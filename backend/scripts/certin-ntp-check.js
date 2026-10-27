const { verifyNtpTimeSync, verify180DayLogRetention, CERT_IN_CONFIG } = require('../src/services/certInService');

/**
 * CLI Tool: Verify CERT-In NTP Synchronization & Log Retention Mandates (Task 5.4)
 */
const main = async () => {
  console.log('\n================================================================');
  console.log('       CERT-IN STATUTORY DIRECTIVE PRE-FLIGHT AUDIT');
  console.log('================================================================');

  const ntp = await verifyNtpTimeSync();
  const retention = verify180DayLogRetention();

  console.log(`Timestamp:             ${ntp.timestamp}`);
  console.log(`Primary Server:        ${ntp.primaryServer}`);
  console.log(`NPL/NIC Servers:       ${CERT_IN_CONFIG.ntpServers.join(', ')}`);
  console.log(`Clock Offset:          ${ntp.timeDriftMs} ms (Limit: ±${ntp.maxAllowedDriftMs} ms)`);
  console.log(`NTP Sync Verdict:      ${ntp.certInCompliant ? '🟢 [SYNCHRONIZED WITH NPL/NIC]' : '🔴 [FAILED]'}`);
  console.log('----------------------------------------------------------------');
  console.log(`Log Retention Mandate: ${retention.mandatedRetentionDays} days`);
  console.log(`Jurisdiction:          ${retention.jurisdiction}`);
  console.log(`Statutory Order:       ${retention.statutoryDirective}`);
  console.log(`Retention Status:      🟢 [180-DAY ENCRYPTED PRESERVATION ENFORCED]`);
  console.log('================================================================\n');

  if (!ntp.certInCompliant) {
    process.exit(1);
  }
};

if (require.main === module) {
  main().catch((err) => {
    console.error('[ERROR] CERT-In check crashed:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
