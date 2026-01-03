import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import BookCopy from '../models/BookCopy.js';
import SystemConfig from '../models/SystemConfig.js';
import { logAudit } from './auditController.js';
import sendEmail from '../utils/sendEmail.js';

// @desc    Issue a Book (Atomic Check & Set)
// @route   POST /api/circulation/issue
export const issueBook = async (req, res) => {
    const { studentId, isbn, copyId } = req.body;

    try {
        let config = await SystemConfig.findOne();
        if (!config) config = await SystemConfig.create({});

        const student = await User.findById(studentId);
        if (!student) return res.status(404).json({ message: 'Student not found' });
        if (!student.isActive) return res.status(400).json({ message: 'Student account is blocked' });

        const activeCount = await Transaction.countDocuments({ student: student._id, status: 'Issued' });
        if (activeCount >= config.maxBooksPerStudent) {
            return res.status(400).json({ message: `Limit reached (${config.maxBooksPerStudent} books max)` });
        }

        let targetCopy;

        if (copyId) {
            targetCopy = await BookCopy.findOneAndUpdate(
                { copyNumber: copyId, status: 'Available' },
                { status: 'Issued' },
                { new: true }
            );
            if (!targetCopy) return res.status(400).json({ message: 'Copy is not available (Already Issued or Lost)' });
        } else {
            const book = await Book.findOne({ isbn });
            if (!book) return res.status(404).json({ message: 'Book ISBN not found' });

            //Using 'book' (the object ID field) instead of 'bookId'
            targetCopy = await BookCopy.findOneAndUpdate(
                { book: book._id, status: 'Available' },
                { status: 'Issued' },
                { new: true }
            );
            if (!targetCopy) return res.status(400).json({ message: 'No copies currently available' });
        }

        // Using 'targetCopy.book' for the ID reference
        await Book.findByIdAndUpdate(targetCopy.book, { $inc: { availableCopies: -1 } });

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + config.issueDaysLimit);

        const transaction = await Transaction.create({
            student: student._id,
            book: targetCopy.book, // Correct field name for Transaction
            copyId: targetCopy.copyNumber,
            dueDate,
            status: 'Issued',
            isFinePaid: false
        });

        if (req.user) await logAudit(req.user._id, 'ISSUE_BOOK', `Issued ${targetCopy.copyNumber} to ${student.registerNumber}`);

        res.status(201).json({
            message: 'Book Issued Successfully',
            copy: targetCopy.copyNumber,
            transaction,
            dueDate
        });

    } catch (error) {
        if (req.body.copyId) {
            await BookCopy.findOneAndUpdate({ copyNumber: req.body.copyId }, { status: 'Available' });
        }
        res.status(500).json({ message: error.message });
    }
};

