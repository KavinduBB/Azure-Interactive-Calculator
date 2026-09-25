"use client";

import { ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  allLabel,
  searchable = true,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  allLabel?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const summary =
    value.length === 0
      ? allLabel ?? placeholder
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label ?? value[0]
        : `${value.length} selected`;

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className="relative" ref={ref}>
      <span id={`${id}-label`} className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
        {label}
      </span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full min-w-[200px] items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 text-left text-[13px] hover:border-line-strong"
      >
        <span className={`truncate ${value.length ? "" : "text-ink-2"}`}>{summary}</span>
        <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-[max(100%,320px)] rounded-lg border border-line bg-panel shadow-lg">
          {searchable && (
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <Search size={14} className="text-muted" aria-hidden="true" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter"
                aria-label={`Filter ${label}`}
                className="w-full bg-transparent text-[13px] outline-none"
              />
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-1.5 text-[12px]">
            <button type="button" className="text-accent hover:underline" onClick={() => onChange(filtered.map((o) => o.value))}>
              Select all
            </button>
            <button type="button" className="text-accent hover:underline" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-72 overflow-auto pb-1">
            {filtered.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-panel-2">
                  <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} className="accent-[var(--accent)]" />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="shrink-0 text-[11.5px] text-muted tabular">{o.hint}</span>}
                </label>
              </li>
            ))}
            {filtered.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
