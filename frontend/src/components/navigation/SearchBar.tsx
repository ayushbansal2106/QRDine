"use client";

import React from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = "Search for coffee, snacks...",
}) => {
  return (
    <div className="px-margin-mobile md:px-0 py-sm">
      <div className="relative bg-surface-container-lowest rounded-xl flex items-center px-md py-sm shadow-[0px_4px_20px_rgba(0,0,0,0.04)] focus-within:ring-1 focus-within:ring-outline outline-none">
        <span className="material-symbols-outlined text-outline mr-sm select-none">
          search
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-transparent border-none w-full font-inter font-normal text-body-md text-on-surface focus:ring-0 p-0 placeholder-outline outline-none"
          placeholder={placeholder}
          type="text"
        />
        {value && (
          <button
            onClick={() => onChange("")}
            className="text-on-surface-variant hover:opacity-80 ml-2"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        )}
      </div>
    </div>
  );
};
