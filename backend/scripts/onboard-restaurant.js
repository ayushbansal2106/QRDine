#!/usr/bin/env node
/**
 * Restaurant Onboarding & Batch Table QR Generator (Form A - Task 4.1).
 *
 * Validates Indian statutory registration details (GSTIN, FSSAI), creates the Cafe
 * tenant entity, provisions dining tables in batch, and generates QR code assets.
 *
 * Usage:
 *   node scripts/onboard-restaurant.js \
 *     --legalName "Ambience Hospitality LLP" \
 *     --tradeName "The Urban Bistro" \
 *     --gstin "07AAAAA0000A1Z5" \
 *     --fssai "10019011000123" \
 *     --tables 12 \
 *     --taxMode composite_5 \
 *     --address "Connaught Place, New Delhi" \
 *     --phone "9876543210" \
 *     --email "owner@urbanbistro.com"
 */

'use strict';

const mongoose = require('mongoose');
const QRCode = require('qrcode');
const Cafe = require('../src/models/Cafe');
const Table = require('../src/models/Table');
const User = require('../src/models/User');

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const FSSAI_REGEX = /^[0-9]{14}$/;

/**
 * Validate restaurant onboarding attributes.
 */
const validateOnboardingData = (data) => {
  const errors = [];

  const legalName = (data.legalName || '').trim();
  if (!legalName || legalName.length < 2) {
    errors.push('Legal Entity Name is required and must be at least 2 characters');
  }

  const tradeName = (data.tradeName || legalName).trim();

  const gstin = (data.gstin || '').trim().toUpperCase();
  if (!gstin || !GSTIN_REGEX.test(gstin)) {
    errors.push('Invalid GSTIN format. Expected 15-character alphanumeric (e.g., 07AAAAA0000A1Z5)');
  }

  const fssaiNumber = (data.fssaiNumber || '').trim();
  if (!fssaiNumber || !FSSAI_REGEX.test(fssaiNumber)) {
    errors.push('Invalid FSSAI License Number. Expected exactly 14 numeric digits');
  }

  const tableCount = parseInt(data.tableCount || 10, 10);
  if (isNaN(tableCount) || tableCount < 1 || tableCount > 200) {
    errors.push('Table count must be an integer between 1 and 200');
  }

  const validTaxModes = ['composite_5', 'regular_18', 'exempt_0'];
  const taxMode = (data.taxMode || 'composite_5').toLowerCase();
  if (!validTaxModes.includes(taxMode)) {
    errors.push(`Tax mode must be one of: ${validTaxModes.join(', ')}`);
  }

  const email = (data.email || '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Invalid email address format');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: {
      legalName,
      tradeName,
      gstin,
      fssaiNumber,
      tableCount,
      taxMode,
      address: (data.address || '').trim(),
      phone: (data.phone || '').trim(),
      email,
    },
  };
};

/**
 * Programmatic onboarding execution.
 */
const onboardRestaurant = async (input, options = {}) => {
  const validation = validateOnboardingData(input);
  if (!validation.isValid) {
    const error = new Error(`Onboarding validation failed: ${validation.errors.join('; ')}`);
    error.validationErrors = validation.errors;
    throw error;
  }

  const { legalName, tradeName, gstin, fssaiNumber, tableCount, taxMode, address, phone, email } =
    validation.sanitized;

  // 1. Create or update Cafe entity
  const cafe = await Cafe.create({
    name: tradeName,
    tradeName,
    legalName,
    gstin,
    fssaiNumber,
    taxMode,
    tableCount,
    address,
    phone,
    email,
    termsAccepted: true,
    termsAcceptedAt: new Date(),
  });

  // 2. Batch generate tables and QR codes
  const tables = [];
  for (let i = 1; i <= tableCount; i += 1) {
    const tableNumber = i;
    const tableId = new mongoose.Types.ObjectId();
    const qrTargetUrl = `${options.baseUrl || 'http://localhost:3000'}/table/${tableId}`;
    const qrDataUrl = await QRCode.toDataURL(qrTargetUrl);

    tables.push({
      _id: tableId,
      cafeId: cafe._id,
      tableNumber,
      qrCodeUrl: qrDataUrl,
      isActive: true,
    });
  }

  const createdTables = await Table.insertMany(tables);

  // 3. Optional owner user provisioning
  let ownerUser = null;
  if (input.ownerEmail && input.ownerPassword) {
    ownerUser = await User.create({
      cafeId: cafe._id,
      name: input.ownerName || 'Cafe Owner',
      email: input.ownerEmail.trim().toLowerCase(),
      password: input.ownerPassword,
      role: 'owner',
    });
  }

  return {
    success: true,
    cafe,
    tables: createdTables,
    ownerUser,
    summary: {
      cafeId: String(cafe._id),
      legalName,
      tradeName,
      gstin,
      fssaiNumber,
      tableCount: createdTables.length,
      taxMode,
    },
  };
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = value;
        i += 1;
      }
    }
  }
  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.legalName || !args.gstin || !args.fssai) {
    console.log(`
QRDine Restaurant Onboarding Tool (Form A)
=========================================
Usage:
  node scripts/onboard-restaurant.js \\
    --legalName "Ambience Hospitality LLP" \\
    --tradeName "The Urban Bistro" \\
    --gstin "07AAAAA0000A1Z5" \\
    --fssai "10019011000123" \\
    --tables 10 \\
    --taxMode composite_5 \\
    --address "Connaught Place, New Delhi" \\
    --phone "9876543210" \\
    --email "owner@urbanbistro.com"
`);
    process.exit(1);
  }

  const connect = require('../src/config/db');
  await connect();

  try {
    const result = await onboardRestaurant({
      legalName: args.legalName,
      tradeName: args.tradeName,
      gstin: args.gstin,
      fssaiNumber: args.fssai,
      tableCount: args.tables,
      taxMode: args.taxMode,
      address: args.address,
      phone: args.phone,
      email: args.email,
    });

    console.log('\n[SUCCESS] Restaurant Onboarded Successfully!');
    console.log('--------------------------------------------------');
    console.log(`Cafe ID:       ${result.summary.cafeId}`);
    console.log(`Legal Name:    ${result.summary.legalName}`);
    console.log(`Trade Name:    ${result.summary.tradeName}`);
    console.log(`GSTIN:         ${result.summary.gstin}`);
    console.log(`FSSAI Number:  ${result.summary.fssaiNumber}`);
    console.log(`Tax Mode:      ${result.summary.taxMode}`);
    console.log(`Tables Created: ${result.tables.length} tables with batch QR codes`);
    console.log('--------------------------------------------------\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('\n[ERROR] Onboarding failed:', err.message);
    if (err.validationErrors) {
      err.validationErrors.forEach((e) => console.error(`  - ${e}`));
    }
    await mongoose.disconnect();
    process.exit(1);
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  validateOnboardingData,
  onboardRestaurant,
  GSTIN_REGEX,
  FSSAI_REGEX,
};
