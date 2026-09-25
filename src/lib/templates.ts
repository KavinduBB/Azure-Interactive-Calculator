import { REGIONS, type Category } from "./catalog";
import type { AzureResource, ResourceEstimate } from "./types";

export type Config = Record<string, string | number>;

export interface Field {
  key: string;
  label: string;
  type: "select" | "number" | "text";
  options?: { value: string; label: string }[];
  min?: number;
  step?: number;
  suffix?: string;
  hint?: string;
}

export interface Template {
  id: string;
  label: string;
  category: Category;
  type: string;
  blurb: string;
  fields: Field[];
  defaults: Config;
  /** Builds the resource description the pricing engine understands. Omitted for manual items. */
  build?: (c: Config) => Partial<AzureResource>;
  /** Scales the engine's monthly price, e.g. VM count × hours. */
  multiplier?: (c: Config) => number;
  /** Manual price for items with no list price. */
  manual?: (c: Config) => number;
}

const opt = (values: string[], label = (v: string) => v) => values.map((v) => ({ value: v, label: label(v) }));
const region: Field = { key: "region", label: "Region", type: "select", options: REGIONS.map((r) => ({ value: r.name, label: r.label })) };
const n = (c: Config, k: string) => Number(c[k] ?? 0) || 0;
const s = (c: Config, k: string) => String(c[k] ?? "");

export const VM_SIZES = [
  "Standard_B1s", "Standard_B1ms", "Standard_B2s", "Standard_B2ms", "Standard_B4ms", "Standard_B8ms",
  "Standard_D2as_v5", "Standard_D4as_v5", "Standard_D8as_v5", "Standard_D16as_v5",
  "Standard_D2s_v5", "Standard_D4s_v5", "Standard_D8s_v5", "Standard_D16s_v5",
  "Standard_D2ds_v5", "Standard_D4ds_v5", "Standard_D8ds_v5",
  "Standard_E2s_v5", "Standard_E4s_v5", "Standard_E8s_v5",
  "Standard_F2s_v2", "Standard_F4s_v2", "Standard_F8s_v2",
  "Standard_NC4as_T4_v3",
];
const PLAN_SKUS: [string, string][] = [
  ["F1", "Free"], ["B1", "Basic"], ["B2", "Basic"], ["B3", "Basic"],
  ["S1", "Standard"], ["S2", "Standard"], ["S3", "Standard"],
  ["P0v3", "PremiumV3"], ["P1v3", "PremiumV3"], ["P2v3", "PremiumV3"], ["P3v3", "PremiumV3"],
  ["P1mv3", "PremiumMV3"], ["P2mv3", "PremiumMV3"],
];
const SQL: Record<string, NonNullable<AzureResource["sku"]>> = {
  "Basic (5 DTU)": { name: "Basic", tier: "Basic", capacity: 5 },
  "Standard S0 (10 DTU)": { name: "S0", tier: "Standard", capacity: 10 },
  "Standard S1 (20 DTU)": { name: "S1", tier: "Standard", capacity: 20 },
  "Standard S2 (50 DTU)": { name: "S2", tier: "Standard", capacity: 50 },
  "Standard S3 (100 DTU)": { name: "S3", tier: "Standard", capacity: 100 },
  "Premium P1 (125 DTU)": { name: "P1", tier: "Premium", capacity: 125 },
  "General Purpose 2 vCore": { name: "GP_Gen5", tier: "GeneralPurpose", family: "Gen5", capacity: 2 },
  "General Purpose 4 vCore": { name: "GP_Gen5", tier: "GeneralPurpose", family: "Gen5", capacity: 4 },
  "General Purpose 8 vCore": { name: "GP_Gen5", tier: "GeneralPurpose", family: "Gen5", capacity: 8 },
  "Business Critical 2 vCore": { name: "BC_Gen5", tier: "BusinessCritical", family: "Gen5", capacity: 2 },
};
const FLEX_SIZES = ["Standard_B1ms", "Standard_B2s", "Standard_B2ms", "Standard_B4ms", "Standard_D2ds_v5", "Standard_D4ds_v5", "Standard_D8ds_v5", "Standard_E2ds_v5", "Standard_E4ds_v5"];
const flexTier = (size: string) => (/_B/i.test(size) ? "Burstable" : /_E/i.test(size) ? "MemoryOptimized" : "GeneralPurpose");

