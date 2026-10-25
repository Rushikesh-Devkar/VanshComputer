const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
app.set('trust proxy', 1);
const frontendDir = path.join(__dirname, '..', '..', 'frontend');
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
    imgSrc: ["'self'", 'data:', 'https:', 'blob:'], mediaSrc: ["'self'", 'https://res.cloudinary.com'], connectSrc: ["'self'", 'https://api.razorpay.com'],
    frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
    formAction: ["'self'", 'https://api.razorpay.com'], objectSrc: ["'none'"], upgradeInsecureRequests: null,
  } },
}));

// Cookies ke saath cors mein origin ki list zaroori hai, "sab allow" nahi
const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({ origin: origins, credentials: true }));
app.use(express.static(frontendDir));
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

// Razorpay signs the original bytes, so this route must run before JSON parsing.
app.post('/api/orders/webhook', express.raw({ type: 'application/json', limit: '1mb' }), require('./modules/orders/order.controller').webhook);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/products', require('./modules/products/product.routes'));
app.use('/api/leads', require('./modules/leads/lead.routes'));
app.use('/api/banner', require('./modules/banner/banner.routes'));
app.use('/api/reviews', require('./modules/reviews/review.routes'));
app.use('/api/reels', require('./modules/reels/reel.routes'));
app.use('/api/orders', require('./modules/orders/orders.routes'));
app.use('/api/orders', require('./modules/orders/return.routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
