"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { fetchMyScratchCards, revealMyScratchCard } from "@/actions/scratch";

interface Prize {
  label: string;
  type: "flat_off" | "percent_off" | "free_item" | "none";
  value: number;
}

/**
 * Module #16 — customer scratch-off card.
 *
 * Renders a canvas over hidden prize content. Dragging erases the foil; once
 * enough has been scratched the prize is revealed server-side (the draw happens
 * on the backend, never in the browser).
 */
export const ScratchReveal: React.FC = () => {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [prize, setPrize] = useState<Prize | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isDrawing, setIsDrawing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchMyScratchCards();
        if (res.success && res.pending && res.pending.length > 0) {
          setPendingId(res.pending[0].id);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const paintFoil = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width));
    canvas.height = Math.max(1, Math.floor(rect.height));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#8a9886");
    gradient.addColorStop(1, "#51604f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "600 16px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Scratch here ✨", canvas.width / 2, canvas.height / 2 + 6);
  }, []);

  useEffect(() => {
    if (pendingId && !prize) paintFoil();
  }, [pendingId, prize, paintFoil]);

  const eraseAt = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  };

  const clearedRatio = () => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let clear = 0;
    // Sample every 40th pixel for speed
    for (let i = 3; i < data.length; i += 40 * 4) {
      if (data[i] === 0) clear += 1;
    }
    return clear / (data.length / (40 * 4));
  };

  const reveal = useCallback(async () => {
    if (!pendingId || busy || prize) return;
    setBusy(true);
    setError("");
    try {
      const res = await revealMyScratchCard(pendingId);
      setPrize(res.prize as Prize);
    } catch (err: unknown) {
      setError(thrownMessage(err, "Failed to reveal card."));
    } finally {
      setBusy(false);
    }
  }, [pendingId, busy, prize]);

  const handlePointerUp = () => {
    setIsDrawing(false);
    if (clearedRatio() > 0.45) reveal();
  };

  if (!pendingId) return null;

  return (
    <div className="bg-surface-container-lowest rounded-xl p-md w-full shadow-[0px_4px_20px_rgba(0,0,0,0.04)] mb-lg border border-surface-container">
      <div className="flex items-center gap-xs mb-sm">
        <span className="material-symbols-outlined text-primary text-[20px]">casino</span>
        <span className="font-inter font-semibold text-body-md text-on-surface">You won a scratch card!</span>
      </div>

      <div
        ref={containerRef}
        className="relative w-full h-[120px] rounded-xl overflow-hidden select-none"
        style={{ touchAction: "none" }}
      >
        {/* Hidden prize layer */}
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-accent-amber-container">
          {prize ? (
            <>
              <span className="material-symbols-outlined text-[32px] text-warning">celebration</span>
              <span className="font-inter font-bold text-body-lg text-warning text-center px-md">
                {prize.label}
              </span>
            </>
          ) : (
            <span className="font-inter font-semibold text-body-md text-warning">??</span>
          )}
        </div>

        {/* Scratch foil */}
        {!prize && (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full cursor-crosshair"
            onPointerDown={(e) => {
              setIsDrawing(true);
              (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
              eraseAt(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (isDrawing) eraseAt(e.clientX, e.clientY);
            }}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => setIsDrawing(false)}
          />
        )}
      </div>

      {error && <p className="font-inter text-body-sm text-error mt-sm">{error}</p>}

      {!prize && (
        <button
          onClick={reveal}
          disabled={busy}
          className="mt-sm w-full h-10 rounded-lg bg-surface-container text-on-surface font-inter font-semibold text-body-sm cursor-pointer disabled:opacity-50"
        >
          {busy ? "Revealing..." : "Reveal now"}
        </button>
      )}
    </div>
  );
};

export default ScratchReveal;
