const Invoice = require('../models/Invoice');
const DiningSession = require('../models/DiningSession');
const Cafe = require('../models/Cafe');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const path = require('path');
const fs = require('fs');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendInvoiceEmail } = require('../services/emailService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 1. Download invoice PDF
const downloadInvoicePDF = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const invoice = await Invoice.findOne({ _id: id, cafeId: req.cafeId });
  if (!invoice) {
    return next(new AppError('Invoice not found', 404));
  }

  const filePath = path.join(__dirname, '..', '..', invoice.pdfUrl);
  if (!fs.existsSync(filePath)) {
    return next(new AppError('Invoice PDF file not found on disk', 404));
  }

  res.download(filePath, `${invoice.invoiceNumber}.pdf`);
});

/**
 * Work out who an invoice should go to.
 *
 * The session's own `customerEmail` is only populated when the guest typed one
 * at the table. Plenty of bills are settled by guests who never gave an email,
 * so that field is frequently empty — and an empty `to:` is not a resend, it is
 * a silent no-op that still reported success.
 *
 * Falling back to the linked CRM profile means a customer who gave their email
 * to the cashier once, or verified it at sign-in, can still be reached. An
 * *unverified* profile email is deliberately not used: invoices are legal
 * documents and must not be sent to an address nobody proved they own.
 */
const resolveRecipient = async (session) => {
  if (session.customerEmail) {
    return { email: session.customerEmail, source: 'session' };
  }

  const customer = await findLinkedCustomer(session);
  if (customer && customer.email && customer.emailVerifiedAt) {
    return { email: customer.email, source: 'customer', customer };
  }

  return { email: '', source: 'none', customer: customer || null };
};

const findLinkedCustomer = async (session) => {
  // A session has no customerId of its own — it reaches the profile through
  // the orders placed at that table.
  const order = await Order.findOne({
    sessionId: session._id,
    status: { $ne: 'cancelled' },
    customerId: { $ne: null },
  }).sort({ createdAt: 1 });

  if (!order) return null;
  return Customer.findOne({ _id: order.customerId, cafeId: session.cafeId });
};

// 2. Resend invoice email
const resendInvoiceEmail = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { email } = req.body || {};

  const invoice = await Invoice.findOne({ _id: id, cafeId: req.cafeId });
  if (!invoice) {
    return next(new AppError('Invoice not found', 404));
  }

  const session = await DiningSession.findById(invoice.sessionId);
  if (!session) {
    return next(new AppError('Session not found for this invoice', 404));
  }

  // A staff member supplying an address is linking it to the profile, not just
  // passing a one-off — otherwise the next resend asks again. Persisting is
  // what makes the prompt a fix rather than a repeated chore.
  if (email !== undefined && email !== null && String(email).trim() !== '') {
    const address = String(email).trim().toLowerCase();
    if (!EMAIL_RE.test(address)) {
      throw new AppError('Enter a valid email address', 400);
    }

    const alreadyOnAnother = await Customer.findOne({
      cafeId: req.cafeId,
      email: address,
      _id: { $ne: (await findLinkedCustomer(session))?._id },
    });
    if (alreadyOnAnother) {
      throw new AppError('That email is already linked to another customer', 409);
    }

    session.customerEmail = address;

    const linked = await findLinkedCustomer(session);
    if (linked) {
      linked.email = address;
      await linked.save();
    }
    await session.save();
  }

  const recipient = await resolveRecipient(session);

  if (!recipient.email) {
    // 409, not 200-with-a-failure-flag buried in the body: the caller has to
    // be able to tell "sent" from "we had nobody to send it to".
    return next(
      new AppError(
        'No email address is linked to this bill. Add one to send the invoice.',
        409
      )
    );
  }

  const cafe = await Cafe.findById(req.cafeId);
  const filePath = path.join(__dirname, '..', '..', invoice.pdfUrl);

  if (!fs.existsSync(filePath)) {
    return next(new AppError('Invoice PDF file not found on disk', 404));
  }

  const result = await sendInvoiceEmail(
    recipient.email,
    session.customerName,
    filePath,
    cafe ? cafe.name : 'QRDine Restaurant',
    invoice.invoiceNumber
  );

  res.status(200).json({
    success: true,
    message: result.sent
      ? `Invoice sent to ${recipient.email}`
      : `Email not sent: ${result.reason}`,
    emailSent: result.sent,
    email: recipient.email,
    reason: result.reason || null,
  });
});

module.exports = {
  downloadInvoicePDF,
  resendInvoiceEmail,
  resolveRecipient,
};
