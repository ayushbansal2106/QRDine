const express = require('express');
const {
  getPilotStatus,
  startPilot,
  logShift,
  advancePhase,
  auditReadiness,
  issueSignoffCertificate,
} = require('../controllers/pilotController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');

const router = express.Router();

// Protected admin routes for pilot operations
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'), validateCsrfToken);

router.get('/status', getPilotStatus);
router.get('/audit', auditReadiness);

router.post('/start', startPilot);
router.post('/log-shift', logShift);
router.post('/advance-phase', advancePhase);
router.post('/signoff', issueSignoffCertificate);

module.exports = router;
