import "server-only";
import type { RetailPrice } from "../types";

const API = "https://prices.azure.com/api/retail/prices";
const TTL_MS = 12 * 60 * 60 * 1000;

const cache = new Map<string, { at: number; items: Promise<RetailPrice[]> }>();

/** Quote a value for an OData filter. */
export function odata(v: string) {
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * Calls the public Azure Retail Prices API (no auth), following pages and
 * caching each filter for 12 hours so a diagram with 50 resources doesn't
 * trigger 50 identical requests.
 */
export function retailPrices(filter: string, currency = "USD", maxPages = 10): Promise<RetailPrice[]> {
  const key = `${currency}|${filter}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;
  const items = load(filter, currency, maxPages).catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), items });
  return items;
}

async function load(filter: string, currency: string, maxPages: number) {
  const params = new URLSearchParams({
    "api-version": "2023-01-01-preview",
    currencyCode: `'${currency}'`,
    $filter: filter,
  });
  let url: string | null = `${API}?${params.toString()}`;
  const out: RetailPrice[] = [];
  let pages = 0;
  while (url && pages++ < maxPages) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Retail Prices API returned ${res.status}`);
    const body: { Items: RetailPrice[]; NextPageLink?: string | null } = await res.json();
    out.push(...body.Items);
    url = body.NextPageLink ?? null;
  }
  return out;
}

/** Lowercase and drop the `Standard_` prefix, spaces and underscores, so `Standard_B1ms`, `B1MS` and `B1 ms` compare equal. */
export function normSku(s: string | undefined | null) {
  return (s ?? "").toLowerCase().replace(/^standard_/, "").replace(/[\s_]/g, "");
}

/** Of several tiered rows for the same meter, keep the base tier (tierMinimumUnits = 0). */
export function baseTier(items: RetailPrice[]) {
  return items.filter((i) => Number(i.tierMinimumUnits ?? 0) === 0);
}
