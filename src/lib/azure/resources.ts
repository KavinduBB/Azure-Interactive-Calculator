import "server-only";
import { armFetch, armList } from "./arm";
import type { AzureResource, Subscription } from "../types";

interface GraphResponse {
  data: Record<string, unknown>[];
  $skipToken?: string;
}

async function resourceGraph(token: string, subscriptions: string[], query: string) {
  const rows: Record<string, unknown>[] = [];
  let skipToken: string | undefined;
  let guard = 0;
  do {
    const body = {
      subscriptions,
      query,
      options: { resultFormat: "objectArray", $top: 1000, ...(skipToken ? { $skipToken: skipToken } : {}) },
    };
    const res = await armFetch<GraphResponse>(
      token,
      "/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01",
      { method: "POST", body: JSON.stringify(body) },
    );
    rows.push(...res.data);
    skipToken = res.$skipToken;
  } while (skipToken && guard++ < 20);
  return rows;
}

export async function listSubscriptions(token: string): Promise<Subscription[]> {
  const subs = await armList<{
    subscriptionId: string;
    displayName: string;
    state: string;
    tenantId?: string;
    subscriptionPolicies?: { quotaId?: string };
  }>(token, "/subscriptions?api-version=2022-12-01");
  return subs
    .map((s) => ({
      subscriptionId: s.subscriptionId,
      displayName: s.displayName,
      state: s.state,
      tenantId: s.tenantId,
      quotaId: s.subscriptionPolicies?.quotaId,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function listResourceGroups(token: string, subscriptionIds: string[]) {
  const [groups, counts] = await Promise.all([
    resourceGraph(
      token,
      subscriptionIds,
      `resourcecontainers
       | where type =~ 'microsoft.resources/subscriptions/resourcegroups'
       | project name, location, subscriptionId
       | order by name asc`,
    ),
    resourceGraph(token, subscriptionIds, `resources | summarize n=count() by rg=tolower(resourceGroup), subscriptionId`),
  ]);
  const countOf = new Map(counts.map((c) => [`${c.subscriptionId}|${c.rg}`, Number(c.n)]));
  return groups.map((g) => ({
    name: String(g.name),
    location: String(g.location),
    subscriptionId: String(g.subscriptionId),
    resourceCount: countOf.get(`${g.subscriptionId}|${String(g.name).toLowerCase()}`) ?? 0,
  }));
}

/** Resource types that add noise to a diagram without adding cost or structure. */
const HIDDEN_TYPES = [
  "microsoft.compute/virtualmachines/extensions",
  "microsoft.alertsmanagement/smartdetectoralertrules",
  "microsoft.insights/actiongroups",
  "microsoft.devtestlab/schedules",
  "microsoft.network/networkwatchers",
  "microsoft.network/networkwatchers/flowlogs",
  "microsoft.portal/dashboards",
  "microsoft.security/automations",
];

function escapeKql(s: string) {
  return s.replace(/'/g, "''");
}

export async function listResources(
  token: string,
  subscriptionIds: string[],
  resourceGroups?: string[],
  includeHidden = false,
): Promise<AzureResource[]> {
  const rgFilter =
    resourceGroups && resourceGroups.length
      ? `| where resourceGroup in~ (${resourceGroups.map((g) => `'${escapeKql(g)}'`).join(",")})`
      : "";
  const typeFilter = includeHidden
    ? ""
    : `| where type !in~ (${HIDDEN_TYPES.map((t) => `'${t}'`).join(",")})`;
  const rows = await resourceGraph(
    token,
    subscriptionIds,
    `resources ${rgFilter} ${typeFilter}
     | project id, name, type=tolower(type), kind, location, resourceGroup=tolower(resourceGroup), subscriptionId, sku, tags, properties`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    key: String(r.id).toLowerCase(),
    name: String(r.name),
    type: String(r.type),
    kind: (r.kind as string) || undefined,
    location: String(r.location ?? ""),
    resourceGroup: String(r.resourceGroup),
    subscriptionId: String(r.subscriptionId),
    sku: (r.sku as AzureResource["sku"]) ?? null,
    tags: (r.tags as Record<string, string>) ?? null,
    properties: (r.properties as Record<string, unknown>) ?? {},
  }));
}
