import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { FileText, Clock, CheckCircle, Users, Send } from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch counts in parallel
  const [
    { count: totalRfqs },
    { count: processedRfqs },
    { count: sentCount },
    { count: totalSuppliers },
  ] = await Promise.all([
    supabase.from("rfqs").select("*", { count: "exact", head: true }),
    supabase.from("rfqs").select("*", { count: "exact", head: true }).eq("status", "processed"),
    supabase.from("outgoing_rfqs").select("*", { count: "exact", head: true }).eq("status", "sent"),
    supabase.from("suppliers").select("*", { count: "exact", head: true }),
  ]);

  const stats = [
    { label: "Total RFQs",     value: totalRfqs ?? 0,     icon: FileText,    color: "bg-blue-50 text-blue-600",    href: "/rfqs" },
    { label: "Processed",      value: processedRfqs ?? 0, icon: CheckCircle, color: "bg-green-50 text-green-600",  href: "/rfqs" },
    { label: "Quotes Sent",    value: sentCount ?? 0,     icon: Send,        color: "bg-indigo-50 text-indigo-600",href: "/rfqs" },
    { label: "Suppliers",      value: totalSuppliers ?? 0,icon: Users,       color: "bg-purple-50 text-purple-600",href: "/suppliers" },
  ];

  // Fetch 5 most recent RFQs
  const { data: recentRfqs } = await supabase
    .from("rfqs")
    .select("id, rfq_code, buyer_name, status, priority, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  const statusStyle: Record<string, string> = {
    pending:    "bg-yellow-100 text-yellow-800",
    processing: "bg-blue-100 text-blue-800",
    processed:  "bg-green-100 text-green-800",
    approved:   "bg-indigo-100 text-indigo-800",
    sent:       "bg-gray-100 text-gray-700",
  };

  return (
    <>
      <DashboardHeader title="Dashboard" />
      <main className="flex-1 p-8 space-y-8">

        {/* Stats grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {stats.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-2xl border border-gray-100 p-6 flex items-center gap-4 hover:shadow-md transition-shadow"
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${s.color}`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-sm text-gray-500">{s.label}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Recent RFQs */}
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
            <h2 className="font-semibold text-gray-900">Recent RFQs</h2>
            <Link href="/rfqs" target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>

          {!recentRfqs || recentRfqs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText className="w-10 h-10 text-gray-200 mb-3" />
              <p className="text-gray-400 font-medium">No RFQs yet</p>
              <p className="text-gray-400 text-sm mt-1 mb-4">Upload your first RFQ to get started</p>
              <Link
                href="/rfqs/upload"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
              >
                Upload RFQ
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-50">
                  <th className="px-6 py-3">RFQ Code</th>
                  <th className="px-6 py-3">Buyer</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Priority</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentRfqs.map((rfq) => (
                  <tr key={rfq.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3 font-medium text-blue-600">
                      <Link href={`/rfqs/${rfq.id}`} target="_blank" className="hover:underline">{rfq.rfq_code}</Link>
                    </td>
                    <td className="px-6 py-3 text-gray-600">{rfq.buyer_name ?? "—"}</td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle[rfq.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {rfq.status}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {rfq.priority === "urgent" && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">urgent</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-gray-400 whitespace-nowrap">
                      <p>{new Date(rfq.created_at).toLocaleDateString("en-IN")}</p>
                      <p className="text-xs">{new Date(rfq.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
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
