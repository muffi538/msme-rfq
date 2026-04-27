import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const companyName = user.user_metadata?.company_name ?? "your company";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <span className="text-white font-bold text-2xl">R</span>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Welcome, {companyName}!
        </h1>
        <p className="text-gray-500 text-lg">
          Your dashboard is being built. Phase 2 coming next.
        </p>
      </div>
    </div>
  );
}
