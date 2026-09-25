"use client";

import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Plus, Trash2, X } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { CategoryIcon } from "@/components/CategoryIcon";
import { StatusPill } from "@/components/StatusPill";
import { ResourceNode, type ResourceNodeData } from "@/components/diagram/ResourceNode";
import { api, downloadCsv, readLocal, writeLocal } from "@/lib/api";
import { money } from "@/lib/format";
import {
  IMPORT_KEY,
  TEMPLATES,
  scaleEstimate,
  templateById,
  toResource,
  type Config,
  type EstimateItem,
} from "@/lib/templates";
import { CURRENCIES, type Currency, type ResourceEstimate } from "@/lib/types";

const nodeTypes = { resource: ResourceNode };
const SAVE_KEY = "acc.estimate.v1";

interface Saved {
  items: EstimateItem[];
  edges: { id: string; source: string; target: string }[];
  currency: Currency;
  example?: boolean;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** Nearest position to `want` where a new card doesn't overlap an existing one, searching in rings. */
function freeSpot(want: { x: number; y: number }, nodes: Node[]) {
  const W = 236 + 24, H = 78 + 20;
  const clear = (p: { x: number; y: number }) =>
    nodes.every((n) => Math.abs(n.position.x - p.x) >= W || Math.abs(n.position.y - p.y) >= H);
  if (clear(want)) return want;
  for (let ring = 1; ring < 12; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const p = { x: want.x + dx * W, y: want.y + dy * H };
        if (clear(p)) return p;
      }
    }
  }
  return { x: want.x, y: want.y + nodes.length * 20 };
}

function exampleEstimate(): Saved {
  const mk = (template: string, name: string, x: number, y: number, config: Config = {}): EstimateItem => ({
    id: uid(),
    template,
    name,
    position: { x, y },
    config: { ...templateById.get(template)!.defaults, ...config },
  });
  const web = mk("static", "frontend", 0, 80);
  const plan = mk("plan", "api-plan", 320, 80);
  const sql = mk("sql", "app-db", 640, 0);
  const blob = mk("storage", "uploads", 640, 170);
  return {
    items: [web, plan, sql, blob],
    edges: [
      { id: uid(), source: web.id, target: plan.id },
      { id: uid(), source: plan.id, target: sql.id },
      { id: uid(), source: plan.id, target: blob.id },
    ],
    currency: "USD",
    example: true,
  };
}

export default function EstimateView() {
  return (
    <ReactFlowProvider>
      <EstimateInner />
    </ReactFlowProvider>
  );
}

