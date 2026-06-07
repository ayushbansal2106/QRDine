const mongoose = require('mongoose');
const dotenv = require('dotenv');
const MenuItem = require('../models/MenuItem');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not defined in backend/.env");
  process.exit(1);
}

const migrate = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB successfully.");

    // Update all MenuItem documents where gstPercentage is not set
    const result = await MenuItem.updateMany(
      { gstPercentage: { $exists: false } },
      { $set: { gstPercentage: 0 } }
    );

    console.log(`Migration complete. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
  } catch (err) {
    console.error("Error during migration:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

migrate();
