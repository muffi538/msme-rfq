"use client";

import { useEffect, useState } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

const DEFAULT_TEMPLATE = `Hello {supplier},

We have a new RFQ for you.
RFQ ID: {rfqCode}
Category: {category}

Items:
{items}

Please share your best rate, MOQ, and delivery time.
Reply to this message or email us back.

Thank you.`;

const DEFAULT_BUYER_REPLY = `Dear {customer},

Thank you for your enquiry. Please find our quotation below for your review:

{items}

Total: {totalPrice}
Delivery: {deliveryDays} days from order confirmation
Payment terms: {paymentTerms}
Validity: {validityDays} days

Please confirm the order or reach out for any clarifications.

Best regards,
{company}`;

export default function SettingsPage() {
  const [template,     setTemplate]     = useState(DEFAULT_TEMPLATE);
  const [buyerReply,   setBuyerReply]   = useState(DEFAULT_BUYER_REPLY);
  const [companyName,  setCompanyName]  = useState("");
  const [saving,       setSaving]       = useState(false);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.message_template)     setTemplate(data.message_template);
        if (data.buyer_reply_template) setBuyerReply(data.buyer_reply_template);
        if (data.company_name)         setCompanyName(data.company_name);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_template:     template,
          buyer_reply_template: buyerReply,
          company_name:         companyName,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Settings saved!");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DashboardHeader title="Settings" />
      <main className="flex-1 p-8 max-w-2xl mx-auto w-full">

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-6">

            {/* Company */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
              <h2 className="font-semibold text-gray-900">Company</h2>
              <div className="space-y-1.5">
                <Label>Company name</Label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Elemax Trading Co."
                />
                <p className="text-xs text-gray-400">Shown in the dashboard header</p>
              </div>
            </div>

            {/* Message template */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
              <div>
                <h2 className="font-semibold text-gray-900">WhatsApp Message Template</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Customise the message sent to suppliers. Use these placeholders:
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {["{supplier}", "{rfqCode}", "{category}", "{items}"].map((p) => (
                    <code key={p} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-mono">{p}</code>
                  ))}
                </div>
              </div>
              <textarea
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={14}
                className="w-full text-sm font-mono border border-gray-200 rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-gray-800"
              />
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Preview</p>
                <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">
                  {template
                    .replace("{supplier}", "Sharma Traders")
                    .replace("{rfqCode}", "RFQ-2026-12345")
                    .replace("{category}", "POWER TOOLS")
                    .replace("{items}", "1. Drill Machine — Qty: 5\n2. Angle Grinder — Qty: 3")}
                </pre>
              </div>
            </div>

            {/* Buyer reply email template */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
              <div>
                <h2 className="font-semibold text-gray-900">Buyer Reply Email Template</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Style guide the AI uses when drafting your reply to the original buyer (after a supplier quotation comes back).
                  Edit the structure to match how you talk to clients. Available placeholders:
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {["{customer}", "{items}", "{totalPrice}", "{deliveryDays}", "{paymentTerms}", "{validityDays}", "{company}"].map((p) => (
                    <code key={p} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-mono">{p}</code>
                  ))}
                </div>
              </div>
              <textarea
                value={buyerReply}
                onChange={(e) => setBuyerReply(e.target.value)}
                rows={14}
                className="w-full text-sm font-mono border border-gray-200 rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-gray-800"
              />
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Preview</p>
                <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">
                  {buyerReply
                    .replace("{customer}",     "Mr. Khan")
                    .replace("{items}",        "1. Drill Machine — Qty: 5 @ ₹3,200/unit\n2. Angle Grinder — Qty: 3 @ ₹2,800/unit")
                    .replace("{totalPrice}",   "₹24,400")
                    .replace("{deliveryDays}", "5")
                    .replace("{paymentTerms}", "50% advance, balance on dispatch")
                    .replace("{validityDays}", "15")
                    .replace("{company}",      companyName || "Your Company")}
                </pre>
              </div>
            </div>

            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base gap-2"
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Settings</>}
            </Button>
          </div>
        )}
      </main>
    </>
  );
}
