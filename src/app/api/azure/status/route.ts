import { cliModeEnabled, getArmToken } from "@/lib/azure/auth";

/** Reads display claims from the token without verifying it; used only to show who is signed in. */
function whoIs(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return { name: payload.name as string | undefined, user: (payload.upn ?? payload.unique_name ?? payload.email) as string | undefined, tenantId: payload.tid as string | undefined };
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  const cli = cliModeEnabled();
  const msal = Boolean(process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID);
  try {
    const { token, mode } = await getArmToken(req);
    return Response.json({ connected: true, mode, cliAvailable: cli, msalConfigured: msal, ...whoIs(token) });
  } catch (e) {
    return Response.json({ connected: false, cliAvailable: cli, msalConfigured: msal, error: (e as Error).message });
  }
}
