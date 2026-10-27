/**
 * Locale-independent formatters.
 *
 * Calling `toLocaleString()` with no argument (or an empty array) makes the
 * output depend on the *runtime's* locale. During SSR that is the server's,
 * and during hydration it is the browser's — so an owner whose Windows
 * machine is set to en-US gets different text than the server rendered, React
 * throws a hydration mismatch and regenerates the tree.
 *
 * Every formatter here pins the locale to en-IN (this is an Indian café
 * product) so the server and the browser always emit identical markup.
 *
 * `suppressHydrationWarning` is deliberately NOT used as a fix: it hides the
 * mismatch instead of removing it, and it only silences one text node.
 */

export const LOCALE = "en-IN";

const toDate = (value: string | number | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** e.g. "3 Oct 2026, 6:27 pm" */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  fallback = "—"
): string {
  const date = toDate(value);
  if (!date) return fallback;
  return date.toLocaleString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** e.g. "6:27 pm" */
export function formatTime(
  value: string | number | Date | null | undefined,
  fallback = "—"
): string {
  const date = toDate(value);
  if (!date) return fallback;
  return date.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
}

/** e.g. "3 Oct 2026" */
export function formatDate(
  value: string | number | Date | null | undefined,
  fallback = "—"
): string {
  const date = toDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

/** Compact table format: "3 Oct, 6:27 pm" (no year). */
export function formatShort(value: string | number | Date | null | undefined, fallback = "—"): string {
  const date = toDate(value);
  if (!date) return fallback;
  return date.toLocaleString(LOCALE, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Currency, pinned to the Indian numbering system. */
export function formatCurrency(value: number | string | null | undefined): string {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}