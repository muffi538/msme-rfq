const steps = [
  { num: "01", title: "Upload your RFQ", desc: "Drag and drop a PDF, Excel sheet, or photo — any format works." },
  { num: "02", title: "AI extracts items", desc: "Every item, quantity, and spec is pulled out and cleaned up automatically." },
  { num: "03", title: "Items get categorised", desc: "Each item is mapped to one of 12 categories by our AI engine." },
  { num: "04", title: "Suppliers are matched", desc: "We find which suppliers in your database handle each category." },
  { num: "05", title: "You review & approve", desc: "Check the split RFQs in your dashboard and hit approve when ready." },
  { num: "06", title: "Sent via WhatsApp", desc: "Each supplier gets a clean, formatted message with only their items." },
];

export default function HowItWorksSection() {
  return (
    <section className="py-24 px-6 bg-blue-50">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">How it works</h2>
          <p className="text-gray-500 text-lg">Six steps. Fully automated. You stay in control.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {steps.map((step) => (
            <div key={step.num} className="bg-white rounded-2xl p-6 border border-blue-100">
              <span className="text-3xl font-black text-blue-100">{step.num}</span>
              <h3 className="font-semibold text-gray-900 mt-2 mb-1">{step.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
