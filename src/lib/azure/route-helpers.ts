import "server-only";
import { AuthError } from "./auth";
import { ArmError } from "./arm";

export function errorResponse(e: unknown) {
  if (e instanceof AuthError) return Response.json({ error: e.message, code: "auth" }, { status: 401 });
  if (e instanceof ArmError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  console.error(e);
  return Response.json({ error: (e as Error)?.message ?? "Unexpected error" }, { status: 500 });
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isGuid(s: unknown): s is string {
  return typeof s === "string" && GUID.test(s);
}
