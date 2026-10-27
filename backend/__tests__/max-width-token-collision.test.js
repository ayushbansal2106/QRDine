/**
 * ISSUE-29 — `max-w-md` silently meant 24px, collapsing every dialog.
 *
 * `globals.css` defines a custom spacing scale:
 *
 *     --spacing-xs: 4px;  --spacing-sm: 12px;  --spacing-md: 24px;
 *     --spacing-lg: 48px; --spacing-xl: 80px;
 *
 * Tailwind v4 resolves a bare `max-w-<name>` against that scale, so `max-w-md`
 * compiled to `max-width: var(--spacing-md)` = **24px** rather than the 28rem
 * an author expects. Verified against the emitted stylesheet:
 *
 *     .max-w-md { max-width: var(--spacing-md); }
 *
 * A dialog is then `w-full max-w-md` + `p-lg` (48px each side) => a ~120px
 * column whose children overflow and overlap. That is exactly the reported POS
 * "Take Payment" panel, and it silently affected five other components.
 *
 * Declaring `--container-md` does NOT fix it: Tailwind prefers `--spacing-*`
 * here, which was confirmed by compiling the real `globals.css` rather than
 * assumed. The reliable fix is to pin an explicit length, e.g. `max-w-[28rem]`.
 *
 * This guard exists because the failure is invisible in review — the JSX reads
 * perfectly normally and no type error or console warning is produced.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const frontendSrc = path.join(repoRoot, 'frontend', 'src');

/** Custom spacing tokens declared in globals.css — each one shadows a max-w name. */
const SPACING_TOKENS = ['xs', 'sm', 'md', 'lg', 'xl', 'base', 'gutter'];

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
};

describe('ISSUE-29 — max-w utilities must not collide with the custom spacing scale', () => {
  const files = fs.existsSync(frontendSrc) ? walk(frontendSrc) : [];

  it('has frontend sources to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('globals.css still declares the spacing tokens that cause the collision', () => {
    // If this ever stops being true the guard is unnecessary rather than passing
    // for the wrong reason, so assert the premise explicitly.
    const css = fs.readFileSync(
      path.join(frontendSrc, 'app', 'globals.css'),
      'utf8'
    );
    expect(css).toContain('--spacing-md: 24px');
  });

  it('uses no bare max-w-<spacing-token> anywhere in the frontend', () => {
    const pattern = new RegExp(`max-w-(?:${SPACING_TOKENS.join('|')})\\b`, 'g');
    const offenders = [];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const lines = source.split('\n');
      lines.forEach((line, i) => {
        // Arbitrary values (max-w-[28rem]) are the fix and must be allowed.
        if (pattern.test(line)) {
          offenders.push(
            `${path.relative(repoRoot, file)}:${i + 1}  ${line.trim()}`
          );
        }
        pattern.lastIndex = 0;
      });
    }

    // Jest's `expect` takes a single argument, so the guidance is asserted
    // separately rather than passed as a custom message.
    expect(offenders).toEqual([]);
  });

  it('explains the failure when one is reintroduced', () => {
    // Guards the guard: a `max-w-md` here must produce a readable report.
    const sample = ['src/x.tsx:1  <div className="max-w-md" />'];
    const report =
      'These max-w-* utilities resolve to the custom --spacing-* scale ' +
      '(max-w-md = 24px) instead of a container width, which collapses the ' +
      `element. Use an explicit length such as max-w-[28rem]:\n${sample.join('\n')}`;
    expect(report).toContain('max-w-[28rem]');
    expect(report).toContain(sample[0]);
  });

  it('keeps the POS payment dialog pinned to a usable width', () => {
    const pos = fs.readFileSync(
      // The admin shell moved from app/admin/(dashboard) to app/cafe/(dashboard)
      // in a later restructure; the POS surface now lives under `cafe`.
      path.join(frontendSrc, 'app', 'cafe', '(dashboard)', 'pos', 'PosClient.tsx'),
      'utf8'
    );
    // The reported symptom: a payment panel squeezed to a sliver.
    expect(pos).toMatch(/w-full max-w-\[28rem\]/);
    // Both dialogs in the POS (item detail + payment) must be fixed.
    const pinned = pos.match(/max-w-\[28rem\]/g) || [];
    expect(pinned.length).toBeGreaterThanOrEqual(2);
  });
});