import "server-only";
import { AzureCliCredential } from "@azure/identity";

const ARM_SCOPE = "https://management.azure.com/.default";

export type AuthMode = "cli" | "bearer";

export class AuthError extends Error {
  status = 401;
}

/**
 * CLI mode reads the developer's own `az login` session. It is only allowed
 * when running locally, or when AZURE_AUTH_MODE=cli is set explicitly, because
 * on a public deployment it would expose the host's Azure account to anyone.
 */
export function cliModeEnabled(): boolean {
  if (process.env.AZURE_AUTH_MODE === "cli") return true;
  if (process.env.AZURE_AUTH_MODE === "bearer") return false;
  return process.env.NODE_ENV !== "production";
}

/** Header the "This PC" view sends to ask for the local Azure CLI session. */
export const AUTH_SOURCE_HEADER = "x-auth-source";

let cliCredential: AzureCliCredential | null = null;

export async function getArmToken(req: Request): Promise<{ token: string; mode: AuthMode }> {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return { token: header.slice(7).trim(), mode: "bearer" };
  }
  // With Microsoft sign-in configured, the CLI session is used only when a request asks for it,
  // so the sign-in view never silently falls back to the host's account.
  const wantsCli = req.headers.get(AUTH_SOURCE_HEADER) === "cli" || !process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID;
  if (!wantsCli) {
    throw new AuthError("Sign in with Microsoft to read your Azure resources.");
  }
  if (!cliModeEnabled()) {
    throw new AuthError("The Azure CLI connection is only available when the app runs on your own computer.");
  }
  cliCredential ??= new AzureCliCredential();
  try {
    const t = await cliCredential.getToken(ARM_SCOPE);
    return { token: t.token, mode: "cli" };
  } catch {
    throw new AuthError("Azure CLI is not signed in. Run `az login` and try again.");
  }
}
