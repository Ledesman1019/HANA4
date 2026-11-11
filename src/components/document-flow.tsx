import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FlowStep = {
  label: string;
  /** done = completado · current = lo que toca ahora · pending = aún no · failed = anulado o rechazado · skipped = no aplicó */
  state: "done" | "current" | "pending" | "failed" | "skipped";
  detail?: string;
};

/**
 * Flujo de documentos: en qué paso del proceso está una operación y qué falta.
 * (El equivalente al «flujo de documentos» de SAP.)
 */
export function DocumentFlow({ steps }: { steps: FlowStep[] }) {
  return (
    <ol className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-surface p-3 shadow-xs">
      {steps.map((step, i) => (
        <li key={step.label} className="flex min-w-28 flex-1 flex-col items-center px-1 text-center">
          <div className="flex w-full items-center">
            <span className={cn("h-0.5 flex-1", i === 0 ? "bg-transparent" : step.state === "pending" || step.state === "skipped" ? "bg-slate-200" : "bg-brand-500")} />
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                step.state === "done" && "bg-brand-600 text-white",
                step.state === "current" && "bg-surface text-link ring-2 ring-brand-500",
                step.state === "pending" && "bg-slate-100 text-slate-400",
                step.state === "skipped" && "border border-dashed border-slate-300 text-slate-400",
                step.state === "failed" && "bg-danger text-white",
              )}
            >
              {step.state === "done" ? <Check className="h-4 w-4" strokeWidth={3} /> : step.state === "failed" ? <X className="h-4 w-4" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("h-0.5 flex-1", i === steps.length - 1 ? "bg-transparent" : steps[i + 1].state === "pending" || steps[i + 1].state === "skipped" ? "bg-slate-200" : "bg-brand-500")} />
          </div>
          <p className={cn("mt-2 text-xs font-semibold", step.state === "pending" || step.state === "skipped" ? "text-slate-400" : "text-slate-900")}>{step.label}</p>
          {step.detail && <p className="tabular mt-0.5 text-[11px] leading-tight text-slate-500">{step.detail}</p>}
        </li>
      ))}
    </ol>
  );
}
