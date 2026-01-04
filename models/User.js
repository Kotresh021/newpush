import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    registerNumber: { type: String, unique: true, sparse: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String },
    address: { type: String },
    password: { type: String, required: true },
    role: { type: String, enum: ['student', 'admin', 'staff'], default: 'student' },
    dob: { type: Date },
    department: { type: String },
    semester: { type: String },
    isFirstLogin: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    resetPasswordOtp: { type: String },
    resetPasswordExpires: { type: Date },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// --- PERFORMANCE INDEXES ---
userSchema.index({ role: 1 }); // Optimize "Get Students"
userSchema.index({ email: 1 }); // Optimize Login
userSchema.index({ registerNumber: 1 }); // Optimize Search

export default mongoose.model('User', userSchema);