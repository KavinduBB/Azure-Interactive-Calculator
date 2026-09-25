import type { AzureResource } from "./types";

export interface WhatIfOption {
  label: string;
  apply: (r: AzureResource) => AzureResource;
}

const clone = (r: AzureResource): AzureResource => JSON.parse(JSON.stringify(r));

const VM_SIZES = [
  "Standard_B1s", "Standard_B2s", "Standard_B2ms", "Standard_B4ms",
  "Standard_D2as_v5", "Standard_D4as_v5", "Standard_D8as_v5",
  "Standard_D2s_v5", "Standard_D4s_v5", "Standard_D8s_v5",
  "Standard_D2ds_v5", "Standard_D4ds_v5", "Standard_D8ds_v5",
  "Standard_E2s_v5", "Standard_E4s_v5", "Standard_F2s_v2", "Standard_F4s_v2",
];
const PLAN_SKUS: [string, string][] = [
  ["F1", "Free"], ["B1", "Basic"], ["B2", "Basic"], ["B3", "Basic"],
  ["S1", "Standard"], ["S2", "Standard"], ["S3", "Standard"],
  ["P0v3", "PremiumV3"], ["P1v3", "PremiumV3"], ["P2v3", "PremiumV3"], ["P3v3", "PremiumV3"],
];
const SQL_OPTIONS: { label: string; sku: NonNullable<AzureResource["sku"]> }[] = [
  { label: "Basic (5 DTU)", sku: { name: "Basic", tier: "Basic", capacity: 5 } },
  { label: "Standard S0", sku: { name: "S0", tier: "Standard", capacity: 10 } },
  { label: "Standard S1", sku: { name: "S1", tier: "Standard", capacity: 20 } },
  { label: "Standard S2", sku: { name: "S2", tier: "Standard", capacity: 50 } },
  { label: "Standard S3", sku: { name: "S3", tier: "Standard", capacity: 100 } },
  { label: "Premium P1", sku: { name: "P1", tier: "Premium", capacity: 125 } },
  { label: "General Purpose 2 vCore", sku: { name: "GP_Gen5", tier: "GeneralPurpose", family: "Gen5", capacity: 2 } },
  { label: "General Purpose 4 vCore", sku: { name: "GP_Gen5", tier: "GeneralPurpose", family: "Gen5", capacity: 4 } },
  { label: "General Purpose 8 vCore", sku: { name: "GP_Gen5", tier: "GeneralPurpose", family: "Gen5", capacity: 8 } },
];
const DISK_SKUS = ["Standard_LRS", "StandardSSD_LRS", "Premium_LRS"];

/** SKU changes worth comparing for a resource. Empty when the type has no what-if options. */
export function whatIfOptions(r: AzureResource): WhatIfOption[] {
  switch (r.type) {
    case "microsoft.compute/virtualmachines": {
      const current = (r.properties.hardwareProfile as { vmSize?: string } | undefined)?.vmSize;
      const opts: WhatIfOption[] = [
        {
          label: "Deallocate (stop compute billing)",
          apply: (x) => {
            const c = clone(x);
            c.properties.extended = { instanceView: { powerState: { code: "PowerState/deallocated" } } };
            return c;
          },
        },
      ];
      for (const s of VM_SIZES.filter((s) => s !== current)) {
        opts.push({
          label: s.replace("Standard_", ""),
          apply: (x) => {
            const c = clone(x);
            c.properties.hardwareProfile = { ...(c.properties.hardwareProfile as object), vmSize: s };
            c.properties.extended = { instanceView: { powerState: { code: "PowerState/running" } } };
            return c;
          },
        });
      }
      return opts;
    }
    case "microsoft.web/serverfarms":
      return PLAN_SKUS.filter(([n]) => n !== r.sku?.name).map(([name, tier]) => ({
        label: `${name} (${tier})`,
        apply: (x) => {
          const c = clone(x);
          c.sku = { ...(c.sku ?? {}), name, tier, capacity: Math.max(1, c.sku?.capacity ?? 1) };
          return c;
        },
      }));
    case "microsoft.sql/servers/databases":
      if (r.name === "master") return [];
      return SQL_OPTIONS.map((o) => ({
        label: o.label,
        apply: (x) => {
          const c = clone(x);
          c.sku = { ...o.sku };
          c.kind = "v12.0,user";
          return c;
        },
      }));
    case "microsoft.compute/disks":
      return DISK_SKUS.filter((s) => s !== r.sku?.name).map((s) => ({
        label: s.replace("_", " "),
        apply: (x) => {
          const c = clone(x);
          c.sku = { name: s };
          return c;
        },
      }));
    default:
      return [];
  }
}
