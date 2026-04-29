import Link from "next/link";
import { ArrowRight, Zap } from "lucide-react";

const MOCK_ITEMS = [
  { name: "Drill Machine 13mm",  qty: "5 pcs",  category: "POWER TOOLS",  color: "bg-orange-100 text-orange-700" },
  { name: "M8 Hex Bolt × 100",   qty: "2 box",  category: "FASTENERS",    color: "bg-blue-100 text-blue-700" },
  { name: "PVC Elbow 2\"",        qty: "20 pcs", category: "SANITARY",     color: "bg-cyan-100 text-cyan-700" },
  { name: "LED Panel 18W",        qty: "10 pcs", category: "ELECTRICAL",   color: "bg-yellow-100 text-yellow-700" },
];

const STATS = [
  { value: "30 min",  label: "saved per RFQ" },
  { value: "85%+",    label: "auto-accuracy" },
  { value: "12",      label: "categories handled" },
];

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col justify-center overflow-hidden bg-white pt-16">

      {/* Subtle grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: "linear-gradient(#000 1px,transparent 1px),linear-gradient(90deg,#000 1px,transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Blue glow blob */}
      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-blue-600/8 blur-[80px]" />

      <div className="relative max-w-6xl mx-auto px-6 py-20 w-full">
        <div className="flex flex-col items-center text-center gap-8">

          {/* Badge */}
          <div className="animate-fade-up inline-flex items-center gap-2 border border-blue-200 bg-blue-50 text-blue-700 text-sm font-medium px-4 py-1.5 rounded-full">
            <Zap className="w-3.5 h-3.5 fill-blue-600 text-blue-600" />
            Built for Indian MSME procurement teams
          </div>

          {/* Headline */}
          <h1 className="animate-fade-up delay-100 max-w-3xl text-5xl sm:text-6xl lg:text-7xl font-black text-gray-950 tracking-tight leading-[1.05]">
            Stop spending{" "}
            <span className="relative inline-block">
              <span className="relative z-10 text-blue-600">2 hours</span>
              <span className="absolute bottom-1 left-0 right-0 h-3 bg-blue-100 rounded-sm -z-0" />
            </span>{" "}
            on every RFQ.
          </h1>

          {/* Subtext */}
          <p className="animate-fade-up delay-200 max-w-xl text-lg text-gray-500 leading-relaxed">
            Upload any RFQ — PDF, Excel, or WhatsApp screenshot. AI extracts
            every item, finds the right suppliers, and fires WhatsApp messages.
            Automatically.
          </p>

          {/* CTAs */}
          <div className="animate-fade-up delay-300 flex flex-col sm:flex-row gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5"
            >
              Get started free
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 text-base font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all"
            >
              See how it works
            </a>
          </div>

          {/* Stats */}
          <div className="animate-fade-up delay-400 flex items-center gap-8 pt-2">
            {STATS.map((s, i) => (
              <div key={i} className="text-center">
                <p className="text-2xl font-black text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-400 font-medium mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Product mockup */}
          <div className="animate-scale-in delay-500 w-full max-w-3xl mt-4 animate-float">
            <div className="rounded-2xl border border-gray-200 shadow-[0_20px_60px_rgba(0,0,0,0.12)] overflow-hidden">
              {/* Browser chrome */}
              <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center gap-3">
                <div className="flex gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-400/80" />
                  <span className="w-3 h-3 rounded-full bg-yellow-400/80" />
                  <span className="w-3 h-3 rounded-full bg-green-400/80" />
                </div>
                <div className="flex-1 mx-3 bg-white border border-gray-200 rounded-md px-3 py-1 text-xs text-gray-400 text-left truncate">
                  rfqflow.in/rfqs/RFQ-2026-95032
                </div>
              </div>

              {/* App content */}
              <div className="bg-white p-6">
                {/* Header row */}
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-gray-900 text-sm">RFQ-2026-95032</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Processed</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Urgent</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Sharma Hardware Traders · 4 items · 29 Apr 2026</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 font-medium hover:bg-gray-50">Split</button>
                    <button className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold">Approve All</button>
                  </div>
                </div>

                {/* Items table */}
                <div className="rounded-xl border border-gray-100 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-gray-400 uppercase tracking-wide border-b border-gray-100">
                        <th className="text-left px-4 py-2.5 font-medium">#</th>
                        <th className="text-left px-4 py-2.5 font-medium">Item</th>
                        <th className="text-left px-4 py-2.5 font-medium">Category</th>
                        <th className="text-left px-4 py-2.5 font-medium">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MOCK_ITEMS.map((item, i) => (
                        <tr key={i} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                          <td className="px-4 py-2.5 font-medium text-gray-800">{item.name}</td>
                          <td className="px-4 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${item.color}`}>
                              {item.category}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-500">{item.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Bottom bar */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-400">4 items · 3 suppliers matched · Ready to send</p>
                  <div className="flex gap-1.5">
                    <span className="text-[10px] px-2 py-1 rounded-md bg-orange-50 text-orange-600 font-medium border border-orange-100">WhatsApp ×3</span>
                    <span className="text-[10px] px-2 py-1 rounded-md bg-blue-50 text-blue-600 font-medium border border-blue-100">Email ×1</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p className="animate-fade-up delay-600 text-xs text-gray-400">
            No credit card · 5-minute setup · Works with your existing Tally
          </p>
        </div>
      </div>
    </section>
  );
}
