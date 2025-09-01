// src/pages/CalendarPage.jsx
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

// ==== Date utils ====
const fromISO = (iso) => {
  if (!iso) return new Date(NaN);
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const TYPE_STYLES = {
  GP: "bg-cyan-600 text-white",
  TRAINING: "bg-emerald-600 text-white",
  PR: "bg-fuchsia-600 text-white",
  BOARD: "bg-rose-600 text-white",
  STAFF: "bg-amber-600 text-white",
  DEV: "bg-indigo-600 text-white",
  HQ: "bg-slate-600 text-white",
  ACADEMY: "bg-teal-700 text-white",
  SCOUTING: "bg-lime-700 text-white",
  FINANCES: "bg-purple-700 text-white",
  OTHER: "bg-zinc-700 text-white",
};

// ==== Density presets ====
const DENSITY_PRESETS = {
  compact: {
    limit: 2,
    cellMin: "min-h-[88px] md:min-h-[96px]",
    gap: "gap-0.5",
    badge: "px-1.5 py-0.5 text-[10px] md:text-xs",
    dateSize: "text-[11px] md:text-sm",
  },
  comfort: {
    limit: 3,
    cellMin: "min-h-[110px] md:min-h-[120px]",
    gap: "gap-1",
    badge: "px-2 py-1 text-xs md:text-sm",
    dateSize: "text-xs md:text-sm",
  },
  roomy: {
    limit: 5,
    cellMin: "min-h-[140px] md:min-h-[160px]",
    gap: "gap-1.5",
    badge: "px-2.5 py-1.5 text-sm",
    dateSize: "text-sm md:text-base",
  },
};

function normalizeOtherEvents(gameState) {
  const raw = gameState?.events || gameState?.agenda || [];
  return raw
    .filter(Boolean)
    .map((e, idx) => ({
      id: e.id ?? `EV_${idx}`,
      date: e.date ?? e.dateISO,
      type: (e.type ?? e.category ?? "OTHER").toUpperCase(),
      title: e.title ?? e.name ?? "Event",
      meta: e,
    }))
    .filter((e) => e.date);
}
function mapGPsToEvents(calendar = []) {
  return calendar
    .filter((r) => r?.race_date)
    .map((r) => ({
      id: `GP_${r.year}_${r.round || r.gp_id || r.gp_name}`,
      date: r.race_date,
      type: "GP",
      title: r.gp_name || "Grand Prix",
      subtitle: r.Country || r.country || "",
      round: r.round,
      gp: r,
    }));
}
function buildMonthGrid(viewDate) {
  const start = startOfMonth(viewDate);
  const end = endOfMonth(viewDate);
  const startWeekday = (start.getDay() + 6) % 7; // Monday=0
  const daysInMonth = end.getDate();
  const cells = [];
  const leading = startWeekday;
  const totalCells = 42;
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - leading + 1;
    const dateObj = new Date(viewDate.getFullYear(), viewDate.getMonth(), dayNum);
    const inCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
    cells.push({ dateObj, inCurrentMonth });
  }
  return cells;
}

