import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function Navbar() {
  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: "68px",
        display: "flex",
        alignItems: "center",
        backgroundColor: "rgba(250,244,235,0.96)",
        borderBottom: "1px solid #e0d5c5",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          maxWidth: "1280px",
          width: "100%",
          margin: "0 auto",
          padding: "0 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              backgroundColor: "#1847F5",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 8px rgba(24,71,245,0.4)",
            }}
          >
            <span style={{ color: "white", fontWeight: 900, fontSize: "14px" }}>P</span>
          </div>
          <span style={{ fontWeight: 700, color: "#1a1209", fontSize: "15px", letterSpacing: "-0.02em" }}>
            Procur.AI
          </span>
        </div>

        {/* Nav links */}
        <nav style={{ display: "flex", alignItems: "center", gap: "40px" }}>
          <a href="#features"     style={{ fontSize: "14px", color: "#7a6a55", textDecoration: "none" }}>Features</a>
          <a href="#how-it-works" style={{ fontSize: "14px", color: "#7a6a55", textDecoration: "none" }}>How it works</a>
        </nav>

        {/* CTAs */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <Link
            href="/login"
            style={{ fontSize: "14px", color: "#7a6a55", fontWeight: 500, textDecoration: "none" }}
          >
            Log in
          </Link>
          <Link
            href="/signup"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 20px",
              backgroundColor: "#1847F5",
              color: "white",
              fontSize: "14px",
              fontWeight: 700,
              borderRadius: "9999px",
              textDecoration: "none",
              boxShadow: "0 2px 12px rgba(24,71,245,0.45)",
            }}
          >
            Sign up free <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}
