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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const navItems = [
  { href: "/dashboard",              label: "Dashboard",    icon: LayoutDashboard },
  { href: "/inbox",                  label: "Email Inbox",  icon: Inbox },
  { href: "/rfqs",                   label: "RFQs",         icon: FileText },
  { href: "/rfqs/upload",            label: "Upload RFQ",   icon: Upload },
  { href: "/suppliers",              label: "Suppliers",    icon: Users },
  { href: "/suppliers/tally-import", label: "Tally Import", icon: Database },
  { href: "/settings",               label: "Settings",     icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-gray-900 flex flex-col z-40">
      {/* Logo */}
      <div className="px-6 h-16 flex items-center border-b border-gray-800">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center mr-3 flex-shrink-0">
          <span className="text-white font-bold text-sm">R</span>
        </div>
        <span className="text-white font-bold text-lg">RFQ Flow</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              )}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 pb-4 border-t border-gray-800 pt-4">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Log out
        </button>
      </div>
    </aside>
  );
}
