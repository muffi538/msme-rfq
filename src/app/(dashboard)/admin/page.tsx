"use client";

import { useEffect, useState } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Users, FileText, ShieldCheck, Clock, CheckCircle, XCircle } from "lucide-react";

type UserRow = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  confirmed: boolean;
  is_admin: boolean;
  rfq_count: number;
  supplier_count: number;
};

export default function AdminPage() {
  const [users, setUsers]     = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setUsers(d.users ?? []);
      })
      .catch(() => setError("Failed to load users"))
      .finally(() => setLoading(false));
  }, []);

  const totalRfqs      = users.reduce((s, u) => s + u.rfq_count, 0);
  const totalSuppliers = users.reduce((s, u) => s + u.supplier_count, 0);
  const confirmed      = users.filter((u) => u.confirmed).length;

  return (
    <>
      <DashboardHeader title="Admin — All Users" />
      <main className="flex-1 p-8 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Users",      value: users.length,    icon: Users,     color: "blue"   },
            { label: "Verified Emails",  value: confirmed,       icon: CheckCircle, color: "green" },
            { label: "Total RFQs",       value: totalRfqs,       icon: FileText,  color: "purple" },
            { label: "Total Suppliers",  value: totalSuppliers,  icon: ShieldCheck, color: "amber" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-${s.color}-50`}>
                <s.icon className={`w-5 h-5 text-${s.color}-600`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-500">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Signed-up Users</h2>
            <p className="text-sm text-gray-500 mt-0.5">Every account that has registered on RFQ Flow</p>
          </div>

          {loading && (
            <div className="p-12 text-center text-gray-400">Loading users…</div>
          )}

          {error && (
            <div className="p-6 text-red-600 text-sm">{error}</div>
          )}

          {!loading && !error && (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {["Email", "Verified", "Role", "RFQs", "Suppliers", "Signed up", "Last login"].map((h) => (
                    <th key={h} className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">{u.email}</td>
                    <td className="px-6 py-4">
                      {u.confirmed
                        ? <span className="flex items-center gap-1 text-green-600"><CheckCircle className="w-3.5 h-3.5" /> Yes</span>
                        : <span className="flex items-center gap-1 text-amber-500"><XCircle className="w-3.5 h-3.5" /> Pending</span>}
                    </td>
                    <td className="px-6 py-4">
                      {u.is_admin
                        ? <span className="bg-purple-100 text-purple-700 text-xs font-semibold px-2 py-0.5 rounded-full">Admin</span>
                        : <span className="bg-gray-100 text-gray-600 text-xs font-semibold px-2 py-0.5 rounded-full">Client</span>}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{u.rfq_count}</td>
                    <td className="px-6 py-4 text-gray-600">{u.supplier_count}</td>
                    <td className="px-6 py-4 text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(u.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {u.last_sign_in_at
                        ? new Date(u.last_sign_in_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                        : "—"}
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
