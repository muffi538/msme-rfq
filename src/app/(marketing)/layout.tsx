import Navbar from "@/components/landing/Navbar";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <main>{children}</main>
      <footer className="bg-gray-900 text-gray-400 text-sm text-center py-6">
        © {new Date().getFullYear()} RFQ Flow · Built for Indian MSMEs
      </footer>
    </>
  );
}
