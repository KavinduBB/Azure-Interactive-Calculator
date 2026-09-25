import { getArmToken } from "@/lib/azure/auth";
import { listTenants } from "@/lib/azure/resources";
import { errorResponse } from "@/lib/azure/route-helpers";

export async function GET(req: Request) {
  try {
    const { token } = await getArmToken(req);
    return Response.json({ tenants: await listTenants(token) });
  } catch (e) {
    return errorResponse(e);
  }
}
