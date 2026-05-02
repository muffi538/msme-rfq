import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import Link from "next/link";
import { Upload } from "lucide-react";
import RfqsClient from "@/components/dashboard/RfqsClient";

export default async function RfqsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Only show RFQs that have actually been processed — pending ones stay in
  // the email inbox until the user clicks "Process it".
  const { data: rfqs } = await supabase
    .from("rfqs")
    .select("id, rfq_code, buyer_name, buyer_email, status, priority, file_type, created_at")
    .not("status", "in", "(pending,needs_processing)")
    .order("created_at", { ascending: false });

  return (
    <>
      <DashboardHeader title="RFQs" />
      <main className="flex-1 p-8">

        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-gray-500 text-sm">{rfqs?.length ?? 0} total RFQs</p>
          <Link
            href="/rfqs/upload"
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" />
            Upload RFQ
          </Link>
        </div>

        <RfqsClient rfqs={rfqs ?? []} />

      </main>
    </>
  );
}
