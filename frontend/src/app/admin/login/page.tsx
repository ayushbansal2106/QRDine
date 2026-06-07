"use client";

import React, { useActionState } from "react";
import { loginAdmin } from "@/actions/auth";
import { Button } from "@/components/common/Button";

const initialState = {
  error: "",
};

export default function AdminLoginPage() {
  const [state, formAction, isPending] = useActionState(loginAdmin, initialState);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-margin-mobile">
      <div className="bg-surface-container-lowest w-full max-w-[400px] rounded-xl p-lg shadow-[0px_12px_32px_rgba(0,0,0,0.08)] flex flex-col font-inter">
        {/* Brand/Logo Header */}
        <div className="flex flex-col items-center gap-xs text-center mb-lg">
          <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center shadow-[0px_4px_12px_rgba(81,96,79,0.1)]">
            <span className="material-symbols-outlined text-[28px] select-none">
              restaurant
            </span>
          </div>
          <h2 className="font-semibold text-headline-lg text-primary mt-sm">
            QRDine Admin
          </h2>
          <p className="text-body-sm text-on-surface-variant">
            Please log in with your credentials to access dashboards.
          </p>
        </div>

        {/* Form */}
        <form action={formAction} className="flex flex-col gap-md">
          {state?.error && (
            <div className="bg-error/10 border border-error/20 text-error text-body-sm rounded-lg p-sm font-semibold flex items-center gap-xs">
              <span className="material-symbols-outlined text-[18px]">error</span>
              {state.error}
            </div>
          )}

          <div className="flex flex-col gap-xs">
            <label htmlFor="email" className="font-semibold text-label-md text-on-surface">
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="e.g. admin@qrdine.com"
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
            />
          </div>

          <div className="flex flex-col gap-xs">
            <label htmlFor="password" className="font-semibold text-label-md text-on-surface">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              placeholder="••••••••"
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
            />
          </div>

          <Button type="submit" variant="primary" fullWidth className="h-11 mt-sm" disabled={isPending}>
            {isPending ? "Logging in..." : "Log In"}
          </Button>
        </form>

        <div className="text-center mt-lg border-t border-surface-container pt-md">
          <span className="text-body-sm text-on-surface-variant/60">
            Need an account? Contact your administrator.
          </span>
        </div>
      </div>
    </div>
  );
}
