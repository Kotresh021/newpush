import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';

// --- INTERNAL HELPER (To be used by other controllers) ---
export const logAudit = async (actorId, action, details, ip = '0.0.0.0') => {
    try {
        const user = await User.findById(actorId);
        await AuditLog.create({
            actor: actorId,
            actorName: user ? user.name : 'Unknown',
            action,
            details,
            ip
        });
    } catch (error) {
        console.error("Audit Log Error:", error); // Don't crash app if logging fails
    }
};

// --- API ENDPOINT (For Admin Dashboard) ---
// @desc    Get All Logs
// @route   GET /api/audit
export const getAuditLogs = async (req, res) => {
    try {
        const logs = await AuditLog.find()
            .sort({ createdAt: -1 }) // Newest first
            .limit(100); // Limit to last 100 events
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ... existing imports
// @desc Delete Logs (Bulk/Range)
export const deleteLogs = async (req, res) => {
    const { type, ids, startDate, endDate } = req.body;
    try {
        let query = {};

        if (type === 'select' && ids.length > 0) {
            query = { _id: { $in: ids } };
        } else if (type === 'lastMonth') {
            const date = new Date();
            date.setMonth(date.getMonth() - 1);
            query = { createdAt: { $lt: date } };
        } else if (type === 'lastYear') {
            const date = new Date();
            date.setFullYear(date.getFullYear() - 1);
            query = { createdAt: { $lt: date } };
        } else if (type === 'range') {
            query = {
                createdAt: {
                    $gte: new Date(startDate),
                    $lte: new Date(new Date(endDate).setHours(23, 59, 59))
                }
            };
        } else if (type === 'all') {
            query = {}; // Delete everything
        } else {
            return res.status(400).json({ message: "Invalid delete criteria" });
        }

        const result = await AuditLog.deleteMany(query);
        res.json({ message: `Deleted ${result.deletedCount} logs.` });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};