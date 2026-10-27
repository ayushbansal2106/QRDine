const nodemailer = require('nodemailer');
const env = require('../config/env');
const socketService = require('./socketService');

/**
 * Channel-based notification service.
 *
 * Every outbound message is addressed as `{ channel, to, ... }` so a new
 * transport (SMS, WhatsApp, push) can be added without touching call sites.
 * SMS is intentionally not wired yet: it needs a provider account and DLT
 * registration, so `registerChannel('sms', ...)` is the single seam where that
 * lands. Until then, callers get `{ delivered: false, reason: 'channel_not_configured' }`
 * rather than an exception.
 */

const channels = new Map();

let mailTransport = null;

const getMailTransport = () => {
  if (mailTransport) return mailTransport;
  if (!env.smtpUser || !env.smtpPass) return null;
  mailTransport = nodemailer.createTransport({
    host: env.smtpHost,
    port: Number(env.smtpPort),
    secure: Number(env.smtpPort) === 465,
    auth: { user: env.smtpUser, pass: env.smtpPass },
  });
  return mailTransport;
};

const registerChannel = (name, handler) => {
  channels.set(name, handler);
};

const listChannels = () => Array.from(channels.keys());

const isChannelAvailable = (name) => channels.has(name);

/**
 * Send one notification. Never throws: delivery problems are reported in the
 * result so that a background job (e.g. a manager alert) cannot fail an order.
 */
const send = async ({ channel, to, subject = '', body = '', payload = null, meta = {} }) => {
  const handler = channels.get(channel);
  if (!handler) {
    return { delivered: false, channel, reason: 'channel_not_configured' };
  }

  try {
    const result = await handler({ to, subject, body, payload, meta });
    return { delivered: true, channel, ...(result || {}) };
  } catch (err) {
    console.error(`Notification via "${channel}" failed:`, err.message);
    return { delivered: false, channel, reason: err.message };
  }
};

/** Fan a message out over several channels, returning one result per channel. */
const broadcast = async (channelNames, message) => {
  const results = await Promise.all(channelNames.map((channel) => send({ ...message, channel })));
  return results;
};

// --- Channel: in-app (real-time dashboard alerts) ----------------------------
registerChannel('in_app', async ({ payload }) => {
  if (!payload || !payload.cafeId || !payload.event) {
    throw new Error('in_app channel requires payload.cafeId and payload.event');
  }
  socketService.emitReviewReceived(payload.cafeId, payload.data || {});
  return { emitted: payload.event };
});

// --- Channel: email (manager digests) ---------------------------------------
registerChannel('email', async ({ to, subject, body, meta }) => {
  const transport = getMailTransport();
  if (!transport) return { skipped: true, reason: 'smtp_not_configured' };

  const info = await transport.sendMail({
    from: `"${meta.cafeName || 'QRDine'}" <${env.smtpFrom}>`,
    to,
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
             <h2 style="color:#51604f">${subject}</h2>
             <div>${String(body).replace(/\n/g, '<br/>')}</div>
             <p style="color:#888;font-size:12px">Sent by QRDine</p>
           </div>`,
  });
  return { messageId: info.messageId };
});

// --- Channel: sms (reserved) ------------------------------------------------
// Intentionally unregistered. When a provider is chosen, register it here with
// `registerChannel('sms', handler)`; no call site needs to change.

module.exports = {
  registerChannel,
  listChannels,
  isChannelAvailable,
  send,
  broadcast,
  // Convenience wrapper used by the review engine for manager alerts.
  alertManagers: async ({ cafeId, cafeName, subject, body, payload, to }) => {
    const targets = ['in_app', ...(to ? ['email'] : [])];
    return broadcast(targets, {
      to,
      subject,
      body,
      payload: { cafeId, event: 'manager_alert', data: payload },
    });
  },
};
