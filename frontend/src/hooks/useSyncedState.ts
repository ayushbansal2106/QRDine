import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Local state that resets whenever the server-provided value changes.
 *
 * Why this exists: the admin boards (kitchen, orders, requests) hold live state
 * that socket events mutate, but they also need to adopt a fresh snapshot when
 * the server component re-renders with new data after `router.refresh()`. The
 * usual implementation —
 *
 * ```tsx
 * useEffect(() => { setOrders(initialOrders); }, [initialOrders]);
 * ```
 *
 * — is what `react-hooks/set-state-in-effect` correctly rejects: it renders
 * once with the *stale* orders and then immediately re-renders, so the board
 * briefly shows data the server has already replaced.
 *
 * This is React's documented alternative for "adjusting state when a prop
 * changes": remember the value the state was seeded from, and if the incoming
 * prop no longer matches, update both during the same render. React discards
 * and re-runs that render immediately, so the stale value is never committed —
 * no extra pass, no flash, and no effect.
 *
 * The previous value is kept in state rather than a ref on purpose: reading a
 * ref during render is what `react-hooks/refs` rejects, and state is the
 * value React can re-render against correctly.
 *
 * @param serverValue The value the server just rendered.
 */
export function useSyncedState<T>(serverValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(serverValue);
  const [seededFrom, setSeededFrom] = useState(serverValue);

  if (seededFrom !== serverValue) {
    setSeededFrom(serverValue);
    setState(serverValue);
  }

  // `useState` already guarantees a stable setter, but the compiler and
  // `exhaustive-deps` cannot see through the hook boundary — so socket effects
  // that depend on `setOrders` would be told they have a missing dependency.
  // Wrapping it once with an empty dep list states that stability explicitly.
  const setSynced = useCallback<Dispatch<SetStateAction<T>>>((value) => {
    setState(value);
  }, []);

  return [state, setSynced];
}