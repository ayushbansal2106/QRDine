const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const Cafe = require('../models/Cafe');

const SUPPLIER_DETAILS = {
  legalName: 'QRDine Technologies Private Limited',
  tradeName: 'QRDine Cloud Platform',
  gstin: '07AAACQ1234M1Z5',
  sacCode: '998313',
  address: 'Saket District Centre, New Delhi 110017',
  stateCode: '07',
  stateName: 'Delhi',
  contactEmail: 'billing@qrdine.com',
};

/**
 * Resolve Indian GST breakdown under SAC 998313.
 */
const resolveSubscriptionTaxBreakdown = (subtotalPaise, recipientGstin = '') => {
  const cleanGstin = (recipientGstin || '').trim().toUpperCase();
  const recipientStateCode = cleanGstin.length >= 2 ? cleanGstin.slice(0, 2) : '07';

  // Intra-state (Delhi -> Delhi) vs Inter-state (Delhi -> Other State)
  const isInterState = cleanGstin.length === 15 && recipientStateCode !== SUPPLIER_DETAILS.stateCode;

  if (isInterState) {
    const igstPaise = Math.round(subtotalPaise * 0.18);
    return {
      taxType: 'inter_state',
      isInterState: true,
      recipientStateCode,
      cgstRate: 0,
      cgstPaise: 0,
      sgstRate: 0,
      sgstPaise: 0,
      igstRate: 0.18,
      igstPaise,
      totalGstPaise: igstPaise,
      totalPaise: subtotalPaise + igstPaise,
    };
  }

  // Intra-state supply
  const cgstPaise = Math.round(subtotalPaise * 0.09);
  const sgstPaise = Math.round(subtotalPaise * 0.09);
  const totalGstPaise = cgstPaise + sgstPaise;

  return {
    taxType: 'intra_state',
    isInterState: false,
    recipientStateCode,
    cgstRate: 0.09,
    cgstPaise,
    sgstRate: 0.09,
    sgstPaise,
    igstRate: 0,
    igstPaise: 0,
    totalGstPaise,
    totalPaise: subtotalPaise + totalGstPaise,
  };
};

/**
 * Helper to calculate subscription tax for quotes and billing summaries.
 */
const calculateSubscriptionTax = ({ amount, recipientGstin = '', recipientStateCode = '' }) => {
  const gstin = recipientGstin || (recipientStateCode ? `${recipientStateCode}AAAAA0000A1Z5` : '');
  const breakdown = resolveSubscriptionTaxBreakdown(amount * 100, gstin);

  return {
    sacCode: SUPPLIER_DETAILS.sacCode,
    isInterState: breakdown.isInterState,
    cgstRate: breakdown.cgstRate * 100,
    cgstAmount: breakdown.cgstPaise / 100,
    sgstRate: breakdown.sgstRate * 100,
    sgstAmount: breakdown.sgstPaise / 100,
    igstRate: breakdown.igstRate * 100,
    igstAmount: breakdown.igstPaise / 100,
    totalTax: breakdown.totalGstPaise / 100,
    totalAmount: breakdown.totalPaise / 100,
  };
};

/**
 * Generate a sequential invoice number for B2B billing conforming to Rule 46.
 * Format: QRD/YYYY-YY/XXXX
 */
let invoiceSequence = 1001;
const generateInvoiceNumber = () => {
  const now = new Date();
  const year = now.getFullYear();
  const nextYearShort = String((year + 1) % 100).padStart(2, '0');
  const seq = String(invoiceSequence++).padStart(4, '0');
  return `QRD/${year}-${nextYearShort}/${seq}`;
};

/**
 * Generate PDF document for subscription tax invoice.
 */
