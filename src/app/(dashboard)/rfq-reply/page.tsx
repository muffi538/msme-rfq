import DashboardHeader from "@/components/dashboard/DashboardHeader";
import RfqReplyClient from "@/components/dashboard/RfqReplyClient";

export default function RfqReplyPage() {
  return (
    <>
      <DashboardHeader title="RFQ Reply" />
      <main className="flex-1 p-8">
        <RfqReplyClient />
      </main>
    </>
  );
}
