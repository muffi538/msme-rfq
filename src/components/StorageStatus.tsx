"use client";

import { useEffect, useState } from "react";
import { save, load } from "@/lib/storage";

export default function StorageStatus() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    save("__check__", true);
    const ok = load("__check__", false);
    setReady(ok === true);
  }, []);

  if (!ready) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700 ring-1 ring-green-600/20">
      ✓ Storage ready
    </span>
  );
}
