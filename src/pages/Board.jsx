// src/pages/Board.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

/** Utils */
const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    // tolerante a "YYYY-MM-DD" ou ISO
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(v);
  }
  return null;
};
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const pct = (x) => `${Math.round(clamp01(x) * 100)}%`;
const titleCase = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");

/** Normalização muito permissiva */
function normalizeBoard(raw) {
  if (!raw || typeof raw !== "object") return { reputation: 0.5, expectation: "Midfield", objectives: [] };

  const reputation =
    Number(raw.reputation ?? raw.rep ?? raw.board_rep ?? raw.board_reputation ?? 0.5);
  const expectation =
    raw.expectation ?? raw.season_expectation ?? raw.targets ?? "Midfield";

  const arr = Array.isArray(raw.objectives)
    ? raw.objectives
    : Array.isArray(raw.goals)
      ? raw.goals
      : [];

  const norms = arr.map((o, i) => {
    const cat = (o.category ?? o.type ?? "PERFORMANCE").toString().toUpperCase();
    const status = (o.status ?? "active").toString().toLowerCase(); // active|completed|failed|paused
    const prog = clamp01(
      o.progress ??
        (typeof o.done === "number" ? o.done / (o.total || 1) : o.done ? 1 : 0)
    );
    const deadline = toDate(o.deadline ?? o.until ?? o.by ?? null);
    return {
      id: o.id ?? `OBJ_${i}`,
      category: cat, // PERFORMANCE|FINANCIAL|DEV|STAFF|PR
      title: o.title ?? o.name ?? "Objective",
      desc: o.desc ?? o.description ?? "",
      deadline,
      status,
      progress: prog,
      weight: Number(o.weight ?? 1),
      priority: Number(o.priority ?? (cat === "PERFORMANCE" ? 1 : 2)), // 1 high .. 3 low
      reward: o.reward ?? null,
      penalty: o.penalty ?? o.consequence ?? null,
      meta: o
    };
  });

  return {
    reputation: clamp01(reputation),
    expectation: expectation,
    objectives: norms
  };
}

/** Paletas leves */
const CAT_COLORS = {
  PERFORMANCE: "bg-cyan-600",
  FINANCIAL: "bg-purple-700",
  DEV: "bg-indigo-600",
  STAFF: "bg-amber-600",
  PR: "bg-fuchsia-600",
  OTHER: "bg-zinc-600"
};
const STATUS_COLORS = {
  active: "bg-sky-600",
  completed: "bg-emerald-600",
  failed: "bg-rose-600",
  paused: "bg-slate-500"
};

