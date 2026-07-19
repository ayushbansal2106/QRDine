"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CafeProfile, StaffUser } from "@/types";
import { getCafeProfile, updateCafeProfile, getStaffUsers, createStaffUser, deleteStaffUser } from "@/actions/settings";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";

type SettingsTab = "profile" | "staff";

export const SettingsClient: React.FC = () => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Tab state
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  // ─── Cafe Profile State ────────────────────────────────
  const [cafe, setCafe] = useState<CafeProfile | null>(null);
  const [isLoadingCafe, setIsLoadingCafe] = useState(true);
  const [profileForm, setProfileForm] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    logo: "",
  });
  const [profileMessage, setProfileMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ─── Staff State ───────────────────────────────────────
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [staffForm, setStaffForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "staff" as "manager" | "staff",
  });
  const [staffError, setStaffError] = useState("");

  // ─── Load Data ─────────────────────────────────────────
  useEffect(() => {
    loadCafeProfile();
    loadStaffUsers();
  }, []);

  const loadCafeProfile = async () => {
    setIsLoadingCafe(true);
    try {
      const result = await getCafeProfile();
      if (result.success && result.cafe) {
        setCafe(result.cafe);
        setProfileForm({
          name: result.cafe.name || "",
          address: result.cafe.address || "",
          phone: result.cafe.phone || "",
          email: result.cafe.email || "",
          logo: result.cafe.logo || "",
        });
      }
    } catch (err: any) {
      setProfileMessage({ type: "error", text: err.message || "Failed to load cafe profile." });
    } finally {
      setIsLoadingCafe(false);
    }
  };

  const loadStaffUsers = async () => {
    setIsLoadingStaff(true);
    try {
      const result = await getStaffUsers();
      if (result.success) {
        setStaffUsers(result.users);
      }
    } catch (err) {
      console.error("Failed to load staff users:", err);
    } finally {
      setIsLoadingStaff(false);
    }
  };

  // ─── Profile Handlers ──────────────────────────────────
  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage(null);

    startTransition(async () => {
      try {
        const result = await updateCafeProfile(profileForm);
        if (result.success) {
          setCafe(result.cafe);
          setProfileMessage({ type: "success", text: "Profile updated successfully." });
          setTimeout(() => setProfileMessage(null), 3000);
          router.refresh();
        }
      } catch (err: any) {
        setProfileMessage({ type: "error", text: err.message || "Failed to update profile." });
      }
    });
  };

  // ─── Staff Handlers ────────────────────────────────────
  const handleCreateStaff = (e: React.FormEvent) => {
    e.preventDefault();
    setStaffError("");

    if (!staffForm.name.trim() || !staffForm.email.trim() || !staffForm.password) {
      setStaffError("All fields are required.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await createStaffUser(staffForm);
        if (result.success) {
          setStaffUsers((prev) => [...prev, result.user]);
          setIsAddModalOpen(false);
          setStaffForm({ name: "", email: "", password: "", role: "staff" });
          router.refresh();
        }
      } catch (err: any) {
        setStaffError(err.message || "Failed to create staff user.");
      }
    });
  };

  const handleDeleteStaff = (user: StaffUser) => {
    if (!confirm(`Are you sure you want to remove ${user.name} (${user.email})? This action cannot be undone.`)) return;

    startTransition(async () => {
      try {
        await deleteStaffUser(user.id);
        setStaffUsers((prev) => prev.filter((u) => u.id !== user.id));
        router.refresh();
      } catch (err: any) {
        alert(err.message || "Failed to delete staff user.");
      }
    });
  };

  // ─── Tabs ──────────────────────────────────────────────
  const tabs = [
    { id: "profile" as SettingsTab, label: "Cafe Profile", icon: "store" },
    { id: "staff" as SettingsTab, label: "Staff Management", icon: "group" },
  ];

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      <TopAppBar title="Settings" iconName="settings" />

      <main className="flex-1 p-md lg:p-lg max-w-[900px] w-full mx-auto">
        {/* Tab Navigation */}
        <div className="flex gap-xs mb-lg border-b border-surface-container pb-xs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-xs px-md py-sm rounded-t-lg text-body-sm font-inter font-semibold whitespace-nowrap cursor-pointer transition-all duration-200 relative ${
                activeTab === tab.id
                  ? "text-primary"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {/* ─── TAB: Cafe Profile ─────────────────────────────── */}
        {activeTab === "profile" && (
          <div>
            {isLoadingCafe ? (
              <div className="flex items-center justify-center py-xl">
                <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <form onSubmit={handleProfileSubmit} className="flex flex-col gap-md">
                {/* Name */}
                <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
                  <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm pb-sm border-b border-surface-container">
                    Café Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                    <div className="flex flex-col gap-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">Café Name</label>
                      <input
                        type="text"
                        value={profileForm.name}
                        onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Brew & Brew"
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">Email</label>
                      <input
                        type="email"
                        value={profileForm.email}
                        onChange={(e) => setProfileForm((p) => ({ ...p, email: e.target.value }))}
                        placeholder="cafe@example.com"
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">Phone</label>
                      <input
                        type="tel"
                        value={profileForm.phone}
                        onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))}
                        placeholder="+91 98765 43210"
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">Logo URL</label>
                      <input
                        type="url"
                        value={profileForm.logo}
                        onChange={(e) => setProfileForm((p) => ({ ...p, logo: e.target.value }))}
                        placeholder="https://example.com/logo.png"
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                  </div>

                  {/* Address */}
                  <div className="flex flex-col gap-xs mt-md">
                    <label className="font-inter font-semibold text-label-md text-on-surface">Address</label>
                    <textarea
                      value={profileForm.address}
                      onChange={(e) => setProfileForm((p) => ({ ...p, address: e.target.value }))}
                      rows={2}
                      placeholder="123 Main Street, City, State"
                      className="w-full bg-surface-container-low rounded-xl px-md py-sm font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none resize-none transition-all"
                    />
                  </div>
                </div>

                {/* Message feedback */}
                {profileMessage && (
                  <div
                    className={`px-md py-sm rounded-lg text-body-sm font-inter font-semibold flex items-center gap-xs ${
                      profileMessage.type === "success"
                        ? "bg-[#e8f5e9] text-[#2e7d32]"
                        : "bg-[#ffebee] text-[#c62828]"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {profileMessage.type === "success" ? "check_circle" : "error"}
                    </span>
                    {profileMessage.text}
                  </div>
                )}

                {/* Action */}
                <div className="flex justify-end">
                  <Button type="submit" variant="primary" disabled={isPending} className="h-10 px-lg">
                    {isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ─── TAB: Staff Management ─────────────────────────── */}
        {activeTab === "staff" && (
          <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-md">
              <div>
                <h3 className="font-inter font-semibold text-body-lg text-on-surface">
                  Staff Members
                </h3>
                <p className="font-inter text-body-sm text-on-surface-variant">
                  Manage who has access to the admin dashboard.
                </p>
              </div>
              <Button
                variant="primary"
                onClick={() => {
                  setStaffForm({ name: "", email: "", password: "", role: "staff" });
                  setStaffError("");
                  setIsAddModalOpen(true);
                }}
                className="h-10 px-md"
              >
                <span className="material-symbols-outlined text-[18px]">person_add</span>
                Add Staff
              </Button>
            </div>

            {/* Staff List */}
            {isLoadingStaff ? (
              <div className="flex items-center justify-center py-xl">
                <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : staffUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-xl text-center">
                <span className="material-symbols-outlined text-[48px] text-on-surface-variant/40 mb-sm">
                  group
                </span>
                <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-xs">
                  No Staff Members
                </h3>
                <p className="font-inter text-body-sm text-on-surface-variant">
                  Add staff members to give them access to the admin dashboard.
                </p>
              </div>
            ) : (
              <div className="bg-surface-container-lowest rounded-xl border border-surface-container overflow-hidden">
                {/* Header row */}
                <div className="hidden md:grid grid-cols-[2fr_2fr_1fr_1fr_0.5fr] gap-sm px-md py-sm bg-surface-container-low border-b border-surface-container">
                  <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Name</span>
                  <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Email</span>
                  <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Role</span>
                  <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Added</span>
                  <span className="font-inter font-semibold text-label-sm text-on-surface-variant text-right">Actions</span>
                </div>

                {staffUsers.map((user) => (
                  <div
                    key={user.id}
                    className="grid grid-cols-1 md:grid-cols-[2fr_2fr_1fr_1fr_0.5fr] gap-sm px-md py-sm border-b border-surface-container last:border-b-0 hover:bg-surface-container-low/50 transition-colors"
                  >
                    <div className="flex items-center gap-sm">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="font-inter font-bold text-label-sm text-primary">
                          {user.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-inter text-body-sm text-on-surface truncate">{user.name}</p>
                      </div>
                    </div>
                    <span className="font-inter text-body-sm text-on-surface truncate">{user.email}</span>
                    <span>
                      <span
                        className={`inline-flex items-center px-sm py-0.5 rounded-full text-label-sm font-inter font-semibold ${
                          user.role === "owner"
                            ? "bg-[#e3f2fd] text-[#1565c0]"
                            : user.role === "manager"
                              ? "bg-[#fff3e0] text-[#e65100]"
                              : "bg-surface-container text-on-surface-variant"
                        }`}
                      >
                        {user.role === "owner" ? "Owner" : user.role === "manager" ? "Manager" : "Staff"}
                      </span>
                    </span>
                    <span className="font-inter text-body-sm text-on-surface-variant">
                      {new Date(user.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </span>
                    <div className="flex justify-end">
                      {user.role !== "owner" && (
                        <button
                          onClick={() => handleDeleteStaff(user)}
                          disabled={isPending}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors cursor-pointer disabled:opacity-40"
                          title={`Remove ${user.name}`}
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Add Staff Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Add Staff Member">
        <form onSubmit={handleCreateStaff} className="flex flex-col gap-md">
          <div className="flex flex-col gap-xs">
            <label className="font-inter font-semibold text-label-md text-on-surface">Full Name</label>
            <input
              required
              type="text"
              value={staffForm.name}
              onChange={(e) => setStaffForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Priya Sharma"
              className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
            />
          </div>

          <div className="flex flex-col gap-xs">
            <label className="font-inter font-semibold text-label-md text-on-surface">Email Address</label>
            <input
              required
              type="email"
              value={staffForm.email}
              onChange={(e) => setStaffForm((p) => ({ ...p, email: e.target.value }))}
              placeholder="staff@qrdine.com"
              className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
            />
          </div>

          <div className="flex flex-col gap-xs">
            <label className="font-inter font-semibold text-label-md text-on-surface">Password</label>
            <input
              required
              type="password"
              value={staffForm.password}
              onChange={(e) => setStaffForm((p) => ({ ...p, password: e.target.value }))}
              placeholder="Min. 6 characters"
              minLength={6}
              className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
            />
          </div>

          <div className="flex flex-col gap-xs">
            <label className="font-inter font-semibold text-label-md text-on-surface">Role</label>
            <div className="flex gap-sm">
              <button
                type="button"
                onClick={() => setStaffForm((p) => ({ ...p, role: "staff" }))}
                className={`flex-1 h-12 rounded-xl font-inter font-semibold text-body-sm cursor-pointer transition-all ${
                  staffForm.role === "staff"
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-low text-on-surface-variant border border-surface-container hover:bg-surface-container"
                }`}
              >
                Staff
              </button>
              <button
                type="button"
                onClick={() => setStaffForm((p) => ({ ...p, role: "manager" }))}
                className={`flex-1 h-12 rounded-xl font-inter font-semibold text-body-sm cursor-pointer transition-all ${
                  staffForm.role === "manager"
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-low text-on-surface-variant border border-surface-container hover:bg-surface-container"
                }`}
              >
                Manager
              </button>
            </div>
            <p className="font-inter text-label-sm text-on-surface-variant mt-xs">
              {staffForm.role === "staff"
                ? "Staff can manage orders and tables."
                : "Managers can manage menu, tables, staff, and orders."}
            </p>
          </div>

          {staffError && (
            <div className="bg-[#ffebee] text-[#c62828] text-body-sm font-inter font-semibold rounded-lg px-md py-sm flex items-center gap-xs">
              <span className="material-symbols-outlined text-[18px]">error</span>
              {staffError}
            </div>
          )}

          <div className="flex justify-end gap-sm mt-sm">
            <Button variant="ghost" onClick={() => setIsAddModalOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? "Adding..." : "Add Staff"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
