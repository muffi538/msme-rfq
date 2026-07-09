import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-white">
      <div className="max-w-md w-full text-center px-6">
        <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-gray-50 flex items-center justify-center">
          <FileQuestion className="w-6 h-6 text-gray-400" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 mb-1.5">Page not found</h1>
        <p className="text-sm text-gray-500 mb-6">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>
        <a
          href="/dashboard"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#1847F5] hover:bg-[#0f35d4] text-white text-sm font-semibold transition-colors"
        >
          Go to Dashboard
        </a>
      </div>
    </main>
  );
}
