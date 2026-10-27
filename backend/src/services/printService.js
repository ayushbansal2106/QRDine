/**
 * ESC/POS thermal receipt builder (Module #02).
 *
 * Produces a raw command buffer that can be piped to a network/BT/USB thermal
 * printer (58mm or 80mm). The frontend can also render the same receipt as HTML
 * for browser printing when no hardware is available.
 *
 * This module is transport-agnostic: it only builds bytes.
 */

const ESC = '\x1b';
const GS = '\x1d';

const CMD = {
  INIT: `${ESC}@`,
  ALIGN_LEFT: `${ESC}a\x00`,
  ALIGN_CENTER: `${ESC}a\x01`,
  BOLD_ON: `${ESC}E\x01`,
  BOLD_OFF: `${ESC}E\x00`,
  DOUBLE_ON: `${GS}!\x11`,
  DOUBLE_OFF: `${GS}!\x00`,
  CUT: `${GS}V\x00`,
};

const LINE_WIDTH = { 58: 32, 80: 42 };

const padRight = (text, width) => {
  const str = String(text);
  return str.length >= width ? str.slice(0, width) : str + ' '.repeat(width - str.length);
};

const padLeft = (text, width) => {
  const str = String(text);
  return str.length >= width ? str.slice(0, width) : ' '.repeat(width - str.length) + str;
};

/** Two-column row: label on the left, value right-aligned. */
const row = (label, value, width) => {
  const valueStr = String(value);
  const labelSpace = Math.max(0, width - valueStr.length - 1);
  return `${label.slice(0, labelSpace).padEnd(labelSpace)} ${valueStr}`;
};

const formatAmount = (amount, currency = 'INR') => {
  const symbol = currency === 'INR' ? 'Rs.' : `${currency} `;
  return `${symbol}${Number(amount || 0).toFixed(2)}`;
};

/**
 * Render the plain-text body of a receipt.
 * @param {Object} order  Order document (populated tableId optional)
 * @param {Object} cafe   Cafe document (name, receipt settings)
 * @param {Object} [opts] { width, reprint }
 */
const renderReceiptText = (order, cafe = {}, opts = {}) => {
  const width = LINE_WIDTH[opts.width] || LINE_WIDTH[80];
  const currency = cafe.currency || 'INR';
  const lines = [];

  lines.push(cafe.name || 'QRDine');
  if (cafe.address) lines.push(cafe.address);
  if (cafe.phone) lines.push(`Ph: ${cafe.phone}`);
  if (cafe.receipt?.header) lines.push(cafe.receipt.header);
  lines.push('='.repeat(width));

  lines.push(`Order: ${order.orderNumber}`);
  lines.push(`Type : ${(order.orderType || 'dine_in').replace('_', '-').toUpperCase()}`);
  if (order.tableId?.tableNumber) lines.push(`Table: ${order.tableId.tableNumber}`);
  lines.push(`Date : ${new Date(order.createdAt || Date.now()).toLocaleString()}`);
  if (opts.reprint) lines.push('*** REPRINT ***');
  lines.push('-'.repeat(width));

  for (const item of order.items || []) {
    if (item.status === 'cancelled') continue;
    const lineTotal = formatAmount(item.price * item.quantity, currency);
    lines.push(row(`${item.quantity} x ${item.itemName}`, lineTotal, width));
    for (const mod of item.modifiers || []) {
      lines.push(`   + ${mod.name}`);
    }
  }

  lines.push('-'.repeat(width));
  lines.push(row('Subtotal', formatAmount(order.subtotal, currency), width));
  if (order.discountTotal) {
    lines.push(row('Discount', `-${formatAmount(order.discountTotal, currency)}`, width));
  }
  lines.push(row('GST', formatAmount(order.totalGST, currency), width));
  lines.push('='.repeat(width));
  lines.push(row('TOTAL', formatAmount(order.totalAmount, currency), width));
  lines.push('='.repeat(width));

  if (order.payments?.length) {
    for (const payment of order.payments) {
      lines.push(row(payment.method.toUpperCase(), formatAmount(payment.amount, currency), width));
    }
  }

  lines.push('');
  lines.push(cafe.receipt?.footer || 'Thank you for visiting!');
  lines.push('');

  return { text: lines.join('\n'), width };
};

/**
 * Build the ESC/POS byte buffer for a receipt.
 */
const buildEscPosBuffer = (order, cafe = {}, opts = {}) => {
  const { text } = renderReceiptText(order, cafe, opts);
  const parts = [CMD.INIT, CMD.ALIGN_CENTER, CMD.BOLD_ON, '\n', CMD.BOLD_OFF, CMD.ALIGN_LEFT, `${text}\n`, '\n\n', CMD.CUT];
  return Buffer.from(parts.join(''), 'binary');
};

module.exports = { renderReceiptText, buildEscPosBuffer, CMD, LINE_WIDTH };
