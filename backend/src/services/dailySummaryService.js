const DailySummary = require('../models/DailySummary');

/**
 * Upsert the DailySummary document for today based on a closed session and its orders.
 *
 * @param {string} cafeId
 * @param {Object} session  - The closed DiningSession
 * @param {Array}  orders   - All orders belonging to this session
 */
const updateDailySummary = async (cafeId, session, orders) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  // Compute items sold from all orders
  const itemMap = {};
  for (const order of orders) {
    for (const item of order.items || []) {
      const key = String(item.menuItemId);
      if (itemMap[key]) {
        itemMap[key].quantity += item.quantity;
        itemMap[key].revenue += item.price * item.quantity;
      } else {
        itemMap[key] = {
          menuItemId: item.menuItemId,
          itemName: item.itemName,
          quantity: item.quantity,
          revenue: item.price * item.quantity,
        };
      }
    }
  }
  const newItemsSold = Object.values(itemMap);

  // Compute peak hours from orders
  const hourCounts = {};
  for (const order of orders) {
    const hour = new Date(order.createdAt).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }

  // Compute GST breakdown by slab from order taxBreakdown
  const gstMap = {};
  for (const order of orders) {
    for (const tax of order.taxBreakdown || []) {
      const pct = tax.percentage;
      if (pct > 0) {
        gstMap[pct] = (gstMap[pct] || 0) + tax.amount;
      }
    }
  }
  const newGstBreakdown = Object.entries(gstMap).map(([pct, amt]) => ({
    percentage: Number(pct),
    amount: Number(amt),
  }));

  // Determine payment method
  const isOnline = session.paymentMethod === 'paid_online';
  const paymentMethodInc = {
    'paymentMethods.online': isOnline ? 1 : 0,
    'paymentMethods.counter': isOnline ? 0 : 1,
    'paymentMethods.onlineRevenue': isOnline ? session.totalAmount : 0,
    'paymentMethods.counterRevenue': isOnline ? 0 : session.totalAmount,
  };

  try {
    const incOps = {
      totalRevenue: session.totalAmount,
      gstCollected: session.gst,
      orderCount: orders.length,
      sessionCount: 1,
      customerCount: 1,
      ...paymentMethodInc,
    };

    // To prevent race conditions, we use an atomic update.
    // For arrays (itemsSold, peakHours, gstBreakdown), we just push new data.
    // We will aggregate and group them dynamically in the analytics dashboard later
    // if needed, or accept duplicates in the array for now.
    const pushOps = {
      itemsSold: { $each: newItemsSold },
      peakHours: { $each: Object.entries(hourCounts).map(([h, c]) => ({ hour: Number(h), orderCount: c })) },
      gstBreakdown: { $each: newGstBreakdown },
    };

    const summary = await DailySummary.findOneAndUpdate(
      { cafeId, date: startOfDay },
      {
        $inc: incOps,
        $push: pushOps,
      },
      { upsert: true, new: true }
    );

    console.log(`DailySummary updated for cafe ${cafeId} on ${startOfDay.toISOString().slice(0, 10)}`);
    return summary;
  } catch (error) {
    console.error('Failed to update DailySummary:', error.message);
    // Non-blocking — analytics failure should not block payment pipeline
  }
};

module.exports = { updateDailySummary };
