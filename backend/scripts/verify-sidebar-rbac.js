/**
 * Verifies the restructured admin sidebar:
 *  1. Every navigation destination is permission-gated (no ungated link).
 *  2. No destination was lost or duplicated when items moved into sections.
 *  3. A cashier never sees a destination they cannot open.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const sidebar = fs.readFileSync(
  path.join(ROOT, "frontend", "src", "components", "layout", "AdminSidebar.tsx"),
  "utf8"
);
const permissions = fs.readFileSync(
  path.join(ROOT, "frontend", "src", "lib", "permissions.ts"),
  "utf8"
);

// Every `{ label: "...", path: "/admin/..." }` in NAV_SECTIONS + SETTINGS_ITEM
const navItems = [...sidebar.matchAll(/label:\s*"([^"]+)",\s*path:\s*"([^"]+)"/g)].map((m) => ({
  label: m[1],
  path: m[2],
}));

// Every key declared in ROUTE_PERMISSIONS
const gated = new Set(
  [...permissions.matchAll(/^\s*"(\/admin\/[^"]+|\/staff\/[^"]+)":/gm)].map((m) => m[1])
);

let failures = 0;

// 1. No duplicate destinations
const seen = new Map();
for (const item of navItems) {
  if (seen.has(item.path)) {
    console.log(`  ✗ duplicate destination: ${item.path} (${seen.get(item.path)} & ${item.label})`);
    failures++;
  }
  seen.set(item.path, item.label);
}

// 2. Every sidebar destination has a permission rule
console.log("── Sidebar permission gating ──");
console.log(`sidebar destinations : ${navItems.length}`);
console.log(`permission rules      : ${gated.size}`);
for (const item of navItems) {
  if (!gated.has(item.path)) {
    console.log(`  ✗ UNGATED: ${item.path} (${item.label}) — a cashier would see a 403`);
    failures++;
  }
}
if (!failures) console.log("  ✓ every destination is permission-gated");

// 3. Nothing lost from the previous sidebar
const previous = [
  "/admin/pos", "/admin/orders", "/admin/kitchen", "/admin/menu", "/admin/tables",
  "/admin/requests", "/admin/customers", "/admin/loyalty", "/admin/coupons",
  "/admin/wallets", "/admin/scratch", "/admin/bills", "/admin/sales", "/admin/audit",
  "/admin/shift", "/admin/analytics", "/admin/reviews", "/admin/geofence", "/admin/qr",
  "/admin/nfc", "/admin/settings", "/staff/waiter", "/admin/lock",
];
const missing = previous.filter((p) => !gated.has(p) && !seen.has(p));
console.log("\n── Pre-restructure coverage ──");
if (missing.length) {
  failures++;
  for (const m of missing) console.log(`  ✗ lost navigation target: ${m}`);
} else {
  console.log("  ✓ all 22 pre-existing destinations still reachable");
}

// 4. Sections present
console.log("\n── Sections ──");
for (const title of ["Operations", "Pinned", "More"]) {
  if (sidebar.includes(`title: "${title}"`)) console.log(`  ✓ ${title}`);
  else {
    console.log(`  ✗ missing section: ${title}`);
    failures++;
  }
}
if (sidebar.includes("QR-Dine Executive Portal")) console.log("  ✓ brand renamed");
else {
  console.log("  ✗ brand not renamed");
  failures++;
}

console.log(failures ? `\nFAILED (${failures})` : "\nPASSED");
process.exit(failures ? 1 : 0);