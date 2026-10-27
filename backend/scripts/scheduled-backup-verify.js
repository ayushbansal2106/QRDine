#!/usr/bin/env node
/**
 * QRDine — Scheduled Backup Verification (Task 7.5 - Stage 7)
 *
 * Wraps `restore-drill.js` for automated (cron/CI) invocation:
 * 1. Runs the full restore drill programmatically.
 * 2. Writes a timestamped entry to `backups/verification-log.jsonl`.
 * 3. On failure, logs to error tracker and sends alert email (if configured).
 * 4. Exits with code 0 on success, 1 on failure.
 *
 * Usage:
 *   node backend/scripts/scheduled-backup-verify.js [--alert-email <email>]
 *
 * Cron example (weekly Sunday 3 AM IST):
 *   0 3 * * 0  cd /app/backend && npm run backup:verify
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Load .env before anything that reads environment variables.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const LOG_FILE = path.join(__dirname, '..', 'backups', 'verification-log.jsonl');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { alertEmail: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--alert-email' && args[i + 1]) options.alertEmail = args[++i];
  }
  return options;
}

function ensureLogDir() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function appendLog(entry) {
  ensureLogDir();
  const line = JSON.stringify({
    ...entry,
    timestamp: new Date().toISOString(),
    hostname: require('os').hostname(),
  });
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

/**
 * Send alert notification on failure (best-effort).
 */
async function sendAlert(options, errorMessage) {
  // Try error tracker first
  try {
    const errorTracking = require('../src/services/errorTracking');
    errorTracking.initErrorTracking();
    errorTracking.captureMessage('Backup verification FAILED', {
      severity: 'error',
      errorMessage,
    });
  } catch {
    // Error tracker may not be available; not fatal.
  }

  // Try email alert if configured
  if (options.alertEmail) {
    try {
      const nodemailer = require('nodemailer');
      const env = require('../src/config/env');

      if (env.smtpUser && env.smtpPass) {
        const transporter = nodemailer.createTransport({
          host: env.smtpHost,
          port: env.smtpPort,
          secure: false,
          auth: { user: env.smtpUser, pass: env.smtpPass },
        });

        await transporter.sendMail({
          from: env.smtpFrom,
          to: options.alertEmail,
          subject: `[QRDine ALERT] Backup Verification Failed — ${new Date().toISOString()}`,
          text: [
            'QRDine automated backup verification has FAILED.',
            '',
            `Error: ${errorMessage}`,
            '',
            `Host: ${require('os').hostname()}`,
            `Time: ${new Date().toISOString()}`,
            '',
            'Action Required: Investigate backup integrity immediately.',
            'Run: npm run backup:drill -- --useDemoSource',
          ].join('\n'),
        });

        console.log(`✅ Alert email sent to ${options.alertEmail}`);
      }
    } catch (emailErr) {
      console.error(`⚠️  Could not send alert email: ${emailErr.message}`);
    }
  }
}

async function run() {
  const options = parseArgs();

  console.log('');
  console.log('================================================================');
  console.log('    SCHEDULED BACKUP VERIFICATION (OPS-101 / Stage 7)          ');
  console.log('================================================================');
  console.log(`  Time : ${new Date().toISOString()}`);
  console.log(`  Host : ${require('os').hostname()}`);
  console.log(`  Log  : ${LOG_FILE}`);
  console.log('================================================================');
  console.log('');

  const startMs = Date.now();

  try {
    // Import and run the restore drill
    const runRestoreDrill = require('./restore-drill');

    // The drill module may export either the function or an object with it.
    const drillFn =
      typeof runRestoreDrill === 'function'
        ? runRestoreDrill
        : runRestoreDrill.runRestoreDrill || runRestoreDrill.default;

    if (typeof drillFn !== 'function') {
      // Fall back to spawning as a child process
      const { execSync } = require('child_process');
      execSync(`node ${path.join(__dirname, 'restore-drill.js')} --useDemoSource`, {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..'),
        timeout: 300000, // 5 minute timeout
      });
    } else {
      await drillFn({ useDemoSource: true });
    }

    const durationMs = Date.now() - startMs;

    appendLog({
      status: 'BACKUP_VERIFY_OK',
      durationMs,
      method: typeof drillFn === 'function' ? 'programmatic' : 'subprocess',
    });

    console.log('');
    console.log(`✅ Backup verification PASSED in ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`   Log entry written to: ${LOG_FILE}`);
    process.exit(0);
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errorMessage = err.message || String(err);

    appendLog({
      status: 'BACKUP_VERIFY_FAIL',
      durationMs,
      error: errorMessage,
      stack: err.stack,
    });

    console.error('');
    console.error(`❌ Backup verification FAILED after ${(durationMs / 1000).toFixed(1)}s`);
    console.error(`   Error: ${errorMessage}`);
    console.error(`   Log entry written to: ${LOG_FILE}`);

    await sendAlert(options, errorMessage);

    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in scheduled backup verify:', err);
  process.exit(1);
});
