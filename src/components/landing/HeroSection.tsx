import Link from "next/link";
import { ArrowRight } from "lucide-react";
import AnimateIn from "./AnimateIn";

const STATS = [
  { value: "< 2 min",  label: "RFQ end-to-end" },
  { value: "85%+",     label: "extraction accuracy" },
  { value: "10–30×",   label: "daily throughput" },
  { value: "₹0",       label: "extra cost per message" },
];

export default function HeroSection() {
  return (
    <section className="relative min-h-screen bg-[#faf4eb] flex flex-col overflow-hidden">

      {/* Dot grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage: "radial-gradient(circle, #b5a491 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Gradient blobs */}
      <div className="pointer-events-none absolute top-0 left-0 w-[680px] h-[480px]"
        style={{ background: "radial-gradient(ellipse at 20% 30%, rgba(255,185,130,0.38) 0%, transparent 65%)" }} />
      <div className="pointer-events-none absolute top-0 right-0 w-[500px] h-[400px]"
        style={{ background: "radial-gradient(ellipse at 80% 10%, rgba(255,220,160,0.28) 0%, transparent 60%)" }} />
      <div className="pointer-events-none absolute top-20 left-1/3 w-[600px] h-[300px]"
        style={{ background: "radial-gradient(ellipse at 50% 30%, rgba(255,160,120,0.18) 0%, transparent 60%)" }} />

      {/* Chapter label strip */}
      <div className="relative mt-[68px] px-8 md:px-16 pt-16">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-[11px] font-semibold tracking-[0.15em] text-[#9a8674] uppercase">
          <div className="flex items-center gap-4">
            <div className="h-px w-12 bg-[#c5b5a0]" />
            <span>Chapter 01 — The Problem</span>
          </div>
          <div className="flex items-center gap-4">
            <span>India · 2026</span>
            <div className="h-px w-12 bg-[#c5b5a0]" />
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-4 h-px bg-[#e0d5c5]" />
      </div>

      {/* Main content */}
      <div className="relative flex-1 flex flex-col justify-center px-8 md:px-16 pt-16 pb-12">
        <div className="max-w-7xl mx-auto w-full">

          {/* Badge */}
          <AnimateIn animation="fade-up" delay={0}>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#d5c8b5] bg-[#f5ede0] text-[#7a6a55] text-xs font-semibold tracking-widest uppercase mb-10">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1847F5] flex-shrink-0" />
              Made for Indian MSME traders
            </div>
          </AnimateIn>

          {/* Display headline */}
          <AnimateIn animation="fade-up" delay={80}>
            <h1
              className="text-[clamp(52px,8.5vw,120px)] leading-[0.92] font-black tracking-tight text-[#1a1209] mb-6"
              style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
            >
              From inbox<br />
              to supplier.{" "}
              <em
                className="not-italic text-[#1847F5]"
                style={{ fontStyle: "italic", fontFamily: "var(--font-playfair), Georgia, serif" }}
              >
                Instantly.
              </em>
            </h1>
          </AnimateIn>

          {/* Subtext + CTAs */}
          <div className="flex flex-col lg:flex-row lg:items-end gap-10 mt-10">
            <AnimateIn animation="fade-up" delay={160} className="flex-1 max-w-lg">
              <p className="text-[#7a6a55] text-lg leading-relaxed mb-8">
                Paste an RFQ email. AI reads the items, splits by supplier category,
                and sends WhatsApp quotes — all in under 2 minutes.
                Your team stays in control at every step.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/signup"
                  className="inline-flex items-center gap-2.5 px-7 py-3.5 bg-[#1a1209] text-[#faf4eb] font-semibold rounded-full text-sm hover:bg-[#3a2a18] transition-all hover:shadow-xl hover:-translate-y-0.5"
                >
                  Start free today <ArrowRight className="w-4 h-4" />
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-2 px-7 py-3.5 border border-[#c5b5a0] text-[#5a4a35] font-semibold rounded-full text-sm hover:border-[#9a8674] hover:text-[#1a1209] transition-all"
                >
                  See how it works
                </a>
              </div>
            </AnimateIn>

            {/* Stats block */}
            <AnimateIn animation="fade-up" delay={240}>
              <div className="grid grid-cols-2 gap-px bg-[#e0d5c5] border border-[#e0d5c5] rounded-2xl overflow-hidden">
                {STATS.map((s) => (
                  <div key={s.label} className="bg-[#faf4eb] px-7 py-5">
                    <p
                      className="text-3xl font-black text-[#1a1209] leading-none mb-1"
                      style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
                    >
                      {s.value}
                    </p>
                    <p className="text-xs text-[#9a8674] font-medium uppercase tracking-wider">{s.label}</p>
                  </div>
                ))}
              </div>
            </AnimateIn>
          </div>

        </div>
      </div>

      {/* Bottom chapter rule */}
      <div className="relative px-8 md:px-16 pb-10">
        <div className="max-w-7xl mx-auto h-px bg-[#e0d5c5]" />
      </div>

    </section>
  );
}