const generateSubscriptionInvoicePDF = async (invoice) => {
  const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'subscription_invoices');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const sanitizedInvoiceNumber = invoice.invoiceNumber.replace(/[\/\\]/g, '-');
  const fileName = `${sanitizedInvoiceNumber}.pdf`;
  const filePath = path.join(uploadsDir, fileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 45 });
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // Header & Title
    doc.fontSize(20).font('Helvetica-Bold').text('TAX INVOICE', { align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#555555').text('(Issued under Rule 46 of CGST Rules, 2017)', { align: 'center' });
    doc.fillColor('#000000').moveDown(1);

    // Supplier vs Recipient Grid
    const yTop = doc.y;
    // Supplier
    doc.fontSize(10).font('Helvetica-Bold').text('SUPPLIER (Service Provider):', 45, yTop);
    doc.fontSize(9).font('Helvetica')
      .text(SUPPLIER_DETAILS.legalName, 45, yTop + 14)
      .text(`GSTIN: ${SUPPLIER_DETAILS.gstin}`, 45, yTop + 27)
      .text(`SAC Code: ${SUPPLIER_DETAILS.sacCode} (Cloud Software SaaS)`, 45, yTop + 40)
      .text(SUPPLIER_DETAILS.address, 45, yTop + 53, { width: 230 })
      .text(`State: ${SUPPLIER_DETAILS.stateName} (Code: ${SUPPLIER_DETAILS.stateCode})`, 45, yTop + 66);

    // Recipient
    const recipient = invoice.recipient || {};
    doc.fontSize(10).font('Helvetica-Bold').text('RECIPIENT (Billed To):', 310, yTop);
    doc.fontSize(9).font('Helvetica')
      .text(recipient.legalName || recipient.tradeName || 'Valued Restaurant Partner', 310, yTop + 14, { width: 240 })
      .text(`GSTIN: ${recipient.gstin || 'Unregistered / Consumer'}`, 310, yTop + 27)
      .text(`Address: ${recipient.address || 'India'}`, 310, yTop + 40, { width: 240 })
      .text(`Place of Supply: State Code ${recipient.stateCode || '07'}`, 310, yTop + 66);

    doc.moveDown(5);

    // Meta: Invoice Number & Date
    const metaY = doc.y + 15;
    doc.strokeColor('#cccccc').lineWidth(0.5).moveTo(45, metaY).lineTo(550, metaY).stroke();
    doc.fontSize(9).font('Helvetica-Bold')
      .text(`Invoice No: ${invoice.invoiceNumber}`, 45, metaY + 6)
      .text(`Date of Issue: ${new Date(invoice.paidAt || invoice.createdAt).toLocaleDateString('en-IN')}`, 220, metaY + 6)
      .text(`Plan Cycle: ${(invoice.cycle || 'monthly').toUpperCase()}`, 420, metaY + 6, { align: 'right' });
    doc.strokeColor('#cccccc').lineWidth(0.5).moveTo(45, metaY + 20).lineTo(550, metaY + 20).stroke();

    // Table Header
    const tableHeaderY = metaY + 30;
    doc.fontSize(9).font('Helvetica-Bold')
      .text('Service Description', 45, tableHeaderY, { width: 220 })
      .text('SAC', 270, tableHeaderY, { width: 50, align: 'center' })
      .text('Cycle / Outlets', 325, tableHeaderY, { width: 75, align: 'center' })
      .text('Taxable Value', 410, tableHeaderY, { width: 65, align: 'right' })
      .text('Total (INR)', 485, tableHeaderY, { width: 65, align: 'right' });

    doc.strokeColor('#cccccc').lineWidth(0.5).moveTo(45, tableHeaderY + 14).lineTo(550, tableHeaderY + 14).stroke();

    // Table Line
    const lineY = tableHeaderY + 20;
    doc.fontSize(9).font('Helvetica')
      .text(`QRDine Platform Subscription — ${invoice.planName}`, 45, lineY, { width: 220 })
      .text(invoice.sacCode, 270, lineY, { width: 50, align: 'center' })
      .text(`${invoice.cycle} (${invoice.outlets || 1} outlet)`, 325, lineY, { width: 75, align: 'center' })
      .text(`Rs. ${(invoice.subtotalPaise / 100).toFixed(2)}`, 410, lineY, { width: 65, align: 'right' })
      .text(`Rs. ${(invoice.totalPaise / 100).toFixed(2)}`, 485, lineY, { width: 65, align: 'right' });

    doc.moveDown(3);

    // Tax Details & Calculations
    const totalsY = doc.y + 10;
    doc.strokeColor('#eeeeee').lineWidth(0.5).moveTo(310, totalsY).lineTo(550, totalsY).stroke();

    let curY = totalsY + 6;
    doc.fontSize(9).font('Helvetica').text('Taxable Subtotal:', 310, curY);
    doc.text(`Rs. ${(invoice.subtotalPaise / 100).toFixed(2)}`, 485, curY, { width: 65, align: 'right' });

    if (invoice.taxType === 'intra_state') {
      curY += 14;
      doc.text('CGST (9.0%):', 310, curY);
      doc.text(`Rs. ${(invoice.cgstPaise / 100).toFixed(2)}`, 485, curY, { width: 65, align: 'right' });

      curY += 14;
      doc.text('SGST (9.0%):', 310, curY);
      doc.text(`Rs. ${(invoice.sgstPaise / 100).toFixed(2)}`, 485, curY, { width: 65, align: 'right' });
    } else {
      curY += 14;
      doc.text('IGST (18.0%):', 310, curY);
      doc.text(`Rs. ${(invoice.igstPaise / 100).toFixed(2)}`, 485, curY, { width: 65, align: 'right' });
    }

    curY += 16;
    doc.strokeColor('#333333').lineWidth(1).moveTo(310, curY).lineTo(550, curY).stroke();
    curY += 5;
    doc.fontSize(11).font('Helvetica-Bold').text('Total Amount Paid:', 310, curY);
    doc.text(`Rs. ${(invoice.totalPaise / 100).toFixed(2)}`, 460, curY, { width: 90, align: 'right' });

    // Reverse charge notice
    doc.moveDown(3);
    doc.fontSize(8).font('Helvetica')
      .text('Tax Payable under Reverse Charge: NO', 45, doc.y)
      .text('Mode of Payment: Electronic Gateway Transfer', 45, doc.y + 11);

    // Footer & Statutory declaration
    doc.moveDown(4);
    doc.fontSize(8).font('Helvetica-Oblique').fillColor('#666666')
      .text(
        'This is a digitally generated tax invoice and does not require a physical signature under Rule 46 of CGST Rules, 2017.',
        { align: 'center' }
      )
      .text(
        'QRDine acts strictly as an Information Technology SaaS Intermediary under Section 79 of the Information Technology Act, 2000.',
        { align: 'center' }
      );

    doc.end();
    writeStream.on('finish', () => resolve(filePath));
    writeStream.on('error', reject);
  });
};

