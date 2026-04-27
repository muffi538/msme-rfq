"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Settings, LogOut, KeyRound, User, ChevronDown } from "lucide-react";

export default function DashboardHeader({ title }: { title: string }) {
  const router  = useRouter();
  const [company, setCompany] = useState("Your Company");
  const [email,   setEmail]   = useState("");
  const [open,    setOpen]    = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      const name = user?.user_metadata?.company_name ?? "Your Company";
      setCompany(name);
      setEmail(user?.email ?? "");
    });
  }, []);

  // Close menu on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleResetPassword() {
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetSent(true);
    setTimeout(() => setResetSent(false), 4000);
  }

  const initials = company.slice(0, 2).toUpperCase();

  return (
    <header className="h-16 border-b border-gray-100 bg-white flex items-center justify-between px-8 relative z-30">
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>

      {/* Account menu */}
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2.5 hover:bg-gray-50 rounded-xl px-3 py-1.5 transition-colors"
        >
          <span className="text-sm text-gray-500 hidden sm:block">{company}</span>
          <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">{initials}</span>
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute right-0 top-12 w-72 bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
            {/* Account info */}
            <div className="px-4 py-4 border-b border-gray-100 bg-gray-50/60">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-sm font-bold">{initials}</span>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{company}</p>
                  <p className="text-xs text-gray-400 truncate">{email}</p>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-1.5">
              <button
                onClick={() => { setOpen(false); router.push("/settings"); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Settings className="w-4 h-4 text-gray-400" />
                Settings
              </button>

              <button
                onClick={() => { setOpen(false); router.push("/suppliers"); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <User className="w-4 h-4 text-gray-400" />
                My Suppliers
              </button>

              <button
                onClick={handleResetPassword}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <KeyRound className="w-4 h-4 text-gray-400" />
                {resetSent ? (
                  <span className="text-green-600 font-medium">Reset link sent to your email ✓</span>
                ) : (
                  "Change password"
                )}
              </button>
            </div>

            <div className="border-t border-gray-100 py-1.5">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Log out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
