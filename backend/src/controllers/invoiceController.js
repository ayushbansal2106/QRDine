const Invoice = require('../models/Invoice');
const DiningSession = require('../models/DiningSession');
const Cafe = require('../models/Cafe');
const path = require('path');
const fs = require('fs');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendInvoiceEmail } = require('../services/emailService');

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

// 2. Resend invoice email
const resendInvoiceEmail = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const invoice = await Invoice.findOne({ _id: id, cafeId: req.cafeId });
  if (!invoice) {
    return next(new AppError('Invoice not found', 404));
  }

  const session = await DiningSession.findById(invoice.sessionId);
  if (!session) {
    return next(new AppError('Session not found for this invoice', 404));
  }

  const cafe = await Cafe.findById(req.cafeId);
  const filePath = path.join(__dirname, '..', '..', invoice.pdfUrl);

  if (!fs.existsSync(filePath)) {
    return next(new AppError('Invoice PDF file not found on disk', 404));
  }

  const result = await sendInvoiceEmail(
    session.customerEmail,
    session.customerName,
    filePath,
    cafe ? cafe.name : 'QRDine Restaurant',
    invoice.invoiceNumber
  );

  res.status(200).json({
    success: true,
    message: result.sent ? 'Invoice email sent successfully' : `Email skipped: ${result.reason}`,
    emailSent: result.sent,
  });
});

module.exports = {
  downloadInvoicePDF,
  resendInvoiceEmail,
};
