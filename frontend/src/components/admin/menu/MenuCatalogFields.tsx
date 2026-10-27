"use client";

import React, { useState } from "react";
import type { MenuModifierGroup, MenuVariant, PrepStation } from "@/types";

export interface MenuCatalogFieldsProps {
  variants: MenuVariant[];
  onVariantsChange: (variants: MenuVariant[]) => void;
  modifierGroups: MenuModifierGroup[];
  onModifierGroupsChange: (groups: MenuModifierGroup[]) => void;
  dietaryTags: string;
  onDietaryTagsChange: (value: string) => void;
  ingredients: string;
  onIngredientsChange: (value: string) => void;
  allergens: string;
  onAllergensChange: (value: string) => void;
  calories: string;
  onCaloriesChange: (value: string) => void;
  prepStation: PrepStation;
  onPrepStationChange: (value: PrepStation) => void;
}

const DIETARY_PRESETS = ["Vegan", "Vegetarian", "Gluten-Free", "Keto", "Sugar-Free", "Chef Special"];
const ALLERGEN_PRESETS = ["Nuts", "Dairy", "Gluten", "Egg", "Soy", "Shellfish"];

const Section: React.FC<{
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, subtitle, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-surface-container rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-sm py-sm bg-surface-container-low/30 text-left"
      >
        <span className="flex flex-col">
          <span className="font-semibold text-label-md text-on-surface">{title}</span>
          {subtitle && <span className="text-label-sm text-on-surface-variant">{subtitle}</span>}
        </span>
        <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>
      {open && <div className="p-sm flex flex-col gap-sm">{children}</div>}
    </div>
  );
};

const TagInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  presets: string[];
  placeholder: string;
}> = ({ label, value, onChange, presets, placeholder }) => {
  const selected = value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const toggle = (tag: string) => {
    const next = selected.includes(tag)
      ? selected.filter((t) => t !== tag)
      : [...selected, tag];
    onChange(next.join(", "));
  };

  return (
    <div className="flex flex-col gap-xs">
      <label className="font-semibold text-label-md text-on-surface">{label}</label>
      <div className="flex flex-wrap gap-xs">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => toggle(preset)}
            className={`px-sm py-0.5 rounded-full text-label-sm font-semibold border transition-colors ${
              selected.includes(preset)
                ? "bg-primary text-on-primary border-primary"
                : "bg-surface-container-low text-on-surface-variant border-surface-container"
            }`}
          >
            {preset}
          </button>
        ))}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-surface-container-low rounded-lg p-sm border-none text-body-sm text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
      />
    </div>
  );
};

