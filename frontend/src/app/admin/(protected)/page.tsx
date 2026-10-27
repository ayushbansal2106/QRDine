"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/apiClient";

interface OverviewData {
  cafes: number;
  users: number;
  orders: number;
  revenue: number;
}

export default function SuperAdminDashboard() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOverview = async () => {
      try {
        // Backend endpoint is /api/superadmin/overview
        const res = await apiClient.get("/superadmin/overview");
        setData({
          cafes: res.data.totals?.cafes || 0,
          users: res.data.totals?.subscriptions || 0,
          orders: 0, // Not available from this endpoint
          revenue: res.data.revenue?.mrrRupees || 0,
        });
      } catch (err) {
        console.error("Failed to load overview data:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchOverview();
  }, []);

  return (
    <div className="max-w-5xl">
      <h1 className="text-3xl font-bold mb-2">Platform Overview</h1>
      <p className="text-[#e1dfdb] mb-8">Global telemetry for the QRDine platform.</p>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-[#2a2c2c] border border-[#444842] p-6 rounded-2xl animate-pulse h-32"></div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Total Cafes" value={data?.cafes || 0} icon="storefront" />
          <StatCard title="Platform Users" value={data?.users || 0} icon="group" />
          <StatCard title="Total Orders" value={data?.orders || 0} icon="receipt_long" />
          <StatCard title="Platform Revenue (MRR)" value={`$${data?.revenue || 0}`} icon="payments" />
        </div>
      )}
      
      <div className="mt-12 bg-[#2a2c2c] border border-[#444842] rounded-2xl p-8 text-center text-[#e1dfdb]">
        <span className="material-symbols-outlined text-4xl mb-4 text-[#5e5e5b]">monitoring</span>
        <h3 className="text-xl font-semibold text-white mb-2">System Health</h3>
        <p>All core services are operational. Use the navigation to manage tenants or adjust subscriptions.</p>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: string | number; icon: string }) {
  return (
    <div className="bg-[#2a2c2c] border border-[#444842] p-6 rounded-2xl flex flex-col justify-between">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-sm font-medium text-[#e1dfdb] uppercase tracking-wider">{title}</h3>
        <span className="material-symbols-outlined text-[#51604f]">{icon}</span>
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
    </div>
  );
}
