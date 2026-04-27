import { Zap, Brain, Package, MessageCircle, Clock, ShieldCheck } from "lucide-react";

const cards = [
  {
    icon: Zap,
    title: "Fast RFQ Processing",
    description: "From email to supplier messages in under 2 minutes. No more manual typing or copy-pasting.",
    color: "bg-yellow-50 text-yellow-600",
  },
  {
    icon: Brain,
    title: "AI Categorisation",
    description: "Every item is automatically mapped to the right category — Power Tools, Fasteners, Electrical, and 9 more.",
    color: "bg-purple-50 text-purple-600",
  },
  {
    icon: Package,
    title: "Smart Supplier Matching",
    description: "Items are split by category and routed to only the suppliers who deal in that product.",
    color: "bg-blue-50 text-blue-600",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp Automation",
    description: "Each supplier gets a clean, formatted RFQ on WhatsApp — the way Indian MSMEs actually communicate.",
    color: "bg-green-50 text-green-600",
  },
  {
    icon: Clock,
    title: "Real-time Status Tracking",
    description: "See which suppliers have seen, replied to, or ignored your RFQ — all in one dashboard.",
    color: "bg-orange-50 text-orange-600",
  },
  {
    icon: ShieldCheck,
    title: "Human Approval Step",
    description: "Every RFQ goes through your approval queue before sending — so nothing leaves without your say.",
    color: "bg-red-50 text-red-600",
  },
];

export default function WhyUsSection() {
  return (
    <section className="py-24 px-6 bg-white">
      <div className="max-w-6xl mx-auto">
        {/* Heading */}
        <div className="text-center mb-14">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Everything your procurement team needs
          </h2>
          <p className="text-gray-500 text-lg max-w-xl mx-auto">
            Built specifically for hardware and industrial MSME trading companies in India.
          </p>
        </div>

        {/* Cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {cards.map((card) => (
            <div
              key={card.title}
              className="p-6 rounded-2xl border border-gray-100 hover:border-blue-100 hover:shadow-md transition-all bg-white"
            >
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${card.color}`}>
                <card.icon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-gray-900 text-lg mb-2">{card.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{card.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
