"use client";

import React, { useCallback, useState } from "react";
import {
  generateReplyDraft,
  generateReviewDraft,
  getReviews,
  getReviewSettings,
  getReviewSummary,
  publishReply,
  updateReview,
  updateReviewSettings,
} from "@/actions/reviews";
import type { Review, ReviewSettings, ReviewSummary } from "@/types";
import { formatDateTime } from "@/lib/format";

interface Props {
  initialSettings: ReviewSettings | null;
  initialSummary: ReviewSummary | null;
  initialReviews: Review[];
  aiConfigured: boolean;
  loadError: string | null;
}

const Stars: React.FC<{ rating: number; className?: string }> = ({ rating, className = "text-[18px]" }) => (
  <span className={`flex gap-px ${className}`} aria-label={`${rating} out of 5`}>
    {[1, 2, 3, 4, 5].map((star) => (
      <span
        key={star}
        className={`material-symbols-outlined ${star <= rating ? "text-warning" : "text-surface-container"}`}
        style={{ fontSize: "inherit" }}
      >
        {star <= rating ? "star" : "star_outline"}
      </span>
    ))}
  </span>
);

const STATUS_TONE: Record<string, string> = {
  new: "bg-surface-container text-on-surface-variant",
  drafted: "bg-primary/10 text-primary",
  acknowledged: "bg-primary/10 text-primary",
  actioned: "bg-primary/10 text-primary",
  dismissed: "bg-surface-container text-on-surface-variant",
};

