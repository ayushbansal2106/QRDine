const asyncHandler = require('../utils/asyncHandler');
const auditService = require('../services/auditService');

// 1. List audit ledger entries (newest first) with filters
const getAuditEvents = asyncHandler(async (req, res) => {
  const { type, from, to, page = 1, limit = 50 } = req.query;

  const { entries, total } = await auditService.listEvents({
    cafeId: req.cafeId,
    type,
    from,
    to,
    page,
    limit,
  });

  res.status(200).json({
    success: true,
    page: Number(page),
    limit: Number(limit),
    totalCount: total,
    totalPages: Math.ceil(total / Number(limit)),
    entries,
  });
});

module.exports = { getAuditEvents };
