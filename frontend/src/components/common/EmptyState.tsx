import React from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon = "restaurant_menu",
  actionLabel,
  onAction,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-xl text-center max-w-[400px] mx-auto my-lg">
      <div className="w-16 h-16 bg-surface-container rounded-full flex items-center justify-center text-primary mb-md shadow-[0px_4px_20px_rgba(0,0,0,0.02)]">
        <span className="material-symbols-outlined text-[36px] select-none">{icon}</span>
      </div>
      <h3 className="font-inter font-semibold text-headline-md text-on-surface mb-xs">
        {title}
      </h3>
      <p className="font-inter font-normal text-body-sm text-on-surface-variant mb-md">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="bg-primary text-on-primary font-inter font-semibold text-label-md px-lg py-sm rounded-full shadow-[0px_4px_20px_rgba(0,0,0,0.04)] hover:bg-primary-container transition-colors cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
export default EmptyState;
