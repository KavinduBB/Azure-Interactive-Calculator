"use client";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, Download, ExternalLink, Loader2, RefreshCw, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { IMPORT_KEY, fromResource, type EstimateItem } from "@/lib/templates";
import { AppHeader } from "@/components/AppHeader";
import { MultiSelect } from "@/components/MultiSelect";
import { CategoryIcon } from "@/components/CategoryIcon";
import { StatusPill } from "@/components/StatusPill";
import { ResourceNode, type ResourceNodeData } from "@/components/diagram/ResourceNode";
import { GroupNode } from "@/components/diagram/GroupNode";
import { api, downloadCsv, readLocal, setTokenProvider, writeLocal } from "@/lib/api";
import { armToken, currentAccount, msalEnabled, signIn, signOut } from "@/lib/msal";
import { layoutGraph } from "@/lib/graph";
import { portalUrl, typeInfo } from "@/lib/catalog";
import { money, timeAgo } from "@/lib/format";
import { whatIfOptions } from "@/lib/whatif";
import { CURRENCIES, type AzureResource, type CostResult, type Currency, type ResourceEstimate, type Subscription } from "@/lib/types";

interface Snapshot {
  fetchedAt: string;
  currency: string;
  resources: AzureResource[];
  estimates: ResourceEstimate[];
  costs: (CostResult & { subscriptionId: string })[];
}
interface Status {
  connected: boolean;
  mode?: "cli" | "bearer";
  cliAvailable: boolean;
  msalConfigured: boolean;
  name?: string;
  user?: string;
  error?: string;
}
interface RG {
  name: string;
  subscriptionId: string;
  location: string;
  resourceCount: number;
}
interface Change {
  at: string;
  text: string;
  tone: "up" | "down" | "info";
}
interface WhatIf {
  label: string;
  estimate: ResourceEstimate;
}

const nodeTypes = { resource: ResourceNode, rg: GroupNode };
const REFRESH_OPTIONS = [
  { v: 0, l: "Off" },
  { v: 60, l: "Every minute" },
  { v: 300, l: "Every 5 min" },
  { v: 900, l: "Every 15 min" },
];
const COST_REFRESH_MS = 15 * 60 * 1000;
const PREFS = "acc.live.prefs.v1";

interface Prefs {
  subs: string[];
  rgs: string[];
  currency: Currency;
  hideMinor: boolean;
  refreshSec: number;
}

/** What a resource contributes to the monthly estimate: its priced lines, including the fixed part of usage-based ones. */
const monthlyOf = (e?: ResourceEstimate) => (e && (e.status === "priced" || e.status === "usage") ? e.monthly : 0);

export default function LiveView() {
  return (
    <ReactFlowProvider>
      <LiveInner />
    </ReactFlowProvider>
  );
}