// @desc    Return a Book (Fine Logic)
// @route   POST /api/circulation/return
export const returnBook = async (req, res) => {
    const { copyId } = req.body;

    try {
        let config = await SystemConfig.findOne();
        if (!config) config = await SystemConfig.create({});

        const transaction = await Transaction.findOne({ copyId, status: 'Issued' }).populate('student', 'name email');

        if (!transaction) {
            const checkCopy = await BookCopy.findOne({ copyNumber: copyId });
            if (checkCopy && checkCopy.status === 'Available') {
                return res.status(400).json({ message: 'Book is already marked Returned.' });
            }
            return res.status(404).json({ message: 'No active Issue record found for this copy.' });
        }

        const today = new Date();
        const dueDate = new Date(transaction.dueDate);
        let fine = 0;

        const todayMidnight = new Date(today.setHours(0, 0, 0, 0));
        const dueMidnight = new Date(dueDate.setHours(0, 0, 0, 0));

        if (todayMidnight > dueMidnight) {
            const diffTime = Math.abs(todayMidnight - dueMidnight);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            fine = diffDays * config.finePerDay;
        }

        transaction.returnDate = new Date();
        transaction.status = 'Returned';
        transaction.fine = fine;
        transaction.isFinePaid = (fine === 0);
        await transaction.save();

        await BookCopy.findOneAndUpdate({ copyNumber: copyId }, { status: 'Available' });

        const copy = await BookCopy.findOne({ copyNumber: copyId });
        await Book.findByIdAndUpdate(copy.book, { $inc: { availableCopies: 1 } });

        if (req.user) await logAudit(req.user._id, 'RETURN_BOOK', `Returned ${copyId}. Fine: ₹${fine}`);

        res.json({
            message: 'Book Returned Successfully',
            fine,
            student: transaction.student.name
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get Dashboard Stats (With Department Activity)
// @route   GET /api/circulation/dashboard-stats
export const getDashboardStats = async (req, res) => {
    try {
        const totalBooks = await Book.countDocuments();
        const totalStudents = await User.countDocuments({ role: 'student', isActive: true });
        const activeIssues = await Transaction.countDocuments({ status: 'Issued' });

        const fineAgg = await Transaction.aggregate([
            { $group: { _id: null, total: { $sum: "$fine" } } }
        ]);
        const totalFine = fineAgg.length > 0 ? fineAgg[0].total : 0;

        const recentActivity = await Transaction.find()
            .sort({ updatedAt: -1 })
            .limit(5)
            .populate('student', 'name')
            .populate('book', 'title');

        // Department Activity Aggregation
        const deptStats = await Transaction.aggregate([
            {
                $lookup: {
                    from: 'users', // Must match your MongoDB collection name (usually lowercase plural of model)
                    localField: 'student',
                    foreignField: '_id',
                    as: 'studentInfo'
                }
            },
            { $unwind: '$studentInfo' },
            {
                $group: {
                    _id: '$studentInfo.department',
                    count: { $sum: 1 }
                }
            }
        ]);

        const deptActivity = {
            labels: deptStats.map(d => d._id || 'Unknown'),
            data: deptStats.map(d => d.count)
        };

        res.json({ totalBooks, totalStudents, activeIssues, totalFine, recentActivity, deptActivity });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get All Transaction History
export const getHistory = async (req, res) => {
    try {
        const history = await Transaction.find()
            .populate('student', 'name registerNumber department')
            .populate('book', 'title')
            .sort({ issueDate: -1 });
        res.json(history);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get Unpaid Fines
export const getUnpaidFines = async (req, res) => {
    try {
        const fines = await Transaction.find({ fine: { $gt: 0 }, isFinePaid: false })
            .populate('student', 'name registerNumber email')
            .populate('book', 'title')
            .sort({ dueDate: 1 });
        res.json(fines);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Mark Fine as Paid
// @desc    Mark Fine as Paid
export const collectFine = async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id)
            .populate('student', 'name email registerNumber department')
            .populate('book', 'title isbn');

        if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

        transaction.isFinePaid = true;
        await transaction.save();

        // Send Email Notification to Student with Receipt
        if (transaction.student && transaction.student.email) {
            const emailHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
                        .container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
                        .header { background-color: #27ae60; padding: 25px; text-align: center; }
                        .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
                        .content { padding: 30px; color: #333; line-height: 1.6; }
                        .receipt-box { background-color: #f8f9fa; border: 2px solid #2ecc71; border-radius: 8px; padding: 20px; margin: 20px 0; }
                        .amount { font-size: 36px; color: #27ae60; font-weight: bold; text-align: center; margin: 10px 0; }
                        .details { border-top: 1px solid #eee; padding-top: 15px; margin-top: 15px; }
                        .detail-row { display: flex; justify-content: space-between; margin-bottom: 10px; }
                        .detail-label { color: #666; font-weight: 600; }
                        .detail-value { color: #333; }
                        .footer { background-color: #f1f2f6; padding: 15px; text-align: center; font-size: 12px; color: #7f8c8d; border-top: 1px solid #eee; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>✅ Fine Payment Receipt</h1>
                        </div>
                        <div class="content">
                            <p>Hello <strong>${transaction.student.name}</strong>,</p>
                            <p>Your library fine has been successfully processed. Here is your payment receipt:</p>
                            
                            <div class="receipt-box">
                                <div style="text-align: center; color: #666; margin-bottom: 10px;">PAID AMOUNT</div>
                                <div class="amount">₹${transaction.fine}</div>
                                <div style="text-align: center; color: #666;">Library Fine Payment</div>
                            </div>
                            
                            <div class="details">
                                <div class="detail-row">
                                    <span class="detail-label">Receipt ID:</span>
                                    <span class="detail-value">${transaction._id.toString().slice(-8).toUpperCase()}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">Date:</span>
                                    <span class="detail-value">${new Date().toLocaleDateString('en-IN')}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">Time:</span>
                                    <span class="detail-value">${new Date().toLocaleTimeString('en-IN')}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">Student ID:</span>
                                    <span class="detail-value">${transaction.student.registerNumber}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">Book:</span>
                                    <span class="detail-value">${transaction.book.title}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">ISBN:</span>
                                    <span class="detail-value">${transaction.book.isbn}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">Copy ID:</span>
                                    <span class="detail-value">${transaction.copyId}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">Status:</span>
                                    <span class="detail-value" style="color: #27ae60; font-weight: bold;">PAID</span>
                                </div>
                            </div>
                            
                            <p style="margin-top: 25px; font-size: 14px; color: #666;">
                                This receipt is automatically generated by the library system. Please keep it for your records.
                            </p>
                        </div>
                        <div class="footer">
                            &copy; ${new Date().getFullYear()} Government Polytechnic, Kampli • Library System
                        </div>
                    </div>
                </body>
                </html>
            `;

            try {
                await sendEmail({
                    email: transaction.student.email,
                    subject: `Fine Payment Receipt - ₹${transaction.fine} Paid`,
                    message: `Your fine of ₹${transaction.fine} has been paid. Book: ${transaction.book.title}, Copy ID: ${transaction.copyId}`,
                    html: emailHtml
                });
            } catch (emailError) {
                console.error("Failed to send fine receipt email:", emailError.message);
                // Don't fail the request if email fails, just log it
            }
        }

        if (req.user) await logAudit(req.user._id, 'FINE_COLLECT', `Collected ₹${transaction.fine} from ${transaction.student.registerNumber}`);
        res.json({ message: 'Payment Collected and Receipt Sent' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Manually Edit Fine
export const editFine = async (req, res) => {
    const { amount, reason } = req.body;
    try {
        const transaction = await Transaction.findById(req.params.id);
        if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

        transaction.fine = amount;
        transaction.fineReason = reason || 'Manual Override';
        await transaction.save();

        if (req.user) await logAudit(req.user._id, 'FINE_EDIT', `Changed fine to ₹${amount}`);
        res.json({ message: 'Fine Updated', transaction });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get Student Issues
export const getStudentIssues = async (req, res) => {
    try {
        const transactions = await Transaction.find({ student: req.user._id })
            .populate('book', 'title author')
            .sort({ createdAt: -1 });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Delete Transaction History (Bulk/Range)
export const deleteHistory = async (req, res) => {
    const { type, ids, startDate, endDate } = req.body;
    try {
        let query = { status: 'Returned' }; // Safety: Only delete Returned items to prevent stock issues

        if (type === 'select') query._id = { $in: ids };
        else if (type === 'lastYear') {
            const d = new Date(); d.setFullYear(d.getFullYear() - 1);
            query.issueDate = { $lt: d };
        }
        else if (type === 'range') {
            query.issueDate = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }

        const result = await Transaction.deleteMany(query);
        res.json({ message: `Deleted ${result.deletedCount} history records.` });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};