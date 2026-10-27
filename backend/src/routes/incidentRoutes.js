const express = require('express');
const {
  createIncident,
  getIncidents,
  updateIncident,
  triggerContainment,
  getCertInDossier,
  getForensicAudit,
} = require('../controllers/incidentController');
const { protect } = require('../middlewares/authMiddleware');
const { validateCsrfToken } = require('../middlewares/csrfMiddleware');

const router = express.Router();

router.use(protect, validateCsrfToken);

router.post('/', createIncident);
router.get('/', getIncidents);
router.patch('/:incidentId', updateIncident);
router.post('/:incidentId/containment', triggerContainment);
router.get('/:incidentId/certin-dossier', getCertInDossier);
router.get('/:incidentId/forensic-audit', getForensicAudit);

module.exports = router;
