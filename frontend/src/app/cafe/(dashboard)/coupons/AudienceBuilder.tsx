"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAudienceCatalogue,
  previewAudience,
  type AudienceCatalogue,
  type AudienceRule,
} from "@/actions/coupons";

type Props = {
  audience?: { mode: string; rules: AudienceRule[] };
  customerIds?: string[];
  autoIssue?: { enabled: boolean; repeatEveryDays: number };
  onChange: (audience: { mode: string; rules: AudienceRule[] }, customerIds: string[]) => void;
  onAutoIssueChange?: (autoIssue: { enabled: boolean; repeatEveryDays: number }) => void;
};

/** Operators that need no value beside them. */
const VALUELESS = new Set(["is_set", "is_not_set"]);

/**
 * Who this offer is for.
 *
 * The design question the screen has to answer honestly is "what does this
 * reach?" — a rule that matches nobody is worse than no rule, because the coupon
 * still *looks* targeted. So every change asks the server how many profiles
 * match right now and says so underneath, and the four audiences a café actually
 * asks for are one tap each rather than a sentence to assemble.
 *
 * The fields on offer come from the engine's whitelist, so the picker cannot
 * produce a rule that redemption would refuse.
 */
export const AudienceBuilder: React.FC<Props> = ({
  audience,
  customerIds = [],
  autoIssue,
  onChange,
  onAutoIssueChange,
}) => {
  const [catalogue, setCatalogue] = useState<AudienceCatalogue | null>(null);
  const [mode, setMode] = useState<string>(audience?.mode || "all");
  const [rules, setRules] = useState<AudienceRule[]>(audience?.rules || []);
  const [reach, setReach] = useState<{ count: number; description: string } | null>(null);

  useEffect(() => {
    fetchAudienceCatalogue().then((res) => {
      if (res.success) setCatalogue(res.catalogue);
    });
  }, []);

  /**
   * Ask the server how many profiles this reaches.
   *
   * The count is computed server-side against real profiles, not estimated in the
   * browser: an audience rule is a question about the customer table, and only
   * the database knows the answer.
   */
  const refreshReach = useCallback(
    async (nextMode: string, nextRules: AudienceRule[]) => {
      if (nextMode === "all" || nextRules.length === 0) {
        setReach(null);
        return;
      }
      const res = await previewAudience({ mode: nextMode, rules: nextRules }, customerIds);
      if (res.success) setReach({ count: res.totalCount, description: res.description });
    },
    [customerIds]
  );

  /**
   * One place that changes the audience, so state, the parent form and the reach
   * count can never describe three different things.
   */
  const applyChange = (nextMode: string, nextRules: AudienceRule[]) => {
    setMode(nextMode);
    setRules(nextRules);
    onChange({ mode: nextMode, rules: nextRules }, customerIds);
    refreshReach(nextMode, nextRules);
  };

  const setRuleValue = (index: number, patch: Partial<AudienceRule>) => {
    const next = rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
    applyChange(mode, next);
  };

  const addRule = () => {
    const firstField = catalogue?.fields[0];
    if (!firstField) return;
    const next = [...rules, { field: firstField.field, op: firstField.ops[0].op, value: "" }];
    applyChange(mode, next);
  };

  const removeRule = (index: number) => {
    const next = rules.filter((_, i) => i !== index);
    applyChange(mode, next);
  };

  /**
   * A preset is a starting point, not a separate mechanism — what is stored is
   * always rules, so the café can tweak the threshold afterwards instead of
   * being locked to "inactive" or nothing.
   */
  const applyPreset = (key: string) => {
    const preset = catalogue?.presets.find((p) => p.key === key);
    if (!preset) return;

    const defaults: Record<string, AudienceRule[]> = {
      new_user: [{ field: "visitCount", op: "lte", value: 1 }],
      inactive: [
        { field: "lastVisitAt", op: "is_set", value: true },
        { field: "lastVisitAt", op: "not_within_days", value: 30 },
      ],
      loyal: [{ field: "lifetimeSpend", op: "gte", value: 1000 }],
      birthday_month: [{ field: "birthday", op: "month_is", value: "current" }],
      tagged: [{ field: "tags", op: "contains", value: "" }],
    };

    const next = defaults[key] || [];
    applyChange("segment", next);
  };

  const fieldMeta = (field: string) => catalogue?.fields.find((f) => f.field === field);

  const reachTone = useMemo(() => {
    if (!reach) return null;
    if (reach.count === 0) return "text-error";
    return "text-on-surface-variant";
  }, [reach]);

  return (
    <div className="flex flex-col gap-sm">
      <span className="font-inter font-semibold text-label-md text-on-surface">Who is this for?</span>

      <div className="flex flex-wrap gap-xs">
        {[
          { key: "all", label: "Everyone" },
          { key: "segment", label: "A customer group" },
        ].map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => applyChange(option.key, option.key === "segment" ? rules : [])}
            className={`px-sm py-xs rounded-full text-body-sm font-semibold ${
              mode === option.key
                ? "bg-primary text-on-primary"
                : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === "segment" && (
        <>
          <div className="flex flex-wrap gap-xs">
            {(catalogue?.presets || []).map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyPreset(preset.key)}
                title={preset.hint}
                className="px-sm py-xs rounded-full border border-surface-container bg-surface-container-lowest text-body-sm font-medium text-on-surface hover:bg-surface-container"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {rules.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">
              Pick a group above, or add a condition of your own. Every condition
              must be true for the offer to apply.
            </p>
          ) : (
            <div className="flex flex-col gap-xs">
              {rules.map((rule, index) => {
                const meta = fieldMeta(rule.field);
                return (
                  <div key={index} className="flex flex-wrap items-center gap-xs">
                    <select
                      value={rule.field}
                      onChange={(e) => {
                        const nextField = fieldMeta(e.target.value);
                        setRuleValue(index, {
                          field: e.target.value,
                          op: nextField?.ops[0].op || rule.op,
                          value: "",
                        });
                      }}
                      aria-label="Condition field"
                      className="h-10 rounded-lg bg-surface-container-low px-sm text-body-sm text-on-surface outline-none"
                    >
                      {(catalogue?.fields || []).map((f) => (
                        <option key={f.field} value={f.field}>
                          {f.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={rule.op}
                      onChange={(e) => setRuleValue(index, { op: e.target.value })}
                      aria-label="Condition"
                      className="h-10 rounded-lg bg-surface-container-low px-sm text-body-sm text-on-surface outline-none"
                    >
                      {(meta?.ops || []).map((o) => (
                        <option key={o.op} value={o.op}>
                          {o.label}
                        </option>
                      ))}
                    </select>

                    {!VALUELESS.has(rule.op) && (
                      <input
                        value={String(rule.value ?? "")}
                        onChange={(e) => setRuleValue(index, { value: e.target.value })}
                        placeholder={
                          rule.op === "month_is" ? "e.g. current" : rule.op.includes("days") ? "days" : "value"
                        }
                        aria-label="Value"
                        className="h-10 w-28 rounded-lg bg-surface-container-low px-sm text-body-sm text-on-surface outline-none"
                      />
                    )}

                    <button
                      type="button"
                      onClick={() => removeRule(index)}
                      aria-label="Remove condition"
                      className="h-10 w-10 grid place-items-center rounded-lg text-on-surface-variant hover:text-on-surface"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addRule}
                className="self-start px-sm py-xs rounded-lg border border-surface-container text-body-sm font-semibold text-on-surface hover:bg-surface-container"
              >
                Add condition
              </button>
            </div>
          )}

          {reach && (
            <p className={`text-body-sm ${reachTone || ""}`}>
              {reach.count === 0
                ? "No customer matches this right now — the offer would never be usable."
                : `Reaches ${reach.count} customer${reach.count === 1 ? "" : "s"} now${
                    reach.description ? ` · ${reach.description}` : ""
                  }.`}
            </p>
          )}

          <label className="flex items-start gap-sm p-sm bg-surface-container-low rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(autoIssue?.enabled)}
              onChange={(e) => onAutoIssueChange?.({ enabled: e.target.checked, repeatEveryDays: autoIssue?.repeatEveryDays || 0 })}
              className="mt-[2px] w-4 h-4 accent-[var(--color-primary)] shrink-0"
            />
            <span className="text-body-sm text-on-surface-variant">
              Send each matching customer their own code, so the offer appears on
              their profile instead of waiting to be typed.
            </span>
          </label>
        </>
      )}
    </div>
  );
};

export default AudienceBuilder;