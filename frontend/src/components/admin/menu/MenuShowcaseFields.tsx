"use client";

import React, { useState } from "react";
import type { MenuItemMedia } from "@/types";

export interface MenuShowcaseFieldsProps {
  story: string;
  onStoryChange: (value: string) => void;
  media: MenuItemMedia[];
  onMediaChange: (media: MenuItemMedia[]) => void;
  allergenNote: string;
  onAllergenNoteChange: (value: string) => void;
  spiceLevel: string;
  onSpiceLevelChange: (value: string) => void;
  prepMinutes: string;
  onPrepMinutesChange: (value: string) => void;
}

/**
 * Module #06 — customer-facing showcase fields.
 *
 * These are the fields the guest actually sees on the dish sheet: the story, the
 * gallery behind the hero photo, and a plain-language allergen note (the tag
 * list is machine-ish; the note is what a nervous customer reads).
 */
export const MenuShowcaseFields: React.FC<MenuShowcaseFieldsProps> = ({
  story,
  onStoryChange,
  media,
  onMediaChange,
  allergenNote,
  onAllergenNoteChange,
  spiceLevel,
  onSpiceLevelChange,
  prepMinutes,
  onPrepMinutesChange,
}) => {
  const [urlDraft, setUrlDraft] = useState("");
  const [captionDraft, setCaptionDraft] = useState("");

  const addMedia = () => {
    const url = urlDraft.trim();
    if (!url) return;
    onMediaChange([...media, { url, caption: captionDraft.trim() }]);
    setUrlDraft("");
    setCaptionDraft("");
  };

  const updateMedia = (index: number, patch: Partial<MenuItemMedia>) => {
    onMediaChange(media.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const removeMedia = (index: number) => onMediaChange(media.filter((_, i) => i !== index));

  return (
    <div className="border border-surface-container rounded-xl p-sm flex flex-col gap-sm">
      <span className="flex flex-col">
        <span className="font-semibold text-label-md text-on-surface">Dish story &amp; gallery</span>
        <span className="text-label-sm text-on-surface-variant">
          Shown on the guest menu&apos;s detail sheet
        </span>
      </span>

      <div className="flex flex-col gap-xs">
        <label className="font-semibold text-label-md text-on-surface" htmlFor="dish-story">
          The story
        </label>
        <textarea
          id="dish-story"
          rows={3}
          value={story}
          onChange={(e) => onStoryChange(e.target.value)}
          placeholder="Why this dish exists, where the beans come from, how the dough is rested…"
          className="bg-surface-container-low rounded-lg p-sm border-none text-body-sm text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
        />
      </div>

      <div className="flex flex-col gap-xs">
        <span className="font-semibold text-label-md text-on-surface">Extra photos</span>
        {media.map((entry, index) => (
          <div key={`${entry.url}-${index}`} className="flex items-center gap-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={entry.url}
              alt=""
              className="w-10 h-10 rounded object-cover border border-surface-container"
            />
            <input
              value={entry.url}
              onChange={(e) => updateMedia(index, { url: e.target.value })}
              className="flex-1 bg-surface-container-low rounded-lg p-sm border-none text-body-sm"
            />
            <input
              value={entry.caption || ""}
              onChange={(e) => updateMedia(index, { caption: e.target.value })}
              placeholder="Caption"
              className="w-28 bg-surface-container-low rounded-lg p-sm border-none text-body-sm"
            />
            <button
              type="button"
              onClick={() => removeMedia(index)}
              className="text-error px-xs"
              aria-label="Remove photo"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
            </button>
          </div>
        ))}
        <div className="flex items-center gap-xs">
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://… (image URL)"
            className="flex-1 bg-surface-container-low rounded-lg p-sm border-none text-body-sm"
          />
          <input
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            placeholder="Caption"
            className="w-28 bg-surface-container-low rounded-lg p-sm border-none text-body-sm"
          />
          <button
            type="button"
            onClick={addMedia}
            disabled={!urlDraft.trim()}
            className="text-primary font-semibold text-label-md disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-xs">
        <label className="font-semibold text-label-md text-on-surface" htmlFor="allergen-note">
          Allergen note (in plain language)
        </label>
        <input
          id="allergen-note"
          value={allergenNote}
          onChange={(e) => onAllergenNoteChange(e.target.value)}
          placeholder="Made in a kitchen that handles nuts and dairy."
          className="bg-surface-container-low rounded-lg p-sm border-none text-body-sm"
        />
      </div>

      <div className="flex gap-md">
        <div className="flex flex-1 flex-col gap-xs">
          <label className="font-semibold text-label-md text-on-surface" htmlFor="spice-level">
            Spice level (0–5)
          </label>
          <input
            id="spice-level"
            type="number"
            min={0}
            max={5}
            value={spiceLevel}
            onChange={(e) => onSpiceLevelChange(e.target.value)}
            className="bg-surface-container-low rounded-lg p-sm border-none text-body-sm"
          />
        </div>
        <div className="flex flex-1 flex-col gap-xs">
          <label className="font-semibold text-label-md text-on-surface" htmlFor="prep-minutes">
            Prep time (minutes)
          </label>
          <input
            id="prep-minutes"
            type="number"
            min={0}
            max={240}
            value={prepMinutes}
            onChange={(e) => onPrepMinutesChange(e.target.value)}
            className="bg-surface-container-low rounded-lg p-sm border-none text-body-sm"
          />
        </div>
      </div>
    </div>
  );
};