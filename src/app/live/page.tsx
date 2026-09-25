import type { Metadata } from "next";
import { LiveClient } from "./ClientOnly";

export const metadata: Metadata = { title: "Live subscription · Azure Cost Canvas" };

export default function LivePage() {
  return <LiveClient />;
}
