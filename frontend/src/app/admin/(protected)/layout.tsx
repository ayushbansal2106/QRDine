import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LogoutButton } from "./LogoutButton";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get("superadmin_token");

  if (!token) {
    redirect("/admin/login");
  }

  return (
    <div className="flex h-screen bg-[#1b1c1c] text-white overflow-hidden">
      {/* Dark Sidebar specifically for Super Admin */}
      <aside className="w-64 bg-[#2a2c2c] border-r border-[#444842] flex flex-col hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b border-[#444842]">
          <div className="w-8 h-8 rounded-full bg-[#51604f] flex items-center justify-center mr-3">
            <span className="material-symbols-outlined text-white text-sm">shield_person</span>
          </div>
          <span className="font-bold text-lg tracking-tight">Control Plane</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <Link
            href="/admin"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#51604f]/20 text-[#51604f] font-medium transition-colors"
          >
            <span className="material-symbols-outlined">dashboard</span>
            Overview
          </Link>
          <Link
            href="/admin/cafes"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#e1dfdb] hover:bg-[#444842]/30 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined">storefront</span>
            Tenants (Cafes)
          </Link>
          <Link
            href="/admin/billing"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#e1dfdb] hover:bg-[#444842]/30 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined">credit_card</span>
            Subscriptions
          </Link>
          <Link
            href="/admin/plans"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#e1dfdb] hover:bg-[#444842]/30 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined">security</span>
            Plan Configuration
          </Link>

          <Link
            href="/admin/staff"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#e1dfdb] hover:bg-[#444842]/30 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined">manage_accounts</span>
            Platform Staff
          </Link>
        </nav>

        <div className="p-4 border-t border-[#444842]">
          <LogoutButton className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-[#ff8989] hover:bg-[#ba1a1a]/20 transition-colors text-left">
            <span className="material-symbols-outlined">logout</span>
            Sign Out
          </LogoutButton>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-[#1b1c1c]">
        {/* Mobile Header */}
        <header className="h-16 md:hidden flex items-center justify-between px-4 bg-[#2a2c2c] border-b border-[#444842]">
           <span className="font-bold">Control Plane</span>
           <LogoutButton>
             <span className="material-symbols-outlined text-[#ff8989]">logout</span>
           </LogoutButton>
        </header>

        <div className="flex-1 overflow-y-auto p-6 md:p-10">
          {children}
        </div>
      </main>
    </div>
  );
}