function LiveInner() {
  const initial = useMemo(
    () => readLocal<Prefs>(PREFS, { subs: [], rgs: [], currency: "USD", hideMinor: true, refreshSec: 0 }),
    [],
  );
  const [status, setStatus] = useState<Status | null>(null);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [selSubs, setSelSubs] = useState<string[]>(initial.subs);
  const [rgs, setRgs] = useState<RG[]>([]);
  const [selRgs, setSelRgs] = useState<string[]>(initial.rgs);
  const [currency, setCurrency] = useState<Currency>(initial.currency);
  const [hideMinor, setHideMinor] = useState(initial.hideMinor);
  const [refreshSec, setRefreshSec] = useState(initial.refreshSec);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [whatIf, setWhatIf] = useState<Record<string, WhatIf>>({});
  const [, setClock] = useState(0);
  const [account, setAccount] = useState<string | null>(null);
  const lastCosts = useRef<{ at: number; costs: Snapshot["costs"]; currency: string } | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  const rf = useReactFlow();
  const router = useRouter();

  // Persist preferences.
  useEffect(() => {
    writeLocal(PREFS, { subs: selSubs, rgs: selRgs, currency, hideMinor, refreshSec } satisfies Prefs);
  }, [selSubs, selRgs, currency, hideMinor, refreshSec]);

  // Connection status and subscriptions. Uses the Microsoft account when signed in, otherwise local Azure CLI.
  const connect = useCallback(async () => {
    try {
      if (msalEnabled) {
        const acct = await currentAccount();
        setTokenProvider(acct ? armToken : null);
        setAccount(acct?.username ?? null);
      }
      const s = await api<Status>("/api/azure/status");
      setStatus(s);
      if (!s.connected) return;
      const r = await api<{ subscriptions: Subscription[] }>("/api/azure/subscriptions");
      setSubs(r.subscriptions);
      setSelSubs((cur) => {
        const valid = cur.filter((id) => r.subscriptions.some((x) => x.subscriptionId === id));
        return valid.length ? valid : r.subscriptions.slice(0, 1).map((x) => x.subscriptionId);
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => {
      if (alive) void connect();
    });
    return () => {
      alive = false;
    };
  }, [connect]);

  const onSignIn = async () => {
    setError(null);
    try {
      await signIn();
      snapRef.current = null;
      lastCosts.current = null;
      setSnap(null);
      await connect();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const onSignOut = async () => {
    await signOut().catch(() => undefined);
    setTokenProvider(null);
    setAccount(null);
    snapRef.current = null;
    setSnap(null);
    setSubs([]);
    await connect();
  };

  // Resource groups for the chosen subscriptions.
  useEffect(() => {
    if (!selSubs.length) return;
    let cancelled = false;
    const q = selSubs.map((s) => `subscriptionId=${s}`).join("&");
    api<{ resourceGroups: RG[] }>(`/api/azure/resource-groups?${q}`)
      .then((r) => !cancelled && setRgs(r.resourceGroups))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [selSubs]);

  const load = useCallback(
    async (opts: { silent?: boolean; forceCosts?: boolean } = {}) => {
      if (!selSubs.length) return;
      if (!opts.silent) setLoading(true);
      setError(null);
      const cached = lastCosts.current;
      const needCosts = opts.forceCosts || !cached || cached.currency !== currency || Date.now() - cached.at > COST_REFRESH_MS;
      try {
        const next = await api<Snapshot>("/api/azure/snapshot", {
          method: "POST",
          json: { subscriptionIds: selSubs, resourceGroups: selRgs, currency, withCosts: needCosts },
        });
        if (needCosts) lastCosts.current = { at: Date.now(), costs: next.costs, currency };
        else next.costs = cached!.costs;
        const prev = snapRef.current;
        if (prev && prev.currency === next.currency) {
          const found = diff(prev, next);
          if (found.length) setChanges((c) => [...found, ...c].slice(0, 40));
        }
        snapRef.current = next;
        setSnap(next);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [selSubs, selRgs, currency],
  );

  // Auto-refresh.
  useEffect(() => {
    if (!refreshSec || !snap) return;
    const t = setInterval(() => load({ silent: true }), refreshSec * 1000);
    return () => clearInterval(t);
  }, [refreshSec, load, snap]);

  // Keep "updated x ago" current.
  useEffect(() => {
    const t = setInterval(() => setClock((c) => c + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const estByKey = useMemo(() => new Map((snap?.estimates ?? []).map((e) => [e.key, e])), [snap]);
  const actualByKey = useMemo(() => {
    const m = new Map<string, { cost: number; currency: string }>();
    for (const c of snap?.costs ?? []) if (c.available) for (const r of c.byResource) m.set(r.key, { cost: r.cost, currency: r.currency });
    return m;
  }, [snap]);

  const layout = useMemo(() => {
    if (!snap) return { nodes: [] as Node[], edges: [] };
    const l = layoutGraph(snap.resources, {
      hideMinor,
      costOf: (k) => monthlyOf(estByKey.get(k)),
      nodeData: (r): ResourceNodeData => ({
        resource: r,
        estimate: estByKey.get(r.key),
        actual: actualByKey.get(r.key)?.cost,
        actualCurrency: actualByKey.get(r.key)?.currency,
        currency: snap.currency,
        whatIf: whatIf[r.key]?.estimate.monthly,
      }),
    });
    l.nodes = l.nodes.map((n) => (n.type === "rg" ? { ...n, data: { ...n.data, currency: snap.currency } } : n));
    return l;
  }, [snap, hideMinor, estByKey, actualByKey, whatIf]);

  // Controlled nodes that keep user-dragged positions across refreshes.
  const [nodes, setNodes] = useState<Node[]>([]);
  const [layoutSeen, setLayoutSeen] = useState(layout);
  if (layout !== layoutSeen) {
    setLayoutSeen(layout);
    const old = new Map(nodes.map((n) => [n.id, n]));
    setNodes(
      layout.nodes.map((n) => {
        const o = old.get(n.id);
        return o ? { ...n, position: o.position, selected: o.selected } : n;
      }),
    );
  }
  const onNodesChange = useCallback((c: NodeChange[]) => setNodes((ns) => applyNodeChanges(c, ns)), []);

  // Fit the view when the set of groups changes (new selection), not on every refresh.
  const groupKey = useMemo(() => layout.nodes.filter((n) => n.type === "rg").map((n) => n.id).join(","), [layout]);
  useEffect(() => {
    if (!groupKey) return;
    const t = setTimeout(() => rf.fitView({ padding: 0.08, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [groupKey, rf]);

  const edges = useMemo(
    () =>
      layout.edges.map((e) =>
        selected && (e.source === selected || e.target === selected)
          ? { ...e, animated: true, style: { stroke: "var(--accent)", strokeWidth: 2 } }
          : e,
      ),
    [layout.edges, selected],
  );

  const focus = useCallback(
    (key: string) => {
      setSelected(key);
      setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === key })));
      setTimeout(() => rf.fitView({ nodes: [{ id: key }], duration: 400, maxZoom: 1.1, padding: 0.6 }), 30);
    },
    [rf],
  );

  const totals = useMemo(() => {
    const t = { monthly: 0, priced: 0, usage: 0, free: 0, unknown: 0, stopped: 0, whatIf: 0 };
    for (const e of snap?.estimates ?? []) {
      t.monthly += monthlyOf(e);
      t[e.status] += 1;
      t.whatIf += whatIf[e.key] ? monthlyOf(whatIf[e.key].estimate) : monthlyOf(e);
    }
    return t;
  }, [snap, whatIf]);

  const exportCsv = () => {
    if (!snap) return;
    const rows: (string | number)[][] = [["Name", "Type", "Resource group", "Region", "SKU", "Status", `Estimated monthly (${snap.currency})`, "Actual month to date", "Note"]];
    for (const r of snap.resources) {
      const e = estByKey.get(r.key);
      rows.push([r.name, typeInfo(r.type).label, r.resourceGroup, r.location, r.sku?.name ?? "", e?.status ?? "", e ? e.monthly.toFixed(2) : "", actualByKey.get(r.key)?.cost.toFixed(2) ?? "", e?.note ?? ""]);
    }
    downloadCsv(`azure-costs-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const copyToEstimate = () => {
    if (!snap) return;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const items: Omit<EstimateItem, "id">[] = [];
    for (const r of snap.resources) {
      const mapped = fromResource(r);
      const n = byId.get(r.key);
      if (!mapped || !n) continue;
      const parent = n.parentId ? byId.get(n.parentId) : undefined;
      items.push({ ...mapped, position: { x: n.position.x + (parent?.position.x ?? 0), y: n.position.y + (parent?.position.y ?? 0) } });
    }
    writeLocal(IMPORT_KEY, items);
    router.push("/estimate");
  };

  const subOptions = subs.map((s) => ({ value: s.subscriptionId, label: s.displayName, hint: s.state !== "Enabled" ? s.state : undefined }));
  const rgOptions = [...new Map(rgs.map((g) => [g.name.toLowerCase(), g])).values()].map((g) => ({
    value: g.name.toLowerCase(),
    label: g.name,
    hint: `${g.resourceCount}`,
  }));

  const statusChip = (
    <>
      {status?.connected && (
        <span className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[12px] text-ink-2">
          <span className="h-2 w-2 rounded-full bg-good" aria-hidden="true" />
          {status.mode === "cli" ? "Azure CLI" : "Microsoft account"}
          {status.user ? ` · ${status.user}` : ""}
        </span>
      )}
      {msalEnabled &&
        (account ? (
          <button type="button" onClick={onSignOut} className="text-[13px] text-ink-2 hover:text-ink hover:underline">Sign out</button>
        ) : (
          <button type="button" onClick={onSignIn} className="rounded-md border border-line px-3 py-1.5 text-[13px] font-medium hover:border-accent">
            Sign in with Microsoft
          </button>
        ))}
    </>
  );

  return (
    <div className="flex h-screen flex-col">
      <AppHeader active="live" right={statusChip} />

      {status && !status.connected ? (
        <NotConnected status={status} onSignIn={onSignIn} />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 border-b border-line bg-panel px-4 py-3">
            <MultiSelect label="Subscriptions" options={subOptions} value={selSubs} onChange={setSelSubs} placeholder="Choose subscriptions" />
            <MultiSelect label="Resource groups" options={rgOptions} value={selRgs} onChange={setSelRgs} placeholder="All" allLabel="All resource groups" />
            <label className="flex flex-col">
              <span className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className="h-9 rounded-md border border-line bg-panel px-2 text-[13px]">
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col">
              <span className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Auto-refresh</span>
              <select value={refreshSec} onChange={(e) => setRefreshSec(Number(e.target.value))} className="h-9 rounded-md border border-line bg-panel px-2 text-[13px]">
                {REFRESH_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </label>
            <label className="flex h-9 items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={hideMinor} onChange={(e) => setHideMinor(e.target.checked)} className="accent-[var(--accent)]" />
              Hide NICs, NSGs and links
            </label>
            <div className="ml-auto flex items-center gap-2">
              {snap && <span className="text-[12px] text-muted">Updated {timeAgo(snap.fetchedAt)}</span>}
              <button
                type="button"
                onClick={copyToEstimate}
                disabled={!snap}
                title="Open these resources in the estimate builder to try changes"
                className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-panel px-3 text-[13px] hover:border-line-strong disabled:opacity-50"
              >
                <Copy size={14} aria-hidden="true" /> Copy to estimate
              </button>
              <button
                type="button"
                onClick={exportCsv}
                disabled={!snap}
                className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-panel px-3 text-[13px] hover:border-line-strong disabled:opacity-50"
              >
                <Download size={14} aria-hidden="true" /> CSV
              </button>
              <button
                type="button"
                onClick={() => load({ forceCosts: true })}
                disabled={!selSubs.length || loading}
                className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                {snap ? "Refresh" : "Load resources"}
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="flex items-center gap-2 border-b border-line bg-crit-soft px-4 py-2 text-[13px] text-crit">
              <AlertTriangle size={14} aria-hidden="true" /> {error}
            </div>
          )}

          <div className="flex min-h-0 flex-1">
            <div className="relative min-w-0 flex-1">
              {snap ? (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onNodeClick={(_, n) => n.type === "resource" && setSelected(n.id)}
                  onPaneClick={() => setSelected(null)}
                  minZoom={0.1}
                  maxZoom={2}
                  proOptions={{ hideAttribution: false }}
                >
                  <Background gap={24} color="var(--grid)" />
                  <Controls showInteractive={false} />
                  <MiniMap pannable zoomable nodeColor={(n) => (n.type === "rg" ? "transparent" : "var(--line-strong)")} maskColor="color-mix(in srgb, var(--bg) 70%, transparent)" />
                </ReactFlow>
              ) : (
                <EmptyCanvas loading={loading || !status} canLoad={selSubs.length > 0} onLoad={() => load({ forceCosts: true })} />
              )}
              {loading && snap && (
                <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-[12px] shadow">
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Reading resources and prices
                </div>
              )}
            </div>

            <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-panel" aria-label="Costs">
              <Summary snap={snap} totals={totals} currency={snap?.currency ?? currency} />
              {selected && snap && estByKey.get(selected) ? (
                <Details
                  key={selected}
                  resource={snap.resources.find((r) => r.key === selected)!}
                  estimate={estByKey.get(selected)!}
                  actual={actualByKey.get(selected)}
                  currency={snap.currency}
                  whatIf={whatIf[selected]}
                  onWhatIf={(w) => setWhatIf((cur) => {
                    const next = { ...cur };
                    if (w) next[selected] = w;
                    else delete next[selected];
                    return next;
                  })}
                  onClose={() => setSelected(null)}
                />
              ) : (
                <ResourceList snap={snap} estByKey={estByKey} changes={changes} onPick={focus} />
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function diff(prev: Snapshot, next: Snapshot): Change[] {
  const at = next.fetchedAt;
  const out: Change[] = [];
  const pe = new Map(prev.estimates.map((e) => [e.key, e]));
  const ne = new Map(next.estimates.map((e) => [e.key, e]));
  const pr = new Map(prev.resources.map((r) => [r.key, r]));
  const nr = new Map(next.resources.map((r) => [r.key, r]));
  for (const [k, r] of nr) {
    if (!pr.has(k)) out.push({ at, tone: "up", text: `${r.name} was created (${typeInfo(r.type).label})` });
  }
  for (const [k, r] of pr) {
    if (!nr.has(k)) out.push({ at, tone: "down", text: `${r.name} was deleted` });
  }
  for (const [k, e] of ne) {
    const p = pe.get(k);
    if (!p || !nr.has(k)) continue;
    const name = nr.get(k)!.name;
    if (p.status !== e.status && (e.status === "stopped" || p.status === "stopped")) {
      out.push({ at, tone: e.status === "stopped" ? "down" : "up", text: `${name} ${e.status === "stopped" ? "stopped" : "started"}` });
    } else if (Math.abs(p.monthly - e.monthly) >= 0.5) {
      const d = e.monthly - p.monthly;
      out.push({ at, tone: d > 0 ? "up" : "down", text: `${name} changed: ${d > 0 ? "+" : "−"}${money(Math.abs(d), next.currency)}/mo` });
    }
  }
  return out;
}

function NotConnected({ status, onSignIn }: { status: Status; onSignIn: () => void }) {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="max-w-lg rounded-xl border border-line bg-panel p-6">
        <h1 className="text-lg font-semibold">Connect to Azure</h1>
        {msalEnabled ? (
          <>
            <p className="mt-2 text-ink-2">
              Sign in with the Microsoft work account you use for the Azure portal. The app asks for read access to Azure Resource Manager and never changes your resources.
            </p>
            <button type="button" onClick={onSignIn} className="mt-4 rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink">
              Sign in with Microsoft
            </button>
          </>
        ) : status.cliAvailable ? (
          <>
            <p className="mt-2 text-ink-2">
              This app is running locally, so it can use your Azure CLI sign-in. Open a terminal on this machine and run:
            </p>
            <pre className="mt-3 rounded-md bg-panel-2 px-3 py-2 font-mono text-[13px]">az login</pre>
            <p className="mt-3 text-ink-2">Then reload this page. Reader access to a subscription is enough to see resources.</p>
          </>
        ) : (
          <p className="mt-2 text-ink-2">
            Microsoft sign-in isn&apos;t configured on this deployment yet. Set <code className="font-mono">NEXT_PUBLIC_ENTRA_CLIENT_ID</code> to an Entra app registration to enable it.
          </p>
        )}
        {status.error && <p className="mt-3 text-[13px] text-muted">Details: {status.error}</p>}
      </div>
    </div>
  );
}

function EmptyCanvas({ loading, canLoad, onLoad }: { loading: boolean; canLoad: boolean; onLoad: () => void }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md text-center">
        {loading ? (
          <Loader2 className="mx-auto animate-spin text-muted" aria-label="Loading" />
        ) : (
          <>
            <h2 className="text-base font-semibold">See your architecture and what it costs</h2>
            <p className="mt-2 text-ink-2">
              Pick a subscription and, optionally, some resource groups. Each resource is priced from its real size and tier using Azure&apos;s public price list.
            </p>
            <button
              type="button"
              disabled={!canLoad}
              onClick={onLoad}
              className="mt-4 rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50"
            >
              Load resources
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Summary({ snap, totals, currency }: { snap: Snapshot | null; totals: { monthly: number; priced: number; usage: number; free: number; unknown: number; stopped: number; whatIf: number }; currency: string }) {
  const costs = snap?.costs ?? [];
  const actual = costs.filter((c) => c.available);
  const unavailable = costs.find((c) => !c.available);
  const delta = totals.whatIf - totals.monthly;
  return (
    <div className="border-b border-line p-4">
      <div className="text-[12px] text-ink-2">Estimated monthly cost, at list price</div>
      <div className="mt-0.5 text-3xl font-semibold tracking-tight tabular">{snap ? money(totals.monthly, currency) : "–"}</div>
      {snap && Math.abs(delta) >= 0.01 && (
        <div className="mt-1 text-[13px] tabular">
          With your what-if changes: <b>{money(totals.whatIf, currency)}</b>{" "}
          <span className={delta < 0 ? "text-good" : "text-crit"}>({delta < 0 ? "−" : "+"}{money(Math.abs(delta), currency)})</span>
        </div>
      )}
      {snap && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
          <span>{totals.priced} priced</span>
          <span>{totals.usage} usage-based</span>
          <span>{totals.free} free</span>
          {totals.stopped > 0 && <span>{totals.stopped} stopped</span>}
          {totals.unknown > 0 && <span>{totals.unknown} not priced</span>}
        </div>
      )}
      {actual.length > 0 && (
        <div className="mt-3 rounded-md bg-panel-2 px-3 py-2 text-[13px]">
          Actual cost this month so far:{" "}
          <b className="tabular">{money(actual.reduce((a, c) => a + c.total, 0), actual[0].currency ?? currency)}</b>
        </div>
      )}
      {unavailable && (
        <p className="mt-3 flex gap-2 rounded-md bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{unavailable.reason}</span>
        </p>
      )}
    </div>
  );
}

function ResourceList({ snap, estByKey, changes, onPick }: { snap: Snapshot | null; estByKey: Map<string, ResourceEstimate>; changes: Change[]; onPick: (k: string) => void }) {
  const [tab, setTab] = useState<"resources" | "changes">("resources");
  const [q, setQ] = useState("");
  if (!snap) return <div className="p-4 text-[13px] text-muted">Resources appear here once loaded.</div>;
  const list = snap.resources
    .filter((r) => !q || `${r.name} ${r.resourceGroup} ${typeInfo(r.type).label}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => monthlyOf(estByKey.get(b.key)) - monthlyOf(estByKey.get(a.key)) || a.name.localeCompare(b.name));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1 border-b border-line px-3 pt-2" role="tablist">
        {(["resources", "changes"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium ${tab === t ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t === "resources" ? `Resources (${snap.resources.length})` : `Changes${changes.length ? ` (${changes.length})` : ""}`}
          </button>
        ))}
      </div>
      {tab === "resources" ? (
        <>
          <div className="flex items-center gap-2 border-b border-line px-4 py-2">
            <Search size={14} className="text-muted" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search resources" aria-label="Search resources" className="w-full bg-transparent text-[13px] outline-none" />
          </div>
          <ul className="min-h-0 flex-1 overflow-auto">
            {list.map((r) => {
              const info = typeInfo(r.type);
              return (
                <li key={r.key}>
                  <button type="button" onClick={() => onPick(r.key)} className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-panel-2">
                    <CategoryIcon category={info.category} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{r.name}</span>
                      <span className="block truncate text-[11.5px] text-muted">{info.label} · {r.resourceGroup}</span>
                    </span>
                    <StatusPill estimate={estByKey.get(r.key)} currency={snap.currency} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto p-2">
          {changes.length === 0 && (
            <li className="p-3 text-[13px] text-muted">
              Nothing has changed since you loaded. Turn on auto-refresh to watch for new, deleted, started and stopped resources and price changes.
            </li>
          )}
          {changes.map((c, i) => (
            <li key={`${c.at}-${i}`} className="flex gap-2 rounded-md px-2 py-1.5 text-[13px]">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${c.tone === "up" ? "bg-crit" : c.tone === "down" ? "bg-good" : "bg-accent"}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">{c.text}</span>
              <span className="shrink-0 text-[11.5px] text-muted">{timeAgo(c.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Details({
  resource,
  estimate,
  actual,
  currency,
  whatIf,
  onWhatIf,
  onClose,
}: {
  resource: AzureResource;
  estimate: ResourceEstimate;
  actual?: { cost: number; currency: string };
  currency: string;
  whatIf?: WhatIf;
  onWhatIf: (w: WhatIf | null) => void;
  onClose: () => void;
}) {
  const info = typeInfo(resource.type);
  const options = whatIfOptions(resource);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const runWhatIf = async (idx: number) => {
    if (idx < 0) return onWhatIf(null);
    const opt = options[idx];
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ estimates: ResourceEstimate[] }>("/api/estimate", { method: "POST", json: { resources: [opt.apply(resource)], currency } });
      onWhatIf({ label: opt.label, estimate: r.estimates[0] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const facts: [string, string | undefined][] = [
    ["Resource group", resource.resourceGroup],
    ["Region", resource.location],
    ["SKU", resource.sku?.name ?? ((resource.properties.hardwareProfile as { vmSize?: string } | undefined)?.vmSize)],
    ["Tier", resource.sku?.tier],
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex items-start gap-3 border-b border-line p-4">
        <CategoryIcon category={info.category} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold" title={resource.name}>{resource.name}</h2>
          <div className="text-[12.5px] text-ink-2">{info.label}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded p-1 text-muted hover:bg-panel-2 hover:text-ink">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
          {facts.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11.5px] text-muted">{k}</dt>
              <dd className="truncate">{v}</dd>
            </div>
          ))}
        </dl>

        <section>
          <div className="flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold">Estimated cost</h3>
            <StatusPill estimate={estimate} currency={currency} />
          </div>
          {estimate.lines.length > 0 && (
            <table className="mt-2 w-full text-[12.5px]">
              <tbody>
                {estimate.lines.map((l, i) => (
                  <tr key={i} className="border-t border-line align-top">
                    <td className="py-1.5 pr-2">
                      {l.label}
                      <div className="text-[11px] text-muted">
                        {money(l.unitPrice, currency)} per {l.unit.replace(/^1 /, "").replace(/^1\//, "")}
                      </div>
                    </td>
                    <td className="py-1.5 text-right font-mono tabular">{money(l.monthly, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {estimate.note && <p className="mt-2 text-[12.5px] text-ink-2">{estimate.note}</p>}
          {actual && (
            <p className="mt-2 rounded-md bg-panel-2 px-3 py-2 text-[12.5px]">
              Actual this month so far: <b className="tabular">{money(actual.cost, actual.currency)}</b>
            </p>
          )}
        </section>

        {options.length > 0 && (
          <section>
            <h3 className="text-[13px] font-semibold">What if</h3>
            <p className="mt-0.5 text-[12px] text-muted">Price this resource with a different size or tier. Nothing changes in Azure.</p>
            <select
              aria-label="Compare with"
              className="mt-2 h-9 w-full rounded-md border border-line bg-panel px-2 text-[13px]"
              value={whatIf ? options.findIndex((o) => o.label === whatIf.label) : -1}
              onChange={(e) => runWhatIf(Number(e.target.value))}
              disabled={busy}
            >
              <option value={-1}>Current configuration</option>
              {options.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
            </select>
            {busy && <p className="mt-2 text-[12.5px] text-muted">Pricing…</p>}
            {err && <p className="mt-2 text-[12.5px] text-crit">{err}</p>}
            {whatIf && !busy && (
              <div className="mt-2 rounded-md border border-line px-3 py-2 text-[13px]">
                <div className="flex justify-between"><span>{whatIf.label}</span><b className="tabular">{money(monthlyOf(whatIf.estimate), currency)}/mo</b></div>
                {(() => {
                  const d = monthlyOf(whatIf.estimate) - monthlyOf(estimate);
                  return (
                    <div className={`text-[12.5px] tabular ${d < 0 ? "text-good" : d > 0 ? "text-crit" : "text-muted"}`}>
                      {d === 0 ? "No change" : `${d < 0 ? "Saves" : "Adds"} ${money(Math.abs(d), currency)} a month`}
                    </div>
                  );
                })()}
              </div>
            )}
          </section>
        )}

        <a href={portalUrl(resource.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline">
          Open in Azure portal <ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
