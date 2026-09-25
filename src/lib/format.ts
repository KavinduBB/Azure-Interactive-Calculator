import type { ResourceEstimate } from "./types";

export function money(n: number, currency = "USD", compact = false) {
  const opts: Intl.NumberFormatOptions = {
    style: "currency",
    currency,
    maximumFractionDigits: compact || Math.abs(n) >= 100 ? 0 : 2,
    minimumFractionDigits: compact || Math.abs(n) >= 100 ? 0 : 2,
  };
  if (compact && Math.abs(n) >= 10000) opts.notation = "compact";
  try {
    return new Intl.NumberFormat("en-US", opts).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function estimateLabel(e: ResourceEstimate | undefined, currency: string) {
  if (!e) return "…";
  switch (e.status) {
    case "priced": return `${money(e.monthly, currency)}/mo`;
    case "free": return "Free";
    case "stopped": return "Stopped";
    case "usage": return e.monthly > 0 ? `${money(e.monthly, currency)}+ /mo` : "Usage-based";
    default: return "Not priced";
  }
}

export function timeAgo(iso: string | undefined) {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}
