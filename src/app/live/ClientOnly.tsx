"use client";

import dynamic from "next/dynamic";

// The live view reads saved preferences from localStorage on first render, so it only renders in the browser.
const LiveView = dynamic(() => import("./LiveView"), { ssr: false });

export function LiveClient() {
  return <LiveView />;
}
