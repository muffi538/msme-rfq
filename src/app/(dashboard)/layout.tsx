"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/dashboard/Sidebar";
import IdleTimeout from "@/components/dashboard/IdleTimeout";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mounted,   setMounted]   = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar_collapsed");
    if (saved === "true") setCollapsed(true);
    setMounted(true);
  }, []);

  function toggle() {
    setCollapsed((v) => {
      localStorage.setItem("sidebar_collapsed", String(!v));
      return !v;
    });
  }

  const sidebarW = collapsed ? 64 : 240;

  return (
    <div className="flex h-screen bg-background">
      <Sidebar collapsed={collapsed} />

      {/* Floating toggle button — lives outside sidebar so overflow-hidden never clips it */}
      {mounted && (
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{ left: `${sidebarW - 14}px` }}
          className="fixed top-[26px] z-50 transition-[left] duration-300 ease-in-out
            w-7 h-7 rounded-full
            flex items-center justify-center
            bg-[#1e2235] border border-[#3a3f5c]
            shadow-[0_0_0_2px_#0d0f1a,0_4px_16px_rgba(91,107,255,0.35)]
            hover:bg-[#5b6bff] hover:border-[#5b6bff]
            hover:shadow-[0_0_0_2px_#0d0f1a,0_4px_20px_rgba(91,107,255,0.6)]
            group transition-all"
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-white transition-colors" />
            : <ChevronLeft  className="w-3.5 h-3.5 text-gray-400 group-hover:text-white transition-colors" />}
        </button>
      )}

      <div
        className="flex-1 flex flex-col overflow-auto transition-[margin] duration-300 ease-in-out"
        style={{ marginLeft: `${sidebarW}px` }}
      >
        {children}
      </div>
      <IdleTimeout />
    </div>
  );
}
