import { getArmToken } from "@/lib/azure/auth";
import { listSubscriptions } from "@/lib/azure/resources";
import { errorResponse } from "@/lib/azure/route-helpers";

export async function GET(req: Request) {
  try {
    const { token } = await getArmToken(req);
    return Response.json({ subscriptions: await listSubscriptions(token) });
  } catch (e) {
    return errorResponse(e);
  }
}
