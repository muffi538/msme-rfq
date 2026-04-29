import Link from "next/link";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main>{children}</main>

      <footer className="bg-[#1a1209] border-t border-[#2e2518]">
        <div className="max-w-7xl mx-auto px-8 md:px-16 py-14">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">

            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-[#1847F5] rounded-md flex items-center justify-center shadow-[0_2px_8px_rgba(24,71,245,0.4)]">
                <span className="text-white font-black text-xs">R</span>
              </div>
              <span className="font-bold text-[#faf4eb] text-sm tracking-tight">RFQ Flow</span>
            </div>

            <div className="flex items-center gap-8 text-sm text-[#5a4e3f]">
              <a href="#features"     className="hover:text-[#faf4eb] transition-colors">Features</a>
              <a href="#how-it-works" className="hover:text-[#faf4eb] transition-colors">How it works</a>
              <Link href="/login"  className="hover:text-[#faf4eb] transition-colors">Log in</Link>
              <Link href="/signup" className="hover:text-[#faf4eb] transition-colors">Sign up</Link>
            </div>

            <p className="text-[#3a2e20] text-sm">
              © {new Date().getFullYear()} RFQ Flow
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
