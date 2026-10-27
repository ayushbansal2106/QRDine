const Customer = require('../models/Customer');
const Order = require('../models/Order');
const customerService = require('../services/customerService');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const csvCell = (value) => {
  const str = value === null || value === undefined ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
};

// 0. Exact phone lookup for the POS till.
//
// The cashier needs to know "have I served this person before?" the moment a
// number is dialled, before the order is placed. `getCustomers` cannot answer
// that: its search is a case-insensitive substring match over name/phone/email,
// so "98765" would match a dozen customers and the cashier would have to guess
// which one is meant. This is an exact phone match and returns nothing when the
// number is unknown, which is the signal to create a fresh profile.
const lookupCustomerByPhone = asyncHandler(async (req, res) => {
  const { phone } = req.query;

  if (!String(phone || '').trim()) {
    throw new AppError('phone is required', 400);
  }

  // Shared resolution with the POS and OTP sign-in. An exact match on the raw
  // string reported "new number" for a customer who had in fact paid at the
  // counter, purely because one path stored `9996696235` and the other `91…`.
  const customer = await customerService.findByPhone(req.cafeId, phone);

  if (!customer) {
    return res.status(200).json({ success: true, found: false, customer: null });
  }

  res.status(200).json({
    success: true,
    found: true,
    customer: {
      id: String(customer._id),
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      visitCount: customer.visitCount || 0,
      lifetimeSpend: customer.lifetimeSpend || 0,
    },
  });
});

// 1. List customers (search / sort / paginate)
const getCustomers = asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 25, sort = 'recent' } = req.query;
  const filter = { cafeId: req.cafeId };

  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: regex }, { phone: regex }, { email: regex }];
  }

  const sortMap = {
    recent: { lastVisitAt: -1, createdAt: -1 },
    spend: { lifetimeSpend: -1 },
    visits: { visitCount: -1 },
    name: { name: 1 },
  };
  const sortSpec = sortMap[sort] || sortMap.recent;

  const skip = (Number(page) - 1) * Number(limit);
  const [customers, totalCount] = await Promise.all([
    Customer.find(filter).sort(sortSpec).skip(skip).limit(Number(limit)),
    Customer.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    page: Number(page),
    limit: Number(limit),
    totalCount,
    totalPages: Math.ceil(totalCount / Number(limit)),
    customers,
  });
});

// 2. Customer profile + recent order history
const getCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const customer = await Customer.findOne({ _id: id, cafeId: req.cafeId });
  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  const orders = await Order.find({ cafeId: req.cafeId, customerId: customer._id })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('orderNumber orderType status totalAmount createdAt items');

  res.status(200).json({ success: true, customer, orders });
});

// 3. Update profile notes / preferences (Module #09)
const updateCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const customer = await Customer.findOne({ _id: id, cafeId: req.cafeId });
  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  const allowed = ['name', 'email', 'phone', 'notes', 'dietary', 'tags', 'birthday'];
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      customer[field] = field === 'birthday' && req.body[field] ? new Date(req.body[field]) : req.body[field];
    }
  }

  if (req.body.dietary === undefined && req.body.tags === undefined && req.body.birthday === undefined) {
    // nothing extra
  }

  await customer.save();
  res.status(200).json({ success: true, message: 'Customer updated', customer });
});

// 4. Export directory as CSV (Module #09)
const exportCustomersCsv = asyncHandler(async (req, res) => {
  const customers = await Customer.find({ cafeId: req.cafeId }).sort({ lifetimeSpend: -1 });

  const header = [
    'Name',
    'Phone',
    'Email',
    'Visits',
    'Lifetime Spend',
    'Avg Spend',
    'Last Visit',
    'Dietary',
    'Tags',
    'Notes',
  ].join(',');

  const rows = customers.map((c) =>
    [
      csvCell(c.name),
      csvCell(c.phone),
      csvCell(c.email),
      c.visitCount,
      c.lifetimeSpend,
      c.avgSpend,
      csvCell(c.lastVisitAt ? new Date(c.lastVisitAt).toISOString() : ''),
      csvCell((c.dietary || []).join('; ')),
      csvCell((c.tags || []).join('; ')),
      csvCell(c.notes),
    ].join(',')
  );

  const csv = [header, ...rows].join('\n');
  const filename = `customers-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
});

module.exports = {
  lookupCustomerByPhone,
  getCustomers,
  getCustomer,
  updateCustomer,
  exportCustomersCsv,
};
