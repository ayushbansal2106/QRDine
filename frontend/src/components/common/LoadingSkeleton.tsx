import React from "react";

export const LoadingSkeleton: React.FC = () => {
  return (
    <div className="w-full flex flex-col gap-md p-margin-mobile">
      <div className="h-8 bg-surface-container-high rounded w-1/3 animate-pulse" />
      <div className="h-12 bg-surface-container-high rounded animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter mt-sm">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="bg-surface-container-lowest rounded-xl h-72 animate-pulse shadow-[0px_4px_20px_rgba(0,0,0,0.02)]"
          >
            <div className="h-40 bg-surface-container-high w-full rounded-t-xl" />
            <div className="p-md flex flex-col gap-sm">
              <div className="h-6 bg-surface-container-high rounded w-3/4" />
              <div className="h-4 bg-surface-container-high rounded w-5/6" />
              <div className="flex justify-between items-center mt-2">
                <div className="h-6 bg-surface-container-high rounded w-1/4" />
                <div className="h-8 bg-surface-container-high rounded-full w-8" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
export default LoadingSkeleton;
