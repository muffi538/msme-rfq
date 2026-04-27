import Sidebar from "@/components/dashboard/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      {/* Main content — offset by sidebar width */}
      <div className="flex-1 flex flex-col ml-60 overflow-auto">
        {children}
      </div>
    </div>
  );
}
