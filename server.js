import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/db.js';

// --- SECURITY PACKAGES ---
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss-clean';
import hpp from 'hpp';

// Import Routes
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import deptRoutes from './routes/deptRoutes.js';
import bookRoutes from './routes/bookRoutes.js';
import circulationRoutes from './routes/circulationRoutes.js';
import configRoutes from './routes/configRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import feedbackRoutes from './routes/feedbackRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';

dotenv.config();
connectDB();

const app = express();

// --- SECURITY MIDDLEWARE ---

// 1. Secure HTTP Headers
app.use(helmet());

// 2. Rate Limiting (Prevents Brute Force/DDoS)
const limiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 150, // Limit each IP to 150 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api', limiter);

// 3. Body Parser with Limit (Prevents DOS via large payloads)
app.use(express.json({ limit: '10kb' }));

// 4. Data Sanitization against NoSQL Injection
app.use(mongoSanitize());

// 5. Data Sanitization against XSS
app.use(xss());

// 6. Prevent Parameter Pollution
app.use(hpp());

// 7. CORS (Allow credentials)
app.use(cors({
    origin: '*', // Change this to your specific frontend domain in production
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

// --- ROUTES ---
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/departments', deptRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/circulation', circulationRoutes);
app.use('/api/config', configRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/settings', settingsRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));