export const MenuCatalogFields: React.FC<MenuCatalogFieldsProps> = (props) => {
  const {
    variants,
    onVariantsChange,
    modifierGroups,
    onModifierGroupsChange,
    dietaryTags,
    onDietaryTagsChange,
    ingredients,
    onIngredientsChange,
    allergens,
    onAllergensChange,
    calories,
    onCaloriesChange,
    prepStation,
    onPrepStationChange,
  } = props;

  // ── Variants ────────────────────────────────────────
  const addVariant = () =>
    onVariantsChange([...variants, { name: "", price: 0, isDefault: variants.length === 0 }]);

  const updateVariant = (idx: number, patch: Partial<MenuVariant>) =>
    onVariantsChange(variants.map((v, i) => (i === idx ? { ...v, ...patch } : v)));

  const removeVariant = (idx: number) => {
    const next = variants.filter((_, i) => i !== idx);
    // Guarantee exactly one default remains when variants exist
    if (next.length > 0 && !next.some((v) => v.isDefault)) next[0].isDefault = true;
    onVariantsChange(next);
  };

  const setDefaultVariant = (idx: number) =>
    onVariantsChange(variants.map((v, i) => ({ ...v, isDefault: i === idx })));

  // ── Modifier groups ─────────────────────────────────
  const addGroup = () =>
    onModifierGroupsChange([
      ...modifierGroups,
      { name: "", selectionType: "single", isRequired: false, options: [{ name: "", price: 0 }] },
    ]);

  const updateGroup = (idx: number, patch: Partial<MenuModifierGroup>) =>
    onModifierGroupsChange(modifierGroups.map((g, i) => (i === idx ? { ...g, ...patch } : g)));

  const removeGroup = (idx: number) =>
    onModifierGroupsChange(modifierGroups.filter((_, i) => i !== idx));

  const addOption = (groupIdx: number) =>
    updateGroup(groupIdx, {
      options: [...modifierGroups[groupIdx].options, { name: "", price: 0 }],
    });

  const updateOption = (groupIdx: number, optIdx: number, patch: Partial<MenuModifierGroup["options"][number]>) =>
    updateGroup(groupIdx, {
      options: modifierGroups[groupIdx].options.map((o, i) =>
        i === optIdx ? { ...o, ...patch } : o
      ),
    });

  const removeOption = (groupIdx: number, optIdx: number) =>
    updateGroup(groupIdx, {
      options: modifierGroups[groupIdx].options.filter((_, i) => i !== optIdx),
    });

  return (
    <div className="flex flex-col gap-sm">
      {/* Variants */}
      <Section
        title="Sizes / Variants"
        subtitle={variants.length > 0 ? `${variants.length} configured` : "Optional"}
      >
        {variants.map((variant, idx) => (
          <div key={idx} className="flex items-center gap-xs">
            <input
              value={variant.name}
              onChange={(e) => updateVariant(idx, { name: e.target.value })}
              placeholder="Regular"
              className="flex-1 bg-surface-container-low rounded-lg p-sm border-none text-body-sm text-on-surface focus:ring-1 focus:ring-primary outline-none"
            />
            <input
              type="number"
              step="0.01"
              value={variant.price}
              onChange={(e) => updateVariant(idx, { price: parseFloat(e.target.value) || 0 })}
              placeholder="Price"
              className="w-24 bg-surface-container-low rounded-lg p-sm border-none text-body-sm text-on-surface focus:ring-1 focus:ring-primary outline-none"
            />
            <button
              type="button"
              onClick={() => setDefaultVariant(idx)}
              title="Set as default"
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                variant.isDefault ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">star</span>
            </button>
            <button
              type="button"
              onClick={() => removeVariant(idx)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-error hover:bg-error/10"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        ))}
        <button type="button" onClick={addVariant} className="self-start text-primary text-label-md font-semibold flex items-center gap-xs">
          <span className="material-symbols-outlined text-[18px]">add</span> Add variant
        </button>
      </Section>

      {/* Modifier groups */}
      <Section
        title="Modifier Groups"
        subtitle={modifierGroups.length > 0 ? `${modifierGroups.length} configured` : "Optional"}
      >
        {modifierGroups.map((group, groupIdx) => (
          <div key={groupIdx} className="border border-surface-container rounded-lg p-sm flex flex-col gap-sm bg-surface-container-lowest">
            <div className="flex items-center gap-xs">
              <input
                value={group.name}
                onChange={(e) => updateGroup(groupIdx, { name: e.target.value })}
                placeholder="e.g. Milk Type"
                className="flex-1 bg-surface-container-low rounded-lg p-sm border-none text-body-sm text-on-surface focus:ring-1 focus:ring-primary outline-none"
              />
              <select
                value={group.selectionType}
                onChange={(e) =>
                  updateGroup(groupIdx, { selectionType: e.target.value as "single" | "multi" })
                }
                className="bg-surface-container-low rounded-lg p-sm border-none text-body-sm text-on-surface"
              >
                <option value="single">Pick one</option>
                <option value="multi">Pick many</option>
              </select>
              <button
                type="button"
                onClick={() => removeGroup(groupIdx)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-error hover:bg-error/10"
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            </div>

            {group.options.map((option, optIdx) => (
              <div key={optIdx} className="flex items-center gap-xs pl-sm">
                <input
                  value={option.name}
                  onChange={(e) => updateOption(groupIdx, optIdx, { name: e.target.value })}
                  placeholder="Option (e.g. Oat Milk)"
                  className="flex-1 bg-surface-container-low rounded-lg p-sm border-none text-body-sm text-on-surface focus:ring-1 focus:ring-primary outline-none"
                />
                <input
                  type="number"
                  step="0.01"
                  value={option.price}
                  onChange={(e) => updateOption(groupIdx, optIdx, { price: parseFloat(e.target.value) || 0 })}
                  placeholder="+₹"
                  className="w-20 bg-surface-container-low rounded-lg p-sm border-none text-body-sm text-on-surface focus:ring-1 focus:ring-primary outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeOption(groupIdx, optIdx)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-error hover:bg-error/10"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => addOption(groupIdx)}
              className="self-start text-primary text-label-sm font-semibold flex items-center gap-xs"
            >
              <span className="material-symbols-outlined text-[16px]">add</span> Add option
            </button>
          </div>
        ))}
        <button type="button" onClick={addGroup} className="self-start text-primary text-label-md font-semibold flex items-center gap-xs">
          <span className="material-symbols-outlined text-[18px]">add</span> Add modifier group
        </button>
      </Section>

      {/* Visual catalog / dietary */}
      <Section title="Dietary & Allergens" subtitle="Module #06 — visual catalog">
        <TagInput
          label="Dietary tags"
          value={dietaryTags}
          onChange={onDietaryTagsChange}
          presets={DIETARY_PRESETS}
          placeholder="Custom tags, comma separated"
        />
        <TagInput
          label="Allergens"
          value={allergens}
          onChange={onAllergensChange}
          presets={ALLERGEN_PRESETS}
          placeholder="Custom allergens, comma separated"
        />
        <div className="flex flex-col gap-xs">
          <label className="font-semibold text-label-md text-on-surface">Ingredients</label>
          <input
            value={ingredients}
            onChange={(e) => onIngredientsChange(e.target.value)}
            placeholder="espresso, oat milk, vanilla"
            className="bg-surface-container-low rounded-lg p-sm border-none text-body-sm text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
          />
        </div>
        <div className="flex flex-col gap-xs">
          <label className="font-semibold text-label-md text-on-surface">Calories</label>
          <input
            type="number"
            value={calories}
            onChange={(e) => onCaloriesChange(e.target.value)}
            placeholder="0"
            className="bg-surface-container-low rounded-lg p-sm border-none text-body-sm text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
          />
        </div>
      </Section>

      {/* KDS prep station */}
      <div className="flex items-center justify-between border border-surface-container rounded-xl px-sm py-sm">
        <span className="flex flex-col">
          <span className="font-semibold text-label-md text-on-surface">Prep Station</span>
          <span className="text-label-sm text-on-surface-variant">Routes this item on KDS screens</span>
        </span>
        <select
          value={prepStation}
          onChange={(e) => onPrepStationChange(e.target.value as PrepStation)}
          className="bg-surface-container-low rounded-lg p-sm border-none text-body-sm text-on-surface"
        >
          <option value="kitchen">Kitchen</option>
          <option value="bar">Bar</option>
          <option value="both">Both</option>
        </select>
      </div>
    </div>
  );
};

export default MenuCatalogFields;
