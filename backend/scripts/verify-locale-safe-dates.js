/**
 * Locale-safety guard.
 *
 * A call like `new Date().toLocaleString()` renders with the *runtime's*
 * locale. During SSR that is the server's and during hydration it is the
 * browser's, so any difference between them makes React throw a hydration
 * mismatch and regenerate the tree. This reproduced in production on the
 * dashboard header ("Saturday, 3 October" from the server vs "Saturday,
 * October 3" from the browser).
 *
 * The rule: every toLocale* call in the frontend must pin its locale, ideally
 * to `LOCALE` from src/lib/format.ts.
 *
 *   node scripts/verify-locale-safe-dates.js
 *
 * Exits non-zero when a violation is found so it can run in CI.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'src');

// toLocaleDateString / toLocaleTimeString / toLocaleString
const CALL = /\.toLocale(DateString|TimeString|String)\s*\(/g;

// A locale is pinned when the call's own first argument is non-empty.
// `toLocaleString()` and `toLocaleTimeString([], ...)` are violations;
// `toLocaleString("en-IN")` and `toLocaleString(LOCALE, ...)` are fine.
//
// The scan starts from the call's own '(' — the last character of the regex
// match — because searching the line for the first '(' would instead land on
// an inner `new Date()` and silently pass every violation.
const hasPinnedLocale = (line, openIndex) => {
  // Extract the call's first argument, honouring nesting, then decide.
  // `[]` counts as unpinned: an empty locale array means "whatever the
  // runtime's locale is", which is precisely the bug.
  const decide = (arg) => {
    const trimmed = arg.trim();
    return trimmed.length > 0 && trimmed !== '[]';
  };

  let depth = 0;
  for (let i = openIndex; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return decide(line.slice(openIndex + 1, i));
    } else if (ch === ',' && depth === 1) {
      return decide(line.slice(openIndex + 1, i));
    }
  }
  return false;
};

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
};

const isComment = (line) =>
  /^\s*(\/\/|\*|\/\*)/.test(line) || /^\s*\*/.test(line);

const main = () => {
  const files = walk(SRC);
  const violations = [];

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      CALL.lastIndex = 0;
      let match = CALL.exec(line);
      while (match) {
        // The call's own '(' is the last char of the matched text.
        const openIndex = match.index + match[0].length - 1;
        if (!isComment(line) && !hasPinnedLocale(line, openIndex)) {
          violations.push({
            file: path.relative(path.join(__dirname, '..', '..'), file),
            line: i + 1,
            text: line.trim().slice(0, 100),
          });
        }
        match = CALL.exec(line);
      }
    });
  }

  console.log(`scanned ${files.length} frontend source files`);
  console.log('rule: every toLocale*() must pin its locale (use LOCALE from src/lib/format.ts)');
  console.log('');

  if (violations.length === 0) {
    console.log('  ✓ no unpinned locale formatters');
    console.log('');
    console.log('PASSED');
    return;
  }

  console.log(`  ✗ ${violations.length} unpinned locale formatter(s):`);
  for (const v of violations) {
    console.log(`      ${v.file}:${v.line}`);
    console.log(`        ${v.text}`);
  }
  console.log('');
  console.log('FAILED — pin the locale (LOCALE from src/lib/format.ts) or use a');
  console.log('format helper. An unpinned call hydrates differently for any user');
  console.log('whose OS locale differs from the server.');
  process.exitCode = 1;
};

main();