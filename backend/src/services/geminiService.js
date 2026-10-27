const env = require('../config/env');

/**
 * Module #18 — thin, defensive wrapper around the Google Gemini API.
 *
 * Rules enforced here:
 *  - The API key is read from the server environment only. It is never sent to
 *    the browser, and no customer PII is ever placed in a prompt by callers.
 *  - The SDK is required lazily, so the whole backend still boots (and the test
 *    suite still runs) on a machine with no key installed.
 *  - Every call is non-throwing: callers get `{ ok, data | reason }` and decide
 *    how to degrade. A cafe with AI switched off must still be able to collect
 *    ratings and reply to reviews by hand.
 */

let sdk = null;
let sdkLoadFailed = false;

const loadSdk = () => {
  if (sdk || sdkLoadFailed) return sdk;
  try {
    // eslint-disable-next-line global-require
    sdk = require('@google/generative-ai');
  } catch (err) {
    sdkLoadFailed = true;
    console.warn('Gemini service: @google/generative-ai is not installed. AI features are disabled.');
  }
  return sdk;
};

const isConfigured = () => Boolean(env.googleApiKey);

const isEnabled = () => isConfigured() && Boolean(loadSdk());

// ── Resilience ──────────────────────────────────────────────────────────────
// Gemini throttles aggressively under load ("503 ... high demand"), and a
// cafe digitising a menu at peak service is exactly when that happens. A
// single transient blip used to surface to the user as a dead job, so calls
// now retry briefly and then walk a fallback chain.
//
// A retired model (404) is NOT retryable — retrying it wastes the user's
// time — so it advances straight to the next model.
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash'];
// Measured throttling is bursty rather than sustained: the same model and
// payload succeeded on the third attempt seconds after two failures, and
// failed outright on a neighbouring run. A short backoff ladder converts most
// of those blips into a successful scan; the cost is a longer worst case
// (~8s of waiting plus the calls themselves) on a job the owner is watching.
const RETRY_DELAYS_MS = [500, 1500, 3000];

const TRANSIENT_PATTERNS = [
  /503/, /429/, /high demand/i, /resource[ _-]?exhausted/i, /unavailable/i,
  /overloaded/i, /timed?\s?out/i, /econnreset/i, /etimedout/i,
  /socket hang up/i, /fetch failed/i, /network error/i, /eai_again/i,
];
const RETIRED_PATTERNS = [/404/, /no longer available/i, /is not found/i, /unknown model/i];

const classifyError = (message) => {
  const msg = String(message || '');
  if (RETIRED_PATTERNS.some((re) => re.test(msg))) return 'retired';
  if (TRANSIENT_PATTERNS.some((re) => re.test(msg))) return 'transient';
  return 'fatal';
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Try `call(model)` against the configured model, then each fallback.
 *
 * `call` must throw to signal failure; whatever it resolves to on success is
 * passed straight back. Returns `{ value }` or `{ reason }`.
 */
const withResilience = async ({ call }) => {
  const chain = [env.geminiModel, ...FALLBACK_MODELS.filter((m) => m !== env.geminiModel)];
  let sawTransient = false;

  for (const model of chain) {
    if (model !== chain[0]) {
      console.warn(`Gemini: falling back to ${model}.`);
    }
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const value = await call(model);
        if (model !== chain[0]) {
          console.warn(`Gemini: ${model} answered after ${chain[0]} failed.`);
        }
        return { value };
      } catch (err) {
        const kind = classifyError(err && err.message);

        if (kind === 'retired') {
          console.warn(`Gemini: model ${model} is unavailable (${err.message}).`);
          break; // try the next model, do not burn retries on a dead name
        }

        if (kind === 'fatal') {
          // A bad key or malformed request is model-independent, so stop the
          // whole chain rather than burning it against each fallback.
          throw err;
        }

        sawTransient = true;
        const isLastAttempt = attempt === RETRY_DELAYS_MS.length;
        // Retry on the primary model only; the fallbacks each get a single
        // attempt, since a throttled account will throttle them too.
        if (isLastAttempt || model !== chain[0]) {
          // Logged even when not retrying, so a fully-throttled chain is
          // visible in the logs instead of looking like a silent failure.
          console.warn(
            `Gemini: ${model} unavailable (${kind}): ${String(err.message).slice(0, 120)}`
          );
          break;
        }

        const delay = RETRY_DELAYS_MS[attempt];
        console.warn(`Gemini: ${model} busy (attempt ${attempt + 1}), retrying in ${delay}ms.`);
        await sleep(delay);
      }
    }
  }

  return { reason: sawTransient ? 'ai_throttled' : 'ai_model_unavailable' };
};

const extractJson = (text) => {
  if (!text) return null;
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch (innerErr) {
      return null;
    }
  }
};

/**
 * Ask the model for a JSON object matching `schema`.
 *
 * @param {Object} options
 * @param {string} options.system   System instruction (role + constraints).
 * @param {string} options.prompt    User content to analyse.
 * @param {Object} options.schema    responseSchema describing the JSON shape.
 * @returns {Promise<{ok: boolean, data: Object|null, reason?: string}>}
 */
