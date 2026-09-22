// src/pages/Inbox.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";
import { useEventStore } from "@/state/EventStore";

const TYPE_STYLES = {
  GP: "bg-cyan-700 text-white",
  BOARD: "bg-rose-700 text-white",
  FINANCE: "bg-purple-700 text-white",
  FINANCES: "bg-purple-700 text-white",
  DEV: "bg-indigo-700 text-white",
  STAFF: "bg-amber-700 text-white",
  CONTRACT: "bg-amber-700 text-white",
  MEDICAL: "bg-orange-700 text-white",
  PR: "bg-fuchsia-700 text-white",
  SCOUTING: "bg-lime-700 text-white",
  HQ: "bg-slate-700 text-white",
  ACADEMY: "bg-teal-700 text-white",
  OTHER: "bg-zinc-700 text-white",
};
const CATEGORIES = ["ALL", "GP", "BOARD", "FINANCE", "DEV", "STAFF", "CONTRACT", "MEDICAL", "PR", "SCOUTING", "HQ", "ACADEMY", "OTHER"];

const asDate = (value) => {
  if (!value) return new Date(NaN);
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const raw = String(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return new Date(value);
};

function normalizeInbox(gameStateLike, fallbackList) {
  let raw = Array.isArray(gameStateLike?.inbox) ? gameStateLike.inbox : null;
  if (!raw && Array.isArray(gameStateLike?.events)) raw = gameStateLike.events;
  if (!raw && Array.isArray(gameStateLike?.agenda)) raw = gameStateLike.agenda;
  if (!raw && Array.isArray(fallbackList)) raw = fallbackList;
  if (!Array.isArray(raw)) return [];

  return raw.map((m, i) => {
    const typeRaw = String(m.type || m.category || "OTHER").toUpperCase();
    const type = CATEGORIES.includes(typeRaw) ? typeRaw : "OTHER";
    const date = m.date ?? m.dateISO ?? m.created_at ?? m.createdAt ?? m.when ?? m.ts ?? null;
    return {
      id: String(m.id ?? `MSG_${i}`),
      type,
      title: m.title ?? m.subject ?? m.name ?? m.headline ?? "Untitled",
      body: m.body ?? m.description ?? m.summary ?? "",
      date,
      dateObj: asDate(date),
      unread: m.unread ?? m.is_unread ?? (m.read === false),
      sender: m.sender ?? m.from ?? m.author ?? m.department ?? sourceLabel(type),
      senderRole: m.sender_role ?? m.role ?? m.department ?? "",
      priority: String(m.priority ?? (m.action_required || m.requires_response ? "high" : "normal")).toLowerCase(),
      actionRequired: Boolean(m.action_required ?? m.actionRequired ?? m.requires_response ?? m.requiresReply),
      actionRoute: m.action_route ?? m.route ?? m.href ?? routeForType(type),
      deadline: m.deadline ?? m.due_date ?? m.respond_by ?? null,
      meta: { ...m },
    };
  }).sort((a, b) => (b.dateObj - a.dateObj) || a.title.localeCompare(b.title));
}

function sourceLabel(type) {
  const labels = {
    GP: "Race Engineering",
    BOARD: "The Board",
    FINANCE: "Finance Department",
    DEV: "Technical Department",
    STAFF: "Team Management",
    CONTRACT: "Contract Department",
    MEDICAL: "Medical Team",
    PR: "Communications",
    SCOUTING: "Scouting Department",
    HQ: "Facilities",
    ACADEMY: "Driver Academy",
  };
  return labels[type] || "Team";
}

function routeForType(type) {
  const routes = {
    GP: "/RaceWeekend",
    BOARD: "/Board",
    FINANCE: "/Finances",
    DEV: "/Development",
    STAFF: "/MyStaff",
    CONTRACT: "/MyDrivers",
    MEDICAL: "/MyDrivers",
    PR: "/Home",
    SCOUTING: "/Scouting",
    HQ: "/HQ",
    ACADEMY: "/Academy",
  };
  return routes[type] || null;
}

function dateLabel(dateObj) {
  if (!dateObj || Number.isNaN(dateObj.getTime())) return "Undated";
  return dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Inbox() {
  const { gameState, setGameState } = useGame();
  const eventNews = useEventStore((s) => s.news);
  const [fallback, setFallback] = useState(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("ALL");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/data/inbox.json");
        if (!response.ok) return;
        const json = await response.json();
        setFallback(Array.isArray(json) ? json : (Array.isArray(json?.items) ? json.items : null));
      } catch {
        setFallback(null);
      }
    })();
  }, []);

  const combinedInbox = useMemo(() => {
    const base = Array.isArray(gameState?.inbox) ? gameState.inbox : [];
    const news = Array.isArray(eventNews) ? eventNews.map((n) => ({
      ...n,
      id: n.id + "_" + (n.ts || n.dateISO || ""),
      type: String(n.type || "OTHER").toUpperCase(),
      title: n.title || n.headline || "Untitled",
      date: n.dateISO || n.ts || null,
      unread: n.unread ?? true,
    })) : [];
    return [...base, ...news];
  }, [gameState?.inbox, eventNews]);

  const items = useMemo(
    () => normalizeInbox({ inbox: combinedInbox }, fallback),
    [combinedInbox, fallback]
  );

  const filtered = useMemo(() => items.filter((m) => {
    if (onlyUnread && !m.unread) return false;
    if (cat !== "ALL" && m.type !== cat) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!`${m.title} ${m.body} ${m.sender}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [items, onlyUnread, cat, query]);

  useEffect(() => {
    if (!filtered.length) {
      setActiveId(null);
      return;
    }
    if (!activeId || !filtered.some((m) => m.id === activeId)) setActiveId(filtered[0].id);
  }, [filtered, activeId]);

  const active = filtered.find((m) => m.id === activeId) || filtered[0] || null;
  const unreadCount = items.filter((m) => m.unread).length;

  function markReadInStore(id) {
    const base = Array.isArray(gameState?.inbox) ? gameState.inbox : [];
    if (!base.some((msg) => String(msg.id) === String(id))) return;
    setGameState({
      inbox: base.map((msg) => String(msg.id) === String(id)
        ? { ...msg, read: true, unread: false, is_unread: false }
        : msg),
    });
  }

  function openItem(message) {
    setActiveId(message.id);
    if (message.unread) markReadInStore(message.id);
  }

  function markAllRead() {
    const base = Array.isArray(gameState?.inbox) ? gameState.inbox : [];
    setGameState({
      inbox: base.map((msg) => ({ ...msg, read: true, unread: false, is_unread: false })),
    });
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Reports, decisions and warnings generated by your live career state.
          </p>
        </div>
        <div className="flex-1" />
        <div className="text-sm text-muted-foreground">{unreadCount} unread</div>
        <Button variant="outline" onClick={markAllRead} disabled={!unreadCount}>Mark all as read</Button>
      </div>

      <div className="rounded-xl border bg-white shadow-sm p-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2">
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="border rounded-md px-3 py-2 text-sm">
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>{category === "ALL" ? "All departments" : category}</option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search inbox…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm flex-1"
          />
          <label className="flex items-center gap-2 px-2 text-sm">
            <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
            Unread only
          </label>
          <Button variant="outline" onClick={() => { setCat("ALL"); setOnlyUnread(false); setQuery(""); }}>
            Clear filters
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 min-h-[620px]">
        <section className="xl:col-span-4 rounded-xl border bg-slate-950 text-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <div className="text-sm font-semibold">Messages</div>
            <div className="text-xs text-slate-400">{filtered.length}</div>
          </div>
          <div className="max-h-[680px] overflow-y-auto divide-y divide-white/10">
            {filtered.map((message) => {
              const selected = active?.id === message.id;
              return (
                <button
                  type="button"
                  key={message.id}
                  onClick={() => openItem(message)}
                  className={[
                    "w-full p-3 text-left transition-colors",
                    selected ? "bg-slate-100 text-slate-950" : "hover:bg-slate-900",
                  ].join(" ")}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${message.unread ? "bg-cyan-400" : "bg-slate-600"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold truncate">{message.sender}</div>
                        {message.priority === "high" || message.actionRequired
                          ? <span className="text-[9px] uppercase tracking-wide text-rose-500">Action</span>
                          : null}
                      </div>
                      <div className={`text-sm truncate ${selected ? "text-slate-700" : "text-slate-200"}`}>{message.title}</div>
                      <div className={`text-xs mt-1 ${selected ? "text-slate-500" : "text-slate-500"}`}>{dateLabel(message.dateObj)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
            {!filtered.length ? <div className="p-5 text-sm text-slate-400">No messages found.</div> : null}
          </div>
        </section>

        <section className="xl:col-span-8 rounded-xl border bg-slate-950 text-slate-100 shadow-sm overflow-hidden">
          {active ? (
            <>
              <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-start gap-3">
                <div className="h-12 w-12 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center font-bold text-sm">
                  {String(active.sender || "TM").split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold">{active.title}</h2>
                  <div className="text-sm text-slate-300">{active.sender}{active.senderRole ? ` · ${active.senderRole}` : ""}</div>
                </div>
                <div className="flex-1" />
                <div className="text-sm text-slate-400">{dateLabel(active.dateObj)}</div>
              </div>

              <div className="p-5 md:p-7">
                <div className="flex flex-wrap items-center gap-2 mb-6">
                  <span className={`rounded px-2 py-1 text-[10px] uppercase tracking-wider ${TYPE_STYLES[active.type] || TYPE_STYLES.OTHER}`}>
                    {active.type}
                  </span>
                  {active.actionRequired ? <span className="rounded bg-rose-950 text-rose-200 px-2 py-1 text-[10px] uppercase tracking-wider">Response required</span> : null}
                  {active.deadline ? <span className="text-xs text-amber-300">Deadline {String(active.deadline).slice(0, 10)}</span> : null}
                </div>

                <div className="max-w-4xl whitespace-pre-wrap text-[15px] leading-7 text-slate-200">
                  {active.body || "No additional details were included in this message."}
                </div>

                <div className="mt-8 pt-5 border-t border-white/10 flex flex-wrap gap-2">
                  {active.actionRoute ? (
                    <Link
                      to={active.actionRoute}
                      className="inline-flex items-center rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
                    >
                      Open related page
                    </Link>
                  ) : null}
                  {active.unread ? (
                    <Button variant="outline" onClick={() => markReadInStore(active.id)}>Mark as read</Button>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="h-full min-h-[420px] flex items-center justify-center text-slate-500">Select a message.</div>
          )}
        </section>
      </div>
    </div>
  );
}
