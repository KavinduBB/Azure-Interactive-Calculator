"use client";

import {
  InteractionRequiredAuthError,
  createStandardPublicClientApplication,
  type AccountInfo,
  type IPublicClientApplication,
} from "@azure/msal-browser";

/**
 * Microsoft sign-in for people connecting their own Azure. Enabled when
 * NEXT_PUBLIC_ENTRA_CLIENT_ID points at a multi-tenant Entra app registration
 * (SPA platform, redirect URI <origin>/auth/redirect, delegated permission
 * "Azure Service Management / user_impersonation").
 */
const clientId = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID;
const authority = process.env.NEXT_PUBLIC_ENTRA_AUTHORITY ?? "https://login.microsoftonline.com/organizations";
const ARM_SCOPES = ["https://management.azure.com/user_impersonation"];

export const msalEnabled = Boolean(clientId);

let pca: Promise<IPublicClientApplication> | null = null;

function client() {
  if (!clientId) return null;
  pca ??= createStandardPublicClientApplication({
    auth: { clientId, authority, redirectUri: `${window.location.origin}/auth/redirect` },
    cache: { cacheLocation: "sessionStorage" },
  });
  return pca;
}

export async function currentAccount(): Promise<AccountInfo | null> {
  const app = await client();
  if (!app) return null;
  return app.getActiveAccount() ?? app.getAllAccounts()[0] ?? null;
}

export async function signIn(): Promise<AccountInfo | null> {
  const app = await client();
  if (!app) return null;
  const r = await app.loginPopup({ scopes: ARM_SCOPES, prompt: "select_account" });
  app.setActiveAccount(r.account);
  return r.account;
}

export async function signOut() {
  const app = await client();
  const account = await currentAccount();
  if (app && account) await app.logoutPopup({ account });
}

/** An access token for Azure Resource Manager, or null when nobody is signed in. */
export async function armToken(): Promise<string | null> {
  const app = await client();
  const account = await currentAccount();
  if (!app || !account) return null;
  try {
    return (await app.acquireTokenSilent({ scopes: ARM_SCOPES, account })).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      return (await app.acquireTokenPopup({ scopes: ARM_SCOPES, account })).accessToken;
    }
    throw e;
  }
}
