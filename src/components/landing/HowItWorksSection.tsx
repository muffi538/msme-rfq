import AnimateIn from "./AnimateIn";

const steps = [
  {
    num: "01",
    title: "Email arrives",
    desc: "Buyer sends you an RFQ via email. n8n picks it up automatically — no manual checking needed.",
    detail: "PDF · Excel · Image · Email body",
  },
  {
    num: "02",
    title: "AI reads the attachment",
    desc: "Every item, quantity, unit, and spec is extracted and cleaned up. Hindi, Hinglish, abbreviations — all handled.",
    detail: "OCR · LLM normalization · 12 categories",
  },
  {
    num: "03",
    title: "Items are categorised",
    desc: "Each item is mapped to one of 12 categories using a keyword engine first, AI fallback for ambiguous items.",
    detail: "Keyword pass → LLM fallback → per-tenant cache",
  },
  {
    num: "04",
    title: "Suppliers are matched",
    desc: "For each category, the right suppliers from your database are found. One outgoing RFQ per supplier.",
    detail: "Split by category × supplier",
  },
  {
    num: "05",
    title: "You review & approve",
    desc: "Edit items, fix categories, select suppliers — then approve all with one click. You stay in control.",
    detail: "Approval queue · editable table · one-click send",
  },
  {
    num: "06",
    title: "Sent via WhatsApp",
    desc: "Each supplier receives a clean formatted message with only their items. Email fallback if no WhatsApp.",
    detail: "AiSensy · SMTP fallback · delivery tracking",
  },
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-32 px-6 bg-gray-950">
      <div className="max-w-5xl mx-auto">

        {/* Heading */}
        <AnimateIn className="text-center mb-16">
          <p className="text-sm font-semibold text-blue-400 uppercase tracking-widest mb-3">Process</p>
          <h2 className="text-4xl sm:text-5xl font-black text-white tracking-tight mb-5">
            Six steps. Fully automated.
          </h2>
          <p className="text-gray-400 text-lg">You stay in control at step 5. Everything else is hands-free.</p>
        </AnimateIn>

        {/* Steps */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[28px] top-0 bottom-0 w-px bg-gradient-to-b from-blue-600/60 via-blue-600/30 to-transparent hidden sm:block" />

          <div className="space-y-3">
            {steps.map((step, i) => (
              <AnimateIn key={step.num} delay={i * 90} animation="slide-right">
                <div className="group flex gap-6 p-5 rounded-2xl hover:bg-white/5 transition-colors">
                  {/* Number bubble */}
                  <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-blue-600/10 border border-blue-600/20 flex items-center justify-center group-hover:bg-blue-600/20 group-hover:border-blue-600/40 transition-colors">
                    <span className="text-blue-400 font-black text-sm">{step.num}</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <h3 className="font-bold text-white text-[15px] tracking-tight mb-1">{step.title}</h3>
                        <p className="text-gray-400 text-sm leading-relaxed max-w-md">{step.desc}</p>
                      </div>
                      <span className="flex-shrink-0 text-[11px] text-blue-400/80 bg-blue-600/10 border border-blue-600/20 px-2.5 py-1 rounded-lg font-medium whitespace-nowrap">
                        {step.detail}
                      </span>
                    </div>
                  </div>
                </div>
              </AnimateIn>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
