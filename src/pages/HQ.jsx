// src/pages/HQ.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

/** Utils */
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));
const daysToMs = (d) => (Number(d) || 0) * 24 * 60 * 60 * 1000;
const fmtMoney = (n) => {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n));
  } catch {
    return `${n}`;
  }
};
const titleCase = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");
const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  // accept YYYY-MM-DD or ISO
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

/** Normalização ultra-tolerante */
function normalizeHQ(raw) {
  const arr = Array.isArray(raw?.facilities) ? raw.facilities
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.items) ? raw.items
    : [];

  const facilities = arr.map((f, i) => {
    const level = f.level ?? f.lvl ?? f.tier ?? 0;
    const max = f.max_level ?? f.max ?? 5;
    const status = (f.status ?? f.state ?? "active").toString().toLowerCase(); // active|upgrading|disabled
    const upCost = f.upgrade_cost ?? f.cost ?? f.upgrade?.cost ?? null;
    const upDays = f.upgrade_time_days ?? f.upgrade_days ?? f.duration_days ?? f.upgrade?.days ?? null;
    const name = f.name ?? f.id ?? `Facility ${i + 1}`;

    return {
      id: f.id ?? name.toLowerCase().replace(/\s+/g, "_"),
      name,
      category: (f.category ?? f.type ?? name).toString(),
      level: clamp(level, 0, max),
      maxLevel: Number(max) || 5,
      status,
      effects: f.effects ?? f.bonus ?? null, // livre: {attr:+x, dnf:-y} etc
      upgrade_cost: upCost,
      upgrade_time_days: upDays,
      // dates
      started_at: toDate(f.started_at ?? f.upgrade_started_at ?? null),
      finishes_at: toDate(f.finishes_at ?? f.upgrade_finishes_at ?? null),
      // free-form meta
      meta: f
    };
  });

  // queue (opcional)
  const queueRaw = raw?.queue ?? raw?.upgrades ?? [];
  const queue = Array.isArray(queueRaw) ? queueRaw.map((q, i) => ({
    id: q.id ?? `Q_${i}`,
    facility_id: q.facility_id ?? q.facility ?? null,
    name: q.name ?? q.title ?? q.facility_name ?? "Upgrade",
    started_at: toDate(q.started_at ?? q.start ?? null),
    finishes_at: toDate(q.finishes_at ?? q.finish ?? q.until ?? null),
    cost: q.cost ?? q.budget ?? null
  })) : [];

  return { facilities, queue };
}

function ProgressBar({ value, max = 1 }) {
  const v = clamp(value / max, 0, 1);
  return (
    <div className="h-2 w-full rounded bg-muted/50 overflow-hidden ring-1 ring-black/5">
      <div className="h-full rounded" style={{ width: `${v * 100}%`, background: "var(--primary, #111827)" }} />
    </div>
  );
}

function Pill({ children, className = "" }) {
  return <span className={`inline-flex px-2 py-0.5 rounded text-[11px] ${className}`}>{children}</span>;
}

const STATUS_COLORS = {
  active: "bg-emerald-600 text-white",
  upgrading: "bg-sky-600 text-white",
  disabled: "bg-zinc-600 text-white"
};

