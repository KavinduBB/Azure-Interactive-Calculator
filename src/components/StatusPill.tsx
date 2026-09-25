import type { ResourceEstimate } from "@/lib/types";
import { estimateLabel } from "@/lib/format";

const STYLE: Record<ResourceEstimate["status"], string> = {
  priced: "bg-accent-soft text-ink",
  usage: "bg-warn-soft text-warn",
  free: "bg-good-soft text-good",
  stopped: "bg-panel-2 text-muted border border-line",
  unknown: "bg-panel-2 text-muted border border-dashed border-line-strong",
};

export function StatusPill({ estimate, currency }: { estimate?: ResourceEstimate; currency: string }) {
  const cls = estimate ? STYLE[estimate.status] : STYLE.unknown;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular whitespace-nowrap ${cls}`}>
      {estimateLabel(estimate, currency)}
    </span>
  );
}
