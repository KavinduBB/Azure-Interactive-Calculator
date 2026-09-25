"use client";

import dynamic from "next/dynamic";
import type { Source } from "./LiveView";

// The live view reads saved preferences from localStorage on first render, so it only renders in the browser.
const LiveView = dynamic(() => import("./LiveView"), { ssr: false });

export function LiveClient({ source = "microsoft" }: { source?: Source }) {
  return <LiveView source={source} />;
}
