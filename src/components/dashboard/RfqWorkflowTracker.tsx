"use client";

import { cn } from "@/lib/utils";
import type { WorkflowStepView } from "@/lib/rfq-lifecycle";

const dotStyle: Record<string, string> = {
  completed: "bg-green-500 ring-2 ring-green-100",
  current:   "bg-blue-600 ring-2 ring-blue-100",
  pending:   "bg-gray-200",
};

const lineStyle: Record<string, string> = {
  completed: "bg-green-300",
  current:   "bg-blue-200",
  pending:   "bg-gray-200",
};

export function RfqWorkflowTracker({
  steps,
  compact = false,
  showLabels = false,
}: {
  steps: WorkflowStepView[];
  compact?: boolean;
  showLabels?: boolean;
}) {
  return (
    <div
      className={cn("flex items-center min-w-0", compact ? "gap-0.5" : "gap-1")}
      role="list"
      aria-label="RFQ workflow progress"
    >
      {steps.map((step, i) => {
        const connector =
          step.state === "completed" && steps[i + 1]?.state !== "pending"
            ? "completed"
            : step.state === "current"
              ? "current"
              : "pending";

        return (
          <div key={step.id} className="flex items-center gap-0.5 flex-shrink-0" role="listitem">
            {i > 0 && (
              <div
                className={cn(compact ? "w-2 h-px" : "w-4 h-px", lineStyle[connector])}
                aria-hidden
              />
            )}
            <div
              className="flex flex-col items-center gap-0.5"
              title={`${step.label}: ${step.state}`}
            >
              <div className={cn(compact ? "w-2 h-2" : "w-2.5 h-2.5", "rounded-full flex-shrink-0", dotStyle[step.state])} />
              {showLabels && (
                <span
                  className={cn(
                    "text-[10px] leading-none whitespace-nowrap",
                    step.state === "completed" ? "text-green-700" :
                    step.state === "current" ? "text-blue-700 font-medium" :
                    "text-gray-400",
                    compact ? "hidden sm:inline" : "inline",
                  )}
                >
                  {step.short}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
