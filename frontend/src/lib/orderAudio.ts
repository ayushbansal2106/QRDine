"use client";

/**
 * Module #03 — new-order audio cue.
 *
 * Synthesised with the Web Audio API rather than an mp3 so there is no asset to
 * host, no cache to bust and no autoplay preload. Browsers block audio until the
 * user has interacted with the page, so the caller must call this from a real
 * user gesture (the admin board is interactive by definition) and failures are
 * swallowed — a failed ding must never interrupt order handling.
 */

let context: AudioContext | null = null;

const getContext = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  if (context) return context;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
};

/** Short two-tone chime. `variant` lets a flagged order sound different. */
export const playOrderDing = (variant: "normal" | "flagged" = "normal") => {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const tones = variant === "flagged" ? [520, 380] : [660, 880];
  const now = ctx.currentTime;

  tones.forEach((frequency, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = frequency;

    const start = now + index * 0.16;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.36);
  });
};