export default function HQ() {
  const { gameState } = useGame();
  const [fallback, setFallback] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/data/hq.json");
        if (r.ok) setFallback(await r.json());
      } catch {}
    })();
  }, []);

  const { facilities, queue } = useMemo(
    () => normalizeHQ(gameState?.hq || fallback || {}),
    [gameState?.hq, fallback]
  );

  const summary = useMemo(() => {
    const total = facilities.length || 1;
    const avgLevel = facilities.reduce((s, f) => s + (Number(f.level) || 0), 0) / total;
    const actives = facilities.filter((f) => f.status === "active").length;
    const upgs = facilities.filter((f) => f.status === "upgrading").length;
    return { avgLevel, actives, upgs, total };
  }, [facilities]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-semibold">HQ</h1>
        <div className="text-sm text-muted-foreground">
          Facilities: <span className="font-medium">{summary.total}</span> • Active: <span className="font-medium">{summary.actives}</span> • Upgrading: <span className="font-medium">{summary.upgs}</span>
        </div>
      </div>

      {/* Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Average Level</div>
            <div className="text-xl font-semibold">{summary.avgLevel.toFixed(1)} / 5</div>
            <div className="mt-2"><ProgressBar value={summary.avgLevel} max={5} /></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Active Facilities</div>
            <div className="text-xl font-semibold">{summary.actives}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Upgrades In Progress</div>
            <div className="text-xl font-semibold">{summary.upgs}</div>
          </CardContent>
        </Card>
      </div>

      {/* Facilities grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {facilities.length === 0 ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">No facilities configured.</CardContent></Card>
        ) : (
          facilities.map((f) => (
            <Card key={f.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-muted-foreground">{f.category}</div>
                    <div className="text-lg font-medium">{f.name}</div>
                  </div>
                  <Pill className={`${STATUS_COLORS[f.status] || STATUS_COLORS.active}`}>{titleCase(f.status)}</Pill>
                </div>

                <div>
                  <div className="flex items-center justify-between text-sm">
                    <div>Level</div>
                    <div className="font-medium">{f.level} / {f.maxLevel}</div>
                  </div>
                  <div className="mt-1"><ProgressBar value={f.level} max={f.maxLevel} /></div>
                </div>

                {f.effects ? (
                  <div className="text-xs text-muted-foreground">
                    {/* efeitos livres em formato chave:valor */}
                    <EffectsList effects={f.effects} />
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border p-2">
                    <div className="text-[11px] text-muted-foreground">Upgrade Cost</div>
                    <div className="text-sm font-medium">{f.upgrade_cost != null ? fmtMoney(f.upgrade_cost) : "—"}</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-[11px] text-muted-foreground">Upgrade Time</div>
                    <div className="text-sm font-medium">{f.upgrade_time_days ? `${f.upgrade_time_days} days` : "—"}</div>
                  </div>
                </div>

                {/* Upgrading ETA */}
                {f.status === "upgrading" ? (
                  <div className="text-xs text-muted-foreground">
                    {renderETA(f.started_at, f.finishes_at, f.upgrade_time_days)}
                  </div>
                ) : null}

                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" disabled>Upgrade</Button>
                  <Button size="sm" variant="outline" disabled>Pause</Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Upgrade Queue */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-lg font-medium">Upgrade Queue</div>
            <Button size="sm" variant="outline" disabled>Prioritize</Button>
          </div>
          {queue.length === 0 ? (
            <div className="text-sm text-muted-foreground">No queued upgrades.</div>
          ) : (
            <ul className="divide-y">
              {queue.map((q) => (
                <li key={q.id} className="py-2 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-medium leading-tight">{q.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {q.started_at ? q.started_at.toLocaleDateString("en-GB", { day:"2-digit", month:"short" }) : "—"}
                      {" → "}
                      {q.finishes_at ? q.finishes_at.toLocaleDateString("en-GB", { day:"2-digit", month:"short" }) : "—"}
                      {q.cost != null ? ` • ${fmtMoney(q.cost)}` : ""}
                    </div>
                  </div>
                  <Button size="sm" disabled>Cancel</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Renders effect list regardless of structure (string | array | object) */
function EffectsList({ effects }) {
  if (!effects) return null;
  if (typeof effects === "string") return <div>{effects}</div>;
  if (Array.isArray(effects)) {
    return (
      <ul className="list-disc pl-5 space-y-0.5">
        {effects.map((e, i) => <li key={i}>{typeof e === "string" ? e : JSON.stringify(e)}</li>)}
      </ul>
    );
  }
  // object
  return (
    <ul className="list-disc pl-5 space-y-0.5">
      {Object.entries(effects).map(([k, v]) => (
        <li key={k}><span className="text-foreground">{titleCase(k)}:</span> {typeof v === "number" ? v : String(v)}</li>
      ))}
    </ul>
  );
}

function renderETA(started_at, finishes_at, upgrade_time_days) {
  const now = new Date();
  const start = started_at || now;
  const end = finishes_at || (upgrade_time_days ? new Date(start.getTime() + daysToMs(upgrade_time_days)) : null);
  if (!end) return "Upgrading…";
  const msLeft = end.getTime() - now.getTime();
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  if (daysLeft >= 0) {
    return `ETA: ${end.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)`;
  }
  return `Completed on ${end.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
}
