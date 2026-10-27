/**
 * Guards the hydration fix for persisted Zustand stores.
 *
 * `cartStore` and `sessionStore` both use the `persist` middleware. On the
 * server they are always empty and statusless; on the client they rehydrate
 * from `localStorage` before the first paint. Rendering a value derived from
 * them without waiting for rehydration makes the first client render disagree
 * with the server HTML, and React discards the server output with
 * "Hydration failed because the server rendered HTML didn't match".
 *
 * WHY THIS IS AN ASSERTION LIST RATHER THAN A HEURISTIC
 * -----------------------------------------------------
 * An earlier version of this script tried to *detect* the defect: scan every
 * component for a persisted-store read, and flag one that renders a
 * store-derived value without a gate. It produced eleven false positives,
 * because static matching cannot tell `items` read from the store apart from
 * `order.items` read from a prop, and cannot see that a sheet which returns
 * `null` while closed never reaches the server at all. A guard that always
 * fails is worse than no guard: it trains people to ignore it.
 *
 * So this asserts the positive property instead — a known list of components
 * that ARE server-rendered with store-derived markup must each keep their
 * hydration gate. It cannot catch a newly added offender, and it does not claim
 * to; it fails loudly if one of these is regressed, which is the regression that
 * actually happened.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND_SRC = path.join(__dirname, '..', '..', 'frontend', 'src');

/**
 * zustand's `persist` attaches `store.persist` ONLY when a storage backend
 * resolves. On the server there is no `window.localStorage`, so `persistImpl`
 * returns early and never assigns it — meaning `store.persist.hasHydrated()`
 * throws "Cannot read properties of undefined" during SSR and takes the page
 * down. Everything must go through `useStoresHydrated` instead.
 */
const RAW_PERSIST_PATTERN =
  /\.persist\s*\.\s*(hasHydrated|onFinishHydration|onHydrate|rehydrate|clearStorage|setOptions|getOptions)/;

/** A component is considered gated if it references hydration in any form. */
const GATE_PATTERN =
  /useStoresHydrated|persist\.hasHydrated|onFinishHydration|\bhydrated\b/;

/**
 * Server-rendered components whose markup depends on persisted state.
 * Keep in step with `frontend/src/store/useStoresHydrated.ts`.
 */
const MUST_BE_GATED = [
  {
    file: 'components/menu/TableMenuClient.tsx',
    why: 'Renders the header cart count and the seating status ("Live" / "Bill raised").',
  },
  {
    file: 'components/customer/DishCard.tsx',
    why: 'Swaps the ADD button for a quantity stepper based on the saved cart.',
  },
  {
    file: 'components/layout/StickyActionBar.tsx',
    why: 'Renders the cart badge on the sticky bottom bar.',
  },
  {
    file: 'components/customer/SignInClient.tsx',
    why: 'Shows or hides the "open from your table" warning based on the saved café id.',
  },
];

const walk = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
};

function main() {
  if (!fs.existsSync(FRONTEND_SRC)) {
    console.error(`Cannot find frontend/src at ${FRONTEND_SRC}`);
    process.exit(2);
  }

  const violations = [];
  for (const { file, why } of MUST_BE_GATED) {
    const full = path.join(FRONTEND_SRC, file);
    if (!fs.existsSync(full)) {
      violations.push({ file, why, problem: 'file no longer exists — update the list' });
      continue;
    }
    const source = fs.readFileSync(full, 'utf8');
    if (!GATE_PATTERN.test(source)) {
      violations.push({ file, why, problem: 'no hydration gate found' });
    }
  }

  // No file may reach into the persist API directly; that is the SSR crash.
  const rawUses = [];
  for (const file of walk(FRONTEND_SRC)) {
    const rel = path.relative(FRONTEND_SRC, file).replace(/\\/g, '/');
    // The hook itself is the one legitimate user, via a guarded accessor.
    if (rel === 'store/useStoresHydrated.ts') continue;

    const source = fs.readFileSync(file, 'utf8');
    if (RAW_PERSIST_PATTERN.test(source)) rawUses.push(rel);
  }

  console.log('── Persisted-store components must stay hydration-gated ──');

  if (violations.length === 0 && rawUses.length === 0) {
    for (const { file, why } of MUST_BE_GATED) console.log(`  ✓ ${file}\n      ${why}`);
    console.log('\n  ✓ no component reads store.persist directly');
    console.log('\nPASSED');
    return;
  }

  for (const v of violations) {
    console.log(`  ✗ ${v.file} — ${v.problem}`);
    console.log(`      ${v.why}`);
  }
  for (const rel of rawUses) {
    console.log(`  ✗ ${rel} — reads store.persist directly`);
    console.log('      store.persist does not exist during server rendering.');
  }
  console.log(
    '\n  Fix: gate the value with useStoresHydrated() so the first client render\n' +
      '  matches the server, e.g.\n' +
      '    const hydrated = useStoresHydrated();\n' +
      '    const count = hydrated ? getTotalItems() : 0;'
  );
  console.log('\nFAILED');
  process.exit(1);
}

// ── Self-test ────────────────────────────────────────────
// A checker that cannot fail is worthless, so prove both branches fire.
function selfTest() {
  const originalReadFileSync = fs.readFileSync;
  const originalExistsSync = fs.existsSync;
  const originalReaddirSync = fs.readdirSync;

  const fake = (sources) => {
    fs.existsSync = () => true;
    // An empty tree, so the whole-tree scan is a no-op and this exercises only
    // the assertion list it is meant to test.
    fs.readdirSync = () => [];
    fs.readFileSync = (file) => {
      // Normalise separators: the list uses POSIX-style relative paths but
      // path.join produces backslashes on Windows.
      const target = String(file).replace(/\\/g, '/');
      const key = Object.keys(sources).find((k) => target.endsWith(k));
      if (!key) throw new Error(`unexpected read: ${file}`);
      return sources[key];
    };
  };

  const restore = () => {
    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;
    fs.readdirSync = originalReaddirSync;
  };

  const results = {};
  const exited = { code: null };
  const originalExit = process.exit;
  process.exit = (code) => {
    exited.code = code;
  };
  const originalLog = console.log;
  console.log = () => {};

  try {
    const gated = Object.fromEntries(
      MUST_BE_GATED.map(({ file }) => [file, 'const hydrated = useStoresHydrated();'])
    );

    fake(gated);
    main();
    results.gatedCodePasses = exited.code === null;

    const ungated = Object.fromEntries(MUST_BE_GATED.map(({ file }) => [file, 'const x = 1;']));
    fake(ungated);
    exited.code = null;
    main();
    results.ungatedCodeFails = exited.code === 1;
  } finally {
    restore();
    console.log = originalLog;
    process.exit = originalExit;
  }

  console.log('\n── Self-test ──');
  for (const [name, ok] of Object.entries(results)) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
  if (Object.values(results).some((ok) => !ok)) {
    console.log('\nSELF-TEST FAILED — the checker is not discriminating.');
    process.exit(1);
  }
}

if (require.main === module) {
  selfTest();
  main();
}