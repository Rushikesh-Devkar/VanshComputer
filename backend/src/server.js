const app = require('./app');
const connectDB = require('./config/db');
const { expireReservations } = require('./modules/orders/order.service');
const mailer = require('./utils/mailer');

const PORT = process.env.PORT || 4000;

if (process.env.NODE_ENV === 'production' && !mailer.isMailConfigured()) {
  mailer.warnMailNotConfigured();
}

connectDB()
  .then(() => {
    expireReservations().catch(() => console.error('Initial order expiry check failed.'));
    const expiryTimer = setInterval(() => expireReservations().catch(() => console.error('Order expiry check failed.')), 30 * 1000);
    expiryTimer.unref();
    app.listen(PORT, () => {
    console.log('');
    console.log('  Vansh Computer chalu hai!');
    console.log(`  Website:  http://localhost:${PORT}`);
    console.log(`  API:      http://localhost:${PORT}/api/products`);
    console.log(`  Health:   http://localhost:${PORT}/health`);
    console.log('');
    });
  })
  .catch(() => { console.error('DB connection failed. Check the local database configuration.'); process.exit(1); });