export const TEMPLATES: Template[] = [
  {
    id: "vm", label: "Virtual machine", category: "compute", type: "microsoft.compute/virtualmachines",
    blurb: "Pay-as-you-go VM, priced per hour.",
    fields: [
      region,
      { key: "size", label: "Size", type: "select", options: opt(VM_SIZES, (v) => v.replace("Standard_", "")) },
      { key: "os", label: "Operating system", type: "select", options: opt(["Linux", "Windows"]) },
      { key: "count", label: "Instances", type: "number", min: 1, step: 1 },
      { key: "hours", label: "Hours running per month", type: "number", min: 0, step: 1, hint: "730 is always on. About 176 is office hours only." },
    ],
    defaults: { region: "southeastasia", size: "Standard_B2s", os: "Linux", count: 1, hours: 730 },
    build: (c) => ({
      properties: {
        hardwareProfile: { vmSize: s(c, "size") },
        storageProfile: { osDisk: { osType: s(c, "os") } },
        extended: { instanceView: { powerState: { code: "PowerState/running" } } },
      },
    }),
    multiplier: (c) => Math.max(0, n(c, "count")) * (Math.max(0, n(c, "hours")) / 730),
  },
  {
    id: "plan", label: "App Service plan", category: "web", type: "microsoft.web/serverfarms",
    blurb: "Hosts web apps and APIs. Apps on a plan share its price.",
    fields: [
      region,
      { key: "sku", label: "Pricing tier", type: "select", options: PLAN_SKUS.map(([v, t]) => ({ value: v, label: `${v} (${t})` })) },
      { key: "os", label: "Operating system", type: "select", options: opt(["Linux", "Windows"]) },
      { key: "instances", label: "Instances", type: "number", min: 1, step: 1 },
    ],
    defaults: { region: "southeastasia", sku: "B1", os: "Linux", instances: 1 },
    build: (c) => {
      const tier = PLAN_SKUS.find(([v]) => v === s(c, "sku"))?.[1] ?? "Basic";
      return { sku: { name: s(c, "sku"), tier, capacity: Math.max(1, n(c, "instances")) }, kind: s(c, "os") === "Linux" ? "linux" : "app", properties: { reserved: s(c, "os") === "Linux" } };
    },
  },
  {
    id: "static", label: "Static Web App", category: "web", type: "microsoft.web/staticsites",
    blurb: "Front-end hosting with a free tier.",
    fields: [region, { key: "plan", label: "Plan", type: "select", options: opt(["Free", "Standard"]) }],
    defaults: { region: "eastasia", plan: "Free" },
    build: (c) => ({ sku: { name: s(c, "plan"), tier: s(c, "plan") } }),
  },
  {
    id: "sql", label: "Azure SQL Database", category: "data", type: "microsoft.sql/servers/databases",
    blurb: "Single database, DTU or vCore.",
    fields: [
      region,
      { key: "option", label: "Tier", type: "select", options: opt(Object.keys(SQL)) },
      { key: "maxGb", label: "Max data size", type: "number", min: 1, step: 1, suffix: "GB", hint: "Billed on vCore tiers only; DTU tiers include storage." },
    ],
    defaults: { region: "southeastasia", option: "Standard S0 (10 DTU)", maxGb: 32 },
    build: (c) => ({ kind: "v12.0,user", sku: SQL[s(c, "option")] ?? SQL["Basic (5 DTU)"], properties: { maxSizeBytes: n(c, "maxGb") * 1024 ** 3 } }),
  },
  {
    id: "postgres", label: "PostgreSQL flexible server", category: "data", type: "microsoft.dbforpostgresql/flexibleservers",
    blurb: "Managed PostgreSQL.",
    fields: [
      region,
      { key: "size", label: "Compute size", type: "select", options: opt(FLEX_SIZES, (v) => `${v.replace("Standard_", "")} (${flexTier(v)})`) },
      { key: "storageGb", label: "Storage", type: "number", min: 32, step: 32, suffix: "GB" },
    ],
    defaults: { region: "centralindia", size: "Standard_B1ms", storageGb: 32 },
    build: (c) => ({ sku: { name: s(c, "size"), tier: flexTier(s(c, "size")) }, properties: { state: "Ready", storage: { storageSizeGB: n(c, "storageGb") } } }),
  },
  {
    id: "mysql", label: "MySQL flexible server", category: "data", type: "microsoft.dbformysql/flexibleservers",
    blurb: "Managed MySQL.",
    fields: [
      region,
      { key: "size", label: "Compute size", type: "select", options: opt(FLEX_SIZES, (v) => `${v.replace("Standard_", "")} (${flexTier(v)})`) },
      { key: "storageGb", label: "Storage", type: "number", min: 20, step: 10, suffix: "GB" },
    ],
    defaults: { region: "centralindia", size: "Standard_B1ms", storageGb: 20 },
    build: (c) => ({ sku: { name: s(c, "size"), tier: flexTier(s(c, "size")) }, properties: { state: "Ready", storage: { storageSizeGB: n(c, "storageGb") } } }),
  },
  {
    id: "storage", label: "Storage account (blobs)", category: "storage", type: "microsoft.storage/storageaccounts",
    blurb: "Priced on data stored. Transactions and egress are extra.",
    fields: [
      region,
      { key: "redundancy", label: "Redundancy", type: "select", options: opt(["Standard_LRS", "Standard_ZRS", "Standard_GRS", "Standard_RAGRS"], (v) => v.replace("Standard_", "")) },
      { key: "tier", label: "Access tier", type: "select", options: opt(["Hot", "Cool", "Cold"]) },
      { key: "gb", label: "Data stored", type: "number", min: 0, step: 10, suffix: "GB" },
    ],
    defaults: { region: "southeastasia", redundancy: "Standard_LRS", tier: "Hot", gb: 100 },
    build: (c) => ({ sku: { name: s(c, "redundancy") }, properties: { accessTier: s(c, "tier"), __capacityGB: n(c, "gb") } }),
  },
  {
    id: "disk", label: "Managed disk", category: "storage", type: "microsoft.compute/disks",
    blurb: "Priced by the disk tier its size falls into.",
    fields: [
      region,
      { key: "sku", label: "Type", type: "select", options: [
        { value: "Standard_LRS", label: "Standard HDD" },
        { value: "StandardSSD_LRS", label: "Standard SSD" },
        { value: "Premium_LRS", label: "Premium SSD" },
      ] },
      { key: "sizeGb", label: "Size", type: "number", min: 4, step: 1, suffix: "GB" },
    ],
    defaults: { region: "southeastasia", sku: "StandardSSD_LRS", sizeGb: 128 },
    build: (c) => ({ sku: { name: s(c, "sku") }, properties: { diskSizeGB: n(c, "sizeGb"), diskState: "Attached" } }),
  },
  {
    id: "pip", label: "Public IP address", category: "network", type: "microsoft.network/publicipaddresses",
    blurb: "Standard static IPv4.",
    fields: [region],
    defaults: { region: "southeastasia" },
    build: () => ({ sku: { name: "Standard", tier: "Regional" }, properties: { publicIPAllocationMethod: "Static", ipConfiguration: { id: "estimate" } } }),
  },
  {
    id: "pe", label: "Private endpoint", category: "network", type: "microsoft.network/privateendpoints",
    blurb: "Hourly charge; data processed is extra.",
    fields: [region],
    defaults: { region: "southeastasia" },
    build: () => ({ properties: {} }),
  },
  {
    id: "acr", label: "Container registry", category: "containers", type: "microsoft.containerregistry/registries",
    blurb: "Daily charge by tier.",
    fields: [region, { key: "sku", label: "Tier", type: "select", options: opt(["Basic", "Standard", "Premium"]) }],
    defaults: { region: "southeastasia", sku: "Basic" },
    build: (c) => ({ sku: { name: s(c, "sku") } }),
  },
  {
    id: "custom", label: "Custom line item", category: "other", type: "custom",
    blurb: "Anything else, at a monthly amount you enter.",
    fields: [{ key: "amount", label: "Monthly amount", type: "number", min: 0, step: 1, hint: "In the currency selected at the top." }],
    defaults: { amount: 10 },
    manual: (c) => Math.max(0, n(c, "amount")),
  },
];

