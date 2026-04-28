"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Clock, LogOut } from "lucide-react";

const IDLE_MINUTES   = 60;  // sign out after this many minutes idle
const WARN_BEFORE    = 2;   // show warning this many minutes before sign-out
const IDLE_MS        = IDLE_MINUTES * 60 * 1000;
const WARN_MS        = WARN_BEFORE * 60 * 1000;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;

export default function IdleTimeout() {
  const router        = useRouter();
  const lastActivity  = useRef(Date.now());
  const [showing,     setShowing]   = useState(false);
  const [countdown,   setCountdown] = useState(WARN_BEFORE * 60);

  const resetTimer = useCallback(() => {
    lastActivity.current = Date.now();
    setShowing(false);
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  // Register activity listeners
  useEffect(() => {
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetTimer));
  }, [resetTimer]);

  // Main idle checker — runs every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const idle = Date.now() - lastActivity.current;

      if (idle >= IDLE_MS) {
        signOut();
        return;
      }

      if (idle >= IDLE_MS - WARN_MS) {
        const remaining = Math.ceil((IDLE_MS - idle) / 1000);
        setCountdown(remaining);
        setShowing(true);
      } else {
        setShowing(false);
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown ticker when warning is showing
  useEffect(() => {
    if (!showing) return;
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { signOut(); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [showing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!showing) return null;

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;
  const label = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center space-y-5">
        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto">
          <Clock className="w-8 h-8 text-orange-500" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Still there?</h2>
          <p className="text-gray-500 text-sm mt-1">
            You&apos;ve been inactive for a while. You&apos;ll be signed out in:
          </p>
          <p className="text-3xl font-bold text-orange-500 mt-3 tabular-nums">{label}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={resetTimer}
            className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            Stay logged in
          </button>
          <button
            onClick={signOut}
            className="flex-1 h-11 border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium rounded-xl transition-colors text-sm flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
