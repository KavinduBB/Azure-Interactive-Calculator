import { getArmToken } from "@/lib/azure/auth";
import { listResources, listSubscriptions } from "@/lib/azure/resources";
import { monthToDateCosts } from "@/lib/azure/costs";
import { attachStorageCapacity } from "@/lib/azure/metrics";
import { estimateAll } from "@/lib/pricing/rules";
import { errorResponse, isGuid } from "@/lib/azure/route-helpers";
import { CURRENCIES, type CostResult } from "@/lib/types";

/**
 * One call returns everything the live view needs: resources, a list-price
 * estimate for each, and actual month-to-date cost where Azure provides it.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const subscriptionIds: string[] = (Array.isArray(body.subscriptionIds) ? body.subscriptionIds : []).filter(isGuid);
    const resourceGroups: string[] = (Array.isArray(body.resourceGroups) ? body.resourceGroups : [])
      .filter((g: unknown) => typeof g === "string" && g.length < 100);
    const currency = CURRENCIES.includes(body.currency) ? body.currency : "USD";
    const withCosts = body.withCosts !== false;
    if (!subscriptionIds.length) return Response.json({ error: "Pick at least one subscription." }, { status: 400 });

    const { token } = await getArmToken(req);
    const [resources, subs] = await Promise.all([
      listResources(token, subscriptionIds, resourceGroups),
      withCosts ? listSubscriptions(token) : Promise.resolve([]),
    ]);

    await attachStorageCapacity(token, resources);

    const [estimates, costs] = await Promise.all([
      estimateAll(resources, currency),
      withCosts
        ? Promise.all(
            subscriptionIds.map((id) =>
              monthToDateCosts(token, id, subs.find((s) => s.subscriptionId === id)?.quotaId).then((c) => ({ subscriptionId: id, ...c })),
            ),
          )
        : Promise.resolve([] as (CostResult & { subscriptionId: string })[]),
    ]);

    return Response.json({ fetchedAt: new Date().toISOString(), currency, resources, estimates, costs });
  } catch (e) {
    return errorResponse(e);
  }
}