export default function Board() {
  const { gameState } = useGame();
  const [fallback, setFallback] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/data/board.json");
        if (r.ok) setFallback(await r.json());
      } catch {}
    })();
  }, []);

  const board = useMemo(() => normalizeBoard(gameState?.board || fallback || {}), [gameState?.board, fallback]);

  /** Filtros */
  const [status, setStatus] = useState("active"); // active|completed|failed|paused|all
  const [category, setCategory] = useState("ALL");
  const [q, setQ] = useState("");

  const objectives = useMemo(() => {
    return board.objectives
      .filter((o) => (status === "all" ? true : o.status === status))
      .filter((o) => (category === "ALL" ? true : o.category === category))
      .filter((o) => {
        if (!q) return true;
        const hay = `${o.title} ${o.desc}`.toLowerCase();
        return hay.includes(q.toLowerCase());
      })
      .sort((a, b) => (a.priority - b.priority) || ((a.deadline?.getTime?.() || 0) - (b.deadline?.getTime?.() || 0)));
  }, [board.objectives, status, category, q]);

  /** Overall confidence = média ponderada dos objetivos ativos */
  const overallConfidence = useMemo(() => {
    const actives = board.objectives.filter((o) => o.status === "active");
    const sumW = actives.reduce((s, o) => s + (o.weight || 1), 0);
    if (!actives.length || sumW <= 0) return 0.5;
    const score = actives.reduce((s, o) => s + clamp01(o.progress) * (o.weight || 1), 0) / sumW;
    return clamp01(0.4 * board.reputation + 0.6 * score); // mistura reputação e progresso
  }, [board.objectives, board.reputation]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-semibold">Board</h1>
        <div className="text-sm text-muted-foreground">
          Season Expectation: <span className="font-medium">{board.expectation}</span>
        </div>
      </div>

      {/* Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard title="Overall Confidence">
          <ProgressBar value={overallConfidence} />
          <div className="text-xs text-muted-foreground mt-1">{pct(overallConfidence)}</div>
        </StatCard>

        <StatCard title="Reputation">
          <ProgressBar value={board.reputation} />
          <div className="text-xs text-muted-foreground mt-1">{pct(board.reputation)}</div>
        </StatCard>

        <StatCard title="Quick Actions">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled>Propose Goal Change</Button>
            <Button size="sm" variant="outline" disabled>Request Budget</Button>
            <Button size="sm" variant="outline" disabled>Report Progress</Button>
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">(* placebos, por agora)</div>
        </StatCard>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-2 py-1">
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="paused">Paused</option>
              <option value="all">All</option>
            </select>

            <select value={category} onChange={(e) => setCategory(e.target.value)} className="border rounded px-2 py-1">
              <option value="ALL">All categories</option>
              <option value="PERFORMANCE">Performance</option>
              <option value="FINANCIAL">Financial</option>
              <option value="DEV">Development</option>
              <option value="STAFF">Staff</option>
              <option value="PR">PR/Media</option>
              <option value="OTHER">Other</option>
            </select>

            <input
              type="text"
              placeholder="Search objectives…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />

            <div className="flex-1" />

            <Button variant="outline" onClick={() => { setStatus("active"); setCategory("ALL"); setQ(""); }}>
              Clear filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabela de objetivos */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="text-left">
                <th className="px-3 py-2 w-24">Category</th>
                <th className="px-3 py-2">Objective</th>
                <th className="px-3 py-2 w-36">Deadline</th>
                <th className="px-3 py-2 w-48">Progress</th>
                <th className="px-3 py-2 w-24">Status</th>
                <th className="px-3 py-2 w-40">Reward / Penalty</th>
              </tr>
            </thead>
            <tbody>
              {objectives.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-muted-foreground">No objectives.</td>
                </tr>
              ) : (
                objectives.map((o) => (
                  <tr key={o.id} className="border-t">
                    <td className="px-3 py-2 align-top">
                      <Pill label={titleCase(o.category)} className={`${CAT_COLORS[o.category] || CAT_COLORS.OTHER} text-white`} />
                      <div className="text-[10px] text-muted-foreground mt-1">P{Number(o.priority) || 2}</div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">{o.title}</div>
                      {o.desc ? <div className="text-xs text-muted-foreground mt-0.5">{o.desc}</div> : null}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {o.deadline ? o.deadline.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <ProgressBar value={o.progress} />
                      <div className="text-xs text-muted-foreground mt-1">{pct(o.progress)}</div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Pill label={titleCase(o.status)} className={`${STATUS_COLORS[o.status] || STATUS_COLORS.active} text-white`} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="text-xs">
                        {o.reward ? <div><span className="text-emerald-700">Reward:</span> {o.reward}</div> : null}
                        {o.penalty ? <div className="mt-1"><span className="text-rose-700">Penalty:</span> {o.penalty}</div> : null}
                        {!o.reward && !o.penalty ? <span className="text-muted-foreground">—</span> : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/** UI bits */
function StatCard({ title, children }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground mb-1">{title}</div>
        {children}
      </CardContent>
    </Card>
  );
}

function Pill({ label, className = "" }) {
  return <span className={`inline-flex px-2 py-0.5 rounded text-[11px] ${className}`}>{label}</span>;
}

function ProgressBar({ value }) {
  const v = clamp01(value);
  return (
    <div className="h-2 w-full rounded bg-muted/50 overflow-hidden ring-1 ring-black/5">
      <div className="h-full rounded" style={{ width: `${v * 100}%`, background: "var(--primary, #111827)" }} />
    </div>
  );
}
