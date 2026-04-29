import Navbar from "@/components/landing/Navbar";
import ScrollProgress from "@/components/landing/ScrollProgress";
import HeroSection from "@/components/landing/HeroSection";
import WhyUsSection from "@/components/landing/WhyUsSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import CtaSection from "@/components/landing/CtaSection";

export default function LandingPage() {
  return (
    <>
      <ScrollProgress />
      <Navbar />
      <HeroSection />
      <WhyUsSection />
      <HowItWorksSection />
      <CtaSection />
    </>
  );
}
