import Link from "next/link";
import { ArrowRight, Calculator, Radar } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader active="home" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance">
          See what your Azure architecture costs, before you build it and while it runs.
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] text-ink-2">
          Prices come from Azure&apos;s public price list and are matched to each resource&apos;s real size, tier and region.
          Connect a subscription and your resources are drawn as a diagram, grouped by resource group, with a monthly cost on every card.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Link href="/estimate" className="group rounded-xl border border-line bg-panel p-6 hover:border-accent">
            <Calculator className="text-accent" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold">Build an estimate</h2>
            <p className="mt-1 text-ink-2">
              Add VMs, App Service plans, databases and storage to a canvas, connect them, and watch the monthly total update as you change sizes and regions.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-accent">
              Start estimating <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </Link>
          <Link href="/live" className="group rounded-xl border border-line bg-panel p-6 hover:border-accent">
            <Radar className="text-accent" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold">Connect your subscription</h2>
            <p className="mt-1 text-ink-2">
              Pick subscriptions and resource groups. Get a live diagram, a price for every resource, actual month-to-date spend where Azure provides it, and what-if pricing for other sizes.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-accent">
              Open live view <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </Link>
        </div>

        <section className="mt-12 grid gap-6 text-[13px] text-ink-2 md:grid-cols-3">
          <div>
            <h3 className="font-semibold text-ink">Read-only</h3>
            <p className="mt-1">The app only reads resource metadata and prices. It never changes anything in your subscription. Reader access is enough.</p>
          </div>
          <div>
            <h3 className="font-semibold text-ink">Estimates and actuals</h3>
            <p className="mt-1">Estimates use pay-as-you-go list prices. Where Cost Management has data, actual spend this month is shown beside them.</p>
          </div>
          <div>
            <h3 className="font-semibold text-ink">What it doesn&apos;t price yet</h3>
            <p className="mt-1">Usage-based services such as bandwidth, Functions executions and log ingestion are marked as usage-based rather than guessed.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
