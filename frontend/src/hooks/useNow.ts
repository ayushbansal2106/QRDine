import { useCallback, useSyncExternalStore } from "react";

/**
 * A render-safe, ticking clock.
 *
 * Anything that renders "how long ago" needs the current time, but reading
 * `Date.now()` in the render body is an impure call: React is free to render a
 * component more than once (and to discard a render), so the label could read
 * differently on a render the user never sees, and the React Compiler rejects
 * it outright.
 *
 * `useSyncExternalStore` is the supported way to read an external value that
 * changes over time. The clock is module-level and shared, so every subscriber
 * ticks off one interval rather than one per component — mounting twenty bill
 * rows costs one timer, not twenty.
 *
 * @param intervalMs How often the value should advance. Coarser than the
 *   shortest label you display is fine; the value is snapped to the interval so
 *   `getServerSnapshot` and the first client render agree and hydration
 *   cannot mismatch.
 */
export function useNow(intervalMs = 30_000): number {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const timer = setInterval(onStoreChange, intervalMs);
      return () => clearInterval(timer);
    },
    [intervalMs]
  );

  const getSnapshot = useCallback(() => {
    // Snapped to the tick so every read within the same interval is identical:
    // `getSnapshot` must be pure, and an unsnapped `Date.now()` changes value
    // between two calls in the same render.
    return Math.floor(Date.now() / intervalMs) * intervalMs;
  }, [intervalMs]);

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    // SSR has no clock to read, and rendering a real timestamp on the server
    // then a slightly different one on the client is a hydration mismatch.
    // Zero renders as the epoch; these labels are all relative, so the client
    // corrects on its first tick.
    () => 0
  );
}