function EstimateInner() {
  const initial = useMemo(() => readLocal<Saved | null>(SAVE_KEY, null) ?? exampleEstimate(), []);
  const pendingImport = useMemo(() => readLocal<Omit<EstimateItem, "id">[] | null>(IMPORT_KEY, null), []);
  const [items, setItems] = useState<EstimateItem[]>(initial.items);
  const [nodes, setNodes] = useState<Node[]>(() => initial.items.map((i) => ({ id: i.id, type: "resource", position: i.position, data: {} })));
  const [edges, setEdges] = useState<Edge[]>(() => initial.edges.map((e) => ({ ...e, type: "smoothstep" })));
  const [currency, setCurrency] = useState<Currency>(initial.currency);
  const [isExample, setIsExample] = useState(Boolean(initial.example));
  const [importOffer, setImportOffer] = useState(pendingImport);
  const [selected, setSelected] = useState<string | null>(null);
  const [pricing, setPricing] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priced, setPriced] = useState<Record<string, ResourceEstimate>>({});
  const rf = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  const cacheKey = useCallback((item: EstimateItem) => `${currency}|${item.template}|${JSON.stringify(item.config)}`, [currency]);

  // Save.
  useEffect(() => {
    const pos = new Map(nodes.map((n) => [n.id, n.position]));
    writeLocal(SAVE_KEY, {
      items: items.map((i) => ({ ...i, position: pos.get(i.id) ?? i.position })),
      edges: edges.map(({ id, source, target }) => ({ id, source, target })),
      currency,
      example: isExample,
    } satisfies Saved);
  }, [items, nodes, edges, currency, isExample]);

  // Price items whose configuration hasn't been priced yet.
  useEffect(() => {
    const todo = items.filter((i) => templateById.get(i.template)?.build && !priced[cacheKey(i)]);
    if (!todo.length) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setPricing(true);
      setPriceError(null);
      try {
        const r = await api<{ estimates: ResourceEstimate[] }>("/api/estimate", {
          method: "POST",
          json: { currency, resources: todo.map(toResource) },
        });
        if (cancelled) return;
        setPriced((p) => {
          const next = { ...p };
          todo.forEach((item, i) => (next[cacheKey(item)] = r.estimates[i]));
          return next;
        });
      } catch (e) {
        if (!cancelled) setPriceError((e as Error).message);
      } finally {
        if (!cancelled) setPricing(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [items, currency, cacheKey, priced]);

  const estimateFor = useCallback(
    (item: EstimateItem): ResourceEstimate | undefined => {
      const t = templateById.get(item.template)!;
      if (t.manual) {
        const amount = t.manual(item.config);
        return { key: item.id, status: "priced", monthly: amount, currency, lines: [{ label: "Entered amount", unitPrice: amount, unit: "1/Month", quantity: 1, monthly: amount }] };
      }
      const e = priced[cacheKey(item)];
      return e ? scaleEstimate(e, t.multiplier?.(item.config) ?? 1) : undefined;
    },
    [cacheKey, currency, priced],
  );

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const displayNodes = nodes.map((n) => {
    const item = itemById.get(n.id);
    if (!item) return n;
    return {
      ...n,
      data: { resource: toResource(item), estimate: estimateFor(item), currency } satisfies ResourceNodeData,
    };
  });

  const total = items.reduce((a, i) => {
    const e = estimateFor(i);
    return a + (e && (e.status === "priced" || e.status === "usage") ? e.monthly : 0);
  }, 0);

  const onNodesChange = useCallback((c: NodeChange[]) => setNodes((ns) => applyNodeChanges(c, ns)), []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => setEdges((es) => applyEdgeChanges(c, es)), []);
  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, type: "smoothstep" }, es)), []);
  const onNodesDelete = useCallback((deleted: Node[]) => {
    const ids = new Set(deleted.map((d) => d.id));
    setItems((is) => is.filter((i) => !ids.has(i.id)));
    setSelected((s) => (s && ids.has(s) ? null : s));
  }, []);

  const addItem = (templateId: string) => {
    const t = templateById.get(templateId)!;
    const box = canvasRef.current?.getBoundingClientRect();
    const center = box ? rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : { x: 0, y: 0 };
    const count = items.filter((i) => i.template === templateId).length + 1;
    const item: EstimateItem = {
      id: uid(),
      template: templateId,
      name: `${t.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}-${count}`,
      config: { ...t.defaults },
      position: freeSpot({ x: center.x - 118, y: center.y - 39 }, nodes),
    };
    setItems((is) => [...is, item]);
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id: item.id, type: "resource", position: item.position, data: {}, selected: true }]);
    setSelected(item.id);
    setIsExample(false);
  };

  const updateItem = (id: string, patch: Partial<EstimateItem>) => {
    setItems((is) => is.map((i) => (i.id === id ? { ...i, ...patch, config: { ...i.config, ...(patch.config ?? {}) } } : i)));
    setIsExample(false);
  };

  const removeItem = (id: string) => {
    setItems((is) => is.filter((i) => i.id !== id));
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelected(null);
  };

  const clearAll = () => {
    setItems([]);
    setNodes([]);
    setEdges([]);
    setSelected(null);
    setIsExample(false);
  };

  const acceptImport = (mode: "replace" | "add") => {
    if (!importOffer) return;
    const incoming: EstimateItem[] = importOffer.map((i) => ({ ...i, id: uid() }));
    const offset = mode === "add" && nodes.length ? Math.max(...nodes.map((n) => n.position.y)) + 200 : 0;
    const placed = incoming.map((i) => ({ ...i, position: { x: i.position.x, y: i.position.y + offset } }));
    const newNodes = placed.map((i) => ({ id: i.id, type: "resource", position: i.position, data: {} }));
    if (mode === "replace") {
      setItems(placed);
      setNodes(newNodes);
      setEdges([]);
    } else {
      setItems((is) => [...is, ...placed]);
      setNodes((ns) => [...ns, ...newNodes]);
    }
    setIsExample(false);
    setImportOffer(null);
    try {
      localStorage.removeItem(IMPORT_KEY);
    } catch {
      /* ignore */
    }
    setTimeout(() => rf.fitView({ padding: 0.15, duration: 300 }), 80);
  };

  const exportCsv = () => {
    const rows: (string | number)[][] = [["Name", "Service", "Region", "Configuration", `Monthly (${currency})`]];
    for (const i of items) {
      const t = templateById.get(i.template)!;
      const e = estimateFor(i);
      const cfg = Object.entries(i.config).filter(([k]) => k !== "region").map(([k, v]) => `${k}=${v}`).join("; ");
      rows.push([i.name, t.label, String(i.config.region ?? ""), cfg, e ? e.monthly.toFixed(2) : ""]);
    }
    rows.push(["Total", "", "", "", total.toFixed(2)]);
    downloadCsv(`azure-estimate-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const selectedItem = selected ? itemById.get(selected) : undefined;
  const byCategory = TEMPLATES.reduce<Record<string, typeof TEMPLATES>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="flex h-screen flex-col">
      <AppHeader
        active="estimate"
        right={
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className="h-8 rounded-md border border-line bg-panel px-2 text-[13px] text-ink">
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        }
      />

      {importOffer && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-accent-soft px-4 py-2 text-[13px]">
          <span>
            <b>{importOffer.length} resources</b> copied from your live subscription are ready to edit.
          </span>
          <button type="button" onClick={() => acceptImport("replace")} className="rounded-md bg-accent px-3 py-1 font-medium text-accent-ink">Replace this estimate</button>
          <button type="button" onClick={() => acceptImport("add")} className="rounded-md border border-line bg-panel px-3 py-1">Add to it</button>
          <button type="button" onClick={() => setImportOffer(null)} className="text-ink-2 hover:underline">Not now</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <nav className="w-60 shrink-0 overflow-auto border-r border-line bg-panel p-3" aria-label="Add a service">
          <h2 className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted">Add a service</h2>
          {Object.entries(byCategory).map(([cat, list]) => (
            <div key={cat} className="mt-3">
              {list.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => addItem(t.id)}
                  title={t.blurb}
                  className="group flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-[13px] hover:bg-panel-2"
                >
                  <CategoryIcon category={t.category} size={26} />
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                  <Plus size={14} className="text-muted opacity-0 group-hover:opacity-100" aria-hidden="true" />
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="relative min-w-0 flex-1" ref={canvasRef}>
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodesDelete={onNodesDelete}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            minZoom={0.2}
          >
            <Background gap={24} color="var(--grid)" />
            <Controls showInteractive={false} />
          </ReactFlow>
          {items.length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <p className="max-w-sm text-center text-ink-2">Add services from the left. Drag between the dots on two cards to connect them.</p>
            </div>
          )}
          {isExample && items.length > 0 && (
            <div className="absolute left-3 top-3 rounded-md border border-line bg-panel px-3 py-1.5 text-[12px] text-ink-2 shadow-sm">
              Example estimate. Edit it or{" "}
              <button type="button" onClick={clearAll} className="text-accent hover:underline">start empty</button>.
            </div>
          )}
        </div>

        <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-panel" aria-label="Estimate">
          <div className="border-b border-line p-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-ink-2">Estimated monthly cost</span>
              {pricing && <Loader2 size={14} className="animate-spin text-muted" aria-label="Pricing" />}
            </div>
            <div className="mt-0.5 text-3xl font-semibold tracking-tight tabular">{money(total, currency)}</div>
            <div className="mt-1 text-[12px] text-muted tabular">
              {money(total * 12, currency)} a year · {items.length} item{items.length === 1 ? "" : "s"} · pay-as-you-go list prices
            </div>
            {priceError && <p className="mt-2 text-[12.5px] text-crit">{priceError}</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={exportCsv} disabled={!items.length} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[13px] hover:border-line-strong disabled:opacity-50">
                <Download size={14} aria-hidden="true" /> CSV
              </button>
              <button type="button" onClick={clearAll} disabled={!items.length} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[13px] hover:border-line-strong disabled:opacity-50">
                <Trash2 size={14} aria-hidden="true" /> Clear
              </button>
            </div>
          </div>

          {selectedItem ? (
            <ItemEditor
              key={selectedItem.id}
              item={selectedItem}
              estimate={estimateFor(selectedItem)}
              currency={currency}
              onChange={(p) => updateItem(selectedItem.id, p)}
              onRemove={() => removeItem(selectedItem.id)}
              onClose={() => setSelected(null)}
            />
          ) : (
            <ul className="min-h-0 flex-1 overflow-auto py-1">
              {[...items]
                .sort((a, b) => (estimateFor(b)?.monthly ?? 0) - (estimateFor(a)?.monthly ?? 0))
                .map((i) => {
                  const t = templateById.get(i.template)!;
                  return (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(i.id);
                          setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === i.id })));
                        }}
                        className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-panel-2"
                      >
                        <CategoryIcon category={t.category} size={26} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{i.name}</span>
                          <span className="block truncate text-[11.5px] text-muted">{t.label}</span>
                        </span>
                        <StatusPill estimate={estimateFor(i)} currency={currency} />
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function ItemEditor({
  item,
  estimate,
  currency,
  onChange,
  onRemove,
  onClose,
}: {
  item: EstimateItem;
  estimate?: ResourceEstimate;
  currency: string;
  onChange: (p: Partial<EstimateItem>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = templateById.get(item.template)!;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex items-start gap-3 border-b border-line p-4">
        <CategoryIcon category={t.category} />
        <div className="min-w-0 flex-1">
          <label htmlFor="item-name" className="sr-only">Name</label>
          <input
            id="item-name"
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="w-full rounded border border-transparent bg-transparent px-1 text-[15px] font-semibold hover:border-line focus:border-line"
          />
          <div className="px-1 text-[12.5px] text-ink-2">{t.label}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close editor" className="rounded p-1 text-muted hover:bg-panel-2 hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <div className="space-y-3 p-4">
        {t.fields.map((f) => {
          const id = `f-${item.id}-${f.key}`;
          const val = item.config[f.key] ?? t.defaults[f.key] ?? "";
          return (
            <div key={f.key}>
              <label htmlFor={id} className="mb-1 block text-[12px] text-ink-2">{f.label}</label>
              {f.type === "select" ? (
                <select id={id} value={String(val)} onChange={(e) => onChange({ config: { [f.key]: e.target.value } })} className="h-9 w-full rounded-md border border-line bg-panel px-2 text-[13px]">
                  {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    id={id}
                    type={f.type === "number" ? "number" : "text"}
                    min={f.min}
                    step={f.step}
                    value={String(val)}
                    onChange={(e) => onChange({ config: { [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value } })}
                    className="h-9 w-full rounded-md border border-line bg-panel px-2 font-mono text-[13px]"
                  />
                  {f.suffix && <span className="text-[12px] text-muted">{f.suffix}</span>}
                </div>
              )}
              {f.hint && <p className="mt-1 text-[11.5px] text-muted">{f.hint}</p>}
            </div>
          );
        })}

        <section className="border-t border-line pt-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold">Price</h3>
            <StatusPill estimate={estimate} currency={currency} />
          </div>
          {estimate?.lines.map((l, i) => (
            <div key={i} className="mt-2 flex justify-between gap-3 text-[12.5px]">
              <span>
                {l.label}
                <span className="block text-[11px] text-muted">{money(l.unitPrice, currency)} per {l.unit.replace(/^1 /, "").replace(/^1\//, "")}</span>
              </span>
              <span className="font-mono tabular">{money(l.monthly, currency)}</span>
            </div>
          ))}
          {estimate?.note && <p className="mt-2 text-[12.5px] text-ink-2">{estimate.note}</p>}
          <p className="mt-2 text-[11.5px] text-muted">{t.blurb}</p>
        </section>

        <button type="button" onClick={onRemove} className="flex items-center gap-1.5 text-[13px] text-crit hover:underline">
          <Trash2 size={14} aria-hidden="true" /> Remove from estimate
        </button>
      </div>
    </div>
  );
}