const generateJson = async ({ system, prompt, schema }) => {
  if (!isEnabled()) {
    return { ok: false, data: null, reason: 'ai_not_configured' };
  }

  try {
    const { GoogleGenerativeAI, SchemaType } = loadSdk();

    const run = await withResilience({
      call: async (modelName) => {
        const genAI = new GoogleGenerativeAI(env.googleApiKey);
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: system,
          generationConfig: {
            responseMimeType: 'application/json',
            ...(schema ? { responseSchema: schema } : {}),
            temperature: 0.4,
          },
        });
        const result = await model.generateContent(prompt);
        const text = result && result.response ? result.response.text() : null;
        return extractJson(text);
      },
    });

    if ('reason' in run) {
      return { ok: false, data: null, reason: run.reason };
    }

    const data = run.value;
    if (!data) {
      return { ok: false, data: null, reason: 'unparseable_response' };
    }

    return { ok: true, data };
  } catch (err) {
    console.error('Gemini request failed:', err.message);
    return { ok: false, data: null, reason: 'request_failed' };
  }
};

/**
 * Multimodal JSON completion (AI menu digitisation).
 *
 * `images` is a list of `{ mimeType, base64 }` parts sent ahead of the prompt.
 * Kept separate from `generateJson` so the review-engine path stays
 * text-only and its behaviour cannot regress when this is added.
 */
const generateJsonWithImages = async ({ system, prompt, schema, images }) => {
  if (!isEnabled()) {
    return { ok: false, data: null, reason: 'ai_not_configured' };
  }

  if (!Array.isArray(images) || images.length === 0) {
    return { ok: false, data: null, reason: 'no_images' };
  }

  try {
    const { GoogleGenerativeAI } = loadSdk();

    const run = await withResilience({
      call: async (modelName) => {
        const genAI = new GoogleGenerativeAI(env.googleApiKey);

        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: system,
          generationConfig: {
            responseMimeType: 'application/json',
            ...(schema ? { responseSchema: schema } : {}),
            // Low temperature: this is transcription with structure, not
            // creative writing. Prices and names must be reproduced,
            // not embellished.
            temperature: 0.1,
          },
        });

        const parts = [
          ...images.map((img) => ({
            inlineData: { data: img.base64, mimeType: img.mimeType },
          })),
          prompt,
        ];

        const result = await model.generateContent(parts);
        const text = result && result.response ? result.response.text() : null;
        return extractJson(text);
      },
    });

    if ('reason' in run) {
      return { ok: false, data: null, reason: run.reason };
    }

    const data = run.value;
    if (!data) {
      return { ok: false, data: null, reason: 'unparseable_response' };
    }

    return { ok: true, data };
  } catch (err) {
    console.error('Gemini vision request failed:', err.message);
    return { ok: false, data: null, reason: 'request_failed' };
  }
};

/** Plain-text completion (used for the owner reply when JSON is not needed). */
const generateText = async ({ system, prompt }) => {
  if (!isEnabled()) {
    return { ok: false, data: null, reason: 'ai_not_configured' };
  }

  try {
    const { GoogleGenerativeAI } = loadSdk();

    const run = await withResilience({
      call: async (modelName) => {
        const genAI = new GoogleGenerativeAI(env.googleApiKey);
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: system,
          generationConfig: { temperature: 0.6 },
        });
        const result = await model.generateContent(prompt);
        const text = result && result.response ? result.response.text() : null;
        return text ? String(text).trim() : null;
      },
    });

    if ('reason' in run) {
      return { ok: false, data: null, reason: run.reason };
    }

    return run.value
      ? { ok: true, data: run.value }
      : { ok: false, data: null, reason: 'empty_response' };
  } catch (err) {
    console.error('Gemini text request failed:', err.message);
    return { ok: false, data: null, reason: 'request_failed' };
  }
};

const OBJECT = 'OBJECT';
const STRING = 'STRING';
const ARRAY = 'ARRAY';
const NUMBER = 'NUMBER';
const BOOLEAN = 'BOOLEAN';

/**
 * Build a plain-JSON schema description. Passing raw string constants keeps this
 * file independent of the SDK's `SchemaType` enum while still producing a valid
 * responseSchema.
 */
const buildSchema = (fields) => {
  const mapType = (type) => {
    switch (type) {
      case 'string':
        return STRING;
      case 'number':
        return NUMBER;
      case 'boolean':
        return BOOLEAN;
      case 'array':
        return ARRAY;
      default:
        return OBJECT;
    }
  };

  const properties = {};
  const required = [];
  for (const [key, def] of Object.entries(fields)) {
    properties[key] = {
      type: mapType(def.type),
      ...(def.description ? { description: def.description } : {}),
      ...(def.type === 'array'
        ? { items: { type: def.itemsType === 'number' ? NUMBER : STRING } }
        : {}),
      ...(def.enum ? { enum: def.enum } : {}),
    };
    if (def.required) required.push(key);
  }

  return {
    type: OBJECT,
    properties,
    ...(required.length ? { required } : {}),
  };
};

module.exports = {
  classifyError,
  FALLBACK_MODELS,
  RETRY_DELAYS_MS,
  isConfigured,
  isEnabled,
  generateJson,
  generateJsonWithImages,
  generateText,
  buildSchema,
  SchemaTypeStrings: { OBJECT, STRING, ARRAY, NUMBER, BOOLEAN },
};
