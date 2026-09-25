"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { CategoryIcon } from "../CategoryIcon";
import { StatusPill } from "../StatusPill";
import { typeInfo } from "@/lib/catalog";
import { money } from "@/lib/format";
import type { AzureResource, ResourceEstimate } from "@/lib/types";

export interface ResourceNodeData extends Record<string, unknown> {
  resource: AzureResource;
  estimate?: ResourceEstimate;
  actual?: number;
  currency: string;
  actualCurrency?: string;
  whatIf?: number;
}

function ResourceNodeImpl({ data, selected }: NodeProps) {
  const d = data as ResourceNodeData;
  const info = typeInfo(d.resource.type);
  const sku = d.resource.sku?.name ?? (d.resource.properties?.hardwareProfile as { vmSize?: string } | undefined)?.vmSize;
  return (
    <div
      className={`flex h-[78px] w-[236px] items-center gap-2.5 rounded-lg border bg-panel px-2.5 shadow-sm transition-colors ${
        selected ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-line-strong"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />
      <CategoryIcon category={info.category} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold leading-tight" title={d.resource.name}>
          {d.resource.name}
        </div>
        <div className="truncate text-[11.5px] text-ink-2" title={info.label}>
          {info.label}
          {sku ? ` · ${String(sku).replace(/^Standard_/, "")}` : ""}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <StatusPill estimate={d.estimate} currency={d.currency} />
          {d.actual != null && (
            <span className="text-[11px] text-muted tabular" title="Actual cost this month to date">
              {money(d.actual, d.actualCurrency ?? d.currency)} MTD
            </span>
          )}
          {d.whatIf != null && (
            <span className="text-[11px] font-medium text-accent tabular" title="What-if price">
              → {money(d.whatIf, d.currency)}
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
    </div>
  );
}

export const ResourceNode = memo(ResourceNodeImpl);
