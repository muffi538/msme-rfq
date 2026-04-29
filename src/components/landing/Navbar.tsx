"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-[#faf4eb]/95 backdrop-blur-md border-b border-[#e0d5c5] shadow-[0_1px_24px_rgba(26,18,9,0.06)]"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-8 h-[68px] flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-[#1847F5] rounded-lg flex items-center justify-center shadow-[0_2px_8px_rgba(24,71,245,0.4)]">
            <span className="text-white font-black text-sm">R</span>
          </div>
          <span className="font-bold text-[#1a1209] text-[15px] tracking-tight">RFQ Flow</span>
        </div>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-10">
          {[
            { href: "#features",     label: "Features" },
            { href: "#how-it-works", label: "How it works" },
          ].map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="text-sm text-[#7a6a55] hover:text-[#1a1209] transition-colors"
            >
              {label}
            </a>
          ))}
        </nav>

        {/* CTAs */}
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden sm:block text-sm text-[#7a6a55] hover:text-[#1a1209] font-medium transition-colors"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1847F5] text-white text-sm font-semibold rounded-full hover:bg-[#0f35d4] transition-all hover:shadow-[0_4px_16px_rgba(24,71,245,0.4)] hover:-translate-y-0.5"
          >
            Sign up now <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
