"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Operator, StaffRole } from "@/types";
import { getOperators, switchOperator } from "@/actions/auth";

const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  waiter: "Waiter",
  barista: "Barista",
  staff: "Staff",
};

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

export const LockClient: React.FC = () => {
  const router = useRouter();
  const [operators, setOperators] = useState<Operator[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [selected, setSelected] = useState<Operator | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    (async () => {
      const result = await getOperators();
      if (result.success) {
        setOperators(result.operators);
        setCurrentUserId(result.currentUserId);
      }
      setIsLoading(false);
    })();
  }, []);

  const handleKey = (key: string) => {
    setError("");
    if (key === "clear") setPin("");
    else if (key === "back") setPin((p) => p.slice(0, -1));
    else if (pin.length < 6) setPin((p) => p + key);
  };

  const handleSubmit = () => {
    if (!selected) {
      setError("Select an operator first.");
      return;
    }
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits.");
      return;
    }

    startTransition(async () => {
      const result = await switchOperator(selected.id, pin);
      if (result.success) {
        router.push("/cafe/pos");
        router.refresh();
      } else {
        setError(result.message || "Incorrect PIN.");
        setPin("");
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-background font-inter">
      <div className="flex-1 flex items-center justify-center p-md">
        <div className="w-full max-w-[760px] bg-surface-container-lowest rounded-2xl p-lg shadow-[0px_12px_32px_rgba(0,0,0,0.08)]">
          <div className="text-center mb-lg">
            <div className="w-14 h-14 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-xs">
              <span className="material-symbols-outlined text-[30px]">lock</span>
            </div>
            <h2 className="font-semibold text-headline-lg text-on-surface">Operator Login</h2>
            <p className="text-body-sm text-on-surface-variant">
              Select your name and enter your PIN to start taking orders.
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-xl">
              <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-lg">
              {/* Operator grid */}
              <div className="flex flex-col gap-sm">
                <span className="font-inter font-semibold text-label-md text-on-surface-variant">
                  Operators
                </span>
                <div className="grid grid-cols-2 gap-sm max-h-[320px] overflow-y-auto pr-xs">
                  {operators.map((op) => {
                    const isSelected = selected?.id === op.id;
                    return (
                      <button
                        key={op.id}
                        onClick={() => {
                          setSelected(op);
                          setPin("");
                          setError("");
                        }}
                        className={`flex flex-col items-center gap-xs rounded-xl p-sm border transition-all cursor-pointer ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-surface-container bg-surface-container-low hover:bg-surface-container"
                        }`}
                      >
                        <span
                          className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                            isSelected ? "bg-primary text-on-primary" : "bg-primary/10 text-primary"
                          }`}
                        >
                          {op.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="font-inter text-body-sm text-on-surface truncate max-w-full">
                          {op.name}
                        </span>
                        <span className="font-inter text-label-sm text-on-surface-variant">
                          {ROLE_LABELS[op.role] || op.role}
                        </span>
                        {!op.pinEnabled && (
                          <span className="font-inter text-label-sm text-error">No PIN set</span>
                        )}
                        {op.id === currentUserId && (
                          <span className="font-inter text-label-sm text-primary">Current</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* PIN pad */}
              <div className="flex flex-col gap-sm">
                <span className="font-inter font-semibold text-label-md text-on-surface-variant">
                  {selected ? `${selected.name}'s PIN` : "PIN"}
                </span>

                {/* Dots */}
                <div className="flex items-center justify-center gap-sm h-12 bg-surface-container-low rounded-xl">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-3 h-3 rounded-full transition-colors ${
                        i < pin.length ? "bg-primary" : "bg-on-surface-variant/25"
                      }`}
                    />
                  ))}
                </div>

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-sm">
                  {PIN_KEYS.map((key) => (
                    <button
                      key={key}
                      disabled={!selected || isPending}
                      onClick={() => handleKey(key)}
                      className="h-12 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface font-inter font-semibold text-body-md transition-colors cursor-pointer disabled:opacity-40 flex items-center justify-center"
                    >
                      {key === "clear" ? (
                        <span className="material-symbols-outlined text-[20px]">backspace</span>
                      ) : key === "back" ? (
                        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                      ) : (
                        key
                      )}
                    </button>
                  ))}
                </div>

                {error && (
                  <div className="bg-error/10 border border-error/20 text-error text-body-sm rounded-lg px-sm py-xs flex items-center gap-xs">
                    <span className="material-symbols-outlined text-[16px]">error</span>
                    {error}
                  </div>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={!selected || isPending || pin.length < 4}
                  className="h-12 rounded-xl bg-primary text-on-primary font-inter font-semibold text-body-md transition-opacity cursor-pointer disabled:opacity-40 flex items-center justify-center gap-xs"
                >
                  <span className="material-symbols-outlined text-[20px]">login</span>
                  {isPending ? "Verifying..." : "Unlock"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LockClient;
