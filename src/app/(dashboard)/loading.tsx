export default function DashboardLoading() {
  return (
    <main className="flex-1 p-8 space-y-6 animate-pulse">
      <div className="h-6 w-40 bg-muted rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border rounded-2xl overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-card p-7 space-y-4">
            <div className="h-3 w-8 bg-muted rounded" />
            <div className="h-9 w-16 bg-muted rounded" />
            <div className="h-3 w-20 bg-muted rounded" />
          </div>
        ))}
      </div>
      <div className="bg-card border border-border rounded-2xl p-7 space-y-4">
        <div className="h-4 w-32 bg-muted rounded" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 w-full bg-muted/60 rounded-lg" />
        ))}
      </div>
    </main>
  );
}
