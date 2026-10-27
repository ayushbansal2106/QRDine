/**
 * One-off codemod: replace hardcoded hex colours in Tailwind arbitrary-value
 * classes (`bg-[#e8f5e9]`, `text-[#2e7d32]`, ...) with the semantic theme
 * tokens added to globals.css.
 *
 * Rationale: a hardcoded hex keeps its old value when the palette changes, so a
 * theme swap would leave the UI half-restyled. After this runs, every colour in
 * the app flows from `@theme` and can be re-pointed in one place.
 *
 * Usage: node scripts/tokenize-hardcoded-colors.js [--dry]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "frontend", "src");
const DRY = process.argv.includes("--dry");

/** hex (lowercase) -> semantic token name in `@theme` */
const TOKEN = {
  "#2e7d32": "success",
  "#e8f5e9": "success-container",
  "#1b5e20": "on-success-container",
  "#c62828": "on-error-container",
  "#ffebee": "error-container",
  "#e65100": "warning",
  "#fff3e0": "warning-container",
  "#f57f17": "on-warning-container",
  "#ffb74d": "on-warning-container",
  "#ffca28": "warning",
  "#1565c0": "info",
  "#e3f2fd": "info-container",
  "#0d47a1": "on-info-container",
  "#6ffbbe": "active-accent",
  "#002113": "on-active-accent",
  "#009668": "success",
  "#00695c": "on-success-container",
  "#eaf8f4": "accent-mint-container",
  "#f3e5f5": "accent-violet-container",
  "#6a1b9a": "on-accent-violet-container",
  "#e0f7fa": "accent-cyan-container",
  "#fff8e1": "accent-amber-container",
  "#66bb6a": "success",
  // duplicates of the brand primary that bypassed the token
  "#51604f": "primary",
  "#6a7967": "primary-container",
};

/**
 * Map a Tailwind prefix to the token slot it should read.
 * `bg-[#x]` -> surface, `text-[#x]` -> on-surface, etc.
 */
const PREFIX_TOKEN = {
  bg: "surface",
  text: "on-surface",
  border: "outline",
  ring: "outline",
  from: "surface",
  to: "surface",
  fill: "surface",
  stroke: "outline",
  divide: "outline",
  shadow: "surface",
  outline: "outline",
  placeholder: "on-surface-variant",
  caret: "on-surface",
  accent: "secondary",
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Resolve `bg-[#e8f5e9]` -> `bg-success-container`.
 * Prefers the exact token; otherwise falls back to "<prefix>-<token>".
 */
function replacementFor(prefix, hex) {
  const token = TOKEN[hex];
  if (!token) return null;
  const slot = PREFIX_TOKEN[prefix] || "surface";
  const candidate = `${prefix}-${token}`;
  return candidate;
}

let filesChanged = 0;
let replacements = 0;
const unresolved = [];

for (const file of walk(SRC)) {
  const original = fs.readFileSync(file, "utf8");
  const updated = original.replace(
    /\b(bg|text|border|ring|fill|stroke|outline|divide|from|to|placeholder|caret|accent)-\[#([0-9a-fA-F]{3,8})\]/g,
    (match, prefix, hexRaw) => {
      const hex = `#${hexRaw.toLowerCase()}`;
      const next = replacementFor(prefix, hex);
      if (!next) {
        unresolved.push({ file: path.relative(ROOT, file), match, hex });
        return match;
      }
      replacements++;
      return next;
    }
  );

  if (updated !== original) {
    filesChanged++;
    if (!DRY) fs.writeFileSync(file, updated, path, "utf8");
  }
}

console.log(`${DRY ? "[dry] " : ""}${replacements} replacements across ${filesChanged} files`);
if (unresolved.length) {
  console.log(`\n${unresolved.length} occurrence(s) with no semantic token:`);
  const seen = new Set();
  for (const u of unresolved) {
    if (seen.has(u.hex)) continue;
    seen.add(u.hex);
    console.log(`  ${u.hex}  e.g. ${u.match}  (${u.file})`);
  }
}