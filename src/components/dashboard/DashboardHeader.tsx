"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";
import { Settings, LogOut, KeyRound, User, ChevronDown, Sun, Moon, Monitor } from "lucide-react";

const THEMES = [
  { value: "light",  label: "Light",  icon: Sun },
  { value: "dark",   label: "Dark",   icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export default function DashboardHeader({ title }: { title: string }) {
  const router  = useRouter();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [company, setCompany] = useState("Your Company");
  const [email,   setEmail]   = useState("");
  const [open,    setOpen]    = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      const name = user?.user_metadata?.company_name ?? "Your Company";
      setCompany(name);
      setEmail(user?.email ?? "");
    });
  }, []);

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

  // Cycle through light → dark → system on icon click
  function cycleTheme() {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
  }

  const ThemeIcon = resolvedTheme === "dark" ? Moon : Sun;

  return (
    <header className="h-16 border-b border-border bg-card flex items-center justify-between px-8 relative z-30">
      <h1 className="text-xl font-semibold text-card-foreground">{title}</h1>

      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        {mounted && (
          <button
            onClick={cycleTheme}
            title={`Theme: ${theme}`}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ThemeIcon className="w-4 h-4" />
          </button>
        )}

        {/* Account menu */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2.5 hover:bg-accent rounded-xl px-3 py-1.5 transition-colors"
          >
            <span className="text-sm text-muted-foreground hidden sm:block">{company}</span>
            <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">{initials}</span>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="absolute right-0 top-12 w-72 bg-popover text-popover-foreground rounded-2xl shadow-lg border border-border overflow-hidden">
              {/* Account info */}
              <div className="px-4 py-4 border-b border-border bg-muted/40">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-sm font-bold">{initials}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{company}</p>
                    <p className="text-xs text-muted-foreground truncate">{email}</p>
                  </div>
                </div>
              </div>

              {/* Theme selector */}
              <div className="px-4 py-3 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground mb-2">Appearance</p>
                <div className="flex gap-1.5">
                  {THEMES.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
                      className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg text-xs font-medium transition-colors border ${
                        theme === value
                          ? "border-blue-600 bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
                          : "border-border text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Menu items */}
              <div className="py-1.5">
                <button
                  onClick={() => { setOpen(false); window.open("/settings", "_blank"); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent transition-colors"
                >
                  <Settings className="w-4 h-4 text-muted-foreground" />
                  Settings
                </button>

                <button
                  onClick={() => { setOpen(false); window.open("/suppliers", "_blank"); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent transition-colors"
                >
                  <User className="w-4 h-4 text-muted-foreground" />
                  My Suppliers
                </button>

                <button
                  onClick={handleResetPassword}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent transition-colors"
                >
                  <KeyRound className="w-4 h-4 text-muted-foreground" />
                  {resetSent ? (
                    <span className="text-green-600 font-medium">Reset link sent to your email ✓</span>
                  ) : (
                    "Change password"
                  )}
                </button>
              </div>

              <div className="border-t border-border py-1.5">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
