"use client";

import React from "react";

interface SettingsToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  /** Decorative leading icon. */
  icon?: React.ReactNode;
  /** Shows a pending state while the preference is being saved. */
  disabled?: boolean;
}

/**
 * A settings row that toggles a boolean preference.
 *
 * The **whole row** is the tap target, not just the switch. A 44×24 control is
 * well under the 44×44 minimum touch target, which on a phone table means the
 * setting is simply unreachable for anyone not using a stylus — so the label,
 * icon and switch are all inside one button.
 *
 * The button itself carries the switch semantics (`role="switch"` +
 * `aria-checked`) and the track is `aria-hidden`, so assistive technology
 * announces one control named after the setting rather than a nested widget.
 */
export const SettingsToggle: React.FC<SettingsToggleProps> = ({
  checked,
  onChange,
  label,
  description,
  icon,
  disabled = false,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="flex w-full items-center gap-md p-md text-left cursor-pointer rounded-lg transition-opacity hover:bg-surface-container-low active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {icon && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full">{icon}</span>}

    <span className="min-w-0 flex-1">
      <span className="block text-body-md font-semibold text-on-surface">{label}</span>
      {description && (
        <span className="block text-body-sm text-on-surface-variant">{description}</span>
      )}
    </span>

    {/* Track: 44x24 with a 20px knob, offset 2px — symmetric at both ends. */}
    <span
      aria-hidden="true"
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
        checked ? "bg-success" : "bg-surface-container-high"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </span>
  </button>
);