export const templateById = new Map(TEMPLATES.map((t) => [t.id, t]));

export interface EstimateItem {
  id: string;
  template: string;
  name: string;
  config: Config;
  position: { x: number; y: number };
}

export function toResource(item: EstimateItem): AzureResource {
  const t = templateById.get(item.template)!;
  const built = t.build?.(item.config) ?? {};
  return {
    id: `estimate/${item.id}`,
    key: `estimate/${item.id}`.toLowerCase(),
    name: item.name,
    type: t.type,
    location: String(item.config.region ?? "eastus"),
    resourceGroup: "estimate",
    subscriptionId: "",
    sku: built.sku ?? null,
    kind: built.kind,
    properties: built.properties ?? {},
  };
}

export function scaleEstimate(e: ResourceEstimate, m: number): ResourceEstimate {
  if (m === 1) return e;
  return {
    ...e,
    monthly: e.monthly * m,
    lines: e.lines.map((l) => ({ ...l, quantity: l.quantity * m, monthly: l.monthly * m })),
  };
}

/** Maps a live resource to an estimate item, so a real architecture can be copied and edited. */
export function fromResource(r: AzureResource): Omit<EstimateItem, "id" | "position"> | null {
  const p = r.properties as Record<string, unknown>;
  const regionName = r.location;
  switch (r.type) {
    case "microsoft.compute/virtualmachines": {
      const size = (p.hardwareProfile as { vmSize?: string } | undefined)?.vmSize;
      const os = (p.storageProfile as { osDisk?: { osType?: string } } | undefined)?.osDisk?.osType ?? "Linux";
      return { template: "vm", name: r.name, config: { region: regionName, size: size ?? "Standard_B2s", os, count: 1, hours: 730 } };
    }
    case "microsoft.web/serverfarms":
      if (r.sku?.name === "Y1") return null;
      return { template: "plan", name: r.name, config: { region: regionName, sku: r.sku?.name ?? "B1", os: p.reserved === true ? "Linux" : "Windows", instances: Math.max(1, r.sku?.capacity ?? 1) } };
    case "microsoft.web/staticsites":
      return { template: "static", name: r.name, config: { region: regionName, plan: r.sku?.name === "Standard" ? "Standard" : "Free" } };
    case "microsoft.sql/servers/databases": {
      if (r.name === "master") return null;
      const match = Object.entries(SQL).find(([, v]) => v.name === r.sku?.name && (v.capacity === r.sku?.capacity || !["GP_Gen5", "BC_Gen5"].includes(v.name ?? "")));
      return { template: "sql", name: r.name, config: { region: regionName, option: match?.[0] ?? "Standard S0 (10 DTU)", maxGb: Math.round(Number(p.maxSizeBytes ?? 0) / 1024 ** 3) || 32 } };
    }
    case "microsoft.dbforpostgresql/flexibleservers":
    case "microsoft.dbformysql/flexibleservers":
      return {
        template: r.type.includes("postgres") ? "postgres" : "mysql",
        name: r.name,
        config: { region: regionName, size: r.sku?.name ?? "Standard_B1ms", storageGb: Number((p.storage as { storageSizeGB?: number } | undefined)?.storageSizeGB ?? 32) },
      };
    case "microsoft.storage/storageaccounts":
      return { template: "storage", name: r.name, config: { region: regionName, redundancy: r.sku?.name ?? "Standard_LRS", tier: String(p.accessTier ?? "Hot"), gb: Math.round(Number(p.__capacityGB ?? 0)) } };
    case "microsoft.compute/disks":
      return { template: "disk", name: r.name, config: { region: regionName, sku: r.sku?.name ?? "StandardSSD_LRS", sizeGb: Number(p.diskSizeGB ?? 128) } };
    case "microsoft.network/publicipaddresses":
      return { template: "pip", name: r.name, config: { region: regionName } };
    case "microsoft.network/privateendpoints":
      return { template: "pe", name: r.name, config: { region: regionName } };
    case "microsoft.containerregistry/registries":
      return { template: "acr", name: r.name, config: { region: regionName, sku: r.sku?.name ?? "Basic" } };
    default:
      return null;
  }
}

export const IMPORT_KEY = "acc.estimate.import.v1";
