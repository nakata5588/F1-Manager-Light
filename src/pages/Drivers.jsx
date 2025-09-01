import React, { useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";
import { ageOn } from "../utils/date.js";

const headers = [
  { key: "name", label: "Driver" },
  { key: "team_name", label: "Team" },
  { key: "nationality", label: "Nat." },
  { key: "age", label: "Age", numeric: true },
  { key: "current_ability", label: "Overall", numeric: true },
  { key: "contract_until", label: "Contract" }
];

export default function Drivers() {
  const { gameState } = useGame();
  const { currentDateISO, drivers = [] } = gameState;

  const [q, setQ] = useState("");
  const [team, setTeam] = useState("ALL");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const teams = useMemo(() => {
    const s = new Set(drivers.map(d => d.team).filter(Boolean));
    return ["ALL", ...Array.from(s)];
  }, [drivers]);

  const enriched = useMemo(() => {
    return drivers.map(d => ({
      ...d,
      age: ageOn(currentDateISO, d.birthdate)
    }));
  }, [drivers, currentDateISO]);

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return enriched.filter(d => {
      const matchQ = !qn || [d.name, d.short_name, d.team, d.nationality].some(v =>
        String(v ?? "").toLowerCase().includes(qn)
      );
      const matchTeam = team === "ALL" || d.team === team;
      return matchQ && matchTeam;
    });
  }, [enriched, q, team]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const res = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? res : -res;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const paged = sorted.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);

  const onSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="grid gap-4">
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="text-lg font-semibold">Drivers</h2>
        <div className="mt-3 flex flex-col md:flex-row gap-2">
          <input
            className="border rounded-md px-3 py-2 text-sm flex-1"
            placeholder="Search driver/team/nationality…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
          />
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={team}
            onChange={(e) => { setTeam(e.target.value); setPage(1); }}
          >
            {teams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
          >
            {headers.map(h => <option key={h.key} value={h.key}>{`Sort by: ${h.label}`}</option>)}
          </select>
          <button
            className="border rounded-md px-3 py-2 text-sm"
            onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
            title="Toggle sort direction"
          >
            {sortDir === "asc" ? "Asc ↑" : "Desc ↓"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {headers.map(h => (
                <th
                  key={h.key}
                  className="text-left font-semibold px-4 py-3 cursor-pointer select-none"
                  onClick={() => onSort(h.key)}
                  title={`Sort by ${h.label}`}
                >
                  {h.label}{sortKey === h.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td className="px-4 py-6 text-center text-gray-500" colSpan={headers.length}>No drivers found.</td></tr>
            ) : paged.map(d => (
              <tr key={d.id} className="border-t">
                <td className="px-4 py-2">{d.name}</td>
                <td className="px-4 py-2">{d.team_name ?? "—"}</td>
                <td className="px-4 py-2">{d.nationality ?? "—"}</td>
                <td className="px-4 py-2">{d.age ?? "—"}</td>
                <td className="px-4 py-2">{d.current_ability ?? "—"}</td>
                <td className="px-4 py-2">{d.contract_until ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-600">
          {sorted.length} results • Page {pageClamped}/{totalPages}
        </div>
        <div className="flex gap-2">
          <button
            className="border rounded-md px-3 py-1 text-sm disabled:opacity-50"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={pageClamped <= 1}
          >
            Prev
          </button>
          <button
            className="border rounded-md px-3 py-1 text-sm disabled:opacity-50"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={pageClamped >= totalPages}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
