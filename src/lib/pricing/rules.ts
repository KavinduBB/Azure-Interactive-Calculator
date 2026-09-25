import "server-only";
import { retailPrices, odata, normSku, baseTier } from "./retail";
import { HOURS_PER_MONTH } from "../types";
import type { AzureResource, PriceLine, ResourceEstimate, RetailPrice } from "../types";

const DAYS_PER_MONTH = HOURS_PER_MONTH / 24;

interface Ctx {
  currency: string;
  byKey: Map<string, AzureResource>;
}

// ---------- small helpers ----------
function prop(r: AzureResource, path: string): unknown {
  let cur: unknown = r.properties;
  for (const k of path.split(".")) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[k];
    else return undefined;
  }
  return cur;
}
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown) => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
};

function line(label: string, p: RetailPrice, quantity: number): PriceLine {
  return {
    label,
    unitPrice: p.retailPrice,
    unit: p.unitOfMeasure,
    quantity,
    monthly: p.retailPrice * quantity,
    meter: `${p.productName} · ${p.meterName}`,
  };
}

function out(r: AzureResource, ctx: Ctx, status: ResourceEstimate["status"], lines: PriceLine[] = [], note?: string): ResourceEstimate {
  const monthly = lines.reduce((a, l) => a + l.monthly, 0);
  return { key: r.key, status, monthly, currency: ctx.currency, lines, note };
}
const priced = (r: AzureResource, ctx: Ctx, lines: PriceLine[], note?: string) =>
  lines.length ? out(r, ctx, "priced", lines, note) : out(r, ctx, "unknown", [], note ?? "No matching list price found for this SKU and region.");
const free = (r: AzureResource, ctx: Ctx, note: string) => out(r, ctx, "free", [], note);
const usage = (r: AzureResource, ctx: Ctx, note: string, lines: PriceLine[] = []) => out(r, ctx, "usage", lines, note);
const unknown = (r: AzureResource, ctx: Ctx, note = "No pricing rule for this resource type yet.") => out(r, ctx, "unknown", [], note);

const region = (r: AzureResource) => r.location.toLowerCase();

// ---------- compute ----------
async function vmHourly(size: string, loc: string, windows: boolean, ctx: Ctx) {
  const items = await retailPrices(
    `serviceName eq 'Virtual Machines' and armRegionName eq ${odata(loc)} and armSkuName eq ${odata(size)} and priceType eq 'Consumption'`,
    ctx.currency,
  );
  return items.find(
    (i) =>
      !/spot|low priority/i.test(i.meterName) &&
      (windows ? /windows/i.test(i.productName) : !/windows/i.test(i.productName)),
  );
}

async function virtualMachine(r: AzureResource, ctx: Ctx) {
  const size = str(prop(r, "hardwareProfile.vmSize"));
  if (!size) return unknown(r, ctx, "VM size not reported.");
  const power = (str(prop(r, "extended.instanceView.powerState.code")) ?? "").toLowerCase();
  const os = (str(prop(r, "storageProfile.osDisk.osType")) ?? "Linux").toLowerCase();
  const hybrid = (str(prop(r, "licenseType")) ?? "").toLowerCase().startsWith("windows");
  const windows = os === "windows" && !hybrid;
  if (power.includes("deallocated")) {
    return out(r, ctx, "stopped", [], "Deallocated. Compute isn't billed, but its disks and public IP still are.");
  }
  const p = await vmHourly(size, region(r), windows, ctx);
  if (!p) return unknown(r, ctx, `No list price for ${size} in ${r.location}.`);
  const notes: string[] = [];
  if (power.includes("stopped")) notes.push("Stopped but not deallocated, so it is still billed. Deallocate it to stop compute charges.");
  if (hybrid) notes.push("Azure Hybrid Benefit is on, so it is priced without the Windows licence.");
  return priced(r, ctx, [line(`${size} ${windows ? "Windows" : "Linux"}, ${HOURS_PER_MONTH} h`, p, HOURS_PER_MONTH)], notes.join(" ") || undefined);
}

async function scaleSet(r: AzureResource, ctx: Ctx) {
  const size = r.sku?.name;
  const count = r.sku?.capacity ?? 0;
  if (!size) return unknown(r, ctx);
  if (count === 0) return out(r, ctx, "stopped", [], "Scaled to zero instances.");
  const os = (str(prop(r, "virtualMachineProfile.storageProfile.osDisk.osType")) ?? "Linux").toLowerCase();
  const p = await vmHourly(size, region(r), os === "windows", ctx);
  if (!p) return unknown(r, ctx, `No list price for ${size} in ${r.location}.`);
  return priced(r, ctx, [line(`${count} × ${size}, ${HOURS_PER_MONTH} h`, p, count * HOURS_PER_MONTH)], "Instance count can change with autoscale.");
}

