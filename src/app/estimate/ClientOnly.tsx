"use client";

import dynamic from "next/dynamic";

// Reads the saved estimate from localStorage on first render, so it only renders in the browser.
const EstimateView = dynamic(() => import("./EstimateView"), { ssr: false });

export function EstimateClient() {
  return <EstimateView />;
}