/**
 * Generate in-memory PDF buffer for a subscription tax invoice.
 */
const generateSubscriptionInvoicePdf = async (invoice) => {
  const filePath = await generateSubscriptionInvoicePDF(invoice);
  return fs.readFileSync(filePath);
};

/**
 * Issue and persist a B2B SaaS Tax Invoice for a cafe subscription.
 */
const issueSubscriptionInvoice = async ({
  cafeId,
  subscriptionId = null,
  planKey = 'starter',
  planName,
  cycle,
  billingCycle,
  subtotalPaise,
  amount,
  outlets = 1,
  recipientDetails,
  paymentDetails,
}) => {
  const cafe = await Cafe.findById(cafeId);
  if (!cafe) throw new Error('Cafe not found');

  const resolvedCycle = cycle || billingCycle || 'monthly';
  const resolvedPlanName = planName || `${planKey.toUpperCase()} Subscription Plan`;
  const resolvedSubtotalPaise = subtotalPaise !== undefined ? subtotalPaise : Math.round(Number(amount || 0) * 100);

  const recipientGstin = (recipientDetails && recipientDetails.gstin) || cafe.gstin || '';
  const tax = resolveSubscriptionTaxBreakdown(resolvedSubtotalPaise, recipientGstin);
  const invoiceNumber = generateInvoiceNumber();

  const recipientStateCode = (recipientDetails && recipientDetails.stateCode) || tax.recipientStateCode;

  const invoice = await SubscriptionInvoice.create({
    invoiceNumber,
    cafeId,
    subscriptionId,
    planKey,
    planName: resolvedPlanName,
    cycle: resolvedCycle,
    sacCode: SUPPLIER_DETAILS.sacCode,
    description: `QRDine Cloud Platform SaaS Subscription — ${resolvedPlanName}`,
    outlets,
    basePaise: resolvedSubtotalPaise,
    subtotalPaise: resolvedSubtotalPaise,
    taxType: tax.taxType,
    cgstRate: tax.cgstRate,
    cgstPaise: tax.cgstPaise,
    sgstRate: tax.sgstRate,
    sgstPaise: tax.sgstPaise,
    igstRate: tax.igstRate,
    igstPaise: tax.igstPaise,
    totalPaise: tax.totalPaise,
    supplier: {
      legalName: SUPPLIER_DETAILS.legalName,
      gstin: SUPPLIER_DETAILS.gstin,
      address: SUPPLIER_DETAILS.address,
      stateCode: SUPPLIER_DETAILS.stateCode,
    },
    recipient: {
      legalName: (recipientDetails && recipientDetails.legalName) || cafe.legalName || cafe.name,
      tradeName: (recipientDetails && recipientDetails.tradeName) || cafe.tradeName || cafe.name,
      gstin: recipientGstin,
      address: (recipientDetails && recipientDetails.address) || cafe.address || '',
      stateCode: recipientStateCode,
    },
    status: (paymentDetails && paymentDetails.status) || 'paid',
    paidAt: (paymentDetails && paymentDetails.paidAt) || new Date(),
  });

  // Attach rupee getters for convenience
  invoice.subtotal = invoice.subtotalPaise / 100;
  invoice.totalTax = (invoice.totalPaise - invoice.subtotalPaise) / 100;
  invoice.totalAmount = invoice.totalPaise / 100;

  try {
    const pdfPath = await generateSubscriptionInvoicePDF(invoice);
    invoice.pdfUrl = `/uploads/subscription_invoices/${invoice.invoiceNumber.replace(/[\/\\]/g, '-')}.pdf`;
    await invoice.save();
  } catch (err) {
    invoice.pdfUrl = '';
    await invoice.save();
  }

  return invoice;
};

const getInvoicesForCafe = async (cafeId) => {
  const invoices = await SubscriptionInvoice.find({ cafeId }).sort({ createdAt: -1 }).lean();
  return invoices.map((inv) => ({
    ...inv,
    subtotal: inv.subtotalPaise / 100,
    totalTax: (inv.totalPaise - inv.subtotalPaise) / 100,
    totalAmount: inv.totalPaise / 100,
  }));
};

const getInvoiceById = async (invoiceId, cafeId) => {
  const inv = await SubscriptionInvoice.findOne({ _id: invoiceId, cafeId });
  if (inv) {
    inv.subtotal = inv.subtotalPaise / 100;
    inv.totalTax = (inv.totalPaise - inv.subtotalPaise) / 100;
    inv.totalAmount = inv.totalPaise / 100;
  }
  return inv;
};

module.exports = {
  SUPPLIER_DETAILS,
  resolveSubscriptionTaxBreakdown,
  calculateSubscriptionTax,
  generateInvoiceNumber,
  generateSubscriptionInvoicePDF,
  generateSubscriptionInvoicePdf,
  issueSubscriptionInvoice,
  getInvoicesForCafe,
  getInvoiceById,
};
