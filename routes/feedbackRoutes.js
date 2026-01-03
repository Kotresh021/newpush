import express from 'express';
import {
    submitFeedback,
    getAllFeedbacks,
    getMyFeedbacks,
    replyFeedback,
    deleteFeedbacks
} from '../controllers/feedbackController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Submit feedback (Student)
router.post('/', protect, submitFeedback);

// Get all feedbacks (Admin/Staff)
router.get('/', protect, authorize('admin', 'staff'), getAllFeedbacks);

// Get my feedbacks (Student)
router.get('/my', protect, getMyFeedbacks);

// Reply to feedback (Admin/Staff)
router.put('/:id/reply', protect, authorize('admin', 'staff'), replyFeedback);

// Delete feedbacks (Admin Only) - NEW
router.post('/delete', protect, authorize('admin'), deleteFeedbacks);

export default router;