// ---------- disks ----------
const DISK_SIZES = [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32767];
const DISK_NUMS = ["1", "2", "3", "4", "6", "10", "15", "20", "30", "40", "50", "60", "70", "80"];
const DISK_SKUS: Record<string, [string, string, string]> = {
  premium_lrs: ["P", "Premium SSD Managed Disks", "LRS"],
  premium_zrs: ["P", "Premium SSD Managed Disks", "ZRS"],
  standardssd_lrs: ["E", "Standard SSD Managed Disks", "LRS"],
  standardssd_zrs: ["E", "Standard SSD Managed Disks", "ZRS"],
  standard_lrs: ["S", "Standard HDD Managed Disks", "LRS"],
};

async function disk(r: AzureResource, ctx: Ctx) {
  const skuName = (r.sku?.name ?? "").toLowerCase();
  const gb = num(prop(r, "diskSizeGB")) ?? 0;
  const state = (str(prop(r, "diskState")) ?? "").toLowerCase();
  const map = DISK_SKUS[skuName];
  if (!map) return usage(r, ctx, `${r.sku?.name ?? "This disk type"} is billed by provisioned capacity, IOPS and throughput.`);
  const [prefix, product, red] = map;
  let idx = DISK_SIZES.findIndex((s) => gb <= s);
  if (idx < 0) idx = DISK_SIZES.length - 1;
  if (prefix === "S" && idx < 3) idx = 3; // smallest HDD tier is S4 (32 GB)
  const tier = `${prefix}${DISK_NUMS[idx]}`;
  const items = await retailPrices(
    `serviceName eq 'Storage' and armRegionName eq ${odata(region(r))} and productName eq ${odata(product)} and skuName eq ${odata(`${tier} ${red}`)} and priceType eq 'Consumption'`,
    ctx.currency,
  );
  const p = items.find((i) => /disk$/i.test(i.meterName) && !/mount|operations/i.test(i.meterName));
  const note = state === "unattached" ? "Unattached: you pay for this disk even though no VM uses it." : undefined;
  if (!p) return unknown(r, ctx, `No list price for ${tier} ${red} in ${r.location}.`);
  return priced(r, ctx, [line(`${tier} ${red} (${gb} GB)`, p, 1)], note);
}

// ---------- networking ----------
async function publicIp(r: AzureResource, ctx: Ctx) {
  const sku = (r.sku?.name ?? "Basic").toLowerCase();
  const alloc = (str(prop(r, "publicIPAllocationMethod")) ?? "Static").toLowerCase();
  const meter =
    sku === "standard" ? "Standard IPv4 Static Public IP" : alloc === "static" ? "Basic IPv4 Static Public IP" : "Basic IPv4 Dynamic Public IP";
  const items = await retailPrices(
    `serviceName eq 'Virtual Network' and productName eq 'IP Addresses' and armRegionName eq ${odata(region(r))} and priceType eq 'Consumption'`,
    ctx.currency,
  );
  const p = items.find((i) => i.meterName === meter);
  if (!p) return unknown(r, ctx, `No list price for ${meter} in ${r.location}.`);
  const attached = prop(r, "ipConfiguration") != null;
  return priced(r, ctx, [line(meter, p, HOURS_PER_MONTH)], attached ? undefined : "Not attached to anything, but still billed.");
}

async function privateEndpoint(r: AzureResource, ctx: Ctx) {
  // Private Link is priced globally rather than per region.
  const items = await retailPrices(
    `serviceName eq 'Virtual Network' and productName eq 'Virtual Network Private Link' and meterName eq 'Standard Private Endpoint' and priceType eq 'Consumption'`,
    ctx.currency,
  );
  const p = items.find((i) => i.armRegionName.toLowerCase() === region(r)) ?? items.find((i) => i.armRegionName === "Global") ?? items[0];
  if (!p) return usage(r, ctx, "Billed per hour plus per GB processed.");
  return usage(r, ctx, "Plus a charge per GB processed.", [line("Private endpoint, 730 h", p, HOURS_PER_MONTH)]);
}

