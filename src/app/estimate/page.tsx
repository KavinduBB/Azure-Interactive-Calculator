import type { Metadata } from "next";
import { EstimateClient } from "./ClientOnly";

export const metadata: Metadata = { title: "Estimate · Azure Cost Canvas" };

export default function EstimatePage() {
  return <EstimateClient />;
}
