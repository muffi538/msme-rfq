import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { FileText, CheckCircle, Users, Send, ArrowRight, Mail, Sparkles, Circle } from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { count: totalRfqs },
    { count: processedRfqs },
    { count: sentCount },
    { count: totalSuppliers },
  ] = await Promise.all([
    // Total = only RFQs that have been processed (pending stay in inbox only)
    supabase.from("rfqs").select("*", { count: "exact", head: true }).not("status", "in", "(pending,needs_processing)"),
    supabase.from("rfqs").select("*", { count: "exact", head: true }).eq("status", "processed"),
    supabase.from("outgoing_rfqs").select("*", { count: "exact", head: true }).eq("status", "sent"),
    supabase.from("suppliers").select("*", { count: "exact", head: true }),
  ]);

  const stats = [
    { label: "Total RFQs",  value: totalRfqs ?? 0,     icon: FileText,    href: "/rfqs",       num: "01" },
    { label: "Completed",   value: processedRfqs ?? 0, icon: CheckCircle, href: "/rfqs",       num: "02" },
    { label: "Quotes Sent", value: sentCount ?? 0,     icon: Send,        href: "/rfqs",       num: "03" },
    { label: "Suppliers",   value: totalSuppliers ?? 0,icon: Users,       href: "/suppliers",  num: "04" },
  ];

  // Setup checklist state — drives the onboarding banner
  const { data: gmailRow } = await supabase
    .from("user_settings")
    .select("value")
    .eq("user_id", user.id)
    .eq("key", "gmail_refresh_token")
    .single();
  const gmailConnected = !!gmailRow?.value;

  const { count: supplierCount } = await supabase
    .from("suppliers")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);
  const hasSupplier = (supplierCount ?? 0) > 0;

  const { count: processedCount } = await supabase
    .from("rfqs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .in("status", ["processed", "approved", "sent"]);
  const hasProcessedRfq = (processedCount ?? 0) > 0;

  const onboardingDone = gmailConnected && hasSupplier && hasProcessedRfq;
  const completedSteps = [gmailConnected, hasSupplier, hasProcessedRfq].filter(Boolean).length;

  // Recent RFQs widget — also excludes pending/needs_processing so unprocessed
  // emails don't leak out of the inbox into the main dashboard view
  const { data: recentRfqs } = await supabase
    .from("rfqs")
    .select("id, rfq_code, buyer_name, status, priority, created_at")
    .not("status", "in", "(pending,needs_processing)")
    .order("created_at", { ascending: false })
    .limit(5);

  const statusStyle: Record<string, string> = {
    pending:    "bg-amber-50 text-amber-700 border border-amber-200",
    processing: "bg-[#1847F5]/8 text-[#1847F5] border border-[#1847F5]/20",
    processed:  "bg-green-50 text-green-700 border border-green-200",
    approved:   "bg-indigo-50 text-indigo-700 border border-indigo-200",
    sent:       "bg-gray-100 text-gray-600 border border-gray-200",
  };

  return (
    <>
      <DashboardHeader title="Dashboard" />
      <main className="flex-1 p-8 space-y-8 bg-background">

        {/* Chapter label */}
        <div>
          <div className="flex items-center gap-3 text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase mb-3">
            <div className="h-px w-8 bg-border" />
            <span>Overview</span>
          </div>
          <div className="h-px bg-border" />
        </div>

        {/* ── Onboarding checklist (hides once all 3 steps are complete) ── */}
        {!onboardingDone && (
          <div className="bg-[#1847F5]/5 border border-[#1847F5]/20 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-semibold text-[#1a1209] text-sm">
                  Get set up in 3 steps
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {completedSteps} of 3 done — you&apos;re almost there.
                </p>
              </div>
              {/* Progress pills */}
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 w-8 rounded-full ${i < completedSteps ? "bg-[#1847F5]" : "bg-[#1847F5]/15"}`}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {[
                {
                  done:  gmailConnected,
                  icon:  Mail,
                  title: "Connect your Gmail",
                  desc:  "Link your inbox so incoming RFQ emails arrive here automatically.",
                  href:  "/inbox",
                  cta:   "Connect Gmail",
                },
                {
                  done:  hasSupplier,
                  icon:  Users,
                  title: "Add your first supplier",
                  desc:  "RFQs get split and sent to suppliers based on item categories.",
                  href:  "/suppliers",
                  cta:   "Add suppliers",
                },
                {
                  done:  hasProcessedRfq,
                  icon:  Sparkles,
                  title: "Process your first RFQ",
                  desc:  "Run the AI on any email to extract items and generate supplier messages.",
                  href:  "/inbox",
                  cta:   "Open inbox",
                },
              ].map((step) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.title}
                    className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${step.done ? "bg-green-50/50" : "bg-card hover:bg-card/80"}`}
                  >
                    {/* Status circle */}
                    <div className="shrink-0">
                      {step.done
                        ? <CheckCircle className="w-5 h-5 text-green-500" />
                        : <Circle      className="w-5 h-5 text-[#1847F5]/30" />}
                    </div>

                    {/* Icon */}
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${step.done ? "bg-green-100" : "bg-[#1847F5]/10"}`}>
                      <Icon className={`w-4 h-4 ${step.done ? "text-green-600" : "text-[#1847F5]"}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold text-sm ${step.done ? "text-green-700 line-through decoration-1" : "text-[#1a1209]"}`}>
                        {step.title}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{step.desc}</p>
                    </div>

                    {/* CTA — hidden once done */}
                    {!step.done && (
                      <Link
                        href={step.href}
                        className="shrink-0 flex items-center gap-1.5 bg-[#1847F5] hover:bg-[#0f35d4] text-white text-xs font-semibold px-3.5 py-2 rounded-full shadow-[0_2px_8px_rgba(24,71,245,0.3)] transition-all whitespace-nowrap"
                      >
                        {step.cta} <ArrowRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stats — gap-px grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border rounded-2xl overflow-hidden">
          {stats.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="bg-card hover:bg-accent/40 transition-colors p-7 flex flex-col gap-4 group"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">{s.num}</span>
                <s.icon className="w-4 h-4 text-muted-foreground group-hover:text-[#1847F5] transition-colors" />
              </div>
              <div>
                <p
                  className="text-[44px] font-black text-card-foreground leading-none mb-1 group-hover:text-[#1847F5] transition-colors"
                  style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
                >
                  {s.value}
                </p>
                <p className="text-sm text-muted-foreground font-medium">{s.label}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Recent RFQs */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">

          {/* Section header — chapter label style */}
          <div className="flex items-center justify-between px-7 py-5 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="h-3.5 w-px bg-[#1847F5]" />
              <h2 className="font-semibold text-card-foreground text-sm tracking-tight">Recent RFQs</h2>
            </div>
            <Link
              href="/rfqs"
              className="text-xs text-muted-foreground hover:text-[#1847F5] flex items-center gap-1 transition-colors font-medium"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {!recentRfqs || recentRfqs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FileText className="w-8 h-8 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground font-medium text-sm">No RFQs yet</p>
              <p className="text-muted-foreground/70 text-xs mt-1 mb-5">Upload your first RFQ to get started</p>
              <Link
                href="/rfqs/upload"
                className="bg-[#1847F5] hover:bg-[#0f35d4] text-white text-xs font-semibold px-5 py-2.5 rounded-full transition-colors shadow-[0_2px_8px_rgba(24,71,245,0.35)]"
              >
                Upload RFQ
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["RFQ Code", "Buyer", "Status", "Priority", "Date"].map((h) => (
                    <th key={h} className="px-7 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentRfqs.map((rfq) => (
                  <tr key={rfq.id} className="hover:bg-accent/40 transition-colors">
                    <td className="px-7 py-4 font-semibold text-[#1847F5]">
                      <Link href={`/rfqs/${rfq.id}`} className="hover:underline underline-offset-2">
                        {rfq.rfq_code}
                      </Link>
                    </td>
                    <td className="px-7 py-4 text-muted-foreground">{rfq.buyer_name ?? "—"}</td>
                    <td className="px-7 py-4">
                      <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${statusStyle[rfq.status] ?? "bg-muted text-muted-foreground border border-border"}`}>
                        {rfq.status}
                      </span>
                    </td>
                    <td className="px-7 py-4">
                      {rfq.priority === "urgent" && (
                        <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold bg-red-50 text-red-700 border border-red-200">urgent</span>
                      )}
                    </td>
                    <td className="px-7 py-4 text-muted-foreground/70 whitespace-nowrap text-xs">
                      <p className="font-medium text-muted-foreground">{new Date(rfq.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
                      <p>{new Date(rfq.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
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