async function privateDnsZone(r: AzureResource, ctx: Ctx) {
  const items = baseTier(await retailPrices(`serviceName eq 'Azure DNS' and meterName eq 'Private Zone' and priceType eq 'Consumption'`, ctx.currency));
  const p = items[0];
  if (!p) return unknown(r, ctx);
  return usage(r, ctx, "Plus a small charge per million queries.", [line("Private DNS zone", p, 1)]);
}

// ---------- app service ----------
async function appServicePlan(r: AzureResource, ctx: Ctx) {
  const name = r.sku?.name ?? "";
  const tier = (r.sku?.tier ?? "").toLowerCase();
  if (name === "F1" || tier === "free") return free(r, ctx, "Free tier.");
  if (name === "Y1" || tier === "dynamic") return usage(r, ctx, "Consumption plan: billed per execution and GB-second. The first 1M executions each month are free.");
  if (tier === "flexconsumption") return usage(r, ctx, "Flex Consumption: billed per execution and GB-second.");
  if (/^EP\d/i.test(name) || tier === "elasticpremium") return unknown(r, ctx, "Elastic Premium pricing isn't mapped yet.");
  if (tier.startsWith("workflow")) return unknown(r, ctx, "Logic Apps Standard pricing isn't mapped yet.");
  const linux = r.properties.reserved === true || (r.kind ?? "").toLowerCase().includes("linux");
  const workers = Math.max(1, r.sku?.capacity ?? num(prop(r, "numberOfWorkers")) ?? 1);
  const items = await retailPrices(
    `serviceName eq 'Azure App Service' and armRegionName eq ${odata(region(r))} and priceType eq 'Consumption'`,
    ctx.currency,
  );
  const want = normSku(name);
  const candidates = items.filter(
    (i) =>
      normSku(i.skuName) === want &&
      (linux ? /linux/i.test(i.productName) : !/linux/i.test(i.productName)) &&
      !/static web|environment|isolated stamp/i.test(i.productName),
  );
  const p = candidates.find((i) => normSku(i.meterName).startsWith(want)) ?? candidates[0];
  if (!p) return unknown(r, ctx, `No list price for ${name} (${linux ? "Linux" : "Windows"}) in ${r.location}.`);
  return priced(r, ctx, [line(`${name} ${linux ? "Linux" : "Windows"} × ${workers} instance${workers > 1 ? "s" : ""}`, p, workers * HOURS_PER_MONTH)]);
}

function webSite(r: AzureResource, ctx: Ctx) {
  const plan = ctx.byKey.get(String(prop(r, "serverFarmId") ?? "").toLowerCase());
  const planName = plan?.name ?? String(prop(r, "serverFarmId") ?? "").split("/").pop();
  if (plan && (plan.sku?.name === "Y1" || (plan.sku?.tier ?? "").toLowerCase() === "dynamic")) {
    return usage(r, ctx, `Runs on consumption plan ${planName}: billed per execution.`);
  }
  return free(r, ctx, planName ? `Billed through App Service plan ${planName}.` : "Billed through its App Service plan.");
}

async function staticSite(r: AzureResource, ctx: Ctx) {
  const tier = (r.sku?.name ?? "Free").toLowerCase();
  if (tier === "free") return free(r, ctx, "Free tier.");
  const items = await retailPrices(
    `serviceName eq 'Azure App Service' and productName eq 'Static Web Apps' and armRegionName eq ${odata(region(r))} and priceType eq 'Consumption'`,
    ctx.currency,
  );
  const p = items.find((i) => i.meterName === "Standard App");
  if (!p) return unknown(r, ctx);
  return priced(r, ctx, [line("Static Web Apps Standard", p, 1)], "Bandwidth over 100 GB is extra.");
}

