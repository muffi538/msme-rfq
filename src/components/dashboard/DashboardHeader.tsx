"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function DashboardHeader({ title }: { title: string }) {
  const [company, setCompany] = useState("Your Company");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      const name = user?.user_metadata?.company_name ?? "Your Company";
      setCompany(name);
    });
  }, []);

  const initials = company.slice(0, 2).toUpperCase();

  return (
    <header className="h-16 border-b border-gray-100 bg-white flex items-center justify-between px-8">
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500">{company}</span>
        <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center">
          <span className="text-white text-xs font-bold">{initials}</span>
        </div>
      </div>
    </header>
  );
}
