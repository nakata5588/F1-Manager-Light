// src/pages/Inbox.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

const TYPE_STYLES = {
  GP: "bg-cyan-600 text-white",
  BOARD: "bg-rose-600 text-white",
  FINANCE: "bg-purple-700 text-white",
  DEV: "bg-indigo-600 text-white",
  STAFF: "bg-amber-600 text-white",
  PR: "bg-fuchsia-600 text-white",
  SCOUTING: "bg-lime-700 text-white",
  HQ: "bg-slate-600 text-white",
  ACADEMY: "bg-teal-700 text-white",
  OTHER: "bg-zinc-700 text-white",
};

const CATEGORIES = ["ALL","GP","BOARD","FINANCE","DEV","STAFF","PR","SCOUTING","HQ","ACADEMY","OTHER"];

const asDate = (v) => {
  if (!v) return new Date(NaN);
  if (v instanceof Date) return v;
  // aceita "YYYY-MM-DD", ISO completo, ou epoch
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    // algumas mensagens podem vir com dateISO / created_at
    const s = v.replace(/T.*/,""); // tolerante
    const [y,m,d] = s.split("-").map(Number);
    if (y && m && d) return new Date(y, m-1, d);
    return new Date(v);
  }
  return new Date(NaN);
};

// Normalizador de mensagens
function normalizeInbox(gameState, fallbackList) {
  // prioridade a gameState.inbox
  let raw = Array.isArray(gameState?.inbox) ? gameState.inbox : null;

  // se não houver, tentar events/agenda como fonte
  if (!raw && Array.isArray(gameState?.events)) raw = gameState.events;
  if (!raw && Array.isArray(gameState?.agenda)) raw = gameState.agenda;

  if (!raw && Array.isArray(fallbackList)) raw = fallbackList;

  if (!Array.isArray(raw)) return [];

  return raw
    .map((m, i) => {
      const type = (m.type || m.category || "OTHER").toString().toUpperCase();
      return {
        id: m.id ?? `MSG_${i}`,
        type: CATEGORIES.includes(type) ? type : "OTHER",
        title: m.title ?? m.name ?? "Untitled",
        body: m.body ?? m.description ?? "",
        date: m.date ?? m.dateISO ?? m.created_at ?? m.createdAt ?? m.when ?? null,
        unread: m.unread ?? m.is_unread ?? m.read === false ? true : false,
        // meta extra
        meta: {
          ...m,
        },
      };
    })
    .map((m) => ({ ...m, dateObj: asDate(m.date) }))
    .sort((a, b) => (b.dateObj - a.dateObj) || a.title.localeCompare(b.title));
}

export default function Inbox() {
  const { gameState } = useGame();

  const [fallback, setFallback] = useState(null);   // /data/inbox.json
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("ALL");
  const [onlyUnread, setOnlyUnread] = useState(true);
  const [active, setActive] = useState(null);       // mensagem aberta no drawer

  useEffect(() => {
    // tenta carregar fallback em /public/data/inbox.json
    (async () => {
      try {
        const r = await fetch("/data/inbox.json");
        if (r.ok) {
          const j = await r.json();
          setFallback(Array.isArray(j) ? j : (Array.isArray(j?.items) ? j.items : null));
        }
      } catch {}
    })();
  }, []);

  const items = useMemo(() => normalizeInbox(gameState, fallback), [gameState, fallback]);

  const filtered = useMemo(() => {
    return items.filter((m) => {
      if (onlyUnread && !m.unread) return false;
      if (cat !== "ALL" && m.type !== cat) return false;
      if (query) {
        const q = query.toLowerCase();
        const hay = `${m.title} ${m.body}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, onlyUnread, cat, query]);

  const openItem = (m) => setActive(m);
  const closeItem = () => setActive(null);

  const unreadCount = items.filter((m) => m.unread).length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-semibold">Inbox</h1>
        <div className="text-sm text-muted-foreground">{unreadCount} unread</div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="unread"
                checked={onlyUnread}
                onChange={(e) => setOnlyUnread(e.target.checked)}
              />
              <label htmlFor="unread" className="text-sm">Unread only</label>
            </div>

            <select value={cat} onChange={(e) => setCat(e.target.value)} className="border rounded px-2 py-1 w-full md:w-auto">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c === "ALL" ? "All categories" : c}</option>
              ))}
            </select>

            <input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />

            <div className="flex-1" />

            <Button variant="outline" onClick={() => { setCat("ALL"); setOnlyUnread(false); setQuery(""); }}>
              Clear filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No messages found.</div>
          ) : (
            <ul className="divide-y">
              {filtered.map((m) => (
                <li key={m.id} className="p-3 hover:bg-muted/40 cursor-pointer" onClick={() => openItem(m)}>
                  <div className="flex items-start gap-3">
                    <span className={`inline-flex rounded px-2 py-0.5 text-[11px] mt-0.5 ${TYPE_STYLES[m.type] || TYPE_STYLES.OTHER}`}>
                      {m.type}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium truncate">
                          {m.unread ? <span className="inline-block h-2 w-2 rounded-full bg-primary mr-2 align-middle" /> : null}
                          {m.title}
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0">
                          {m.dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </div>
                      </div>
                      {m.body ? <div className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{m.body}</div> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Drawer / Detail */}
      {active ? (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={closeItem} />
          <div className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-background shadow-xl p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`inline-flex rounded px-2 py-0.5 text-[11px] ${TYPE_STYLES[active.type] || TYPE_STYLES.OTHER}`}>
                  {active.type}
                </span>
                <div className="text-xs text-muted-foreground">
                  {active.dateObj.toLocaleString("en-GB", {
                    weekday: "short", day: "2-digit", month: "short", year: "numeric"
                  })}
                </div>
              </div>
              <Button variant="outline" onClick={closeItem}>Close</Button>
            </div>

            <h2 className="text-xl font-semibold mb-2">{active.title}</h2>
            {active.body ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{active.body}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No body content.</p>
            )}

            {/* Meta opcional (útil para debug) */}
            {active.meta ? (
              <details className="mt-4 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Meta</summary>
                <pre className="mt-2 p-2 bg-muted/40 rounded overflow-x-auto">
                  {JSON.stringify(active.meta, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
