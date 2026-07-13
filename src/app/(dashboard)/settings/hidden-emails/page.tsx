"use client";

import { useEffect, useState } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, ArchiveRestore, Inbox } from "lucide-react";

type HiddenRfq = {
  id: string;
  rfq_code: string;
  buyer_name: string | null;
  buyer_email: string | null;
  file_name: string | null;
  hidden_at: string | null;
};

export default function HiddenEmailsPage() {
  const [rfqs,        setRfqs]        = useState<HiddenRfq[]>([]);
  const [loading,      setLoading]     = useState(true);
  const [restoring,    setRestoring]   = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/rfqs/hidden")
      .then((r) => r.json())
      .then((data) => setRfqs(data.rfqs ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function restore(id: string) {
    setRestoring((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch(`/api/rfqs/${id}/unhide`, { method: "POST" });
      if (!res.ok) throw new Error("Restore failed");
      setRfqs((prev) => prev.filter((r) => r.id !== id));
      toast.success("Restored to dashboard.");
    } catch {
      toast.error("Couldn't restore this RFQ. Please try again.");
    } finally {
      setRestoring((p) => ({ ...p, [id]: false }));
    }
  }

  return (
    <>
      <DashboardHeader title="Restore Hidden Emails" />
      <main className="flex-1 p-8 max-w-2xl mx-auto w-full">
        <p className="text-sm text-gray-500 mb-6">
          RFQs removed from the dashboard using the trash icon in the inbox. Their source emails were never touched in Gmail — restoring one here just makes it visible in the dashboard again.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : rfqs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center py-20 text-center">
            <Inbox className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-gray-400 font-medium">No hidden emails</p>
            <p className="text-gray-400 text-sm mt-1">Anything you remove from the inbox will show up here.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
            {rfqs.map((rfq) => (
              <div key={rfq.id} className="flex items-center justify-between gap-3 px-6 py-4">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{rfq.rfq_code}</p>
                  <p className="text-sm text-gray-500 truncate">{rfq.buyer_name ?? rfq.buyer_email ?? "Unknown sender"}</p>
                  {rfq.hidden_at && (
                    <p className="text-xs text-gray-400 mt-0.5">Removed {new Date(rfq.hidden_at).toLocaleString("en-IN")}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => restore(rfq.id)}
                  disabled={restoring[rfq.id]}
                  variant="outline"
                  className="gap-1.5 flex-shrink-0"
                >
                  {restoring[rfq.id]
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <ArchiveRestore className="w-3.5 h-3.5" />}
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
