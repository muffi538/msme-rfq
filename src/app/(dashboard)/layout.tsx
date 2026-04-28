import Sidebar from "@/components/dashboard/Sidebar";
import IdleTimeout from "@/components/dashboard/IdleTimeout";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-60 overflow-auto">
        {children}
      </div>
      <IdleTimeout />
    </div>
  );
}
