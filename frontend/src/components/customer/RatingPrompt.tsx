"use client";

import React, { useState } from "react";
import { submitRating } from "@/actions/reviews";
import type { ReviewOutcome } from "@/types";

interface Props {
  orderId: string;
}

const TAGS = [
  { value: "taste", label: "Taste" },
  { value: "freshness", label: "Freshness" },
  { value: "portion", label: "Portion" },
  { value: "temperature", label: "Temperature" },
  { value: "staff_service", label: "Service" },
  { value: "wait_time", label: "Wait time" },
  { value: "cleanliness", label: "Cleanliness" },
  { value: "value_for_money", label: "Value" },
];

/**
 * Module #18 — post-order rating prompt.
 *
 * Happy customers get a suggested Google review they can copy; unhappy ones get
 * a plain thank-you, because their words go straight to the manager instead.
 * The guest token on the cookie is what scopes this to their own order.
 */
export const RatingPrompt: React.FC<Props> = ({ orderId }) => {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleTag = (tag: string) =>
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag].slice(-4)));

  const submit = async () => {
    if (!rating) return;
    setBusy(true);
    setError(null);
    const result = await submitRating({ orderId, rating, tags, comment });
    setBusy(false);
    if (result.success && result.outcome) {
      setOutcome(result.outcome);
    } else {
      setError(result.message || "Could not save your rating.");
    }
  };

  if (outcome) {
    return (
      <div className="bg-surface-container-lowest rounded-xl p-md w-full text-left mb-lg border border-surface-container">
        <div className="flex items-center gap-xs mb-sm">
          <span className="material-symbols-outlined text-primary text-[20px]">favorite</span>
          <span className="font-inter font-semibold text-body-md text-on-surface">Thanks for rating us</span>
        </div>
        <p className="font-inter text-body-sm text-on-surface-variant mb-sm">{outcome.message}</p>

        {outcome.visibility === "public_draft" && (
          <div className="flex flex-col gap-sm">
            {outcome.draft && (
              <div className="bg-surface-container rounded-lg p-sm">
                <p className="text-label-sm text-on-surface-variant mb-xs">A draft you can edit</p>
                <p className="text-body-sm text-on-surface">{outcome.draft}</p>
              </div>
            )}
            <div className="flex gap-sm">
              {outcome.draft && (
                <button
                  onClick={() => navigator.clipboard?.writeText(outcome.draft || "")}
                  className="border border-surface-container rounded-full px-md py-sm text-body-sm font-semibold"
                >
                  Copy
                </button>
              )}
              {outcome.googleReviewUrl && (
                <a
                  href={outcome.googleReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-primary text-on-primary rounded-full px-md py-sm text-body-sm font-semibold"
                >
                  Leave a Google review
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl p-md w-full text-left mb-lg border border-surface-container">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-sm text-body-md font-semibold text-primary"
        >
          <span className="material-symbols-outlined text-[20px]">rate_review</span>
          How was everything?
        </button>
      ) : (
        <div className="flex flex-col gap-sm">
          <div className="flex items-center justify-center gap-xs">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setRating(star)}
                onMouseEnter={() => setHover(star)}
                onMouseLeave={() => setHover(0)}
                aria-label={`${star} star${star > 1 ? "s" : ""}`}
                className="p-xs"
              >
                <span
                  className={`material-symbols-outlined text-[32px] ${
                    star <= (hover || rating) ? "text-warning" : "text-surface-container"
                  }`}
                >
                  {star <= (hover || rating) ? "star" : "star_outline"}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-xs justify-center">
            {TAGS.map((tag) => (
              <button
                key={tag.value}
                onClick={() => toggleTag(tag.value)}
                className={`rounded-full px-sm py-xs text-label-md font-medium ${
                  tags.includes(tag.value)
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container text-on-surface-variant"
                }`}
              >
                {tag.label}
              </button>
            ))}
          </div>

          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Anything you want the team to know?"
            className="w-full bg-surface-container-low rounded-lg p-sm border-none text-body-md"
          />

          {error && <p className="text-body-sm text-error text-center">{error}</p>}

          <button
            onClick={submit}
            disabled={!rating || busy}
            className="bg-primary text-on-primary rounded-full py-sm text-body-md font-semibold disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send rating"}
          </button>
        </div>
      )}
    </div>
  );
};