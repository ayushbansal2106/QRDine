"use client";

import React, { useState } from "react";
import { requestLoginOtp, verifyLoginOtp } from "@/actions/customerApp";

interface PhoneOtpFieldProps {
  cafeId: string;
  phone: string;
  onPhoneChange: (phone: string) => void;
  onVerified: (result: { name: string; phone: string; email: string }) => void;
  disabled?: boolean;
}

/**
 * Phone + OTP sign-in for the guest app (Module #09).
 *
 * Verifying the code establishes the customer profile identity, which is what
 * later links orders, loyalty and wallet — that is the whole point of moving
 * off "everyone is a guest".
 */
export const PhoneOtpField: React.FC<PhoneOtpFieldProps> = ({
  cafeId,
  phone,
  onPhoneChange,
  onVerified,
  disabled = false,
}) => {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 10);

  const sendCode = async () => {
    setBusy(true);
    setError("");
    setNotice("");

    const result = await requestLoginOtp(phone, cafeId);
    setBusy(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setStep("code");
    // Outside production the backend echoes the code so the flow is testable
    // before an SMS sender ID is approved.
    setNotice(
      result.devCode
        ? `Demo mode — your code is ${result.devCode}`
        : "We sent a 6-digit code to your phone"
    );
  };

  const verify = async () => {
    setBusy(true);
    setError("");

    const result = await verifyLoginOtp(phone, code, cafeId);
    setBusy(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    onVerified({
      name: result.customer?.name || "",
      phone: result.customer?.phone || phone,
      email: result.customer?.email || "",
    });
  };

  if (step === "phone") {
    return (
      <div className="flex flex-col gap-sm">
        <label
          htmlFor="guest-phone"
          className="font-inter font-semibold text-label-md text-on-surface"
        >
          Mobile number
        </label>
        <div className="flex items-stretch">
          <span className="grid place-items-center rounded-l-xl bg-surface-container px-md font-inter text-body-md text-on-surface-variant border border-r-0 border-surface-container-high">
            +91
          </span>
          <input
            id="guest-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={phone}
            onChange={(e) => onPhoneChange(digitsOnly(e.target.value))}
            placeholder="99966 96235"
            disabled={disabled || busy}
            className="flex-1 h-12 rounded-r-xl bg-surface-container-low px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border border-surface-container-high focus:ring-2 focus:ring-primary outline-none"
          />
        </div>

        {error && (
          <p role="alert" className="bg-error/10 text-error text-body-sm font-inter rounded-lg p-sm">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={sendCode}
          disabled={disabled || busy || phone.length !== 10}
          className="w-full h-12 bg-primary text-on-primary rounded-xl font-inter font-semibold text-body-lg cursor-pointer transition-all hover:bg-primary-container active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? "Sending…" : "Send code"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-center justify-between">
        <label htmlFor="guest-otp" className="font-inter font-semibold text-label-md text-on-surface">
          Enter the code
        </label>
        <button
          type="button"
          onClick={() => {
            setStep("phone");
            setCode("");
            setError("");
            setNotice("");
          }}
          className="font-inter text-body-sm text-primary cursor-pointer"
        >
          Change number
        </button>
      </div>

      <input
        id="guest-otp"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="······"
        disabled={busy}
        className="w-full h-14 rounded-xl bg-surface-container-low px-md text-center font-mono text-headline-md tracking-[0.5em] text-on-surface placeholder-on-surface-variant/40 border border-surface-container-high focus:ring-2 focus:ring-primary outline-none"
      />

      {notice && (
        <p className="bg-success-container text-on-success-container text-body-sm font-inter rounded-lg p-sm">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="bg-error/10 text-error text-body-sm font-inter rounded-lg p-sm">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={verify}
        disabled={busy || code.length !== 6}
        className="w-full h-12 bg-primary text-on-primary rounded-xl font-inter font-semibold text-body-lg cursor-pointer transition-all hover:bg-primary-container active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? "Checking…" : "Verify & continue"}
      </button>

      <button
        type="button"
        onClick={sendCode}
        disabled={busy}
        className="w-full h-10 text-primary font-inter font-semibold text-body-md cursor-pointer"
      >
        Resend code
      </button>
    </div>
  );
};