/**
 * Lint report + ratchet.
 *
 *   node scripts/lint-report.mjs            # human-readable breakdown
 *   node scripts/lint-report.mjs --check    # CI mode: fails if counts regress
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * `@typescript-eslint/no-explicit-any` has 309 violations in committed code, so
 * it has never once been a gate anyone enforced — it is noise that makes the
 * real findings invisible. It is configured as a *warning* for that reason.
 *
 * But downgrading a rule is how lint debt becomes permanent, so this script is
 * the part that keeps it honest: `BASELINE` is a committed number, and
 * `--check` fails if the count goes **up**. The rule is a ratchet, not a
 * rubber stamp — new `any` types cannot be introduced, and the debt can only be
 * paid down.
 *
 * STATUS: `--check` currently FAILS, because 26 real errors remain (all
 * `@typescript-eslint/no-unused-vars`; see `ZERO_TOLERANCE` below). It is
 * deliberately NOT yet wired into `.github/workflows/ci.yml` as a blocking
 * step — turning it on while it fails would only produce a red build. Wire it
 * in as blocking once those 26 are cleared. Do not delete `ZERO_TOLERANCE`
 * instead.
 *
 * Every other rule stays an *error*. In particular the React Compiler rules
 * (`react-hooks/set-state-in-effect`, `purity`, `immutability`) are genuine
 * correctness bugs, not style, and they are not negotiable.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/**
 * Committed ceilings. Lower these as debt is paid down — that edit IS the
 * progress. Never raise one to make a build green.
 */
const BASELINE = {
  '@typescript-eslint/no-explicit-any': 309,
  total: 380,
};

/** Rules that must never be tolerated, at any count. */
const ZERO_TOLERANCE = [
  'react-hooks/set-state-in-effect',
  'react-hooks/purity',
  'react-hooks/immutability',
  '@typescript-eslint/no-unused-vars',
];

const run = () => {
  // Invoke eslint's JS entry directly rather than through npx: `npx.cmd` cannot
  // be spawned from Node on Windows (EINVAL), and the local binary is exactly
  // the same executable the npm script runs anyway.
  const eslintBin = join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');

  try {
    const out = execFileSync(
      process.execPath,
      [eslintBin, '.', '-f', 'json'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    return JSON.parse(out);
  } catch (err) {
    // eslint exits 1 when it finds problems; the JSON is still on stdout.
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
};

const results = run();

const byRule = {};
const files = [];
let errors = 0;
let warnings = 0;

/**
 * Classify a message that has no ruleId.
 *
 * ESLint reports two quite different things without a ruleId: a genuine parse
 * failure (`fatal: true`), and a bare directive complaint such as an unused
 * `eslint-disable` (`fatal: false`). Reporting the latter as a parse error
 * sends the next person hunting a compile failure that does not exist — so
 * they are counted separately.
 */
const classify = (m) => (m.ruleId ? m.ruleId : m.fatal ? '(parse error)' : '(directive)');

for (const file of results) {
  if (!file.messages.length) continue;
  files.push(file.filePath.replace(`${root}/`, '').replace(/\\/g, '/'));
  for (const m of file.messages) {
    const rule = classify(m);
    byRule[rule] = (byRule[rule] || 0) + 1;
    if (m.severity === 2) errors += 1;
    else warnings += 1;
  }
}

const total = errors + warnings;
const checkMode = process.argv.includes('--check');
const listMode = process.argv.includes('--list');

/** Rules to expand to file:line when listing. `--list all` includes the bulk debt. */
const listAll = process.argv.includes('all');

console.log('Lint report');
console.log(`  files scanned     : ${results.length}`);
console.log(`  files with issues : ${files.length}`);
console.log(`  errors / warnings : ${errors} / ${warnings}`);
console.log('  by rule:');
Object.entries(byRule)
  .sort((a, b) => b[1] - a[1])
  .forEach(([rule, count]) => console.log(`    ${String(count).padStart(4)}  ${rule}`));

if (listMode) {
  const BULK = ['@typescript-eslint/no-explicit-any'];
  for (const file of results) {
    for (const m of file.messages) {
      const rule = classify(m);
      if (!listAll && BULK.includes(rule)) continue;
      const rel = file.filePath.replace(`${root}/`, '').replace(/\\/g, '/');
      console.log(`${rel}:${m.line}:${m.column}  ${rule}  ${m.message}`);
    }
  }
  process.exit(0);
}

if (!checkMode) process.exit(0);

const failures = [];

for (const rule of ZERO_TOLERANCE) {
  const count = byRule[rule] || 0;
  if (count > 0) {
    failures.push(`${rule}: ${count} (must be 0 — these are correctness bugs, not style)`);
  }
}

for (const [rule, ceiling] of Object.entries(BASELINE)) {
  if (rule === 'total') continue;
  const count = byRule[rule] || 0;
  if (count > ceiling) {
    failures.push(`${rule}: ${count} exceeds baseline ${ceiling} (+${count - ceiling})`);
  }
}

if (total > BASELINE.total) {
  failures.push(`total: ${total} exceeds baseline ${BASELINE.total} (+${total - BASELINE.total})`);
}

const parseErrors = byRule['(parse error)'] || 0;
if (parseErrors > 0) {
  failures.push(`(parse error): ${parseErrors} file(s) do not parse`);
}

if (failures.length) {
  console.error('\nLINT RATCHET FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nLint debt may only go down. Fix the issues or lower the');
  console.error('corresponding BASELINE number once it is genuinely resolved.');
  process.exit(1);
}

console.log('\nLINT RATCHET OK — no regressions against baseline.');