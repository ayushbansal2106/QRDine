"use client";

import React, { useState } from "react";
import { Modal } from "./common/Modal";
import { Button } from "./common/Button";
import { createWaiterRequest } from "@/actions/requests";
import { useSessionStore } from "@/store/sessionStore";

interface WaiterAssistanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
}

export const WaiterAssistanceModal: React.FC<WaiterAssistanceModalProps> = ({
  isOpen,
  onClose,
  tableId,
}) => {
  const { activeSessionId, setSessionStatus } = useSessionStore();
  const [requestType, setRequestType] = useState("Need Waiter");
  const [customMsg, setCustomMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const presets = ["Need Waiter", "Need Water", "Clean Table"];

  const handleSubmit = async () => {
    setIsLoading(true);
    try {
      const finalMsg = customMsg.trim() ? customMsg.trim() : requestType;
      await createWaiterRequest(tableId, finalMsg);
      alert("Assistance requested. A staff member will be with you shortly!");
      setCustomMsg("");
      onClose();
    } catch (err) {
      console.error(err);
      alert("Failed to submit request. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Request Assistance">
      <div className="flex flex-col gap-md">
        <div>
          <span className="font-inter font-semibold text-label-md text-on-surface mb-xs block">
            Select Request Type
          </span>
          <div className="flex flex-wrap gap-xs">
            {presets.map((preset) => {
              const isSelected = requestType === preset && !customMsg;
              return (
                <button
                  key={preset}
                  onClick={() => {
                    setRequestType(preset);
                    setCustomMsg("");
                  }}
                  className={`px-sm py-xs rounded-full border text-body-sm font-inter transition-all cursor-pointer ${
                    isSelected
                      ? "bg-primary text-on-primary border-primary"
                      : "bg-surface-container-lowest text-on-surface-variant border-surface-container hover:bg-surface-container-low"
                  }`}
                >
                  {preset}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="custom-request" className="font-inter font-semibold text-label-md text-on-surface mb-xs block">
            Or Type Custom Request
          </label>
          <textarea
            id="custom-request"
            rows={3}
            value={customMsg}
            onChange={(e) => setCustomMsg(e.target.value)}
            placeholder="e.g. Bring extra napkins, high chair..."
            className="w-full bg-surface-container-low rounded-lg p-sm border-none font-inter text-body-md text-on-surface placeholder-on-surface-variant/60 focus:ring-1 focus:ring-primary outline-none"
          />
        </div>

        <div className="flex justify-end gap-sm mt-sm">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? "Submitting..." : "Send Request"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
export default WaiterAssistanceModal;