export default function CalendarPage() {
  const { gameState } = useGame();

  const today = useMemo(() => {
    const iso = gameState?.currentDateISO;
    return iso ? fromISO(iso) : new Date();
  }, [gameState?.currentDateISO]);

  const [viewDate, setViewDate] = useState(() => {
    const base = gameState?.currentDateISO ? fromISO(gameState.currentDateISO) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [density, setDensity] = useState("comfort");
  const currentDensity = DENSITY_PRESETS[density];

  const allEvents = useMemo(() => {
    const gpEvents = mapGPsToEvents(gameState?.calendar || []);
    const misc = normalizeOtherEvents(gameState);
    return [...gpEvents, ...misc].map((ev) => ({
      ...ev,
      type: ev.type?.toUpperCase?.() || "OTHER",
      dateObj: fromISO(ev.date),
      dateISO: ev.date,
    }));
  }, [gameState]);

  const monthEvents = useMemo(() => {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    return allEvents.filter((ev) => {
      const inMonth = ev.dateObj.getFullYear() === y && ev.dateObj.getMonth() === m;
      const passType = typeFilter === "ALL" ? true : ev.type === typeFilter;
      return inMonth && passType;
    });
  }, [allEvents, viewDate, typeFilter]);

  const eventsByDay = useMemo(() => {
    const map = new Map();
    for (const ev of monthEvents) {
      const key = toISO(ev.dateObj);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    }
    for (const [k, list] of map) {
      list.sort((a, b) => {
        if (a.type === "GP" && b.type !== "GP") return -1;
        if (a.type !== "GP" && b.type === "GP") return 1;
        if (a.round && b.round && a.round !== b.round) return a.round - b.round;
        return (a.title || "").localeCompare(b.title || "");
      });
      map.set(k, list);
    }
    return map;
  }, [monthEvents]);

  const grid = useMemo(() => buildMonthGrid(viewDate), [viewDate]);
  const monthLabel = useMemo(
    () => viewDate.toLocaleString("en-GB", { month: "long", year: "numeric" }),
    [viewDate]
  );

  const yearOptions = useMemo(() => {
    const yearsInCal = Array.from(
      new Set((gameState?.calendar || []).map((r) => Number(r.year)).filter(Boolean))
    ).sort((a, b) => a - b);
    if (yearsInCal.length) return yearsInCal;
    const y = today.getFullYear();
    return [y - 1, y, y + 1];
  }, [gameState?.calendar, today]);

  const onChangeYear = (e) => {
    const y = Number(e.target.value);
    setViewDate(new Date(y, viewDate.getMonth(), 1));
  };
  const onChangeFilter = (e) => setTypeFilter(e.target.value);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-semibold">Calendar</h1>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setViewDate(addMonths(viewDate, -1))}>◀ Prev</Button>
          <Button variant="secondary" onClick={() => setViewDate(new Date(today.getFullYear(), today.getMonth(), 1))}>
            Today
          </Button>
          <Button variant="outline" onClick={() => setViewDate(addMonths(viewDate, 1))}>Next ▶</Button>
        </div>

        <div className="flex items-center gap-2">
          <select value={typeFilter} onChange={onChangeFilter} className="border rounded px-2 py-1">
            <option value="ALL">All types</option>
            <option value="GP">Grand Prix</option>
            <option value="TRAINING">Training</option>
            <option value="PR">PR/Media</option>
            <option value="BOARD">Board</option>
            <option value="STAFF">Staff</option>
            <option value="DEV">Development</option>
            <option value="HQ">HQ</option>
            <option value="ACADEMY">Academy</option>
            <option value="SCOUTING">Scouting</option>
            <option value="FINANCES">Finances</option>
            <option value="OTHER">Other</option>
          </select>

          <select value={String(viewDate.getFullYear())} onChange={onChangeYear} className="border rounded px-2 py-1">
            {yearOptions.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>

          {/* Density selector */}
          <select
            value={density}
            onChange={(e) => setDensity(e.target.value)}
            className="border rounded px-2 py-1"
            title="Change density"
          >
            <option value="compact">Compact</option>
            <option value="comfort">Comfort</option>
            <option value="roomy">Roomy</option>
          </select>
        </div>
      </div>

      {/* Subheader */}
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-medium">{monthLabel}</h2>
        <Legend />
      </div>

      {/* Grid */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {/* Week header */}
          <div className="grid grid-cols-7 text-xs md:text-sm bg-muted/60 border-b">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="p-2 text-center font-medium">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {grid.map(({ dateObj, inCurrentMonth }, idx) => {
              const keyISO = toISO(dateObj);
              const events = eventsByDay.get(keyISO) || [];
              const isToday = isSameDay(dateObj, today);
              return (
                <div
                  key={`${keyISO}_${idx}`}
                  className={[
                    `${currentDensity.cellMin} border border-muted/60 p-2 flex flex-col ${currentDensity.gap}`,
                    inCurrentMonth ? "bg-background" : "bg-muted/30 text-muted-foreground",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between">
                    <div className={`${currentDensity.dateSize} font-medium`}>{dateObj.getDate()}</div>
                    {isToday && (
                      <span className="text-[10px] md:text-xs px-2 py-0.5 rounded-full bg-primary text-primary-foreground">
                        Today
                      </span>
                    )}
                  </div>

                  <div className={`flex flex-col ${currentDensity.gap} mt-1`}>
                    {events.slice(0, currentDensity.limit).map((ev) => {
                      const style = TYPE_STYLES[ev.type] || TYPE_STYLES.OTHER;
                      const isGP = ev.type === "GP";
                      const label = isGP
                        ? `${ev.round ? `R${ev.round} — ` : ""}${ev.title}${ev.subtitle ? ` (${ev.subtitle})` : ""}`
                        : ev.title;

                      const BadgeLike = (
                        <span className={`w-full inline-flex items-center justify-start rounded ${currentDensity.badge} ${style}`}>
                          {label}
                        </span>
                      );

                      return isGP && ev.round ? (
                        <Link key={ev.id} to={`/gp/${ev.round}`} className="no-underline">
                          {BadgeLike}
                        </Link>
                      ) : (
                        <div key={ev.id}>{BadgeLike}</div>
                      );
                    })}
                    {events.length > currentDensity.limit && (
                      <span className="text-[10px] text-muted-foreground">+{events.length - currentDensity.limit} more…</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <UpcomingList allEvents={allEvents} baseDate={today} />
    </div>
  );
}

function Legend() {
  const items = [
    ["GP", "Grand Prix"],
    ["TRAINING", "Training"],
    ["PR", "PR/Media"],
    ["BOARD", "Board"],
    ["STAFF", "Staff"],
    ["DEV", "Development"],
    ["HQ", "HQ"],
    ["ACADEMY", "Academy"],
    ["SCOUTING", "Scouting"],
    ["FINANCES", "Finances"],
    ["OTHER", "Other"],
  ];
  return (
    <div className="hidden md:flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      {items.map(([k, label]) => (
        <span key={k} className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded ${TYPE_STYLES[k] || TYPE_STYLES.OTHER}`} />
          <span>{label}</span>
        </span>
      ))}
    </div>
  );
}

function UpcomingList({ allEvents, baseDate }) {
  const upcoming = useMemo(() => {
    return allEvents
      .filter((ev) => ev.dateObj >= new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()))
      .sort((a, b) => a.dateObj - b.dateObj)
      .slice(0, 10);
  }, [allEvents, baseDate]);

  if (!upcoming.length) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-lg font-medium mb-3">Upcoming</h3>
        <div className="flex flex-col divide-y">
          {upcoming.map((ev) => {
            const style = TYPE_STYLES[ev.type] || TYPE_STYLES.OTHER;
            const dateLabel = ev.dateObj.toLocaleDateString("en-GB", {
              weekday: "short",
              day: "2-digit",
              month: "short",
              year: "numeric",
            });
            const isGP = ev.type === "GP";
            const label = isGP
              ? `${ev.round ? `R${ev.round} — ` : ""}${ev.title}${ev.subtitle ? ` (${ev.subtitle})` : ""}`
              : ev.title;

            const Row = (
              <div className="py-2 flex items-center gap-3">
                <span className={`inline-flex rounded px-2 py-1 text-xs ${style}`}>{ev.type}</span>
                <div className="flex-1">
                  <div className="font-medium leading-tight">{label}</div>
                  <div className="text-xs text-muted-foreground">{dateLabel}</div>
                </div>
              </div>
            );

            return isGP && ev.round ? (
              <Link key={ev.id} to={`/gp/${ev.round}`} className="no-underline">
                {Row}
              </Link>
            ) : (
              <div key={ev.id}>{Row}</div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
