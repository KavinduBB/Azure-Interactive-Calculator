import "server-only";
import { armFetch, ArmError } from "./arm";
import type { CostResult } from "../types";

interface QueryResult {
  properties: {
    columns: { name: string; type: string }[];
    rows: unknown[][];
    nextLink?: string | null;
  };
}

/** Offers whose usage never appears in Cost Management (verified for Sponsorship). */
const NO_COST_DATA_QUOTAS = ["sponsored_2016-01-01"];

/**
 * Month-to-date actual cost per resource from Cost Management.
 * Returns `available: false` with a reason instead of throwing, because many
 * subscription types (Sponsorship, some credits offers, CSP without access)
 * simply have no cost data, and the app should fall back to estimates.
 */
export async function monthToDateCosts(
  token: string,
  subscriptionId: string,
  quotaId?: string,
): Promise<CostResult> {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const base = { from: from.toISOString(), to: now.toISOString(), total: 0, byResource: [] };

  if (quotaId && NO_COST_DATA_QUOTAS.includes(quotaId.toLowerCase())) {
    return {
      ...base,
      available: false,
      reason:
        "This is a Sponsorship subscription. Azure doesn't publish its usage to Cost Management, so costs shown are estimates from list prices.",
    };
  }

  const body = {
    type: "ActualCost",
    timeframe: "MonthToDate",
    dataset: {
      granularity: "None",
      aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      grouping: [{ type: "Dimension", name: "ResourceId" }],
    },
  };

  try {
    let url: string | null = `/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2025-03-01`;
    const byKey = new Map<string, number>();
    let currency = "USD";
    let guard = 0;
    while (url && guard++ < 20) {
      const res: QueryResult = await armFetch<QueryResult>(token, url, { method: "POST", body: JSON.stringify(body) });
      const cols = res.properties.columns.map((c) => c.name.toLowerCase());
      const iCost = cols.indexOf("cost");
      const iId = cols.indexOf("resourceid");
      const iCur = cols.indexOf("currency");
      for (const row of res.properties.rows) {
        const id = String(row[iId] ?? "").toLowerCase();
        const cost = Number(row[iCost] ?? 0);
        if (iCur >= 0 && row[iCur]) currency = String(row[iCur]);
        byKey.set(id, (byKey.get(id) ?? 0) + cost);
      }
      url = res.properties.nextLink ?? null;
    }
    const byResource = [...byKey.entries()].map(([key, cost]) => ({ key, cost, currency }));
    const total = byResource.reduce((a, b) => a + b.cost, 0);
    if (byResource.length === 0) {
      return {
        ...base,
        available: false,
        reason: "Cost Management returned no usage for this month yet. Costs shown are estimates from list prices.",
      };
    }
    return { ...base, available: true, currency, total, byResource };
  } catch (e) {
    const err = e as ArmError;
    const reason =
      err.status === 403 || err.status === 401
        ? "You need the Cost Management Reader role on this subscription to see actual costs."
        : `Cost Management is unavailable for this subscription: ${err.message}`;
    return { ...base, available: false, reason };
  }
}
