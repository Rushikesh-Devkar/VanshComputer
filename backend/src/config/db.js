const mongoose = require('mongoose');

module.exports = async function connectDB() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vanshcomputer';
  mongoose.set('strictQuery', true);

  // Fail fast: DB ke bina API ka koi matlab nahi, isliye error throw hoga
  // aur server.js process ko exit kar dega (Render restart/log dikhayega).
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
  console.log('MongoDB connected');
};
