import React from "react";

interface DishPlaceholderProps {
  /** Dish name — used only for the accessible label. */
  name: string;
  className?: string;
}

/**
 * Illustrated stand-in for dishes that have no photograph yet.
 *
 * The QR menu cannot rely on photography: a newly scanned menu has no images,
 * and the bundled dish library ships `imageUrl: null` until licensed photos
 * are supplied. Rather than an empty grey box (which reads as a broken image),
 * this draws a small plated-dish illustration using the theme's surface tokens,
 * so a photo-less menu still looks designed.
 */
export const DishPlaceholder: React.FC<DishPlaceholderProps> = ({ name, className = "" }) => (
  <div
    role="img"
    aria-label={`${name} — no photo available`}
    className={`flex items-center justify-center bg-surface-container-low ${className}`}
  >
    <svg
      viewBox="0 0 96 96"
      // Decorative: the accessible name lives on the wrapper.
      aria-hidden="true"
      className="w-2/3 h-2/3"
      fill="none"
    >
      {/* Plate rim */}
      <circle cx="48" cy="48" r="34" className="fill-surface-container-lowest" />
      <circle cx="48" cy="48" r="34" strokeWidth="2.5" className="stroke-surface-container-highest" />
      <circle cx="48" cy="48" r="25" strokeWidth="1.5" className="stroke-surface-container-high" />
      {/* Food suggestion: three overlapping shapes read as a plated dish */}
      <ellipse cx="41" cy="46" rx="11" ry="8" className="fill-primary/25" />
      <ellipse cx="56" cy="50" rx="10" ry="7" className="fill-primary/40" />
      <ellipse cx="47" cy="57" rx="9" ry="6" className="fill-primary/20" />
      {/* Cutlery */}
      <path
        d="M20 62v10a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V62"
        strokeWidth="2.5"
        className="stroke-surface-container-highest"
      />
      <path d="M76 62v12" strokeWidth="2.5" className="stroke-surface-container-highest" />
    </svg>
  </div>
);