const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate a professional invoice PDF for a dining session.
 *
 * @param {Object} session  - DiningSession document (with computed totals)
 * @param {Array}  orders   - Array of Order documents belonging to the session
 * @param {Object} cafe     - Cafe document
 * @param {string} tableNumber - Table display number
 * @returns {Promise<string>} Absolute file path to the generated PDF
 */
const generateInvoicePDF = async (session, orders, cafe, tableNumber) => {
  // Ensure the upload directory exists
  const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'invoices');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const fileName = `${session.invoiceNumber}.pdf`;
  const filePath = path.join(uploadsDir, fileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const writeStream = fs.createWriteStream(filePath);

    doc.pipe(writeStream);

    // ─── Header ────────────────────────────
    const headerTitle = cafe.legalName || cafe.tradeName || cafe.name || 'QRDine Restaurant';
    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text(headerTitle, { align: 'center' });

    if (cafe.legalName && cafe.tradeName && cafe.legalName !== cafe.tradeName) {
      doc
        .fontSize(10)
        .font('Helvetica-Oblique')
        .text(`(Trading as ${cafe.tradeName})`, { align: 'center' });
    }

    if (cafe.gstin) {
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .text(`GSTIN: ${cafe.gstin}`, { align: 'center' });
    }
    if (cafe.fssaiNumber) {
      doc
        .fontSize(9)
        .font('Helvetica')
        .text(`FSSAI Lic. No: ${cafe.fssaiNumber}`, { align: 'center' });
    }
    if (cafe.taxMode === 'composite_5') {
      doc
        .fontSize(8)
        .font('Helvetica-Oblique')
        .fillColor('#555555')
        .text('Composition Taxable Person, not eligible to collect tax on supplies', { align: 'center' })
        .fillColor('#000000');
    }

    if (cafe.address) {
      doc
        .fontSize(9)
        .font('Helvetica')
        .text(cafe.address, { align: 'center' });
    }
    if (cafe.phone) {
      doc.text(`Phone: ${cafe.phone}`, { align: 'center' });
    }
    if (cafe.email) {
      doc.text(cafe.email, { align: 'center' });
    }

    doc.moveDown(0.5);

    // ─── Invoice Meta ──────────────────────
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(`Invoice #${session.invoiceNumber}`, { align: 'center' });

    doc.moveDown(0.3);

    const dateStr = new Date(session.endedAt || session.startedAt).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc.fontSize(10).font('Helvetica').text(`Date: ${dateStr}`, { align: 'center' });

    doc.moveDown(1);

    // ─── Customer Info ─────────────────────
    doc.fontSize(11).font('Helvetica-Bold').text('Customer:');
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`${session.customerName}`)
      .text(`${session.customerEmail}`)
      .text(`Table ${tableNumber}`);

    doc.moveDown(1);

    // ─── Separator ─────────────────────────
    const drawLine = () => {
      doc
        .strokeColor('#cccccc')
        .lineWidth(0.5)
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .stroke();
      doc.moveDown(0.5);
    };

    drawLine();

    // ─── Items Table Header ────────────────
    const tableTop = doc.y;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Item', 50, tableTop, { width: 250 });
    doc.text('Qty', 310, tableTop, { width: 50, align: 'center' });
    doc.text('Price', 370, tableTop, { width: 80, align: 'right' });
    doc.text('Total', 460, tableTop, { width: 85, align: 'right' });

    doc.moveDown(0.5);
    drawLine();

    // ─── Items ─────────────────────────────
    doc.font('Helvetica').fontSize(10);

    // Aggregate items across all orders
    const itemMap = {};
    for (const order of orders) {
      for (const item of order.items || []) {
        const key = `${item.menuItemId}-${item.price}`;
        if (itemMap[key]) {
          itemMap[key].quantity += item.quantity;
        } else {
          itemMap[key] = {
            name: item.itemName,
            quantity: item.quantity,
            price: item.price,
            gstPercentage: item.gstPercentage || 0,
          };
        }
      }
    }

    const aggregatedItems = Object.values(itemMap);

    for (const item of aggregatedItems) {
      const y = doc.y;
      const lineTotal = item.price * item.quantity;
      doc.text(item.name, 50, y, { width: 250 });
      doc.text(String(item.quantity), 310, y, { width: 50, align: 'center' });
      doc.text(`₹${item.price.toFixed(2)}`, 370, y, { width: 80, align: 'right' });
      doc.text(`₹${lineTotal.toFixed(2)}`, 460, y, { width: 85, align: 'right' });
      doc.moveDown(0.3);
    }

    doc.moveDown(0.5);
    drawLine();

    // ─── Totals ────────────────────────────
    const totalsX = 370;
    const totalsValX = 460;
    const totalsWidth = 85;

    doc.font('Helvetica').fontSize(10);
    doc.text('Subtotal', totalsX, doc.y, { width: 80 });
    doc.text(`₹${session.subtotal.toFixed(2)}`, totalsValX, doc.y - doc.currentLineHeight(), {
      width: totalsWidth,
      align: 'right',
    });
    doc.moveDown(0.3);

    let totalAdditions = 0;
    let totalDiscounts = 0;
    if (session.adjustments && session.adjustments.length > 0) {
      for (const adj of session.adjustments) {
        if (adj.type === 'addition') totalAdditions += adj.amount;
        if (adj.type === 'discount') totalDiscounts += adj.amount;
      }
    }

    if (totalAdditions > 0) {
      doc.text('Additions', totalsX, doc.y, { width: 80 });
      doc.fillColor('#006400'); // Optional: dark green for addition, or keep black
      doc.text(`+₹${totalAdditions.toFixed(2)}`, totalsValX, doc.y - doc.currentLineHeight(), {
        width: totalsWidth,
        align: 'right',
      });
      doc.fillColor('#000000');
      doc.moveDown(0.3);
    }

    if (totalDiscounts > 0) {
      doc.text('Discounts', totalsX, doc.y, { width: 80 });
      doc.fillColor('#cc0000'); // Optional: red for discount, or keep black
      doc.text(`-₹${totalDiscounts.toFixed(2)}`, totalsValX, doc.y - doc.currentLineHeight(), {
        width: totalsWidth,
        align: 'right',
      });
      doc.fillColor('#000000');
      doc.moveDown(0.3);
    }

    // GST breakdown per percentage
    const gstBreakdown = {};
    for (const item of aggregatedItems) {
      const pct = item.gstPercentage;
      const lineSubtotal = item.price * item.quantity;
      const lineGst = (lineSubtotal * pct) / 100;
      if (pct > 0) {
        if (!gstBreakdown[pct]) gstBreakdown[pct] = 0;
        gstBreakdown[pct] += lineGst;
      }
    }

    for (const [pct, amount] of Object.entries(gstBreakdown)) {
      doc.text(`GST (${pct}%)`, totalsX, doc.y, { width: 80 });
      doc.text(`₹${amount.toFixed(2)}`, totalsValX, doc.y - doc.currentLineHeight(), {
        width: totalsWidth,
        align: 'right',
      });
      doc.moveDown(0.3);
    }

    doc.moveDown(0.3);
    drawLine();

    doc.fontSize(13).font('Helvetica-Bold');
    doc.text('Total', totalsX, doc.y, { width: 80 });
    doc.text(`₹${session.totalAmount.toFixed(2)}`, totalsValX, doc.y - doc.currentLineHeight(), {
      width: totalsWidth,
      align: 'right',
    });

    doc.moveDown(1.5);

    // ─── Payment Status ────────────────────
    doc.fontSize(11).font('Helvetica-Bold').text('Payment Status: ', { continued: true });
    doc.font('Helvetica').text('Paid');

    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica');
    const methodLabel =
      session.paymentMethod === 'paid_counter'
        ? 'Paid at Counter'
        : session.paymentMethod === 'paid_online'
          ? 'Paid Online'
          : 'Pending';
    doc.text(`Method: ${methodLabel}`);

    // ─── Footer ────────────────────────────
    doc.moveDown(1.5);
    const legalEntity = cafe.legalName || cafe.tradeName || cafe.name || 'Restaurant';
    const fssaiLic = cafe.fssaiNumber || 'Applied For';

    doc
      .fontSize(8)
      .font('Helvetica-Oblique')
      .fillColor('#666666')
      .text(
        `Food preparation, allergen declaration, and hygiene are managed exclusively by ${legalEntity} (FSSAI Lic. No. ${fssaiLic}). QRDine is a software intermediary under Section 79 of the Information Technology Act, 2000.`,
        { align: 'center' }
      );

    doc.moveDown(0.8);
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#888888')
      .text('Thank you for dining with us!', { align: 'center' })
      .text('Powered by QRDine Cloud Platform', { align: 'center' });

    doc.end();

    writeStream.on('finish', () => resolve(filePath));
    writeStream.on('error', reject);
  });
};

/**
 * Generate invoice PDF as Buffer (convenience wrapper for downloads and tests).
 */
const generateInvoicePdf = async (orderOrSession, cafe) => {
  const session = {
    invoiceNumber: orderOrSession.invoiceNumber || orderOrSession.orderNumber || `INV-${Date.now()}`,
    subtotal: orderOrSession.subtotal || 0,
    totalGST: orderOrSession.totalGST || 0,
    totalAmount: orderOrSession.totalAmount || 0,
    paymentMethod: orderOrSession.paymentMethod || 'cash',
    completedAt: orderOrSession.createdAt || new Date(),
  };
  const orders = Array.isArray(orderOrSession.items) ? [orderOrSession] : [];
  const filePath = await generateInvoicePDF(session, orders, cafe || {}, '1');
  return fs.readFileSync(filePath);
};

module.exports = { generateInvoicePDF, generateInvoicePdf };
