import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function CtaSection() {
  return (
    <section className="py-24 px-6 bg-blue-600">
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-4xl font-bold text-white mb-4">
          Start processing RFQs now
        </h2>
        <p className="text-blue-100 text-lg mb-10">
          Join MSME procurement teams already saving 20+ hours a week.
          Free to start — no credit card needed.
        </p>
        <Link href="/signup">
          <Button
            size="lg"
            className="bg-white text-blue-600 hover:bg-blue-50 px-10 h-12 text-base font-semibold rounded-xl"
          >
            Create your free account
            <ArrowRight className="ml-2 w-4 h-4" />
          </Button>
        </Link>
      </div>
    </section>
  );
}
