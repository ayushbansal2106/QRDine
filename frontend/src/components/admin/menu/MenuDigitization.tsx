"use client";

import React, { useEffect, useRef, useState } from "react";
import { uploadImage } from "@/actions/upload";
import {
  runMenuDigitization,
  publishDigitizedMenu,
  type DigitizeJob,
  type DigitizedCategory,
  type DigitizedItem,
  type DigitizedVariant,
} from "@/actions/menuDigitization";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";

const MAX_PHOTOS = 12;

type Stage = "upload" | "processing" | "review" | "published";

/** Server Actions reject with plain Error objects, so narrow defensively. */
const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

interface MenuDigitizationProps {
  open: boolean;
  onClose: () => void;
  onPublished: () => void;
}

/**
 * AI menu digitisation (Module #19).
 *
 * Flow: upload menu photos → AI extracts a draft → owner edits inline →
 * publish. The live menu is never touched until publish is pressed, because
 * AI misreads prices on dense paper menus.
 */
export const MenuDigitization: React.FC<MenuDigitizationProps> = ({
  open,
  onClose,
  onPublished,
}) => {
  const [stage, setStage] = useState<Stage>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<DigitizeJob | null>(null);
  const [draft, setDraft] = useState<DigitizedCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  // A scan can legitimately take a while (the backend retries a throttled AI
  // service), so the wait is shown with a running clock and escalating copy
  // rather than an unexplained spinner.
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (stage !== "processing" || !busy) return;
    // startedAt is seeded here (not in state) so the first tick already has a
    // baseline; elapsed itself is reset by handleScan, not here, to avoid a
    // cascading render on mount.
    startedAt.current = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000
    );
    return () => window.clearInterval(id);
  }, [stage, busy]);

  const waitHint =
    elapsed < 15
      ? "This usually takes 5–15 seconds."
      : elapsed < 45
        ? "Still working — bigger menus take longer."
        : "Our AI service is busy right now. We're still trying.";

  const reset = () => {
    setStage("upload");
    setFiles([]);
    setJob(null);
    setDraft([]);
    setError(null);
    setBusy(false);
    setProgress("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const onSelectFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list).slice(0, MAX_PHOTOS);
    setError(null);
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
  };

  const handleScan = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setStage("processing");
    setElapsed(0);
    setProgress("Uploading menu photos…");

    try {
      // Upload each photo first, then send the URLs to the digitiser, which
      // fetches them server-side and sends inline image parts to Gemini.
      const uploaded: { url: string }[] = [];
      for (let i = 0; i < files.length; i += 1) {
        setProgress(`Uploading photo ${i + 1} of ${files.length}…`);
        uploaded.push({ url: await uploadImage(files[i]) });
      }

      setProgress("Reading categories, dishes and prices…");
      const result = await runMenuDigitization(uploaded);
      setJob(result.job);

      if (!result.success) {
        setError(result.message);
        setStage("upload");
        return;
      }

      setDraft(result.job.draft?.categories || []);
      setStage("review");
    } catch (err) {
      setError(errorMessage(err, "Something went wrong while scanning your menu."));
      setStage("upload");
    } finally {
      setBusy(false);
      setProgress("");
      setElapsed(0);
    }
  };

  const updateItem = (
    categoryIndex: number,
    itemIndex: number,
    patch: Partial<DigitizedItem>
  ) => {
    setDraft((prev) =>
      prev.map((cat, ci) =>
        ci !== categoryIndex
          ? cat
          : {
              ...cat,
              items: cat.items.map((item, ii) =>
                ii !== itemIndex ? item : { ...item, ...patch }
              ),
            }
      )
    );
  };

  const updateCategory = (categoryIndex: number, patch: Partial<DigitizedCategory>) => {
    setDraft((prev) =>
      prev.map((cat, ci) => (ci !== categoryIndex ? cat : { ...cat, ...patch }))
    );
  };

  const updateVariant = (
    categoryIndex: number,
    itemIndex: number,
    variantIndex: number,
    patch: Partial<DigitizedVariant>
  ) => {
    setDraft((prev) =>
      prev.map((cat, ci) =>
        ci !== categoryIndex
          ? cat
          : {
              ...cat,
              items: cat.items.map((item, ii) =>
                ii !== itemIndex
                  ? item
                  : {
                      ...item,
                      variants: item.variants.map((v, vi) =>
                        vi !== variantIndex ? v : { ...v, ...patch }
                      ),
                    }
              ),
            }
      )
    );
  };

  const addVariant = (categoryIndex: number, itemIndex: number) => {
    setDraft((prev) =>
      prev.map((cat, ci) =>
        ci !== categoryIndex
          ? cat
          : {
              ...cat,
              items: cat.items.map((item, ii) =>
                ii !== itemIndex
                  ? item
                  : { ...item, variants: [...item.variants, { name: "", price: 0 }] }
              ),
            }
      )
    );
  };

  const removeVariant = (categoryIndex: number, itemIndex: number, variantIndex: number) => {
    setDraft((prev) =>
      prev.map((cat, ci) =>
        ci !== categoryIndex
          ? cat
          : {
              ...cat,
              items: cat.items.map((item, ii) =>
                ii !== itemIndex
                  ? item
                  : {
                      ...item,
                      variants: item.variants.filter((_, vi) => vi !== variantIndex),
                    }
              ),
            }
      )
    );
  };

  const removeItem = (categoryIndex: number, itemIndex: number) => {
    setDraft((prev) =>
      prev.map((cat, ci) =>
        ci !== categoryIndex
          ? cat
          : { ...cat, items: cat.items.filter((_, ii) => ii !== itemIndex) }
      )
    );
  };

  /**
   * Dietary marks are extracted from the photo, which frequently fails to
   * detect a veg symbol. This is the one correction the owner must always be
   * able to make, so it is a two-state control rather than a read-only badge.
   */
  const setVeg = (categoryIndex: number, itemIndex: number, isVeg: boolean) => {
    updateItem(categoryIndex, itemIndex, { dietaryTags: [isVeg ? "veg" : "non-veg"] });
  };

  const handlePublish = async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const result = await publishDigitizedMenu(job.id, { categories: draft });
      setJob((prev) => (prev ? { ...prev, status: "published", publishedResult: result.result } : prev));
      setStage("published");
      onPublished();
    } catch (err) {
      setError(errorMessage(err, "Failed to publish."));
    } finally {
      setBusy(false);
    }
  };

  const unpriced = draft.reduce(
    (n, c) => n + c.items.filter((i) => i.needsPrice).length,
    0
  );
  const totalItems = draft.reduce((n, c) => n + c.items.length, 0);

  return (
    <Modal isOpen={open} onClose={handleClose} title="AI Menu Digitalisation">
      <div className="flex flex-col gap-md font-inter pb-2">

        {error && (
          <div className="flex items-start gap-sm rounded-lg bg-error-container px-md py-sm text-body-sm text-on-error-container">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>{error}</span>
          </div>
        )}

        {/* ── Upload ─────────────────────────────────────────── */}
        {stage === "upload" && (
          <>
            <p className="text-body-md text-on-surface-variant">
              Upload clear photos of your printed menu — one page per photo, taken
              straight on, well lit and in focus. AI will read the categories,
              dishes, prices and variants.
            </p>

            <label className="flex flex-col items-center justify-center gap-sm rounded-xl border-2 border-dashed border-surface-container bg-surface-container-lowest px-md py-xl cursor-pointer hover:bg-surface-container-low transition-colors">
              <span className="material-symbols-outlined text-[36px] text-on-surface-variant/50">
                add_photo_alternate
              </span>
              <span className="text-body-md font-semibold text-on-surface">
                Choose menu photos
              </span>
              <span className="text-body-sm text-on-surface-variant">
                JPEG, PNG or WebP · up to {MAX_PHOTOS} photos
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onSelectFiles(e.target.files)}
              />
            </label>

            {files.length > 0 && (
              <>
                <ul className="flex flex-col gap-xs">
                  {files.map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="flex items-center justify-between gap-sm text-body-sm text-on-surface-variant"
                    >
                      <span className="truncate">{f.name}</span>
                      <button
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-on-surface-variant hover:text-error"
                        aria-label={`Remove ${f.name}`}
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-body-sm text-on-surface-variant">
                  {files.length} of {MAX_PHOTOS} selected
                </p>
              </>
            )}

            <Button
              onClick={handleScan}
              disabled={files.length === 0 || busy}
              className="w-full"
            >
              <span className="material-symbols-outlined text-[18px]">document_scanner</span>
              Scan my menu
            </Button>
          </>
        )}

        {/* ── Processing ─────────────────────────────────────── */}
        {stage === "processing" && (
          <div className="flex flex-col items-center gap-md py-xl">
            <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="text-body-md font-semibold text-on-surface">{progress}</p>
            <p className="text-body-sm text-on-surface-variant text-center">
              {waitHint}
              {elapsed > 3 && (
                <span className="tabular-nums"> {elapsed}s</span>
              )}
            </p>
          </div>
        )}

        {/* ── Review ────────────────────────────────────────── */}
        {stage === "review" && (
          <>
            <div className="flex items-center gap-sm rounded-lg bg-success-container px-md py-sm text-body-sm text-on-success-container">
              <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
              <span>
                Extracted <strong>{totalItems}</strong> items across{" "}
                <strong>{draft.length}</strong> categories
                {job?.stats.imageMatchedCount
                  ? ` · ${job.stats.imageMatchedCount} matched to the dish library`
                  : ""}
                . Check the prices before publishing.
              </span>
            </div>

            {unpriced > 0 && (
              <div className="flex items-start gap-sm rounded-lg bg-warning-container px-md py-sm text-body-sm text-on-warning-container">
                <span className="material-symbols-outlined text-[18px]">warning</span>
                <span>
                  {unpriced} item{unpriced === 1 ? "" : "s"} could not be read clearly and
                  will be skipped unless you add a price.
                </span>
              </div>
            )}

            <div className="flex flex-col gap-lg max-h-[45vh] overflow-y-auto pr-1">
              {draft.map((category, ci) => (
                <div key={`${category.name}-${ci}`} className="flex flex-col gap-xs">
                  <input
                    value={category.name}
                    onChange={(e) => updateCategory(ci, { name: e.target.value })}
                    placeholder="Category name"
                    aria-label="Category name"
                    className="font-semibold text-body-lg text-on-surface bg-transparent border-b border-transparent hover:border-surface-container focus:border-primary outline-none"
                  />

                  {category.items.map((item, ii) => {
                    const isVeg = item.dietaryTags[0] === "veg";
                    return (
                      <div
                        key={`${item.name}-${ii}`}
                        className="flex flex-col gap-xs rounded-lg border border-surface-container bg-surface-container-lowest p-sm"
                      >
                        {/* Name · price · GST */}
                        <div className="flex items-center gap-sm">
                          <input
                            value={item.name}
                            onChange={(e) => updateItem(ci, ii, { name: e.target.value })}
                            aria-label="Dish name"
                            className="flex-1 min-w-0 bg-transparent font-semibold text-body-md text-on-surface outline-none"
                          />
                          <label className="flex items-center gap-1 text-[11px] text-on-surface-variant">
                            <span>GST%</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              value={item.gstPercentage ?? 0}
                              aria-label="GST percentage"
                              onChange={(e) =>
                                updateItem(ci, ii, {
                                  gstPercentage:
                                    e.target.value === "" ? 0 : Number(e.target.value),
                                })
                              }
                              className="w-16 text-right bg-surface-container border border-surface-container rounded-lg px-xs py-xs text-body-sm text-on-surface outline-none focus:border-primary"
                            />
                          </label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.price ?? ""}
                            placeholder="No price"
                            aria-label="Price"
                            onChange={(e) =>
                              updateItem(ci, ii, {
                                price: e.target.value === "" ? null : Number(e.target.value),
                                needsPrice: e.target.value === "",
                              })
                            }
                            className={`w-24 text-right bg-surface-container-lowest border rounded-lg px-sm py-xs text-body-md outline-none ${
                              item.needsPrice
                                ? "border-warning text-on-warning-container"
                                : "border-surface-container text-on-surface"
                            }`}
                          />
                        </div>

                        <input
                          value={item.description}
                          placeholder="Add a short description"
                          aria-label="Description"
                          onChange={(e) => updateItem(ci, ii, { description: e.target.value })}
                          className="bg-transparent text-body-sm text-on-surface-variant outline-none"
                        />

                        {/* Veg / non-veg — a control, not a badge */}
                        <div className="flex items-center gap-xs flex-wrap">
                          <div
                            role="group"
                            aria-label="Dietary"
                            className="inline-flex rounded-full border border-surface-container overflow-hidden"
                          >
                            <button
                              type="button"
                              aria-pressed={isVeg}
                              onClick={() => setVeg(ci, ii, true)}
                              className={`px-2 py-0.5 rounded-none text-[10px] font-bold uppercase tracking-wider ${
                                isVeg
                                  ? "bg-success-container text-on-success-container"
                                  : "bg-transparent text-on-surface-variant"
                              }`}
                            >
                              Veg
                            </button>
                            <button
                              type="button"
                              aria-pressed={!isVeg}
                              onClick={() => setVeg(ci, ii, false)}
                              className={`px-2 py-0.5 rounded-none text-[10px] font-bold uppercase tracking-wider ${
                                !isVeg
                                  ? "bg-error-container text-on-error-container"
                                  : "bg-transparent text-on-surface-variant"
                              }`}
                            >
                              Non-veg
                            </button>
                          </div>

                          {item.imageKey && (
                            <span className="text-[11px] text-on-surface-variant inline-flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">image</span>
                              photo matched
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => removeItem(ci, ii)}
                            className="ml-auto text-[11px] text-on-surface-variant hover:text-error inline-flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-[12px]">delete</span>
                            Remove
                          </button>
                        </div>

                        {/* Variants — editable, because a size-based menu
                            (S/M, Half/Full) has no usable base price. */}
                        <div className="flex flex-col gap-xs border-t border-surface-container pt-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] uppercase tracking-wider text-on-surface-variant">
                              Variants
                            </span>
                            <button
                              type="button"
                              onClick={() => addVariant(ci, ii)}
                              className="text-[11px] text-primary inline-flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[12px]">add</span>
                              Add variant
                            </button>
                          </div>

                          {item.variants.length === 0 && (
                            <span className="text-[11px] text-on-surface-variant">
                              No variants — the price above applies.
                            </span>
                          )}

                          {item.variants.map((v, vi) => (
                            <div key={vi} className="flex items-center gap-xs">
                              <input
                                value={v.name}
                                placeholder="e.g. Small"
                                aria-label={`Variant ${vi + 1} name`}
                                onChange={(e) =>
                                  updateVariant(ci, ii, vi, { name: e.target.value })
                                }
                                className="flex-1 min-w-0 bg-surface-container border border-surface-container rounded-lg px-sm py-xs text-body-sm text-on-surface outline-none focus:border-primary"
                              />
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={v.price}
                                placeholder="₹"
                                aria-label={`Variant ${vi + 1} price`}
                                onChange={(e) =>
                                  updateVariant(ci, ii, vi, { price: Number(e.target.value) })
                                }
                                className="w-24 text-right bg-surface-container border border-surface-container rounded-lg px-sm py-xs text-body-sm text-on-surface outline-none focus:border-primary"
                              />
                              <button
                                type="button"
                                aria-label={`Remove variant ${v.name || vi + 1}`}
                                onClick={() => removeVariant(ci, ii, vi)}
                                className="text-on-surface-variant hover:text-error"
                              >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Modifier groups are rarer; shown for review only. */}
                        {item.modifierGroups.length > 0 && (
                          <div className="flex flex-col gap-1 border-t border-surface-container pt-xs">
                            <span className="text-[11px] uppercase tracking-wider text-on-surface-variant">
                              Add-ons
                            </span>
                            {item.modifierGroups.map((g, gi) => (
                              <span key={gi} className="text-[11px] text-on-surface-variant">
                                {g.isRequired ? "* " : ""}
                                {g.name}:{" "}
                                {g.options.map((o) => `${o.name} ₹${o.price}`).join(", ")}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="flex gap-2 border-t border-surface-container pt-md">
              <Button onClick={reset} disabled={busy} className="flex-1">
                Start over
              </Button>
              <Button onClick={handlePublish} disabled={busy} className="flex-1">
                <span className="material-symbols-outlined text-[18px]">publish</span>
                Publish to menu
              </Button>
            </div>
          </>
        )}

        {/* ── Published ─────────────────────────────────────── */}
        {stage === "published" && (
          <div className="flex flex-col items-center gap-md py-xl text-center">
            <span className="material-symbols-outlined text-[48px] text-success">
              task_alt
            </span>
            <p className="font-semibold text-headline-md text-on-surface">Menu published</p>
            <p className="text-body-md text-on-surface-variant">
              {job?.publishedResult?.createdItems ?? 0} dishes added to your live menu
              {job?.publishedResult?.skippedItems
                ? `, ${job.publishedResult.skippedItems} skipped as duplicates or unpriced`
                : ""}
              .
            </p>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};