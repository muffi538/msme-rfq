import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f0e8] flex flex-col">
      <div className="p-6">
        <Link href="/" className="flex items-center gap-2 w-fit">
          <div
            style={{
              width: 32, height: 32,
              backgroundColor: "#1847F5",
              borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 8px rgba(24,71,245,0.4)",
            }}
          >
            <span style={{ color: "white", fontWeight: 900, fontSize: 14 }}>R</span>
          </div>
          <span className="font-bold text-[#1a1209] text-[15px] tracking-tight">RFQ Flow</span>
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        {children}
      </div>
    </div>
  );
}