export const ReviewsClient: React.FC<Props> = ({
  initialSettings,
  initialSummary,
  initialReviews,
  aiConfigured,
  loadError,
}) => {
  const [reviews, setReviews] = useState<Review[]>(initialReviews);
  const [summary, setSummary] = useState<ReviewSummary | null>(initialSummary);
  const [settings, setSettings] = useState<ReviewSettings | null>(initialSettings);
  const [filter, setFilter] = useState<"all" | "private_feedback" | "public_draft">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Settings form state
  const [googlePlaceId, setGooglePlaceId] = useState(initialSettings?.googlePlaceId ?? "");
  const [aiEnabled, setAiEnabled] = useState(initialSettings?.aiEnabled ?? false);
  const [minRating, setMinRating] = useState(String(initialSettings?.minRatingForGoogle ?? 4));
  const [brandVoice, setBrandVoice] = useState(
    initialSettings?.brandVoice ?? "warm, concise, appreciative"
  );
  const [autoAlerts, setAutoAlerts] = useState(initialSettings?.autoSendLowRatingAlerts ?? true);

  const refresh = useCallback(async () => {
    const [reviewsRes, summaryRes] = await Promise.all([
      getReviews({ limit: 50, visibility: filter === "all" ? undefined : filter }),
      getReviewSummary(),
    ]);
    if (reviewsRes.success && reviewsRes.reviews) setReviews(reviewsRes.reviews);
    if (summaryRes.success && summaryRes.summary) setSummary(summaryRes.summary);
  }, [filter]);

  const saveSettings = async () => {
    const result = await updateReviewSettings({
      googlePlaceId,
      aiEnabled,
      minRatingForGoogle: Number(minRating) || 4,
      brandVoice,
      autoSendLowRatingAlerts: autoAlerts,
    });
    if (result.success) {
      const settingsRes = await getReviewSettings();
      if (settingsRes.success && settingsRes.settings) setSettings(settingsRes.settings);
      setMessage({ tone: "success", text: "Review settings saved." });
    } else {
      setMessage({ tone: "error", text: result.message || "Could not save settings." });
    }
  };

  const draftFor = async (review: Review) => {
    setBusyId(review.id);
    const result = await generateReviewDraft(review.id);
    setBusyId(null);
    if (result.success) {
      setReviews((prev) =>
        prev.map((r) => (r.id === review.id ? { ...r, ai: { ...r.ai, draft: result.draft || r.ai.draft } } : r))
      );
    } else {
      setMessage({ tone: "error", text: result.message || "Could not generate a draft." });
    }
  };

  const replyFor = async (review: Review) => {
    setBusyId(review.id);
    const result = await generateReplyDraft(review.id);
    setBusyId(null);
    if (result.success && result.reply) {
      setReplyDrafts((prev) => ({ ...prev, [review.id]: result.reply as string }));
    } else {
      setMessage({ tone: "error", text: result.message || "Could not generate a reply." });
    }
  };

  const publish = async (review: Review) => {
    const reply = replyDrafts[review.id] ?? review.ai.ownerReplyDraft;
    if (!reply?.trim()) return;
    setBusyId(review.id);
    const result = await publishReply(review.id, reply);
    setBusyId(null);
    if (result.success) refresh();
    else setMessage({ tone: "error", text: result.message || "Could not save the reply." });
  };

  const setStatus = async (review: Review, status: string) => {
    setBusyId(review.id);
    const result = await updateReview(review.id, { status });
    setBusyId(null);
    if (result.success) {
      setReviews((prev) => prev.map((r) => (r.id === review.id ? { ...r, status: status as Review["status"] } : r)));
    } else {
      setMessage({ tone: "error", text: result.message || "Could not update the review." });
    }
  };

  const maxCount = summary
    ? Math.max(1, ...Object.values(summary.distribution).map((v) => Number(v)))
    : 1;

  return (
    <div className="p-lg bg-surface-container-lowest min-h-screen font-inter">
      <div className="max-w-6xl mx-auto flex flex-col gap-lg">
        <header>
          <h1 className="text-headline-lg text-on-surface font-semibold">Reviews & AI</h1>
          <p className="text-body-sm text-on-surface-variant mt-xs max-w-3xl">
            Customers rate at the table. Happy ratings get a suggested Google review written from what
            they actually ordered; anything lower stays private and lands in this inbox for you to act
            on before it becomes a public review.
          </p>
        </header>

        {loadError && <div className="bg-error/10 text-error rounded-xl p-md text-body-md">{loadError}</div>}
        {message && (
          <div
            className={`rounded-xl p-md text-body-md ${
              message.tone === "success" ? "bg-primary/10 text-primary" : "bg-error/10 text-error"
            }`}
          >
            {message.text}
          </div>
        )}
        {!aiConfigured && (
          <div className="bg-surface-container rounded-xl p-md text-body-sm text-on-surface-variant">
            <span className="material-symbols-outlined text-[18px] align-middle mr-xs">info</span>
            No <code className="font-mono">GOOGLE_API_KEY</code> is configured on the server, so drafts use
            a template. Add the key and restart the backend to switch on Gemini.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg">
          <section className="bg-surface-container-lowest border border-surface-container rounded-xl p-lg">
            <h2 className="text-title-lg text-on-surface font-semibold mb-md">Rating mix</h2>
            {summary && summary.total > 0 ? (
              <>
                <div className="flex items-baseline gap-sm mb-md">
                  <span className="text-headline-lg font-bold font-mono">{summary.averageRating}</span>
                  <Stars rating={Math.round(summary.averageRating)} />
                  <span className="text-body-sm text-on-surface-variant">
                    {summary.total} rating{summary.total === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="flex flex-col gap-xs">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = Number(summary.distribution[star] || 0);
                    return (
                      <li key={star} className="flex items-center gap-sm text-body-sm">
                        <span className="w-8 font-mono">{star}★</span>
                        <span className="flex-1 h-2 rounded-full bg-surface-container overflow-hidden">
                          <span
                            className="block h-full bg-warning rounded-full"
                            style={{ width: `${(count / maxCount) * 100}%` }}
                          />
                        </span>
                        <span className="w-8 text-right font-mono text-on-surface-variant">{count}</span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-md flex flex-col gap-xs text-body-sm text-on-surface-variant">
                  <span>Replies sent: {summary.responseRate}%</span>
                  <span>Private feedback: {summary.privateFeedbackCount}</span>
                  <span>Needing action: {summary.pendingActionCount}</span>
                </div>
              </>
            ) : (
              <p className="text-body-md text-on-surface-variant">No ratings yet.</p>
            )}
          </section>

          <section className="bg-surface-container-lowest border border-surface-container rounded-xl p-lg lg:col-span-2">
            <h2 className="text-title-lg text-on-surface font-semibold mb-md">What customers mention</h2>
            {summary && summary.topThemes.length > 0 ? (
              <div className="flex flex-wrap gap-sm mb-md">
                {summary.topThemes.map((t) => (
                  <span
                    key={t.theme}
                    className="bg-surface-container rounded-full px-sm py-xs text-label-md text-on-surface"
                  >
                    {t.theme} · {t.count}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-body-md text-on-surface-variant mb-md">No themes yet.</p>
            )}

            {summary?.aiDigest && (
              <div className="bg-surface-container rounded-lg p-md">
                <p className="text-label-md text-on-surface-variant mb-xs">AI digest of low ratings</p>
                <p className="text-body-md text-on-surface whitespace-pre-line">{summary.aiDigest}</p>
              </div>
            )}
          </section>
        </div>

        <section className="bg-surface-container-lowest border border-surface-container rounded-xl p-lg">
          <div className="flex flex-wrap items-center justify-between gap-sm mb-md">
            <h2 className="text-title-lg text-on-surface font-semibold">Feedback inbox</h2>
            <div className="flex gap-xs">
              {(["all", "private_feedback", "public_draft"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`rounded-full px-md py-xs text-body-sm font-semibold capitalize ${
                    filter === value
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {value === "all" ? "All" : value === "private_feedback" ? "Private" : "Draftable"}
                </button>
              ))}
            </div>
          </div>

          {reviews.length === 0 ? (
            <p className="text-body-md text-on-surface-variant">
              Nothing here yet. Ratings appear as soon as customers rate at the table.
            </p>
          ) : (
            <ul className="flex flex-col gap-md">
              {reviews.map((review) => (
                <li key={review.id} className="border border-surface-container rounded-xl p-md flex flex-col gap-sm">
                  <div className="flex flex-wrap items-center gap-sm">
                    <Stars rating={review.rating} />
                    <span
                      className={`px-sm py-xs rounded-full text-label-sm font-semibold ${
                        review.visibility === "private_feedback"
                          ? "bg-error/10 text-error"
                          : "bg-primary/10 text-primary"
                      }`}
                    >
                      {review.visibility === "private_feedback" ? "private" : "draftable"}
                    </span>
                    <span className={`px-sm py-xs rounded-full text-label-sm ${STATUS_TONE[review.status]}`}>
                      {review.status}
                    </span>
                    <span className="text-body-sm text-on-surface-variant">
                      {formatDateTime(review.createdAt)}
                    </span>
                  </div>

                  {review.comment && (
                    <p className="text-body-md text-on-surface">&ldquo;{review.comment}&rdquo;</p>
                  )}

                  {review.tags.length > 0 && (
                    <div className="flex flex-wrap gap-xs">
                      {review.tags.map((tag) => (
                        <span
                          key={tag}
                          className="bg-surface-container rounded-full px-sm py-xs text-label-sm text-on-surface-variant"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {review.ai.summary && (
                    <p className="text-body-sm text-on-surface-variant">
                      <strong className="text-on-surface">AI:</strong> {review.ai.summary}
                      {review.ai.sentiment ? ` (${review.ai.sentiment})` : ""}
                    </p>
                  )}

                  {review.visibility === "public_draft" && (
                    <div className="bg-surface-container rounded-lg p-sm">
                      <p className="text-label-md text-on-surface-variant mb-xs">Suggested Google review</p>
                      <p className="text-body-md text-on-surface whitespace-pre-line">
                        {review.ai.draft || "No draft yet — generate one below."}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-sm items-center">
                    {review.visibility === "public_draft" && (
                      <button
                        onClick={() => draftFor(review)}
                        disabled={busyId === review.id}
                        className="border border-surface-container rounded-full px-md py-sm text-body-sm font-semibold hover:bg-surface-container disabled:opacity-50"
                      >
                        {busyId === review.id ? "Working…" : "Regenerate draft"}
                      </button>
                    )}
                    <button
                      onClick={() => replyFor(review)}
                      disabled={busyId === review.id}
                      className="border border-surface-container rounded-full px-md py-sm text-body-sm font-semibold hover:bg-surface-container disabled:opacity-50"
                    >
                      Draft a reply
                    </button>
                    {review.status === "new" && (
                      <button
                        onClick={() => setStatus(review, "actioned")}
                        disabled={busyId === review.id}
                        className="border border-surface-container rounded-full px-md py-sm text-body-sm font-semibold hover:bg-surface-container disabled:opacity-50"
                      >
                        Mark actioned
                      </button>
                    )}
                  </div>

                  {(replyDrafts[review.id] || review.ownerReply) && (
                    <div className="flex flex-col gap-sm">
                      <textarea
                        value={replyDrafts[review.id] ?? review.ownerReply}
                        onChange={(e) =>
                          setReplyDrafts((prev) => ({ ...prev, [review.id]: e.target.value }))
                        }
                        rows={3}
                        className="w-full border border-surface-container rounded-lg p-sm text-body-md bg-surface-container-lowest"
                      />
                      <button
                        onClick={() => publish(review)}
                        disabled={busyId === review.id}
                        className="self-start bg-primary text-on-primary rounded-full px-md py-sm text-body-sm font-semibold hover:opacity-90 disabled:opacity-50"
                      >
                        Save reply
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-surface-container-lowest border border-surface-container rounded-xl p-lg">
          <h2 className="text-title-lg text-on-surface font-semibold mb-md">Settings</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            <div className="flex flex-col gap-xs">
              <label className="text-label-md text-on-surface-variant" htmlFor="rv-place">
                Google Place ID
              </label>
              <input
                id="rv-place"
                value={googlePlaceId}
                onChange={(e) => setGooglePlaceId(e.target.value)}
                className="border border-surface-container rounded-lg px-sm py-sm text-body-md bg-surface-container-lowest"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="text-label-md text-on-surface-variant" htmlFor="rv-min">
                Minimum rating for a Google prompt
              </label>
              <input
                id="rv-min"
                type="number"
                min={1}
                max={5}
                value={minRating}
                onChange={(e) => setMinRating(e.target.value)}
                className="border border-surface-container rounded-lg px-sm py-sm text-body-md bg-surface-container-lowest"
              />
            </div>
            <div className="flex flex-col gap-xs md:col-span-2">
              <label className="text-label-md text-on-surface-variant" htmlFor="rv-voice">
                Brand voice for AI drafts
              </label>
              <input
                id="rv-voice"
                value={brandVoice}
                onChange={(e) => setBrandVoice(e.target.value)}
                className="border border-surface-container rounded-lg px-sm py-sm text-body-md bg-surface-container-lowest"
              />
            </div>
          </div>

          <div className="flex flex-col gap-sm mt-md">
            <label className="flex items-center gap-sm cursor-pointer">
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
                className="w-5 h-5 accent-primary"
              />
              <span className="text-body-md text-on-surface">Use AI to write drafts and replies</span>
            </label>
            <label className="flex items-center gap-sm cursor-pointer">
              <input
                type="checkbox"
                checked={autoAlerts}
                onChange={(e) => setAutoAlerts(e.target.checked)}
                className="w-5 h-5 accent-primary"
              />
              <span className="text-body-md text-on-surface">Alert managers instantly on a low rating</span>
            </label>
          </div>

          <button
            onClick={saveSettings}
            className="mt-lg bg-primary text-on-primary rounded-full px-lg py-sm text-body-md font-semibold hover:opacity-90"
          >
            Save settings
          </button>
          {settings && (
            <p className="mt-sm text-body-sm text-on-surface-variant">
              Currently: AI {settings.aiEnabled ? "on" : "off"}, threshold {settings.minRatingForGoogle}★.
            </p>
          )}
        </section>
      </div>
    </div>
  );
};