// ---------- databases ----------
async function sqlDatabase(r: AzureResource, ctx: Ctx) {
  const tier = (r.sku?.tier ?? "").toLowerCase();
  const name = r.sku?.name ?? "";
  if (r.name === "master" || tier === "system") return free(r, ctx, "System database, not billed.");
  const loc = region(r);
  const maxGb = Math.round((num(prop(r, "maxSizeBytes")) ?? 0) / 1024 ** 3);
  const dtu = async (product: string, sku: string) => {
    const items = await retailPrices(
      `serviceName eq 'SQL Database' and armRegionName eq ${odata(loc)} and productName eq ${odata(product)} and priceType eq 'Consumption'`,
      ctx.currency,
    );
    return items.find((i) => normSku(i.skuName) === normSku(sku) && !/secondary/i.test(i.skuName));
  };
  if (tier === "basic") {
    const p = await dtu("SQL Database Single Basic", "B");
    return p ? priced(r, ctx, [line("Basic, 5 DTU", p, DAYS_PER_MONTH)]) : unknown(r, ctx);
  }
  if (tier === "standard" || tier === "premium") {
    const product = tier === "standard" ? "SQL Database Single Standard" : "SQL Database Single Premium";
    const p = await dtu(product, name);
    return p ? priced(r, ctx, [line(`${r.sku?.tier} ${name}`, p, DAYS_PER_MONTH)]) : unknown(r, ctx, `No list price for ${name} in ${r.location}.`);
  }
  const vcores = r.sku?.capacity ?? 0;
  const family = /business/.test(tier) || name.startsWith("BC_") ? "Business Critical" : /hyperscale/.test(tier) || name.startsWith("HS_") ? "Hyperscale" : "General Purpose";
  const storage = async () => {
    if (family !== "General Purpose" && family !== "Business Critical") return [];
    const items = await retailPrices(
      `serviceName eq 'SQL Database' and armRegionName eq ${odata(loc)} and productName eq ${odata(`SQL Database Single/Elastic Pool ${family} - Storage`)} and priceType eq 'Consumption'`,
      ctx.currency,
    );
    const p = items.find((i) => i.meterName === `${family} Data Stored` && i.retailPrice > 0);
    return p && maxGb ? [line(`Storage, ${maxGb} GB max size`, p, maxGb)] : [];
  };
  if (name.includes("_S_") || (r.kind ?? "").includes("serverless")) {
    const min = num(prop(r, "minCapacity"));
    return usage(r, ctx, `Serverless: billed per vCore-second used (${min ?? "?"} to ${vcores} vCores) and pauses when idle.`, await storage());
  }
  if (!vcores) return unknown(r, ctx, "vCore count not reported.");
  const zr = prop(r, "zoneRedundant") === true;
  const items = await retailPrices(
    `serviceName eq 'SQL Database' and armRegionName eq ${odata(loc)} and contains(productName, ${odata(`${family} - Compute Gen5`)}) and skuName eq ${odata(`${vcores} vCore${zr ? " Zone Redundancy" : ""}`)} and priceType eq 'Consumption'`,
    ctx.currency,
  );
  const p = items.find((i) => /single/i.test(i.productName)) ?? items[0];
  if (!p) return unknown(r, ctx, `No list price for ${family} ${vcores} vCore in ${r.location}.`);
  const hybrid = str(prop(r, "licenseType")) === "BasePrice";
  const lines = [line(`${family} Gen5, ${vcores} vCore`, p, HOURS_PER_MONTH)];
  // The compute meter excludes the SQL Server licence, which is priced per vCore-hour
  // (Standard for General Purpose, Enterprise for Business Critical). Hyperscale has no licence charge.
  if (!hybrid && family !== "Hyperscale") {
    const edition = family === "Business Critical" ? "SQL Server Enterprise" : "SQL Server Standard";
    const lic = await retailPrices(
      `serviceName eq 'Virtual Machines Licenses' and productName eq ${odata(edition)} and meterName eq '1 vCore License' and priceType eq 'Consumption'`,
      ctx.currency,
    );
    if (lic[0]) lines.push(line(`${edition} licence, ${vcores} vCore`, lic[0], vcores * HOURS_PER_MONTH));
  }
  lines.push(...(await storage()));
  return priced(r, ctx, lines, hybrid ? "Azure Hybrid Benefit is on, so no SQL licence is charged." : undefined);
}

