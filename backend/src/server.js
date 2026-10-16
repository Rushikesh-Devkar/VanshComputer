const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => app.listen(PORT, () => {
    console.log('');
    console.log('  Vansh Computer chalu hai!');
    console.log(`  Website:  http://localhost:${PORT}`);
    console.log(`  API:      http://localhost:${PORT}/api/products`);
    console.log(`  Health:   http://localhost:${PORT}/health`);
    console.log('');
  }))
  .catch(err => { console.error('DB connection failed:', err.message); process.exit(1); });