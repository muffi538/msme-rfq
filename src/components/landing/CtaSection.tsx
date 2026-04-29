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
      {/* Stats strip */}
      <section className="bg-[#f5ede0] border-y border-[#e0d5c5] py-20 px-8 md:px-16">
        <div className="max-w-7xl mx-auto">

          <AnimateIn animation="fade-up">
            <div className="flex items-center gap-4 text-[11px] font-semibold tracking-[0.15em] text-[#9a8674] uppercase mb-4">
              <div className="h-px w-12 bg-[#c5b5a0]" />
              <span>Chapter 04 — The Numbers</span>
            </div>
            <div className="h-px bg-[#e0d5c5] mb-14" />
          </AnimateIn>

          <AnimateIn animation="fade-up" delay={60}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#e0d5c5] border border-[#e0d5c5] rounded-2xl overflow-hidden">
              {PROOF.map((p) => (
                <div key={p.stat} className="bg-[#f5ede0] px-8 py-8 text-center">
                  <p
                    className="text-[42px] sm:text-[52px] font-black text-[#1a1209] leading-none mb-2"
                    style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
                  >
                    {p.stat}
                  </p>
                  <p className="text-xs text-[#9a8674] font-medium uppercase tracking-widest">{p.label}</p>
                </div>
              ))}
            </div>
          </AnimateIn>
        </div>
      </section>

      {/* CTA */}
      <section className="relative bg-[#1a1209] py-36 px-8 md:px-16 overflow-hidden">

        {/* Dot grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        {/* Blue glow */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px]"
          style={{ background: "radial-gradient(ellipse at center, rgba(24,71,245,0.15) 0%, transparent 70%)" }} />

        <div className="relative max-w-7xl mx-auto">

          <AnimateIn animation="fade-up">
            <div className="flex items-center gap-4 text-[11px] font-semibold tracking-[0.15em] text-[#3a2e20] uppercase mb-4">
              <div className="h-px w-12 bg-[#2e2518]" />
              <span>Start today — free</span>
            </div>
            <div className="h-px bg-[#2e2518] mb-16" />
          </AnimateIn>

          <div className="grid lg:grid-cols-2 gap-16 items-end">
            <AnimateIn animation="fade-up" delay={80}>
              <h2
                className="text-[clamp(44px,6vw,88px)] font-black text-[#faf4eb] leading-[0.92] tracking-tight"
                style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
              >
                Your procurement team deserves{" "}
                <em
                  className="text-[#1847F5]"
                  style={{ fontStyle: "italic" }}
                >
                  better tools.
                </em>
              </h2>
            </AnimateIn>

            <AnimateIn animation="fade-up" delay={160}>
              <div>
                <p className="text-[#7a6a55] text-lg leading-relaxed mb-10">
                  Join MSME procurement teams already saving 20+ hours a week.
                  Set up in 5 minutes. No credit card required.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Link
                    href="/signup"
                    className="inline-flex items-center justify-center gap-2.5 px-8 py-4 bg-[#faf4eb] text-[#1a1209] font-bold rounded-full text-sm hover:bg-white transition-all hover:shadow-2xl hover:-translate-y-0.5"
                  >
                    Create your free account <ArrowRight className="w-4 h-4" />
                  </Link>
                  <Link
                    href="/login"
                    className="inline-flex items-center justify-center px-8 py-4 border border-[#2e2518] text-[#7a6a55] font-semibold rounded-full text-sm hover:border-[#5a4e3f] hover:text-[#faf4eb] transition-all"
                  >
                    Already have an account
                  </Link>
                </div>
              </div>
            </AnimateIn>
          </div>

        </div>
      </section>
    </>
  );
}
