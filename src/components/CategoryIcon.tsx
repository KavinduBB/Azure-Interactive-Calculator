import { Activity, Box, Container, Database, Globe, HardDrive, Network, Server, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import type { Category } from "@/lib/catalog";

const ICONS: Record<Category, typeof Box> = {
  compute: Server,
  web: Globe,
  data: Database,
  storage: HardDrive,
  network: Network,
  containers: Container,
  ai: Sparkles,
  monitoring: Activity,
  security: ShieldCheck,
  integration: Workflow,
  other: Box,
};

export function CategoryIcon({ category, size = 32 }: { category: Category; size?: number }) {
  const Icon = ICONS[category];
  const color = `var(--cat-${category})`;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-md"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.55)} strokeWidth={1.8} />
    </span>
  );
}
