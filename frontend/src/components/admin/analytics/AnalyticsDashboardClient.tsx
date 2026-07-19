"use client";

import React, { useState } from "react";
import { OverviewCards } from "./OverviewCards";
import { RevenueChart } from "./RevenueChart";
import { GSTBreakdown } from "./GSTBreakdown";
import { ItemsAnalytics } from "./ItemsAnalytics";
import { TableAnalytics } from "./TableAnalytics";
import { SessionAnalytics } from "./SessionAnalytics";
import { CustomerAnalytics } from "./CustomerAnalytics";
import { PaymentAnalytics } from "./PaymentAnalytics";

const tabs = [
  { id: "overview", label: "Overview", icon: "dashboard" },
  { id: "revenue", label: "Revenue", icon: "payments" },
  { id: "gst", label: "GST", icon: "account_balance" },
  { id: "items", label: "Items", icon: "restaurant_menu" },
  { id: "tables", label: "Tables", icon: "table_restaurant" },
  { id: "sessions", label: "Sessions", icon: "schedule" },
  { id: "customers", label: "Customers", icon: "groups" },
  { id: "payments", label: "Payments", icon: "credit_card" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export const AnalyticsDashboardClient: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const renderContent = () => {
    switch (activeTab) {
      case "overview":
        return <OverviewCards />;
      case "revenue":
        return <RevenueChart />;
      case "gst":
        return <GSTBreakdown />;
      case "items":
        return <ItemsAnalytics />;
      case "tables":
        return <TableAnalytics />;
      case "sessions":
        return <SessionAnalytics />;
      case "customers":
        return <CustomerAnalytics />;
      case "payments":
        return <PaymentAnalytics />;
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 flex flex-col p-md lg:p-lg">
      {/* Header */}
      <div className="flex items-center gap-sm mb-md">
        <span className="material-symbols-outlined text-primary text-[32px]">
          analytics
        </span>
        <h1 className="font-inter font-bold text-headline-md text-on-surface">
          Analytics
        </h1>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-xs mb-lg overflow-x-auto no-scrollbar border-b border-surface-container pb-xs">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`analytics-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-xs px-md py-sm rounded-t-lg text-body-sm font-inter font-semibold whitespace-nowrap cursor-pointer transition-all duration-200 relative ${
                isActive
                  ? "text-primary bg-primary/8"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {tab.icon}
              </span>
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-t-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1">{renderContent()}</div>
    </div>
  );
};
