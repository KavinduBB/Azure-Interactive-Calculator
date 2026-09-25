import { getArmToken } from "@/lib/azure/auth";
import { listResourceGroups } from "@/lib/azure/resources";
import { errorResponse, isGuid } from "@/lib/azure/route-helpers";

export async function GET(req: Request) {
  try {
    const ids = new URL(req.url).searchParams.getAll("subscriptionId").filter(isGuid);
    if (!ids.length) return Response.json({ error: "Pick at least one subscription." }, { status: 400 });
    const { token } = await getArmToken(req);
    return Response.json({ resourceGroups: await listResourceGroups(token, ids) });
  } catch (e) {
    return errorResponse(e);
  }
}
