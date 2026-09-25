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

let cliCredential: AzureCliCredential | null = null;

export async function getArmToken(req: Request): Promise<{ token: string; mode: AuthMode }> {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return { token: header.slice(7).trim(), mode: "bearer" };
  }
  if (!cliModeEnabled()) {
    throw new AuthError("Sign in with Microsoft to read your Azure resources.");
  }
  cliCredential ??= new AzureCliCredential();
  try {
    const t = await cliCredential.getToken(ARM_SCOPE);
    return { token: t.token, mode: "cli" };
  } catch {
    throw new AuthError("Azure CLI is not signed in. Run `az login` and try again.");
  }
}
