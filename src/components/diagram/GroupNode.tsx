"use client";

import type { NodeProps } from "@xyflow/react";
import { memo } from "react";
import { FolderOpen } from "lucide-react";
import type { GroupData } from "@/lib/graph";
import { money } from "@/lib/format";

function GroupNodeImpl({ data }: NodeProps) {
  const d = data as GroupData & { currency: string };
  return (
    <div className="h-full w-full rounded-xl border border-line-strong/70 bg-panel-2/60">
      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold">
            <FolderOpen size={14} className="text-muted" aria-hidden="true" />
            <span className="truncate">{d.label}</span>
          </div>
          <div className="truncate text-[11.5px] text-muted">{d.subtitle}</div>
        </div>
        {d.total > 0 && (
          <div className="shrink-0 text-right">
            <div className="text-[13px] font-semibold tabular">{money(d.total, d.currency)}</div>
            <div className="text-[11px] text-muted">per month</div>
          </div>
        )}
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeImpl);
