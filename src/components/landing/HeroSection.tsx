import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Play } from "lucide-react";

export default function HeroSection() {
  return (
    <section className="pt-32 pb-24 px-6 bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-4xl mx-auto text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 text-sm font-medium px-4 py-1.5 rounded-full mb-8">
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          Built for Indian MSMEs
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
          Turn RFQs into{" "}
          <span className="text-blue-600">supplier-ready quotes</span>{" "}
          in seconds
        </h1>

        {/* Subtext */}
        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
          Upload any RFQ — PDF, Excel, or photo. Our AI extracts every item,
          categorises it, matches the right suppliers, and sends WhatsApp
          messages. What used to take 2 hours now takes 2 minutes.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/signup">
            <Button size="lg" className="bg-blue-600 hover:bg-blue-700 text-white px-8 h-12 text-base font-semibold rounded-xl">
              Get Started Free
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
          <Button size="lg" variant="outline" className="border-blue-200 text-blue-700 hover:bg-blue-50 px-8 h-12 text-base font-semibold rounded-xl">
            <Play className="mr-2 w-4 h-4 fill-blue-600 text-blue-600" />
            Watch Demo
          </Button>
        </div>

        {/* Social proof */}
        <p className="mt-8 text-sm text-gray-400">
          No credit card required · Set up in 5 minutes · Works with your existing Tally
        </p>
      </div>
    </section>
  );
}
