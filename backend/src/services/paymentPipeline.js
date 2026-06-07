const DiningSession = require('../models/DiningSession');
const Order = require('../models/Order');
const Invoice = require('../models/Invoice');
const Cafe = require('../models/Cafe');
const Table = require('../models/Table');
const { generateInvoicePDF } = require('./invoiceService');
const { sendInvoiceEmail } = require('./emailService');
const { updateDailySummary } = require('./dailySummaryService');
const socketService = require('./socketService');

/**
 * Execute the full payment pipeline when admin clicks "Mark Paid".
 *
 * Flow:
 *  1. Load session + orders + cafe
 *  2. Compute totals from orders
 *  3. Generate invoice number
 *  4. Update session → status "paid", set totals, invoiceNumber, paymentMethod
 *  5. Generate PDF invoice
 *  6. Create Invoice document
 *  7. Email invoice to customer (async, non-blocking)
 *  8. Update DailySummary
 *  9. Close session → status "closed", endedAt
 * 10. Emit socket events
 *
 * @param {string} sessionId
 * @param {string} paymentMethod  - "paid_counter" | "paid_online"
 * @param {string} cafeId         - From auth context
 * @returns {Promise<{session, invoice}>}
 */
const executePaymentPipeline = async (sessionId, paymentMethod, cafeId) => {
  // 1. Atomic lock: Find active/awaiting session and mark as processing
  const session = await DiningSession.findOneAndUpdate(
    {
      _id: sessionId,
      cafeId,
      status: { $in: ['active', 'bill_requested', 'awaiting_payment'] },
    },
    {
      $set: { status: 'processing' },
    },
    { new: true }
  );

  if (!session) {
    throw new Error('Session not found or already paid/closed/processing');
  }

  // Load related data
  const [orders, cafe, table] = await Promise.all([
    Order.find({ sessionId: session._id }),
    Cafe.findById(cafeId),
    Table.findById(session.tableId),
  ]);

  const tableNumber = table ? table.tableNumber : 'N/A';

  // 2. Compute totals from all linked orders
  let subtotal = 0;
  let totalGST = 0;

  for (const order of orders) {
    subtotal += order.subtotal || 0;
    totalGST += order.totalGST || 0;
  }

  const totalAmount = subtotal + totalGST;

  // 3. Generate invoice number: INV-YYYYMMDD-XXXX
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const invoiceCountToday = await Invoice.countDocuments({
    cafeId,
    generatedAt: { $gte: startOfDay, $lte: endOfDay },
  });

  const seqStr = String(invoiceCountToday + 1).padStart(4, '0');
  const invoiceNumber = `INV-${dateStr}-${seqStr}`;

  // 4. Update session to "paid"
  session.status = 'paid';
  session.subtotal = Number(subtotal.toFixed(2));
  session.gst = Number(totalGST.toFixed(2));
  session.totalAmount = Number(totalAmount.toFixed(2));
  session.invoiceNumber = invoiceNumber;
  session.paymentMethod = paymentMethod;
  await session.save();

  // 5. Generate PDF invoice
  let pdfFilePath;
  try {
    pdfFilePath = await generateInvoicePDF(session, orders, cafe, tableNumber);
    console.log(`Invoice PDF generated: ${pdfFilePath}`);
  } catch (err) {
    console.error('PDF generation failed:', err.message);
    // Continue pipeline — PDF failure shouldn't block payment
    pdfFilePath = null;
  }

  // 6. Create Invoice document
  const pdfUrl = pdfFilePath ? `/uploads/invoices/${invoiceNumber}.pdf` : '';
  const invoice = await Invoice.create({
    cafeId,
    sessionId: session._id,
    invoiceNumber,
    pdfUrl,
    generatedAt: now,
  });

  // 7. Email invoice (non-blocking)
  if (pdfFilePath) {
    sendInvoiceEmail(
      session.customerEmail,
      session.customerName,
      pdfFilePath,
      cafe.name || 'QRDine Restaurant',
      invoiceNumber
    ).catch((err) => {
      console.error('Invoice email failed (non-blocking):', err.message);
    });
  }

  // 8. Update DailySummary
  updateDailySummary(cafeId, session, orders).catch((err) => {
    console.error('DailySummary update failed (non-blocking):', err.message);
  });

  // 9. Close session
  session.status = 'closed';
  session.endedAt = now;
  await session.save();

  // 10. Emit socket events
  const sessionData = {
    sessionId: session._id,
    tableId: session.tableId,
    tableNumber,
    customerName: session.customerName,
    invoiceNumber,
    totalAmount: session.totalAmount,
  };

  socketService.emitSessionPaid(cafeId, sessionData);
  socketService.emitSessionClosed(cafeId, sessionData);

  return { session, invoice };
};

module.exports = { executePaymentPipeline };
