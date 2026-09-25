import type { Metadata } from "next";
import { LiveClient } from "../live/ClientOnly";

export const metadata: Metadata = { title: "This PC (Azure CLI) · Azure Cost Canvas" };

/** Same live view, reading Azure through this computer's `az login` session instead of Microsoft sign-in. */
export default function LocalPage() {
  return <LiveClient source="cli" />;
}