async function flexibleServer(r: AzureResource, ctx: Ctx, engine: "PostgreSQL" | "MySQL") {
  const name = r.sku?.name ?? "";
  const state = (str(prop(r, "state")) ?? "").toLowerCase();
  const gb = num(prop(r, "storage.storageSizeGB")) ?? 0;
  const items = await retailPrices(
    `serviceName eq ${odata(`Azure Database for ${engine}`)} and armRegionName eq ${odata(region(r))} and priceType eq 'Consumption'`,
    ctx.currency,
  );
  const flex = items.filter((i) => /flexible server|flex server/i.test(i.productName));
  const storageP = flex.find((i) => /storage/i.test(i.productName) && !/backup/i.test(i.productName) && /data stored/i.test(i.meterName));
  const storageLine = storageP && gb ? [line(`Storage, ${gb} GB`, storageP, gb)] : [];
  if (state === "stopped") return usage(r, ctx, "Stopped: compute isn't billed, storage still is.", storageLine);
  const want = normSku(name);
  let computeLine: PriceLine | undefined;
  const exact = flex.find((i) => /compute/i.test(i.productName) && !/confidential/i.test(i.productName) && (normSku(i.armSkuName) === want || normSku(i.skuName) === want));
  if (exact) computeLine = line(`${name}, ${HOURS_PER_MONTH} h`, exact, HOURS_PER_MONTH);
  else {
    // General Purpose / Memory Optimized are priced per vCore; the vCore count is the number in the size name.
    const vcores = Number(/[a-z](\d+)/i.exec(name.replace(/^standard_/i, ""))?.[1] ?? 0);
    const series = /_?([a-z]+\d*[a-z]*)_(v\d)/i.exec(name);
    const perCore = flex.find(
      (i) => /compute/i.test(i.productName) && /vcore/i.test(i.meterName) && !/confidential/i.test(i.productName) &&
        (series ? i.productName.toLowerCase().includes(`${series[1].replace(/\d+/, "")}${series[2]}`.toLowerCase()) : false),
    );
    if (perCore && vcores) computeLine = line(`${name}, ${vcores} vCore × ${HOURS_PER_MONTH} h`, perCore, vcores * HOURS_PER_MONTH);
  }
  if (!computeLine) return unknown(r, ctx, `No list price for ${name} in ${r.location}.`);
  return priced(r, ctx, [computeLine, ...storageLine]);
}

// ---------- other paid services ----------
async function containerRegistry(r: AzureResource, ctx: Ctx) {
  const sku = r.sku?.name ?? "Basic";
  const items = await retailPrices(
    `serviceName eq 'Container Registry' and armRegionName eq ${odata(region(r))} and meterName eq ${odata(`${sku} Registry Unit`)} and priceType eq 'Consumption'`,
    ctx.currency,
  );
  const p = items[0];
  if (!p) return unknown(r, ctx);
  return priced(r, ctx, [line(`${sku} registry`, p, DAYS_PER_MONTH)], "Storage above the included amount is extra.");
}

function managedCluster(r: AzureResource, ctx: Ctx) {
  const tier = (r.sku?.tier ?? "Free").toLowerCase();
  const nodes = "Worker nodes are billed as VM scale sets in the cluster's MC_ resource group.";
  return tier === "free" ? free(r, ctx, `Free control plane. ${nodes}`) : usage(r, ctx, `${r.sku?.tier} tier control plane is billed per cluster hour. ${nodes}`);
}

const REDUNDANCY: Record<string, string> = {
  standard_lrs: "LRS", standard_zrs: "ZRS", standard_grs: "GRS", standard_ragrs: "RA-GRS",
  standard_gzrs: "GZRS", standard_ragzrs: "RA-GZRS", premium_lrs: "LRS", premium_zrs: "ZRS",
};

/**
 * Storage is billed by what's stored. `__capacityGB` is filled in from the
 * UsedCapacity metric in live mode, or typed in by the user in estimate mode.
 */
async function storageAccount(r: AzureResource, ctx: Ctx) {
  const sku = r.sku?.name ?? "Standard_LRS";
  const access = str(prop(r, "accessTier")) ?? "Hot";
  const gb = num(prop(r, "__capacityGB"));
  const red = REDUNDANCY[sku.toLowerCase()];
  const label = `${sku.replace("_", " ")}, ${access} tier`;
  if (gb == null || !red || sku.toLowerCase().startsWith("premium")) {
    return usage(r, ctx, `Billed by data stored and transactions (${label}).`);
  }
  const items = baseTier(
    await retailPrices(
      `serviceName eq 'Storage' and armRegionName eq ${odata(region(r))} and productName eq 'General Block Blob v2' and meterName eq ${odata(`${access} ${red} Data Stored`)} and priceType eq 'Consumption'`,
      ctx.currency,
    ),
  );
  const p = items[0];
  if (!p) return usage(r, ctx, `Billed by data stored and transactions (${label}).`);
  const shown = gb < 10 ? gb.toFixed(2) : Math.round(gb).toString();
  return usage(r, ctx, `Data stored only (${label}). Transactions and egress are extra.`, [line(`${shown} GB stored`, p, gb)]);
}

