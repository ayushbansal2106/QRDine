"use client";

import React, { useMemo, useState } from "react";
import { MenuItem, SelectedModifier } from "@/types";
import { useCartStore } from "@/store/cartStore";
import { formatCurrency } from "@/utils/currency";
import { DishPlaceholder } from "./DishPlaceholder";
import { BottomSheet } from "./BottomSheet";

interface DishOptionSheetProps {
  item: MenuItem | null;
  onClose: () => void;
}

const groupKey = (g: { _id?: string; name: string }) => g._id || g.name;

/**
 * Variant / add-on picker.
 *
 * The parent keys this component by dish id, so switching dishes remounts it
 * and the previous dish's size and add-ons cannot leak into the next one.
 * Resetting that state through an effect instead would repaint the sheet on
 * every open and risk showing one dish's selections over another's.
 *
 * A required group that has not been answered blocks the confirm action and is
 * called out in plain words. Validation is shown only after the guest tries to
 * confirm, rather than nagging from the first render — an error banner on an
 * untouched sheet reads as a failure the guest cannot cause.
 */
export const DishOptionSheet: React.FC<DishOptionSheetProps> = ({ item, onClose }) => {
  const { addItem } = useCartStore();
  const [variantId, setVariantId] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [showErrors, setShowErrors] = useState(false);

  const groups = useMemo(() => item?.modifierGroups || [], [item]);
  const variants = useMemo(() => item?.variants || [], [item]);

  const modifiers: SelectedModifier[] = useMemo(() => {
    const out: SelectedModifier[] = [];
    for (const group of groups) {
      for (const optionId of selected[groupKey(group)] || []) {
        const option = (group.options || []).find((o) => o._id === optionId);
        if (!option) continue;
        out.push({
          groupId: groupKey(group),
          groupName: group.name,
          optionId: option._id,
          optionName: option.name,
          price: Number(option.price || 0),
        });
      }
    }
    return out;
  }, [groups, selected]);

  const missingGroups = groups.filter(
    (g) => g.isRequired && (selected[groupKey(g)] || []).length < (g.min || 1)
  );
  const missingVariant = variants.length > 0 && !variantId;

  const blockingReason = missingVariant
    ? variants.length === 1
      ? "Please select an option to continue"
      : "Please select a size to continue"
    : missingGroups.length === 1
      ? `Please choose ${missingGroups[0].name.toLowerCase()} to continue`
      : missingGroups.length > 1
        ? "Please finish the required choices to continue"
        : null;

  const isValid = blockingReason === null;

  if (!item) return null;

  const chosenVariant = variants.find((v) => v._id === variantId);
  const base = chosenVariant ? chosenVariant.price : item.price;
  const modifierTotal = modifiers.reduce((sum, m) => sum + (Number(m.price) || 0), 0);
  const total = Number(base || 0) + modifierTotal;

  const handleAdd = () => {
    if (!isValid) {
      setShowErrors(true);
      return;
    }
    addItem(item, {
      variantId: chosenVariant?._id,
      variantName: chosenVariant?.name,
      modifiers,
    });
    onClose();
  };

  const toggleOption = (gId: string, optionId: string, min: number, selectionType?: string) => {
    setSelected((prev) => {
      const current = prev[gId] || [];
      if (current.includes(optionId)) return { ...prev, [gId]: current.filter((id) => id !== optionId) };

      if (selectionType === "single") return { ...prev, [gId]: [optionId] };
      // Enforce the floor immediately so a required group cannot be dropped
      // below its minimum after the guest has touched it.
      const next = [...current, optionId];
      return { ...prev, [gId]: next };
    });
  };

  const isVeg = item.dietaryTags?.[0] === "veg";
  const gallery = [item.imageUrl, ...(item.media || []).map((m) => m.url)].filter(
    Boolean
  ) as string[];
  const photo = gallery[0];
  const hasAllergens = (item.allergens?.length ?? 0) > 0 || Boolean(item.allergenNote);

  return (
    <BottomSheet
      isOpen={Boolean(item)}
      onClose={onClose}
      maxHeight="80vh"
      labelledBy="dish-option-title"
      footer={
        <div className="flex flex-col gap-sm">
          {showErrors && blockingReason && (
            <p
              role="alert"
              className="rounded-lg bg-error-container px-md py-sm text-center text-body-sm font-medium text-on-error-container"
            >
              {blockingReason}
            </p>
          )}
          <div className="flex gap-sm">
            <button
              type="button"
              onClick={onClose}
              className="h-12 px-lg rounded-xl border border-surface-container text-body-md font-medium text-on-surface active:scale-[0.98] transition-transform"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              aria-disabled={!isValid}
              className={`flex-1 h-12 rounded-xl text-body-md font-semibold transition-colors ${
                isValid
                  ? "bg-primary text-on-primary active:scale-[0.98]"
                  : "bg-surface-container text-on-surface-variant cursor-not-allowed"
              }`}
            >
              {missingVariant
                ? variants.length === 1
                  ? "Select option"
                  : "Select size"
                : `Add · ${formatCurrency(total)}`}
            </button>
          </div>
        </div>
      }
    >
      {/* Header */}
      <div className="flex items-start gap-sm px-margin-mobile pt-2 pb-md">
        <span className="shrink-0">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="h-12 w-12 rounded-xl object-cover" />
          ) : (
            <DishPlaceholder name={item.name} className="h-12 w-12 rounded-xl" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <span aria-hidden="true" className="mt-1.5 shrink-0 grid h-3 w-3 place-items-center">
              <span
                className={`block h-2.5 w-2.5 border-[1.5px] ${
                  isVeg ? "border-success rounded-[2px]" : "border-error"
                }`}
              >
                {isVeg ? (
                  <span className="block m-auto h-1 w-1 rounded-full bg-success" />
                ) : (
                  <span className="block m-auto h-0 w-0 border-x-[3px] border-x-transparent border-b-[5px] border-b-error" />
                )}
              </span>
            </span>
            <h2
              id="dish-option-title"
              className="text-headline-sm font-semibold text-on-surface leading-snug"
            >
              {item.name}
            </h2>
          </div>
          {item.description && (
            <p className="mt-1 text-body-sm text-on-surface-variant line-clamp-2">{item.description}</p>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 -mr-1 grid h-8 w-8 place-items-center rounded-full text-on-surface-variant active:bg-surface-container"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      {/* Allergens are safety information, so they stay above the fold. */}
      {hasAllergens && (
        <div className="mx-margin-mobile mb-md flex items-start gap-2 rounded-xl bg-warning-container px-sm py-2 text-body-sm text-on-warning-container">
          <span className="material-symbols-outlined text-[16px] mt-px">info</span>
          <span>
            Contains: {(item.allergens || []).join(", ")}
            {item.allergenNote ? ` · ${item.allergenNote}` : ""}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-md px-margin-mobile pb-md">
        {/* Variants */}
        {variants.length > 0 && (
          <section>
            <div className="flex items-center gap-sm">
              <h3 className="text-body-lg font-semibold text-on-surface">Choose size</h3>
              <span className="rounded-full bg-error-container px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-error-container">
                Required
              </span>
            </div>
            <p className="mt-0.5 text-body-sm text-on-surface-variant">Select 1</p>

            <div className="mt-sm flex flex-col gap-xs">
              {variants.map((variant) => {
                const selectedId = variantId === variant._id;
                const errored = showErrors && !variantId;
                return (
                  <button
                    key={variant._id || variant.name}
                    type="button"
                    onClick={() => setVariantId(variant._id)}
                    aria-pressed={selectedId}
                    className={`flex items-center gap-sm rounded-xl border px-md py-sm text-left transition-colors ${
                      errored && !selectedId
                        ? "border-error"
                        : selectedId
                          ? "border-primary bg-surface-container-low"
                          : "border-surface-container"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                        selectedId ? "border-primary" : "border-surface-container-highest"
                      }`}
                    >
                      {selectedId && <span className="block h-2.5 w-2.5 rounded-full bg-primary" />}
                    </span>
                    <span className="flex-1 text-body-md font-medium text-on-surface">
                      {variant.name}
                    </span>
                    <span className="text-body-md font-semibold text-on-surface">
                      {formatCurrency(variant.price)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Modifier groups */}
        {groups.map((group) => {
          const gId = groupKey(group);
          const current = selected[gId] || [];
          const isMulti = (group.options?.length ?? 0) > 0 && (group.min ?? 0) > 1;
          const selectionType = group.selectionType || (isMulti ? "multi" : "single");
          const short = (selected[gId] || []).length < (group.min || 1);

          return (
            <section key={gId}>
              <div className="flex items-center gap-sm">
                <h3 className="text-body-lg font-semibold text-on-surface">{group.name}</h3>
                {group.isRequired && (
                  <span className="rounded-full bg-error-container px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-error-container">
                    Required
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-body-sm text-on-surface-variant">
                {selectionType === "single" ? "Select 1" : `Select up to ${group.max || group.options.length}`}
              </p>

              <div className="mt-sm flex flex-col gap-xs">
                {(group.options || []).map((option) => {
                  const isSelected = current.includes(option._id || "");
                  return (
                    <button
                      key={option._id || option.name}
                      type="button"
                      onClick={() => toggleOption(gId, option._id || "", group.min || 1, selectionType)}
                      aria-pressed={isSelected}
                      className={`flex items-center gap-sm rounded-xl border px-md py-sm text-left transition-colors ${
                        showErrors && group.isRequired && short && !isSelected
                          ? "border-error"
                          : isSelected
                            ? "border-primary bg-surface-container-low"
                            : "border-surface-container"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`grid h-5 w-5 shrink-0 place-items-center border-2 ${
                          selectionType === "single" ? "rounded-full" : "rounded-[4px]"
                        } ${isSelected ? "border-primary bg-primary" : "border-surface-container-highest"}`}
                      >
                        {isSelected && (
                          <span className="material-symbols-outlined text-[12px] text-on-primary">
                            check
                          </span>
                        )}
                      </span>
                      <span className="flex-1 text-body-md font-medium text-on-surface">
                        {option.name}
                      </span>
                      {Number(option.price) > 0 && (
                        <span className="text-body-sm text-on-surface-variant">
                          +{formatCurrency(option.price)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* Live total so price changes from add-ons are visible before confirming */}
        {(chosenVariant || modifiers.length > 0) && (
          <div className="flex items-center justify-between rounded-xl bg-surface-container-low px-md py-sm">
            <span className="text-body-md text-on-surface-variant">Total</span>
            <span className="text-body-lg font-semibold text-on-surface">
              {formatCurrency(total)}
            </span>
          </div>
        )}
      </div>
    </BottomSheet>
  );
};

export default DishOptionSheet;