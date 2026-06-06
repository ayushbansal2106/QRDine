const mongoose = require('mongoose');
const env = require('./env');

const connectDB = async () => {
  if (!env.mongodbUri) {
    throw new Error(
      'MONGODB_URI is not defined. Create backend/.env with a MongoDB Atlas connection string. See docs/MONGODB_ATLAS_SETUP.md.'
    );
  }

  await mongoose.connect(env.mongodbUri);
};

module.exports = connectDB;
