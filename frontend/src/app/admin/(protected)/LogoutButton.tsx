"use client";

import React from "react";

/**
 * Sign-out control for the Super Admin control plane.
 *
 * Extracted into a Client Component because `(protected)/layout.tsx` is a
 * Server Component (it reads the `superadmin_token` cookie), and a Server
 * Component cannot pass event handlers such as `onClick` to the DOM — React
 * throws "Event handlers cannot be passed to Client Component props" and the
 * whole page 500s.
 *
 * The token cookie is cleared and the browser is sent to the login page. A hard
 * `window.location` navigation (rather than `router.push`) is deliberate: it
 * guarantees the cleared cookie is observed by the next server render.
 */
export function LogoutButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const handleLogout = () => {
    document.cookie = "superadmin_token=; path=/; max-age=0;";
    window.location.href = "/admin/login";
  };

  return (
    <button className={className} onClick={handleLogout}>
      {children}
    </button>
  );
}
