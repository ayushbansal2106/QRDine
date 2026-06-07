const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;

/**
 * Lazily create the SMTP transporter.
 * Returns null if SMTP credentials are not configured.
 */
const getTransporter = () => {
  if (transporter) return transporter;

  if (!env.smtpUser || !env.smtpPass) {
    console.warn('Email service: SMTP_USER / SMTP_PASS not configured. Emails will be skipped.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: Number(env.smtpPort),
    secure: Number(env.smtpPort) === 465,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
  });

  return transporter;
};

/**
 * Send an invoice email to the customer.
 * Gracefully handles failures — logs error but does not throw.
 *
 * @param {string} customerEmail
 * @param {string} customerName
 * @param {string} pdfFilePath   - Absolute path to invoice PDF
 * @param {string} cafeName
 * @param {string} invoiceNumber
 */
const sendInvoiceEmail = async (customerEmail, customerName, pdfFilePath, cafeName, invoiceNumber) => {
  const transport = getTransporter();

  if (!transport) {
    console.log(`Email skipped (no SMTP config): Invoice ${invoiceNumber} for ${customerEmail}`);
    return { sent: false, reason: 'SMTP not configured' };
  }

  try {
    const info = await transport.sendMail({
      from: `"${cafeName}" <${env.smtpFrom}>`,
      to: customerEmail,
      subject: `Your QRDine Invoice from ${cafeName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #51604f;">Thank you for dining with us, ${customerName}!</h2>
          <p>Please find your invoice <strong>${invoiceNumber}</strong> attached to this email.</p>
          <p>We hope you enjoyed your meal at <strong>${cafeName}</strong>.</p>
          <br/>
          <p style="color: #888; font-size: 12px;">Powered by QRDine</p>
        </div>
      `,
      attachments: [
        {
          filename: `${invoiceNumber}.pdf`,
          path: pdfFilePath,
          contentType: 'application/pdf',
        },
      ],
    });

    console.log(`Invoice email sent to ${customerEmail}: ${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    console.error(`Failed to send invoice email to ${customerEmail}:`, error.message);
    return { sent: false, reason: error.message };
  }
};

module.exports = { sendInvoiceEmail };
