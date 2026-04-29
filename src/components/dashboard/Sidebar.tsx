"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FileText,
  Upload,
  Users,
  LogOut,
  Inbox,
  Settings,
  Database,
  ShieldCheck,
  MessageSquareReply,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const navItems = [
  { href: "/dashboard",              label: "Dashboard",    icon: LayoutDashboard },
  { href: "/inbox",                  label: "Email Inbox",  icon: Inbox },
  { href: "/rfqs",                   label: "RFQs",         icon: FileText },
  { href: "/rfqs/upload",            label: "Upload RFQ",   icon: Upload },
  { href: "/rfq-reply",              label: "RFQ Reply",    icon: MessageSquareReply },
  { href: "/suppliers",              label: "Suppliers",    icon: Users },
  { href: "/suppliers/tally-import", label: "Tally Import", icon: Database },
  { href: "/settings",               label: "Settings",     icon: Settings },
];

const NAV_TARGET = "_blank" as const;

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single()
        .then(({ data }) => { if (data?.is_admin) setIsAdmin(true); });
    });
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen bg-gray-900 flex flex-col z-40",
        "transition-[width] duration-300 ease-in-out overflow-hidden",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo + toggle button */}
      <div className="h-16 flex items-center justify-between border-b border-gray-800 flex-shrink-0 relative">
        {/* Logo icon — always visible */}
        <div className={cn("flex items-center gap-3 transition-all duration-300", collapsed ? "px-4" : "px-4")}>
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">R</span>
          </div>
          {/* Label fades out when collapsed */}
          <span
            className={cn(
              "text-white font-bold text-[15px] whitespace-nowrap transition-all duration-200",
              collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
            )}
          >
            RFQ Flow
          </span>
        </div>

        {/* Collapse toggle — floats on the right edge */}
        <button
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "absolute -right-3 top-1/2 -translate-y-1/2 z-50",
            "w-6 h-6 rounded-full bg-gray-700 border border-gray-600",
            "flex items-center justify-center",
            "hover:bg-blue-600 hover:border-blue-500 transition-colors",
            "shadow-md"
          )}
        >
          {collapsed
            ? <ChevronRight className="w-3 h-3 text-gray-300" />
            : <ChevronLeft  className="w-3 h-3 text-gray-300" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              target={NAV_TARGET}
              rel="noopener noreferrer"
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
                "h-10 px-3",
                collapsed ? "justify-center" : "justify-start",
                active
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              )}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span
                className={cn(
                  "whitespace-nowrap transition-all duration-200",
                  collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}

        {isAdmin && (
          <Link
            href="/admin"
            target={NAV_TARGET}
            rel="noopener noreferrer"
            title={collapsed ? "Admin Panel" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
              "h-10 px-3 mt-2",
              collapsed ? "justify-center" : "justify-start",
              pathname === "/admin"
                ? "bg-purple-600 text-white"
                : "text-purple-400 hover:bg-gray-800 hover:text-purple-300"
            )}
          >
            <ShieldCheck className="w-4 h-4 flex-shrink-0" />
            <span
              className={cn(
                "whitespace-nowrap transition-all duration-200",
                collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
              )}
            >
              Admin Panel
            </span>
          </Link>
        )}
      </nav>

      {/* Logout */}
      <div className="px-2 pb-4 border-t border-gray-800 pt-3 flex-shrink-0">
        <button
          onClick={handleLogout}
          title={collapsed ? "Log out" : undefined}
          className={cn(
            "flex items-center gap-3 w-full rounded-lg text-sm font-medium",
            "h-10 px-3 transition-colors",
            "text-gray-400 hover:bg-gray-800 hover:text-white",
            collapsed ? "justify-center" : "justify-start"
          )}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          <span
            className={cn(
              "whitespace-nowrap transition-all duration-200",
              collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
            )}
          >
            Log out
          </span>
        </button>
      </div>
    </aside>
  );
}
