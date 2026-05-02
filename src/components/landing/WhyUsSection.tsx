import AnimateIn from "./AnimateIn";

const features = [
  {
    num: "01",
    title: "30× faster processing",
    desc: "From email to supplier messages in under 2 minutes. No manual typing, no copy-paste, no missed items.",
  },
  {
    num: "02",
    title: "AI categorisation",
    desc: "Every item is automatically mapped to one of 12 categories — Power Tools, Fasteners, Electrical, and more.",
  },
  {
    num: "03",
    title: "Smart supplier split",
    desc: "Items are split by category and sent only to suppliers who deal in that product. No irrelevant messages.",
  },
  {
    num: "04",
    title: "WhatsApp automation",
    desc: "Each supplier gets a clean formatted RFQ on WhatsApp — exactly how Indian MSMEs actually transact.",
  },
  {
    num: "05",
    title: "Real-time tracking",
    desc: "See which suppliers have seen, replied to, or ignored your RFQ — all in one live dashboard.",
  },
  {
    num: "06",
    title: "You stay in control",
    desc: "Every RFQ passes through your approval queue before anything is sent. Nothing leaves without your sign-off.",
  },
];

export default function WhyUsSection() {
  return (
    <section id="features" className="relative bg-[#faf4eb] py-32 px-8 md:px-16 overflow-hidden">

      {/* Dot grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.13]"
        style={{
          backgroundImage: "radial-gradient(circle, #b5a491 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative max-w-7xl mx-auto">

        {/* Chapter label */}
        <AnimateIn animation="fade-up">
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-[0.15em] text-[#9a8674] uppercase mb-4">
            <div className="flex items-center gap-4">
              <div className="h-px w-12 bg-[#c5b5a0]" />
              <span>Chapter 02 — Why Procur.AI</span>
            </div>
          </div>
          <div className="h-px bg-[#e0d5c5] mb-16" />
        </AnimateIn>

        {/* Heading */}
        <AnimateIn animation="fade-up" delay={60}>
          <div className="max-w-3xl mb-20">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#d5c8b5] bg-[#f5ede0] text-[#7a6a55] text-xs font-semibold tracking-widest uppercase mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1847F5]" />
              Features
            </div>
            <h2
              className="text-[clamp(36px,5vw,72px)] font-black text-[#1a1209] leading-[0.95] tracking-tight"
              style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
            >
              Everything your team needs.{" "}
              <em
                className="text-[#9a8674]"
                style={{ fontStyle: "italic" }}
              >
                Nothing you don&apos;t.
              </em>
            </h2>
          </div>
        </AnimateIn>

        {/* Feature grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-[#e0d5c5] border border-[#e0d5c5] rounded-2xl overflow-hidden">
          {features.map((f, i) => (
            <AnimateIn key={f.num} animation="fade-up" delay={i * 60}>
              <div className="bg-[#faf4eb] hover:bg-[#f5ede0] transition-colors p-8 h-full group">
                <p
                  className="text-[52px] font-black text-[#e8ddd0] leading-none mb-5 group-hover:text-[#1847F5]/20 transition-colors"
                  style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
                >
                  {f.num}
                </p>
                <h3 className="font-bold text-[#1a1209] text-[15px] mb-3 tracking-tight">{f.title}</h3>
                <p className="text-[#7a6a55] text-sm leading-relaxed">{f.desc}</p>
              </div>
            </AnimateIn>
          ))}
        </div>

      </div>
    </section>
  );
}