// ---------- dispatch ----------
const FREE_TYPES: Record<string, string> = {
  "microsoft.network/virtualnetworks": "Virtual networks are free; traffic through peering and gateways is billed.",
  "microsoft.network/networksecuritygroups": "Free.",
  "microsoft.network/networkinterfaces": "Free.",
  "microsoft.network/routetables": "Free.",
  "microsoft.network/networkwatchers": "Free.",
  "microsoft.network/privatednszones/virtualnetworklinks": "Free.",
  "microsoft.sql/servers": "The logical server is free; its databases are billed.",
  "microsoft.managedidentity/userassignedidentities": "Free.",
  "microsoft.web/certificates": "Free.",
  "microsoft.insights/actiongroups": "Free for email; SMS and calls are billed.",
  "microsoft.compute/virtualmachines/extensions": "Free.",
  "microsoft.devtestlab/schedules": "Free.",
  "microsoft.alertsmanagement/smartdetectoralertrules": "Free.",
  "microsoft.compute/sshpublickeys": "Free.",
  "microsoft.compute/availabilitysets": "Free.",
  "microsoft.insights/activitylogalerts": "Free.",
  "microsoft.web/connections": "Free; Logic Apps actions that use it are billed.",
};

const USAGE_TYPES: Record<string, string> = {
  "microsoft.insights/components": "Application Insights is billed per GB of telemetry ingested.",
  "microsoft.operationalinsights/workspaces": "Billed per GB ingested and retained.",
  "microsoft.keyvault/vaults": "Billed per 10,000 operations.",
  "microsoft.cognitiveservices/accounts": "Billed per request or per token.",
  "microsoft.app/containerapps": "Consumption: billed per vCPU-second, GB-second and request.",
  "microsoft.app/managedenvironments": "Consumption environments are free; dedicated workload profiles are billed per hour.",
  "microsoft.servicebus/namespaces": "Billed by tier and operations.",
  "microsoft.eventhub/namespaces": "Billed per throughput unit and ingress.",
  "microsoft.documentdb/databaseaccounts": "Billed per RU/s or per request, plus storage.",
  "microsoft.logic/workflows": "Billed per action execution.",
  "microsoft.signalrservice/signalr": "Billed per unit per day.",
  "microsoft.cdn/profiles": "Billed per GB delivered and requests.",
  "microsoft.insights/metricalerts": "About $0.10 per monitored time series each month.",
  "microsoft.insights/scheduledqueryrules": "Billed per rule evaluation frequency.",
};

export async function estimateResource(r: AzureResource, ctx: Ctx): Promise<ResourceEstimate> {
  try {
    switch (r.type) {
      case "microsoft.compute/virtualmachines": return await virtualMachine(r, ctx);
      case "microsoft.compute/virtualmachinescalesets": return await scaleSet(r, ctx);
      case "microsoft.compute/disks": return await disk(r, ctx);
      case "microsoft.network/publicipaddresses": return await publicIp(r, ctx);
      case "microsoft.network/privateendpoints": return await privateEndpoint(r, ctx);
      case "microsoft.network/privatednszones": return await privateDnsZone(r, ctx);
      case "microsoft.web/serverfarms": return await appServicePlan(r, ctx);
      case "microsoft.web/sites": return webSite(r, ctx);
      case "microsoft.web/staticsites": return await staticSite(r, ctx);
      case "microsoft.sql/servers/databases": return await sqlDatabase(r, ctx);
      case "microsoft.dbforpostgresql/flexibleservers": return await flexibleServer(r, ctx, "PostgreSQL");
      case "microsoft.dbformysql/flexibleservers": return await flexibleServer(r, ctx, "MySQL");
      case "microsoft.containerregistry/registries": return await containerRegistry(r, ctx);
      case "microsoft.containerservice/managedclusters": return managedCluster(r, ctx);
      case "microsoft.storage/storageaccounts": return await storageAccount(r, ctx);
    }
    if (FREE_TYPES[r.type]) return free(r, ctx, FREE_TYPES[r.type]);
    if (USAGE_TYPES[r.type]) return usage(r, ctx, USAGE_TYPES[r.type]);
    return unknown(r, ctx);
  } catch (e) {
    return unknown(r, ctx, `Price lookup failed: ${(e as Error).message}`);
  }
}

export async function estimateAll(resources: AzureResource[], currency: string): Promise<ResourceEstimate[]> {
  const ctx: Ctx = { currency, byKey: new Map(resources.map((r) => [r.key, r])) };
  const results: ResourceEstimate[] = new Array(resources.length);
  let next = 0;
  const worker = async () => {
    while (next < resources.length) {
      const i = next++;
      results[i] = await estimateResource(resources[i], ctx);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return results;
}
