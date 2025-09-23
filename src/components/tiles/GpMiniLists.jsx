import React, { useState } from "react";

/**
 * Props:
 * - next3:  lista completa de GPs futuros [{ name, date|race_date|dateISO, gp_id, track_id, ... }]
 * - last3:  lista completa de GPs passados (mais recente primeiro)
 * - currentDateISO: string "YYYY-MM-DD" (para calcular dias)
 */
export default function GpMiniLists({ next3 = [], last3 = [], currentDateISO }) {
  const [tab, setTab] = useState("next"); // "next" | "last"
  const list = tab === "next" ? next3 : last3;

  const Btn = ({ active, onClick, children }) => (
    <button
      onClick={onClick}
      className={
        "px-2 py-1 text-xs rounded " +
        (active ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200")
      }
    >
      {children}
    </button>
  );

  const getDateStr = (gp) => gp?.date || gp?.race_date || gp?.dateISO || "";
  const toDate = (iso) => {
    if (!iso) return new Date(NaN);
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  };
  const daysUntil = (fromISO, toISO) => {
    const a = toDate(fromISO);
    const b = toDate(toISO);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Grand Prix</h3>
        <div className="flex items-center gap-1 text-xs">
          <Btn active={tab === "next"} onClick={() => setTab("next")}>Next GP</Btn>
          <Btn active={tab === "last"} onClick={() => setTab("last")}>Last GP</Btn>
        </div>
      </div>

      <div className="mt-3 rounded-xl border overflow-hidden">
        <div className="px-3 py-2 text-xs uppercase tracking-wide text-gray-500 bg-gray-50">
          {tab === "next" ? "Upcoming" : "Recent"}
        </div>
        <ul className="px-3 divide-y text-sm">
          {list && list.length ? (
            list.map((gp, i) => {
              const key = String(gp.gp_id ?? gp.track_id ?? gp.id ?? getDateStr(gp) ?? `${gp.name}-${i}`);
              const dateStr = getDateStr(gp) || "—";
              const d = tab === "next" ? daysUntil(currentDateISO, getDateStr(gp)) : null;

              return (
                <li key={key} className="py-2 flex items-center justify-between gap-3">
                  <span className="truncate">{gp.name || "Grand Prix"}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {/* pill Xd só para Next */}
                    {tab === "next" && d != null && d >= 0 && (
                      <span className="text-[10px] leading-none px-2 py-1 rounded-full bg-indigo-600 text-white">
                        {d}d
                      </span>
                    )}
                    <span className="text-xs text-gray-700">{dateStr}</span>
                  </span>
                </li>
              );
            })
          ) : (
            <li className="py-2 text-gray-500">—</li>
          )}
        </ul>
      </div>
    </div>
  );
}
