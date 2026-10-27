#!/usr/bin/env node
/**
 * Create (or reset) a QRDine staff account.
 *
 * There is deliberately no public "register as super admin" endpoint: the
 * control plane can terminate any customer, so its first operator is created
 * out-of-band from the server itself.
 *
 * Usage:
 *   SUPERADMIN_PASSWORD='...' node scripts/create-superadmin.js --email ops@qrdine.com --name Asha
 *   node scripts/create-superadmin.js --email ops@qrdine.com --role superadmin --reset
 *
 * With no SUPERADMIN_PASSWORD set, a strong random password is generated and
 * printed once. That is the safer default: a password typed into a shell
 * history is a password that will eventually leak from one.
 */

'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const connect = require('../src/config/db');
const SuperAdmin = require('../src/models/SuperAdmin');
const { SUPER_ADMIN_ROLES } = SuperAdmin;

const MIN_PASSWORD_LENGTH = 12;

const parseArgs = (argv) => {
  const args = { reset: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--reset') {
      args.reset = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = value;
      i += 1;
    }
  }
  return args;
};

const generatePassword = () => {
  // Ambiguous characters removed: this gets read off a screen and typed.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const email = String(args.email || '').trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('A valid --email is required.');
    process.exit(1);
  }

  const role = args.role || SUPER_ADMIN_ROLES.SUPERADMIN;
  if (!Object.values(SUPER_ADMIN_ROLES).includes(role)) {
    console.error(`Unknown --role "${role}". Choose one of: ${Object.values(SUPER_ADMIN_ROLES).join(', ')}`);
    process.exit(1);
  }

  let password = process.env.SUPERADMIN_PASSWORD || '';
  let generated = false;
  if (!password) {
    password = generatePassword();
    generated = true;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters. ` +
        'This credential can terminate every customer; a short one is not acceptable.'
    );
    process.exit(1);
  }

  await connect();

  try {
    const existing = await SuperAdmin.findOne({ email });

    if (existing && !args.reset) {
      console.error(
        `A staff account for ${email} already exists. Re-run with --reset to change its password or role.`
      );
      process.exit(1);
    }

    const hash = await SuperAdmin.hashPassword(password);

    if (existing) {
      existing.password = hash;
      existing.role = role;
      existing.isActive = true;
      existing.failedAttempts = 0;
      existing.lockedUntil = null;
      existing.passwordChangedAt = new Date();
      if (args.name) existing.name = String(args.name).trim();
      await existing.save();
      console.log(`Reset ${email} (role: ${role}).`);
    } else {
      await SuperAdmin.create({
        email,
        name: String(args.name || '').trim(),
        password: hash,
        role,
        isActive: true,
        passwordChangedAt: new Date(),
      });
      console.log(`Created ${email} (role: ${role}).`);
    }

    if (generated) {
      console.log('\nGenerated password (shown once — store it now):');
      console.log(`  ${password}\n`);
    }
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
};

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
});