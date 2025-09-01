// src/pages/CalendarPage.jsx
import React, { useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";

export default function CalendarPage() {
  const { gameState } = useGame();
  const { calendar = [] } = gameState;

  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("dateISO");
  const [sortDir, setSortDir] = useState("asc");

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return calendar.filter(gp =>
      !qn ||
      String(gp.name ?? "").toLowerCase().includes(qn) ||
      String(gp.country ?? "").toLowerCase().includes(qn)
    );
  }, [calendar, q]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (sortKey === "dateISO") {
        const ta = Date.parse(av), tb = Date.parse(bv);
        return sortDir === "asc" ? ta - tb : tb - ta;
      }
      const res = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? res : -res;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const onSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  return (
    <div className="grid gap-4">
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="text-lg font-semibold">Calendar</h2>
        <div className="mt-3 flex flex-col md:flex-row gap-2">
          <input
            className="border rounded-md px-3 py-2 text-sm flex-1"
            placeholder="Search GP or Country…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
          >
            <option value="dateISO">Sort by: Date</option>
            <option value="name">Sort by: Grand Prix</option>
            <option value="country">Sort by: Country</option>
          </select>
          <button
            className="border rounded-md px-3 py-2 text-sm"
            onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
          >
            {sortDir === "asc" ? "Asc ↑" : "Desc ↓"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold cursor-pointer" onClick={() => onSort("dateISO")}>
                Date {sortKey === "dateISO" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th className="px-4 py-3 text-left font-semibold cursor-pointer" onClick={() => onSort("name")}>
                Grand Prix {sortKey === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th className="px-4 py-3 text-left font-semibold cursor-pointer" onClick={() => onSort("country")}>
                Country {sortKey === "country" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td className="px-4 py-6 text-center text-gray-500" colSpan={3}>No races found.</td></tr>
            ) : sorted.map(gp => (
              <tr key={gp.id ?? gp.name} className="border-t">
                <td className="px-4 py-2">{gp.dateISO ?? "—"}</td>
                <td className="px-4 py-2">{gp.name ?? "—"}</td>
                <td className="px-4 py-2">{gp.country ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
