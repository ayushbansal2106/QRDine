const express = require('express');

const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const {
  getTables,
  createTable,
  updateTable,
  deleteTable,
  getTableQr,
  getTablePublic,
} = require('../controllers/tableController');

const router = express.Router();

// Public routes (unauthenticated)
router.get('/public/:id', getTablePublic);

router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'));

router.get('/', getTables);
router.post('/', createTable);
router.get('/:id/qr', getTableQr);
router.put('/:id', updateTable);
router.delete('/:id', deleteTable);

module.exports = router;
