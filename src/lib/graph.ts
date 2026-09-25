import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { MINOR_TYPES, typeInfo } from "./catalog";
import type { AzureResource } from "./types";

export const NODE_W = 236;
export const NODE_H = 78;
const GROUP_PAD_X = 24;
const GROUP_PAD_TOP = 52;
const GROUP_PAD_BOTTOM = 24;
const GROUP_GAP = 48;
const ROW_MAX_WIDTH = 2400;

function collectRefs(value: unknown, out: Set<string>, depth = 0) {
  if (depth > 7 || value == null) return;
  if (typeof value === "string") {
    if (value.length < 400 && value.toLowerCase().startsWith("/subscriptions/")) out.add(value.toLowerCase());
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectRefs(v, out, depth + 1);
  }
}

/** Resolve an id that may point inside a resource (a subnet, an IP configuration) to the resource that owns it. */
function resolve(ref: string, keys: Set<string>): string | undefined {
  let cur = ref;
  for (let i = 0; i < 6; i++) {
    if (keys.has(cur)) return cur;
    const parts = cur.split("/");
    if (parts.length <= 9) return undefined; // down to /subscriptions/x/resourceGroups/y/providers/ns/type/name
    cur = parts.slice(0, -2).join("/");
  }
  return undefined;
}

/**
 * Finds links between resources by scanning their properties for the resource
 * IDs they reference (a VM lists its NIC, a NIC its subnet, a web app its plan),
 * plus parent/child IDs such as server → database.
 */
export function findLinks(resources: AzureResource[]): [string, string][] {
  const keys = new Set(resources.map((r) => r.key));
  const seen = new Set<string>();
  const links: [string, string][] = [];
  const add = (a: string, b: string) => {
    if (a === b) return;
    const id = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(id)) return;
    seen.add(id);
    links.push([a, b]);
  };
  for (const r of resources) {
    const parent = r.key.split("/").slice(0, -2).join("/");
    if (keys.has(parent)) add(r.key, parent);
    const refs = new Set<string>();
    collectRefs(r.properties, refs);
    for (const ref of refs) {
      const target = resolve(ref, keys);
      if (target) add(r.key, target);
    }
  }
  return links;
}

/** Removes hidden resources but keeps the path through them (VM → NIC → VNet becomes VM → VNet). */
function collapse(links: [string, string][], hidden: Set<string>, byKey: Map<string, AzureResource>) {
  const adj = new Map<string, Set<string>>();
  for (const [a, b] of links) {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }
  const visible = (k: string) => !hidden.has(k);
  const out: [string, string][] = links.filter(([a, b]) => visible(a) && visible(b));
  const seen = new Set(out.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)));
  for (const h of hidden) {
    // Walk through chains of hidden nodes to their visible neighbours.
    const neighbours = new Set<string>();
    const stack = [h];
    const visited = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const n of adj.get(cur) ?? []) {
        if (hidden.has(n)) stack.push(n);
        else neighbours.add(n);
      }
    }
    const list = [...neighbours];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const bothNetwork = typeInfo(byKey.get(a)?.type ?? "").category === "network" && typeInfo(byKey.get(b)?.type ?? "").category === "network";
        if (list.length > 2 && bothNetwork) continue;
        const id = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push([a, b]);
      }
    }
  }
  return out;
}

export interface GroupData extends Record<string, unknown> {
  label: string;
  subtitle: string;
  total: number;
  count: number;
}

export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Lays out resources as one box per resource group, with a left-to-right
 * dagre layout inside each box, and boxes packed into rows by cost.
 */
export function layoutGraph(
  resources: AzureResource[],
  opts: { hideMinor: boolean; costOf: (key: string) => number; nodeData: (r: AzureResource) => Record<string, unknown> },
): LayoutResult {
  const byKey = new Map(resources.map((r) => [r.key, r]));
  const hidden = new Set(opts.hideMinor ? resources.filter((r) => MINOR_TYPES.has(r.type)).map((r) => r.key) : []);
  const shown = resources.filter((r) => !hidden.has(r.key));
  const links = collapse(findLinks(resources), hidden, byKey);

  const groups = new Map<string, AzureResource[]>();
  for (const r of shown) {
    const g = `${r.subscriptionId}/${r.resourceGroup}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }

  const groupBoxes = [...groups.entries()].map(([gid, members]) => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 18, ranksep: 56, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    const inGroup = new Set(members.map((m) => m.key));
    for (const m of members) g.setNode(m.key, { width: NODE_W, height: NODE_H });
    for (const [a, b] of links) if (inGroup.has(a) && inGroup.has(b)) g.setEdge(a, b);
    dagre.layout(g);
    let maxX = 0, maxY = 0;
    const pos = new Map<string, { x: number; y: number }>();
    for (const m of members) {
      const n = g.node(m.key);
      const x = n.x - NODE_W / 2, y = n.y - NODE_H / 2;
      pos.set(m.key, { x, y });
      maxX = Math.max(maxX, x + NODE_W);
      maxY = Math.max(maxY, y + NODE_H);
    }
    const total = members.reduce((a, m) => a + opts.costOf(m.key), 0);
    const regions = [...new Set(members.map((m) => m.location).filter(Boolean))];
    return {
      gid,
      members,
      pos,
      width: maxX + GROUP_PAD_X * 2,
      height: maxY + GROUP_PAD_TOP + GROUP_PAD_BOTTOM,
      total,
      label: members[0].resourceGroup,
      subtitle: `${members.length} resource${members.length === 1 ? "" : "s"} · ${regions.slice(0, 2).join(", ")}${regions.length > 2 ? ` +${regions.length - 2}` : ""}`,
    };
  });

  groupBoxes.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

  const nodes: Node[] = [];
  let x = 0, y = 0, rowH = 0;
  for (const box of groupBoxes) {
    if (x > 0 && x + box.width > ROW_MAX_WIDTH) {
      x = 0;
      y += rowH + GROUP_GAP;
      rowH = 0;
    }
    const groupId = `group:${box.gid}`;
    nodes.push({
      id: groupId,
      type: "rg",
      position: { x, y },
      style: { width: box.width, height: box.height },
      data: { label: box.label, subtitle: box.subtitle, total: box.total, count: box.members.length } satisfies GroupData,
      selectable: false,
      draggable: true,
    });
    for (const m of box.members) {
      const p = box.pos.get(m.key)!;
      nodes.push({
        id: m.key,
        type: "resource",
        parentId: groupId,
        position: { x: p.x + GROUP_PAD_X, y: p.y + GROUP_PAD_TOP },
        data: opts.nodeData(m),
      });
    }
    x += box.width + GROUP_GAP;
    rowH = Math.max(rowH, box.height);
  }

  const edges: Edge[] = links.map(([a, b]) => ({
    id: `${a}|${b}`,
    source: a,
    target: b,
    type: "smoothstep",
    className: byKey.get(a)?.resourceGroup !== byKey.get(b)?.resourceGroup ? "edge-cross" : "edge-local",
  }));

  return { nodes, edges };
}
