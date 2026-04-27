import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Upload, AlertTriangle } from "lucide-react";

const statusStyle: Record<string, string> = {
  pending:    "bg-yellow-100 text-yellow-800 border-yellow-200",
  processing: "bg-blue-100 text-blue-800 border-blue-200",
  processed:  "bg-green-100 text-green-800 border-green-200",
  approved:   "bg-indigo-100 text-indigo-800 border-indigo-200",
  sent:       "bg-gray-100 text-gray-700 border-gray-200",
};

export default async function RfqsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rfqs } = await supabase
    .from("rfqs")
    .select("id, rfq_code, buyer_name, buyer_email, status, priority, file_type, created_at")
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

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {!rfqs || rfqs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Upload className="w-10 h-10 text-gray-200 mb-3" />
              <p className="text-gray-400 font-medium">No RFQs uploaded yet</p>
              <Link href="/rfqs/upload" className="mt-4 text-blue-600 text-sm font-medium hover:underline">
                Upload your first RFQ →
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
                  <th className="px-6 py-3">RFQ Code</th>
                  <th className="px-6 py-3">Buyer</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Priority</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rfqs.map((rfq) => (
                  <tr key={rfq.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3 font-semibold text-blue-600">{rfq.rfq_code}</td>
                    <td className="px-6 py-3">
                      <p className="text-gray-800 font-medium">{rfq.buyer_name ?? "—"}</p>
                      {rfq.buyer_email && (
                        <p className="text-gray-400 text-xs">{rfq.buyer_email}</p>
                      )}
                    </td>
                    <td className="px-6 py-3 text-gray-500 capitalize">{rfq.file_type ?? "—"}</td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${statusStyle[rfq.status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                        {rfq.status}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {rfq.priority === "urgent" && (
                        <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
                          <AlertTriangle className="w-3 h-3" /> urgent
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-gray-400">
                      {new Date(rfq.created_at).toLocaleDateString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  );
}
