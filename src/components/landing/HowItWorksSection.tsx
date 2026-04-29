import AnimateIn from "./AnimateIn";

const steps = [
  {
    num: "01",
    title: "Email arrives",
    desc: "Buyer sends you an RFQ via email. Picked up automatically — no manual checking needed.",
    tag: "PDF · Excel · Image · Email body",
  },
  {
    num: "02",
    title: "AI reads the attachment",
    desc: "Every item, quantity, unit, and spec is extracted and cleaned up. Hindi, Hinglish, abbreviations — all handled.",
    tag: "OCR · LLM normalization",
  },
  {
    num: "03",
    title: "Items are categorised",
    desc: "Each item is mapped to one of 12 categories using a keyword engine first, AI fallback for ambiguous items.",
    tag: "12 categories · per-tenant cache",
  },
  {
    num: "04",
    title: "Suppliers are matched",
    desc: "For each category, the right suppliers from your database are found. One outgoing RFQ per supplier.",
    tag: "Split by category × supplier",
  },
  {
    num: "05",
    title: "You review & approve",
    desc: "Edit items, fix categories, select suppliers — then approve all with one click. You stay in control.",
    tag: "Approval queue · one-click send",
  },
  {
    num: "06",
    title: "Sent via WhatsApp",
    desc: "Each supplier receives a clean formatted message with only their items. Email fallback if no WhatsApp.",
    tag: "AiSensy · SMTP fallback",
  },
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="relative bg-[#1a1209] py-32 px-8 md:px-16 overflow-hidden">

      {/* Subtle dot grid on dark */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Warm glow */}
      <div className="pointer-events-none absolute top-0 left-0 w-[700px] h-[400px]"
        style={{ background: "radial-gradient(ellipse at 10% 10%, rgba(24,71,245,0.12) 0%, transparent 65%)" }} />
      <div className="pointer-events-none absolute bottom-0 right-0 w-[500px] h-[400px]"
        style={{ background: "radial-gradient(ellipse at 90% 90%, rgba(255,185,100,0.06) 0%, transparent 65%)" }} />

      <div className="relative max-w-7xl mx-auto">

        {/* Chapter label */}
        <AnimateIn animation="fade-up">
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-[0.15em] text-[#5a4e3f] uppercase mb-4">
            <div className="flex items-center gap-4">
              <div className="h-px w-12 bg-[#3a2e20]" />
              <span>Chapter 03 — The Process</span>
            </div>
            <div className="flex items-center gap-4">
              <span>Six steps. Fully automated.</span>
              <div className="h-px w-12 bg-[#3a2e20]" />
            </div>
          </div>
          <div className="h-px bg-[#2e2518] mb-16" />
        </AnimateIn>

        {/* Heading */}
        <AnimateIn animation="fade-up" delay={60}>
          <div className="max-w-3xl mb-20">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#2e2518] bg-[#231c11] text-[#7a6a55] text-xs font-semibold tracking-widest uppercase mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1847F5]" />
              Process
            </div>
            <h2
              className="text-[clamp(36px,5vw,72px)] font-black text-[#faf4eb] leading-[0.95] tracking-tight"
              style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
            >
              You stay in control{" "}
              <em
                className="text-[#5a4e3f]"
                style={{ fontStyle: "italic" }}
              >
                at step five.
              </em>
              <br />Everything else is hands-free.
            </h2>
          </div>
        </AnimateIn>

        {/* Steps */}
        <div className="space-y-0 divide-y divide-[#2e2518] border-y border-[#2e2518]">
          {steps.map((step, i) => (
            <AnimateIn key={step.num} animation="slide-right" delay={i * 70}>
              <div className="flex items-start gap-8 py-7 group hover:bg-[#1f1810] transition-colors px-2 rounded-xl -mx-2">
                {/* Number */}
                <p
                  className="flex-shrink-0 text-[40px] font-black text-[#2e2518] leading-none w-16 group-hover:text-[#1847F5]/30 transition-colors"
                  style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
                >
                  {step.num}
                </p>
                {/* Content */}
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-start justify-between gap-6 flex-wrap">
                    <div>
                      <h3 className="font-bold text-[#faf4eb] text-base mb-1.5 tracking-tight">{step.title}</h3>
                      <p className="text-[#7a6a55] text-sm leading-relaxed max-w-lg">{step.desc}</p>
                    </div>
                    <span className="flex-shrink-0 text-[11px] text-[#5a4e3f] bg-[#231c11] border border-[#2e2518] px-3 py-1.5 rounded-full font-medium whitespace-nowrap">
                      {step.tag}
                    </span>
                  </div>
                </div>
              </div>
            </AnimateIn>
          ))}
        </div>

      </div>
    </section>
  );
}
