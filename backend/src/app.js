const path = require('path');
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
app.set('trust proxy', 1);
const frontendDir = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(frontendDir));
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.use(helmet());

// Cookies ke saath cors mein origin ki list zaroori hai, "sab allow" nahi
const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({ origin: origins, credentials: true }));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/products', require('./modules/products/product.routes'));
app.use('/api/leads', require('./modules/leads/lead.routes'));
app.use('/api/banner', require('./modules/banner/banner.routes'));
app.use('/api/reviews', require('./modules/reviews/review.routes'));
app.use('/api/reels', require('./modules/reels/reel.routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
