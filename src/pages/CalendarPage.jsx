// src/pages/CalendarPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";
import { buildManagementEvents, daysBetweenISO } from "@/domain/managementEvents";
import { GrandPrixFlag } from "@/components/entity/GrandPrixFlag.jsx";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const TYPE_STYLES = {
  GP: "bg-rose-700 text-white",
  PRACTICE: "bg-cyan-700 text-white",
  QUALIFYING: "bg-violet-700 text-white",
  BOARD: "bg-rose-600 text-white",
  FINANCE: "bg-purple-700 text-white",
  FINANCES: "bg-purple-700 text-white",
  DEV: "bg-indigo-700 text-white",
  STAFF: "bg-amber-600 text-white",
  CONTRACT: "bg-amber-700 text-white",
  MEDICAL: "bg-orange-700 text-white",
  DEADLINE: "bg-red-700 text-white",
  PR: "bg-fuchsia-700 text-white",
  SCOUTING: "bg-lime-700 text-white",
  HQ: "bg-slate-700 text-white",
  ACADEMY: "bg-teal-700 text-white",
  OTHER: "bg-zinc-700 text-white",
};

const fromISO = (iso) => {
  if (!iso) return new Date(NaN);
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
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

function buildMonthGrid(viewDate) {
  const start = startOfMonth(viewDate);
  const end = endOfMonth(viewDate);
  const leading = (start.getDay() + 6) % 7;
  const daysInMonth = end.getDate();
  return Array.from({ length: 42 }, (_, i) => {
    const dayNum = i - leading + 1;
    return {
      dateObj: new Date(viewDate.getFullYear(), viewDate.getMonth(), dayNum),
      inCurrentMonth: dayNum >= 1 && dayNum <= daysInMonth,
    };
  });
}

function eventLabel(type) {
  if (type === "GP") return "Race";
  if (type === "DEV") return "Development";
  if (type === "HQ") return "Facilities";
  return String(type || "Other").replaceAll("_", " ");
}

function EventPill({ event, compact = false, gameState = null }) {
  const style = TYPE_STYLES[event.type] || TYPE_STYLES.OTHER;
  const body = (
    <div
      className={[
        "w-full rounded-md text-left transition-opacity hover:opacity-90",
        compact ? "px-1.5 py-1 text-[10px] leading-tight" : "px-2.5 py-2 text-xs",
        style,
      ].join(" ")}
      title={event.title}
    >
      <div className="flex min-w-0 items-center gap-1.5 font-semibold">
        {event?.meta?.gp ? <GrandPrixFlag gameState={gameState} gp={event.meta.gp} size="sm"/> : null}
        <span className="truncate">{event.title}</span>
      </div>
      {!compact && event.subtitle ? <div className="opacity-80 truncate mt-0.5">{event.subtitle}</div> : null}
    </div>
  );
  return event.route ? <Link to={event.route} className="block no-underline">{body}</Link> : body;
}

export default function CalendarPage() {
  const gameState = useGame((s) => s.gameState);
  const todayISO = gameState?.currentDateISO || new Date().toISOString().slice(0, 10);
  const today = useMemo(() => fromISO(todayISO), [todayISO]);

  const [viewDate, setViewDate] = useState(() => startOfMonth(today));
  const [selectedISO, setSelectedISO] = useState(todayISO);
  const [typeFilter, setTypeFilter] = useState("ALL");

  useEffect(() => {
    setSelectedISO(todayISO);
    setViewDate(startOfMonth(fromISO(todayISO)));
  }, [todayISO]);

  const allEvents = useMemo(
    () => buildManagementEvents(gameState).map((event) => ({ ...event, dateObj: fromISO(event.date) })),
    [gameState]
  );

  const visibleEvents = useMemo(
    () => allEvents.filter((event) => typeFilter === "ALL" || event.type === typeFilter),
    [allEvents, typeFilter]
  );

  const eventsByDay = useMemo(() => {
    const map = new Map();
    for (const event of visibleEvents) {
      if (!map.has(event.date)) map.set(event.date, []);
      map.get(event.date).push(event);
    }
    return map;
  }, [visibleEvents]);

  const selectedEvents = useMemo(
    () => (eventsByDay.get(selectedISO) || []).slice().sort((a, b) => String(a.title).localeCompare(String(b.title))),
    [eventsByDay, selectedISO]
  );

  const grid = useMemo(() => buildMonthGrid(viewDate), [viewDate]);
  const monthLabel = viewDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const selectedDate = fromISO(selectedISO);

  const typeOptions = useMemo(() => {
    const discovered = [...new Set(allEvents.map((event) => event.type))].sort();
    return ["ALL", ...discovered];
  }, [allEvents]);

  const upcoming = useMemo(
    () => allEvents
      .filter((event) => event.date >= todayISO)
      .slice(0, 8),
    [allEvents, todayISO]
  );

  return (
    <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold">Calendar</h1>
          <p className="text-sm text-slate-400">
            Race weekends, deadlines, contracts, development and team events from the live Save World.
          </p>
        </div>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => setViewDate(addMonths(viewDate, -1))}>‹</Button>
        <Button
          variant="secondary"
          onClick={() => {
            setViewDate(startOfMonth(today));
            setSelectedISO(todayISO);
          }}
        >
          Today
        </Button>
        <Button variant="outline" onClick={() => setViewDate(addMonths(viewDate, 1))}>›</Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <section className="xl:col-span-9 rounded-xl border border-white/10 bg-[#12141c] text-slate-100 shadow-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center gap-3">
            <div className="text-lg font-semibold uppercase tracking-wide">{monthLabel}</div>
            <div className="flex-1" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-slate-800 border border-white/10 rounded-md px-3 py-1.5 text-sm"
            >
              {typeOptions.map((type) => (
                <option key={type} value={type}>{type === "ALL" ? "All events" : eventLabel(type)}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-7 bg-slate-900/70 text-[11px] uppercase tracking-wider text-slate-400">
            {WEEKDAY_LABELS.map((day) => <div key={day} className="px-3 py-2">{day}</div>)}
          </div>

          <div className="grid grid-cols-7">
            {grid.map(({ dateObj, inCurrentMonth }) => {
              const iso = toISO(dateObj);
              const events = eventsByDay.get(iso) || [];
              const isToday = iso === todayISO;
              const selected = iso === selectedISO;
              return (
                <button
                  type="button"
                  key={iso}
                  onClick={() => setSelectedISO(iso)}
                  className={[
                    "min-h-[118px] p-2 text-left border-t border-r border-white/10 transition-colors",
                    inCurrentMonth ? "bg-[#0d0f15]" : "bg-[#090b10] text-slate-600",
                    selected ? "ring-2 ring-inset ring-white/60 bg-[#171a23]" : "hover:bg-[#171a23]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between">
                    <span className={isToday ? "font-bold text-white" : "font-medium"}>{dateObj.getDate()}</span>
                    {isToday ? <span className="text-[9px] uppercase tracking-wider text-slate-300">Today</span> : null}
                  </div>
                  <div className="mt-2 space-y-1">
                    {events.slice(0, 3).map((event) => (
                      <div key={event.id} className={`rounded px-1.5 py-1 text-[9px] truncate ${TYPE_STYLES[event.type] || TYPE_STYLES.OTHER}`}>
                        <span className="inline-flex min-w-0 items-center gap-1">
                          {event?.meta?.gp ? <GrandPrixFlag gameState={gameState} gp={event.meta.gp} size="sm"/> : null}
                          <span className="truncate">{eventLabel(event.type)} · {event.title.replace(/^.*? — /, "")}</span>
                        </span>
                      </div>
                    ))}
                    {events.length > 3 ? <div className="text-[10px] text-slate-400">+{events.length - 3} more</div> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="xl:col-span-3 space-y-4">
          <div className="rounded-xl border border-white/10 bg-[#12141c] text-slate-100 shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10">
              <div className="text-xs uppercase tracking-wider text-slate-400">
                {selectedDate.toLocaleDateString("en-GB", { weekday: "long" })}
              </div>
              <div className="text-xl font-semibold">
                {selectedDate.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}
              </div>
            </div>
            <div className="p-3 space-y-2 min-h-40">
              {selectedEvents.length
                ? selectedEvents.map((event) => <EventPill key={event.id} event={event} gameState={gameState} />)
                : <div className="text-sm text-slate-400 p-2">No scheduled events.</div>}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#12141c] text-slate-100 shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10">
              <div className="text-sm font-semibold">Upcoming events</div>
              <div className="text-xs text-slate-400">Next decisions and race-weekend milestones</div>
            </div>
            <div className="divide-y divide-white/10">
              {upcoming.map((event) => {
                const days = daysBetweenISO(todayISO, event.date);
                return (
                  <div key={event.id} className="p-3">
                    <div className="flex items-start gap-2">
                      <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${(TYPE_STYLES[event.type] || TYPE_STYLES.OTHER).split(" ")[0]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                          {event?.meta?.gp ? <GrandPrixFlag gameState={gameState} gp={event.meta.gp} size="sm"/> : null}
                          <span className="truncate">{event.title}</span>
                        </div>
                        <div className="text-xs text-slate-400">
                          {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`} · {event.date}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!upcoming.length ? <div className="p-4 text-sm text-slate-400">Nothing upcoming.</div> : null}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
