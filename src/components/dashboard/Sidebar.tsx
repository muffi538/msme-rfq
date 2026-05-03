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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Daily-use sections — what the user touches every day
const dailyNav = [
  { href: "/dashboard",   label: "Dashboard",   icon: LayoutDashboard },
  { href: "/inbox",       label: "Email Inbox", icon: Inbox },
  { href: "/rfqs",        label: "RFQs",        icon: FileText },
  { href: "/rfqs/upload", label: "Upload RFQ",  icon: Upload },
  { href: "/rfq-reply",   label: "RFQ Reply",   icon: MessageSquareReply },
];

// Setup / config sections — usually touched once or rarely
const setupNav = [
  { href: "/suppliers",              label: "Suppliers",    icon: Users },
  { href: "/suppliers/tally-import", label: "Tally Import", icon: Database },
  { href: "/settings",               label: "Settings",     icon: Settings },
];


interface SidebarProps {
  collapsed: boolean;
}

export default function Sidebar({ collapsed }: SidebarProps) {
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
      {/* Logo */}
      <div className="h-16 flex items-center border-b border-gray-800 flex-shrink-0 px-4">
        <div className="w-8 h-8 bg-[#1847F5] rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">P</span>
        </div>
        <span
          className={cn(
            "ml-3 text-white font-bold text-[15px] whitespace-nowrap transition-all duration-200",
            collapsed ? "opacity-0 w-0 ml-0 overflow-hidden" : "opacity-100"
          )}
        >
          Procur.AI
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {/* Daily-use group */}
        {dailyNav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors h-10 px-3",
                collapsed ? "justify-center" : "justify-start",
                active
                  ? "bg-[#1847F5] text-white"
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

        {/* Divider — separates daily-use from setup/config */}
        <div className="my-3 px-3">
          <div className="h-px bg-gray-800" />
          {!collapsed && (
            <p className="text-[10px] font-semibold tracking-widest text-gray-600 uppercase mt-2.5 mb-1">
              Setup
            </p>
          )}
        </div>

        {/* Setup / config group */}
        {setupNav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors h-10 px-3",
                collapsed ? "justify-center" : "justify-start",
                active
                  ? "bg-[#1847F5] text-white"
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
            title={collapsed ? "Admin Panel" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors h-10 px-3 mt-2",
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
            "flex items-center gap-3 w-full rounded-lg text-sm font-medium h-10 px-3",
            "transition-colors text-gray-400 hover:bg-gray-800 hover:text-white",
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
