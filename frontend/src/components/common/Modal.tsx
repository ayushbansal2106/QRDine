"use client";

import React, { useEffect } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
}) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-margin-mobile">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm transition-opacity duration-300"
      />

      {/* Modal Dialog */}
      <div className="bg-surface-container-lowest w-full max-w-[500px] rounded-xl shadow-[0px_12px_32px_rgba(0,0,0,0.12)] overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
        <header className="px-md py-sm border-b border-surface-container flex items-center justify-between">
          <h3 className="font-inter font-semibold text-headline-md text-on-surface">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="text-on-surface-variant hover:opacity-80 transition-opacity p-xs"
          >
            <span className="material-symbols-outlined text-[20px] select-none">close</span>
          </button>
        </header>
        <div className="p-md overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
};
export default Modal;
