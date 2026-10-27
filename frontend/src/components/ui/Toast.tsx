"use client";

import React, { useCallback, useSyncExternalStore } from "react";

/**
 * Transient status messages for the guest app.
 *
 * `ToastManager` already exists, but it is deliberately coupled to a dining
 * session's activity feed and only mounts inside the table flow — so it cannot
 * serve `/profile`, which has no session. This is a small standalone equivalent
 * for UI that just needs to say something for a moment and then get out of the
 * way.
 *
 * The store is module-level rather than React context so any component can call
 * `toast(...)` directly. That keeps call sites free of plumbing, which matters
 * because the alternative — threading a callback down — is what pushes people
 * back to rendering an inline `<div>` that never goes away.
 */

export type ToastTone = "neutral" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const TOAST_MS = 4000;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => {
  // `items` is replaced rather than mutated, so subscribers can compare by
  // reference — which is what makes `useSyncExternalStore` below correct.
  listeners.forEach((listener) => listener());
};

const remove = (id: number) => {
  items = items.filter((t) => t.id !== id);
  emit();
};

/** Stable empty array for the server snapshot, so SSR never mismatches. */
const EMPTY: ToastItem[] = [];

/**
 * Show a transient message. Returns its id in case the caller wants to dismiss
 * it early.
 */
export const toast = (message: string, tone: ToastTone = "neutral"): number => {
  const id = nextId++;
  items = [...items, { id, message, tone }];
  emit();

  // Timed out on an unmounted page, this is harmless — `remove` only ever
  // touches the module store, and the timer is not kept alive.
  setTimeout(() => remove(id), TOAST_MS);

  return id;
};

export const dismissToast = remove;

const TONE_STYLES: Record<ToastTone, string> = {
  neutral: "bg-surface-container-highest/95 text-on-surface",
  success: "bg-success-container/95 text-on-success-container",
  error: "bg-error-container/95 text-on-error-container",
};

const TONE_ICONS: Record<ToastTone, string> = {
  neutral: "info",
  success: "check_circle",
  error: "error",
};

export const Toaster: React.FC = () => {
  // `useSyncExternalStore` rather than subscribe-in-an-effect: the store is
  // module-level and can be written to at any moment, including between render
  // and commit, so subscribing imperatively would be racy.
  const toasts = useSyncExternalStore(
    useCallback((onStoreChange: () => void) => {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    }, []),
    () => items,
    () => EMPTY
  );

  const dismiss = useCallback((id: number) => remove(id), []);

  if (toasts.length === 0) return null;

  return (
    <div
      // `pointer-events-none` on the container so a toast can never swallow a
      // tap meant for the screen underneath it.
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none w-full max-w-[24rem] px-4"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto flex items-center gap-3 ${TONE_STYLES[t.tone]} backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.12)] px-4 py-3 rounded-xl text-left font-inter animate-[slideDown_0.3s_ease-out] cursor-pointer`}
        >
          <span className="material-symbols-outlined text-[20px] shrink-0">
            {TONE_ICONS[t.tone]}
          </span>
          <span className="text-body-sm font-medium leading-tight flex-1">
            {t.message}
          </span>
          <span className="material-symbols-outlined text-[16px] opacity-60 shrink-0">
            close
          </span>
        </button>
      ))}
    </div>
  );
};

export default Toaster;
