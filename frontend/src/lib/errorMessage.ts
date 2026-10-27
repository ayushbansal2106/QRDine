import axios from "axios";

/**
 * The parsed response body of a failed API call, or `undefined`.
 *
 * `response.data` is typed `any` by Axios, so it is narrowed to
 * `Record<string, unknown>` here — once — instead of leaking `any` into every
 * caller. Access a field as `body.field`, which is `unknown` and must be
 * checked before use.
 */
export const apiErrorBody = (
  error: unknown
): Record<string, unknown> | undefined => {
  if (axios.isAxiosError(error)) {
    const data: unknown = error.response?.data;
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  }
  return undefined;
};

/**
 * The HTTP status of a failed API call, or `undefined` for anything else.
 *
 * Several actions branch on status to turn an error into a *state* rather than a
 * failure — a 404 on the active session means "no session yet", a 409 on
 * `resend-email` means "prompt for an address", a 422 from the digitiser means
 * "the AI ran but could not read the menu". Reaching into `error.response.status`
 * by hand at each site is what forced those handlers to `any` in the first
 * place.
 */
export const apiErrorStatus = (error: unknown): number | undefined => {
  if (axios.isAxiosError(error)) {
    return error.response?.status;
  }
  return undefined;
};

/**
 * Extract the message a server action should surface to the user.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Every server action in `src/actions/` had the same line:
 *
 *   } catch (error: unknown) {
 *     throw new Error(error.response?.data?.message || "Failed to fetch X.");
 *   }
 *
 * 198 copies of it, and `error: any` alone was 64% of all `explicit any` in the
 * codebase. That is one root cause, not 198 typing decisions — so the fix is a
 * single typed helper plus `catch (error: unknown)`, not 198 casts.
 *
 * ── Behaviour is deliberately preserved ────────────────────────────────────
 * The original returned the server's message when present and the caller's
 * fallback otherwise — including for non-Axios errors, where `error.message`
 * was deliberately *not* used. Surfacing "Request failed with status code 500"
 * to a café owner instead of "Failed to load orders" is a worse message, so
 * the fallback wins when the server gave us nothing usable.
 *
 * That is a UX decision worth revisiting separately, but changing it inside a
 * 198-site refactor would make the diff impossible to reason about.
 */
export const apiErrorMessage = (error: unknown, fallback: string): string => {
  const data = apiErrorBody(error);
  if (typeof data?.message === "string" && data.message.trim().length > 0) {
    return data.message;
  }

  return fallback;
};

/**
 * A conservative message for a non-Axios throw.
 *
 * Use this where there is no API response to read — a validation failure, or a
 * bug thrown synchronously. Unlike `apiErrorMessage` it *does* surface the real
 * message, because in those cases the Error is the only description available.
 */
export const thrownMessage = (
  error: unknown,
  fallback: string
): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
};