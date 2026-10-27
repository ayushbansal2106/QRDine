/**
 * Route audit — two static checks that normally only surface as browser-console
 * errors at runtime:
 *
 *  1. Every `apiClient.<method>("/path")` in the frontend resolves to a real
 *     Express route (catches typos that would 404).
 *  2. Every state-changing route behind `protect` is guarded by
 *     `validateCsrfToken` (catches a mutation that would 403 in production).
 *
 * Note: apiClient's baseURL already ends in `/api`, so frontend paths are
 * compared against `/api` + path.
 *
 * Usage: node backend/scripts/route-audit.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const FRONT = path.join(ROOT, "frontend", "src");
const BACK = path.join(ROOT, "backend", "src");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

let failures = 0;

// ── 1. Frontend calls vs backend routes ───────────────────────────
const calls = [];
for (const file of walk(FRONT)) {
  const src = fs.readFileSync(file, "utf8");
  const re = /apiClient\.(get|post|put|patch|delete)\(\s*[`"'](\/[^`'"]*)[`'"]/g;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[2];
    calls.push({
      file: path.relative(ROOT, file),
      method: m[1].toUpperCase(),
      url: ("/api" + raw.split("?")[0]).replace(/\/$/, ""),
      dynamic: raw.includes("${"),
    });
  }
}

// ── 2. Backend route table ────────────────────────────────────────
const appSrc = fs.readFileSync(path.join(BACK, "app.js"), "utf8");
const routes = [];
const routerFiles = [];

for (const mount of appSrc.matchAll(/app\.use\(\s*'\/api\/([^']+)'\s*,\s*(\w+)/g)) {
  const prefix = "/api/" + mount[1];
  const varName = mount[2];
  const file = path.join(BACK, "routes", `${varName.replace(/Routes$/, "")}Routes.js`);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  routerFiles.push({ varName, prefix, src });

  for (const r of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
    routes.push({
      method: r[1].toUpperCase(),
      path: (prefix + r[2]).replace(/\/$/, ""),
      router: varName,
    });
  }
}

function resolves(url, method) {
  const up = url.split("/");
  return routes.find((r) => {
    if (r.method !== method) return false;
    const rp = r.path.split("/");
    if (rp.length !== up.length) return false;
    return rp.every((seg, i) => seg.startsWith(":") || seg === up[i]);
  });
}

const orphans = calls.filter((c) => !c.dynamic && !resolves(c.url, c.method));

console.log("── Route resolution ──");
console.log(`frontend apiClient calls : ${calls.length}`);
console.log(`  dynamic (template)     : ${calls.filter((c) => c.dynamic).length}`);
console.log(`backend routes           : ${routes.length}`);
console.log(`unresolved calls         : ${orphans.length}`);
if (orphans.length) {
  failures++;
  for (const o of orphans) {
    console.log(`  ✗ ${o.method.padEnd(6)} ${o.url.padEnd(46)} ${o.file}`);
  }
} else {
  console.log("  ✓ every static call resolves to a route");
}

// ── 3. CSRF coverage ──────────────────────────────────────────────
// A route is "protected" when it sits after a `router.use(protect, ...)` guard.
// Everything after that guard must also sit behind validateCsrfToken.
console.log("\n── CSRF coverage on protected writes ──");
const csrfGaps = [];

/**
 * Strip `//` comments from a line.
 *
 * The paren counter below must not count brackets that only appear in prose —
 * a comment reading `// (two months free)` would otherwise desynchronise the
 * whole parse for that statement.
 */
const stripComment = (line) => line.replace(/\/\/.*$/, "");

/**
 * Capture each `router.<method>(...)` registration whole.
 *
 * Matching by balanced parens rather than by line is the point: registrations
 * are frequently wrapped across several lines, and a line-based scan cannot see
 * that `validateCsrfToken` is inside the argument list.
 */
const parseRouteStatements = (lines) => {
  const statements = [];
  let i = 0;

  while (i < lines.length) {
    const m = lines[i].match(/router\.(post|put|patch|delete|use|get)\s*\(/);
    if (!m) {
      i += 1;
      continue;
    }

    let depth = 0;
    let text = "";
    let j = i;
    for (; j < lines.length; j += 1) {
      const code = stripComment(lines[j]);
      text += `${code}\n`;
      for (const ch of code) {
        if (ch === "(") depth += 1;
        else if (ch === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth === 0) break;
    }

    statements.push({ method: m[1], text, startLine: i });
    i = j + 1;
  }

  return statements;
};

for (const { varName, prefix, src } of routerFiles) {
  const lines = src.split("\n");
  const statements = parseRouteStatements(lines);

  // Line index at which `protect` starts guarding this router.
  //
  // Plain substring, not `\bprotect\b`: the control plane's guard is
  // `protectSuperAdmin`, and a word-boundary match silently fails on it —
  // which would skip the whole router and report every route in it as safe.
  const protectStatement = statements.find((s) => s.method === "use" && /protect/.test(s.text));
  if (!protectStatement) continue;
  const protectLine = protectStatement.startLine;

  // A blanket `router.use(validateCsrfToken)` guards everything declared after
  // it, exactly as it does at runtime. `>=` rather than `>` because routers
  // commonly put both middlewares on one statement:
  //   router.use(protect, tenantMiddleware, requirePermission(...), validateCsrfToken);
  const blanket = statements.find(
    (s) => s.method === "use" && /validateCsrfToken/.test(s.text) && s.startLine >= protectLine
  );
  const blanketLine = blanket ? blanket.startLine : -1;

  for (const st of statements) {
    if (!["post", "put", "patch", "delete"].includes(st.method)) continue;
    if (st.startLine < protectLine) continue; // public route, deliberately unauthenticated

    // Guarded either by CSRF middleware in its own argument list, or by a
    // router-wide guard declared above it.
    if (/validateCsrfToken/.test(st.text)) continue;
    if (blanketLine !== -1 && st.startLine > blanketLine) continue;

    const m = st.text.match(/router\.(post|put|patch|delete)\(\s*'([^']*)'/);
    csrfGaps.push({
      route: `${st.method.toUpperCase()} ${prefix}${m ? m[2] : '(unparsed)'}`,
      router: varName,
      line: st.startLine + 1,
    });
  }
}

if (csrfGaps.length) {
  failures++;
  console.log(`  ✗ ${csrfGaps.length} protected write route(s) without validateCsrfToken:`);
  for (const g of csrfGaps) console.log(`      ${g.route.padEnd(44)} ${g.router}.js:${g.line}`);
} else {
  console.log("  ✓ every protected write route is CSRF-guarded");
}

console.log(failures ? `\nFAILED (${failures} check group(s))` : "\nPASSED");
process.exit(failures ? 1 : 0);