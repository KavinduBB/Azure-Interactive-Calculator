import { estimateAll } from "@/lib/pricing/rules";
import { CURRENCIES, type AzureResource } from "@/lib/types";

/**
 * Prices resource descriptions with the same engine the live view uses.
 * The estimate builder sends synthetic resources; the live view sends edited
 * copies of real ones for "what if" comparisons. No Azure sign-in needed.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const currency = CURRENCIES.includes(body.currency) ? body.currency : "USD";
  const raw: unknown[] = Array.isArray(body.resources) ? body.resources.slice(0, 500) : [];
  const resources: AzureResource[] = raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r, i) => {
      const id = typeof r.id === "string" ? r.id : `estimate/${i}`;
      return {
        id,
        key: id.toLowerCase(),
        name: String(r.name ?? `item-${i}`),
        type: String(r.type ?? "").toLowerCase(),
        kind: typeof r.kind === "string" ? r.kind : undefined,
        location: String(r.location ?? "eastus").toLowerCase(),
        resourceGroup: String(r.resourceGroup ?? "estimate"),
        subscriptionId: "",
        sku: (r.sku as AzureResource["sku"]) ?? null,
        properties: r.properties && typeof r.properties === "object" ? (r.properties as Record<string, unknown>) : {},
      };
    });
  const estimates = await estimateAll(resources, currency);
  return Response.json({ currency, estimates });
}
