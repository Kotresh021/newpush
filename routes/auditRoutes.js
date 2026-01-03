import express from 'express';
import { getAuditLogs, deleteLogs } from '../controllers/auditController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, authorize('admin'), getAuditLogs);
router.post('/delete', protect, authorize('admin'), deleteLogs);

export default router;