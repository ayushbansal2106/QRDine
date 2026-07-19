require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const Table = require('../src/models/Table');
const crypto = require('crypto');

const buildGuestUrl = (publicId) => {
  const frontendUrl = process.env.FRONTEND_PUBLIC_URL || 'http://localhost:3000';
  return `${frontendUrl}/table/${publicId}`;
};

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const tables = await Table.find({ publicId: { $exists: false } });
    console.log(`Found ${tables.length} tables to migrate.`);

    for (const table of tables) {
      const publicId = 'tbl_' + crypto.randomBytes(12).toString('hex');
      table.publicId = publicId;
      table.guestUrl = buildGuestUrl(publicId);
      
      // Need to generate new QR? We can't easily here without cafeId and generating the image. 
      // Admin will regenerate it. We'll just save it.
      await table.save();
      console.log(`Migrated table ${table.tableNumber} -> ${publicId}`);
    }

    console.log('Migration complete');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
