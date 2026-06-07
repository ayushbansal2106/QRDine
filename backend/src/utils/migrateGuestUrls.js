const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Table = require('../models/Table');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const FRONTEND_PUBLIC_URL = process.env.FRONTEND_PUBLIC_URL || 'https://qrdine.local';

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not defined in backend/.env");
  process.exit(1);
}

const migrate = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB successfully.");

    const tables = await Table.find({});
    console.log(`Found ${tables.length} tables to process.`);

    let updatedCount = 0;
    for (const table of tables) {
      const oldUrl = table.guestUrl;
      const newUrl = `${FRONTEND_PUBLIC_URL}/table/${table._id}`;
      
      if (oldUrl !== newUrl) {
        table.guestUrl = newUrl;
        await table.save();
        console.log(`Updated Table ${table.tableNumber}: ${oldUrl} -> ${newUrl}`);
        updatedCount++;
      }
    }

    console.log(`Migration complete. Updated ${updatedCount} tables.`);
  } catch (err) {
    console.error("Error during migration:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

migrate();
