const DiningSession = require('../models/DiningSession');
const Order = require('../models/Order');
const Invoice = require('../models/Invoice');
const Cafe = require('../models/Cafe');
const Table = require('../models/Table');
const { generateInvoicePDF } = require('./invoiceService');
const { sendInvoiceEmail } = require('./emailService');
const { updateDailySummary } = require('./dailySummaryService');
const socketService = require('./socketService');
const customerService = require('./customerService');
const orderService = require('./orderService');
const loyaltyService = require('./loyaltyService');
const scratchService = require('./scratchService');
const auditService = require('./auditService');

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
  //
  // `new: false` returns the document as it was *before* the lock, so the
  // status we displaced is known and can be restored if anything below throws.
  const session = await DiningSession.findOneAndUpdate(
    {
      _id: sessionId,
      cafeId,
      status: { $in: ['active', 'bill_requested', 'awaiting_payment'] },
    },
    {
      $set: { status: 'processing' },
    },
    { new: false }
  );

  if (!session) {
    throw new Error('Session not found or already paid/closed/processing');
  }

  const previousStatus = session.status || 'active';

  try {
    // Load related data
    const [orders, cafe, table] = await Promise.all([
      Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } }),
      Cafe.findById(cafeId),
      Table.findById(session.tableId),
    ]);

    const tableNumber = table ? table.tableNumber : 'N/A';

    // 2. Compute totals from all linked orders
    //
    // Shared helper, because this is the number the guest actually pays. When
    // this loop only counted `served` lines, a bill settled while food was still
    // in the kitchen charged ₹0 for a real order.
    const { subtotal, gst: totalGST } = orderService.sumBillableItems(orders);

    let totalAdditions = 0;
    let totalDiscounts = 0;

    if (session.adjustments) {
      for (const adj of session.adjustments) {
        if (adj.type === 'addition') totalAdditions += adj.amount;
        if (adj.type === 'discount') totalDiscounts += adj.amount;
      }
    }

    const totalAmount = Math.max(0, subtotal + totalAdditions - totalDiscounts + totalGST);

    if (orders.length === 0 || totalAmount < 0) {
        throw new Error('Cannot process payment for an empty dining session');
      }

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

    // Module #01 — revenue actually moved, so redraw the live board immediately.
    // Lazily required to keep the service graph acyclic.
    require('./telemetryService').emitRefresh(cafeId, 'session.paid');

    // Module #04 — write the immutable ledger entry for this closed bill (non-blocking)
    auditService
      .recordEvent({
        cafeId,
        type: 'invoice.closed',
        entityType: 'Invoice',
        entityId: invoice._id,
        amount: session.totalAmount,
        staffName: 'system',
        metadata: {
          invoiceNumber,
          sessionId: String(session._id),
          paymentMethod,
          gst: session.gst,
        },
      })
      .catch((err) => console.error('Audit ledger write failed (non-blocking):', err.message));

    // Module #09 — record CRM visits for any linked customers (non-blocking)
    const customerIds = [...new Set(orders.filter((o) => o.customerId).map((o) => String(o.customerId)))];
    for (const customerId of customerIds) {
      const customerOrders = orders.filter(
        (o) => String(o.customerId) === customerId && o.status !== 'cancelled'
      );
      const amount = customerOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      const itemIds = customerOrders.flatMap((o) => o.items.map((i) => i.menuItemId));
      customerService
        .recordVisit({ cafeId, customerId, amount, itemIds })
        .catch((err) => console.error('Customer visit recording failed (non-blocking):', err.message));

      // Module #15 — award loyalty stamps for the settled visit (non-blocking)
      loyaltyService
        .earnStamps({ cafeId, customerId, amount, itemIds, staffName: 'system' })
        .catch((err) => console.error('Loyalty stamping failed (non-blocking):', err.message));

      // Module #16 — issue a scratch card for the settled visit (non-blocking)
      scratchService
        .maybeIssueCard({ cafeId, customerId, amount })
        .catch((err) => console.error('Scratch card issue failed (non-blocking):', err.message));
    }

    return { session, invoice };
  } catch (err) {
    // The lock must never outlive a failure. A session left in `processing`
    // is invisible to the bills board and refuses every retry, so one
    // transient error would strand the table for good.
    await DiningSession.findByIdAndUpdate(session._id, {
      $set: { status: previousStatus },
    });
    throw err;
  }
};

module.exports = { executePaymentPipeline };
