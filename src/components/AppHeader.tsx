import Link from "next/link";
import { Layers } from "lucide-react";

export function AppHeader({ active, right }: { active: "estimate" | "live" | "home"; right?: React.ReactNode }) {
  const tab = (href: string, key: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
        active === key ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-panel-2 hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-ink">
          <Layers size={16} aria-hidden="true" />
        </span>
        <span className="hidden sm:inline">Azure Cost Canvas</span>
      </Link>
      <nav className="flex items-center gap-1" aria-label="Main">
        {tab("/estimate", "estimate", "Estimate")}
        {tab("/live", "live", "Live subscription")}
      </nav>
      <div className="ml-auto flex items-center gap-3">{right}</div>
    </header>
  );
}
