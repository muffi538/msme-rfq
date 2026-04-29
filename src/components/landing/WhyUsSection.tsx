import { Zap, Brain, Package, MessageCircle, Clock, ShieldCheck } from "lucide-react";
import AnimateIn from "./AnimateIn";

const cards = [
  {
    icon: Zap,
    title: "30× faster processing",
    description: "From email to supplier messages in under 2 minutes. No manual typing, no copy-paste, no missed items.",
    accent: "bg-amber-50 text-amber-600 border-amber-100",
    border: "hover:border-amber-200",
  },
  {
    icon: Brain,
    title: "AI categorisation",
    description: "Every item is automatically mapped to one of 12 categories — Power Tools, Fasteners, Electrical, and more.",
    accent: "bg-violet-50 text-violet-600 border-violet-100",
    border: "hover:border-violet-200",
  },
  {
    icon: Package,
    title: "Smart supplier split",
    description: "Items are split by category and sent only to suppliers who deal in that product. No irrelevant messages.",
    accent: "bg-blue-50 text-blue-600 border-blue-100",
    border: "hover:border-blue-200",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp automation",
    description: "Each supplier gets a clean formatted RFQ on WhatsApp — exactly how Indian MSMEs actually transact.",
    accent: "bg-green-50 text-green-600 border-green-100",
    border: "hover:border-green-200",
  },
  {
    icon: Clock,
    title: "Real-time tracking",
    description: "See which suppliers have seen, replied to, or ignored your RFQ — all in one live dashboard.",
    accent: "bg-orange-50 text-orange-600 border-orange-100",
    border: "hover:border-orange-200",
  },
  {
    icon: ShieldCheck,
    title: "You stay in control",
    description: "Every RFQ passes through your approval queue before anything is sent. Nothing leaves without your sign-off.",
    accent: "bg-rose-50 text-rose-600 border-rose-100",
    border: "hover:border-rose-200",
  },
];

export default function WhyUsSection() {
  return (
    <section id="features" className="py-32 px-6 bg-white">
      <div className="max-w-6xl mx-auto">

        {/* Heading */}
        <AnimateIn className="text-center mb-16">
          <p className="text-sm font-semibold text-blue-600 uppercase tracking-widest mb-3">Features</p>
          <h2 className="text-4xl sm:text-5xl font-black text-gray-950 tracking-tight mb-5">
            Everything your team needs.
            <br />
            <span className="text-gray-400">Nothing you don&apos;t.</span>
          </h2>
          <p className="text-gray-500 text-lg max-w-lg mx-auto">
            Built specifically for hardware and industrial MSME trading companies in India.
          </p>
        </AnimateIn>

        {/* Cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card, i) => (
            <AnimateIn key={card.title} delay={i * 80} animation="fade-up">
              <div
                className={`group h-full p-7 rounded-2xl border border-gray-100 ${card.border} bg-white transition-all duration-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 cursor-default`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-5 border ${card.accent}`}>
                  <card.icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-gray-900 text-[15px] mb-2 tracking-tight">{card.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{card.description}</p>
              </div>
            </AnimateIn>
          ))}
        </div>
      </div>
    </section>
  );
}
