import Navbar from "@/components/landing/Navbar";
import Link from "next/link";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <main>{children}</main>
      <footer className="bg-gray-950 border-t border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center">
                <span className="text-white font-black text-xs">R</span>
              </div>
              <span className="font-bold text-white text-sm tracking-tight">RFQ Flow</span>
            </div>

            {/* Links */}
            <div className="flex items-center gap-6 text-sm text-gray-500">
              <a href="#features"     className="hover:text-gray-300 transition-colors">Features</a>
              <a href="#how-it-works" className="hover:text-gray-300 transition-colors">How it works</a>
              <Link href="/login"  className="hover:text-gray-300 transition-colors">Log in</Link>
              <Link href="/signup" className="hover:text-gray-300 transition-colors">Sign up</Link>
            </div>

            {/* Copy */}
            <p className="text-gray-600 text-sm">
              © {new Date().getFullYear()} RFQ Flow
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
