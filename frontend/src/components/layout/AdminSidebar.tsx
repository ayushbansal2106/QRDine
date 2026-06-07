"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAdmin } from "@/actions/auth";

export const AdminSidebar: React.FC = () => {
  const pathname = usePathname();

  const menuItems = [
    { label: "Orders", path: "/admin/orders", icon: "assignment" },
    { label: "Kitchen", path: "/admin/kitchen", icon: "cooking" },
    { label: "Menu", path: "/admin/menu", icon: "restaurant_menu" },
    { label: "Tables", path: "/admin/tables", icon: "table_restaurant" },
    { label: "Waiter Calls", path: "/admin/requests", icon: "ring_volume" },
    { label: "Bills", path: "/admin/bills", icon: "receipt_long" },
    { label: "Sales History", path: "/admin/sales", icon: "trending_up" },
    { label: "QR Codes", path: "/admin/qr", icon: "qr_code" },
    { label: "Settings", path: "/admin/settings", icon: "settings" },
  ];

  return (
    <aside className="w-64 bg-surface-container-low border-r border-surface-container flex flex-col justify-between shrink-0 h-screen sticky top-0 font-inter">
      {/* Title / Logo */}
      <div className="p-md border-b border-surface-container flex items-center gap-xs">
        <span className="material-symbols-outlined text-primary text-[28px]">
          restaurant
        </span>
        <span className="font-semibold text-body-lg text-primary">
          QRDine Admin
        </span>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 p-sm flex flex-col gap-xs overflow-y-auto">
        {menuItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <Link key={item.label} href={item.path} passHref>
              <span
                className={`flex items-center gap-sm px-md py-sm rounded-lg text-body-md font-semibold cursor-pointer transition-colors duration-150 ${
                  isActive
                    ? "bg-primary text-on-primary shadow-[0px_4px_12px_rgba(81,96,79,0.15)]"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                }`}
              >
                <span className="material-symbols-outlined text-[20px] select-none">
                  {item.icon}
                </span>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Logout Footer */}
      <div className="p-md border-t border-surface-container">
        <button
          onClick={() => logoutAdmin()}
          className="w-full flex items-center gap-sm px-md py-sm rounded-lg text-body-md font-semibold text-error hover:bg-error/10 transition-colors cursor-pointer text-left"
        >
          <span className="material-symbols-outlined text-[20px] select-none">
            logout
          </span>
          Logout
        </button>
      </div>
    </aside>
  );
};
export default AdminSidebar;
