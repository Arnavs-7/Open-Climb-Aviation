require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes       = require('./routes/auth');
const enrollmentRoutes = require('./routes/enrollment');
const paymentRoutes    = require('./routes/payment');
const adminRoutes      = require('./routes/admin');

const app = express();

// Security headers
app.use(helmet());

// CORS — allow the configured frontend plus the known Netlify + production hosts.
// Add your final custom domain to this list once the domain is live (see TODO).
const allowedOrigins = [
  process.env.FRONTEND_URL,              // set on Render (e.g. https://openclimbaviation.com)
  'http://localhost:3000',              // local static dev server
  'http://localhost:5500',              // VS Code Live Server default
  'http://127.0.0.1:5500',
  'https://jaywebsiteklm.netlify.app',          // previous live Netlify site
  'https://open-climb-aviation.vercel.app',     // current live Vercel production site
  'https://openclimbaviationacademy.com',       // live custom domain
  'https://www.openclimbaviationacademy.com',   // live custom domain (www)
].filter(Boolean);

// Allow Vercel preview deployments (e.g. https://open-climb-aviation-<hash>.vercel.app)
const vercelPreviewPattern = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

app.use(cors({
  origin(origin, callback) {
    // allow non-browser clients (curl, server-to-server, health pings) with no Origin
    if (!origin || allowedOrigins.includes(origin) || vercelPreviewPattern.test(origin)) {
      return callback(null, true);
    }
    // Disallowed origin: deny CORS quietly (no thrown error / stack trace spam).
    // The browser blocks the response; the request itself still returns normally.
    return callback(null, false);
  },
  credentials: true
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global rate limiter — 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(limiter);

// Stricter limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts, please try again later.' }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth',       authLimiter, authRoutes);
app.use('/api/enrollment', enrollmentRoutes);
app.use('/api/payment',    paymentRoutes);
app.use('/api/admin',      adminRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.', errors: [] });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error.',
    errors:  []
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Open Climb Aviation API running on port ${PORT}`);
});
