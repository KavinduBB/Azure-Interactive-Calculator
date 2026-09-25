"use client";

import { useEffect } from "react";

/** MSAL v5 redirect bridge: hands the sign-in response from the popup back to the main window. */
export default function AuthRedirect() {
  useEffect(() => {
    import("@azure/msal-browser/redirect-bridge").then((m) => m.broadcastResponseToMainFrame());
  }, []);
  return <p className="p-6 text-[13px] text-ink-2">Finishing sign-in…</p>;
}
