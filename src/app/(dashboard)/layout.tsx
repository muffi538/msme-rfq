"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/dashboard/Sidebar";
import IdleTimeout from "@/components/dashboard/IdleTimeout";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  // Persist across page loads
  useEffect(() => {
    const saved = localStorage.getItem("sidebar_collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed((v) => {
      localStorage.setItem("sidebar_collapsed", String(!v));
      return !v;
    });
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div
        className="flex-1 flex flex-col overflow-auto transition-[margin] duration-300 ease-in-out"
        style={{ marginLeft: collapsed ? "64px" : "240px" }}
      >
        {children}
      </div>
      <IdleTimeout />
    </div>
  );
}
