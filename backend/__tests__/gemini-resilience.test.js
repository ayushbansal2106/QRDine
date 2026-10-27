/**
 * Gemini service resilience — retry + model fallback.
 *
 * This is the behaviour that was missing: a transient 503 ("high demand") used
 * to kill the digitisation job outright, and a retired model name produced a
 * single opaque `request_failed`. Both are now distinguished and handled.
 */

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({
  generateContent: mockGenerateContent,
}));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
  SchemaType: {},
}));

jest.mock('../src/config/env', () => ({
  googleApiKey: 'test-key',
  geminiModel: 'gemini-primary',
}));

const geminiService = require('../src/services/geminiService');

const okText = (obj) => ({ response: { text: () => JSON.stringify(obj) } });
const img = [{ mimeType: 'image/png', base64: 'AAAA' }];

// Keep the suite fast: the real delays are 400ms and 1200ms.
jest.useFakeTimers();

const callVision = () =>
  geminiService.generateJsonWithImages({ system: 's', prompt: 'p', schema: null, images: img });

const modelUsed = () => mockGetGenerativeModel.mock.calls.at(-1)[0].model;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Let queued timers fire so retry backoff completes. */
const settle = async () => {
  await jest.runAllTimersAsync();
};

describe('classifyError', () => {
  it('treats 503 high demand as transient', () => {
    expect(geminiService.classifyError('503 Service Unavailable: high demand')).toBe('transient');
  });
  it('treats 429 and quota exhaustion as transient', () => {
    expect(geminiService.classifyError('429 Too Many Requests')).toBe('transient');
    expect(geminiService.classifyError('RESOURCE_EXHAUSTED')).toBe('transient');
  });
  it('treats network faults as transient', () => {
    expect(geminiService.classifyError('fetch failed')).toBe('transient');
    expect(geminiService.classifyError('socket hang up')).toBe('transient');
  });
  it('treats a retired model as retired, not transient', () => {
    expect(geminiService.classifyError('404 Not Found')).toBe('retired');
    expect(geminiService.classifyError('This model is no longer available')).toBe('retired');
  });
  it('treats an invalid key as fatal', () => {
    expect(geminiService.classifyError('API key not valid')).toBe('fatal');
  });
});

describe('generateJsonWithImages — retry', () => {
  it('succeeds on the first try without retrying', async () => {
    mockGenerateContent.mockResolvedValue(okText({ items: [] }));

    const res = await callVision();

    expect(res).toEqual({ ok: true, data: { items: [] } });
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 and succeeds on the same model', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(new Error('503 Service Unavailable: high demand'))
      .mockResolvedValueOnce(okText({ items: [{ name: 'Paneer Tikka' }] }));

    const promise = callVision();
    await settle();
    const res = await promise;

    expect(res.ok).toBe(true);
    expect(res.data.items[0].name).toBe('Paneer Tikka');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(modelUsed()).toBe('gemini-primary');
  });

  it('recovers on a later retry after several throttled attempts', async () => {
    for (let i = 0; i < geminiService.RETRY_DELAYS_MS.length; i += 1) {
      mockGenerateContent.mockRejectedValueOnce(new Error('503 high demand'));
    }
    mockGenerateContent.mockResolvedValueOnce(okText({ items: [{ name: 'Filter Coffee' }] }));

    const promise = callVision();
    await settle();
    const res = await promise;

    expect(res.ok).toBe(true);
    expect(res.data.items[0].name).toBe('Filter Coffee');
    // Exhausts the whole backoff ladder without ever leaving the primary model.
    expect(modelUsed()).toBe('gemini-primary');
    expect(mockGenerateContent).toHaveBeenCalledTimes(
      geminiService.RETRY_DELAYS_MS.length + 1
    );
  });

  it('reports ai_throttled once every retry is exhausted', async () => {
    mockGenerateContent.mockRejectedValue(new Error('503 high demand'));

    const promise = callVision();
    await settle();
    const res = await promise;

    expect(res).toEqual({ ok: false, data: null, reason: 'ai_throttled' });
    // primary: initial try + one per backoff step, then one per fallback.
    // Derived from the exported budget so changing the ladder cannot make
    // this assertion quietly wrong.
    const attempts =
      geminiService.RETRY_DELAYS_MS.length + 1 + geminiService.FALLBACK_MODELS.length;
    expect(mockGenerateContent).toHaveBeenCalledTimes(attempts);
  });
});

describe('generateJsonWithImages — model fallback', () => {
  it('does not retry a retired model and moves to the fallback immediately', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(new Error('404 Not Found: model is no longer available'))
      .mockResolvedValueOnce(okText({ items: [{ name: 'Naan' }] }));

    const promise = callVision();
    await settle();
    const res = await promise;

    expect(res.ok).toBe(true);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2); // one try, then one fallback
    expect(modelUsed()).not.toBe('gemini-primary');
  });

  it('reports ai_model_unavailable when no model in the chain exists', async () => {
    mockGenerateContent.mockRejectedValue(new Error('404 Not Found'));

    const promise = callVision();
    await settle();
    const res = await promise;

    expect(res).toEqual({ ok: false, data: null, reason: 'ai_model_unavailable' });
  });

  it('surfaces a fatal error immediately, without burning the fallback chain', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API key not valid'));

    const res = await callVision();

    expect(res).toEqual({ ok: false, data: null, reason: 'request_failed' });
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});

describe('generateJsonWithImages — content handling', () => {
  it('still reports unparseable_response without retrying', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'not json at all' } });

    const res = await callVision();

    expect(res).toEqual({ ok: false, data: null, reason: 'unparseable_response' });
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('refuses to run with no images', async () => {
    const res = await geminiService.generateJsonWithImages({
      system: 's', prompt: 'p', schema: null, images: [],
    });
    expect(res.reason).toBe('no_images');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});