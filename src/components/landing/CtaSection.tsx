import Link from "next/link";
import { ArrowRight } from "lucide-react";
import AnimateIn from "./AnimateIn";

const PROOF = [
  { stat: "< 2 min",  label: "per RFQ end-to-end" },
  { stat: "85%+",     label: "item extraction accuracy" },
  { stat: "₹0",       label: "extra cost per message" },
  { stat: "10–30×",   label: "daily RFQ throughput" },
];

export default function CtaSection() {
  return (
    <>
      {/* Social proof strip */}
      <section className="py-16 px-6 bg-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto">
          <AnimateIn>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
              {PROOF.map((p) => (
                <div key={p.stat}>
                  <p className="text-3xl sm:text-4xl font-black text-gray-950 tracking-tight">{p.stat}</p>
                  <p className="text-sm text-gray-400 mt-1.5 font-medium">{p.label}</p>
                </div>
              ))}
            </div>
          </AnimateIn>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-32 px-6 overflow-hidden bg-blue-600">
        {/* Background pattern */}
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        {/* Glow */}
        <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-white/10 rounded-full blur-[80px]" />

        <div className="relative max-w-3xl mx-auto text-center">
          <AnimateIn>
            <p className="text-blue-200 text-sm font-semibold uppercase tracking-widest mb-5">
              Start today — free
            </p>
            <h2 className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-tight mb-6">
              Your procurement team<br />deserves better tools.
            </h2>
            <p className="text-blue-100 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
              Join MSME procurement teams already saving 20+ hours a week.
              Set up in 5 minutes. No credit card required.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-bold text-blue-600 bg-white hover:bg-blue-50 rounded-xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
              >
                Create your free account
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-white/90 hover:text-white border border-white/20 hover:border-white/40 rounded-xl transition-all hover:bg-white/10"
              >
                Already have an account
              </Link>
            </div>
          </AnimateIn>
        </div>
      </section>
    </>
  );
}
