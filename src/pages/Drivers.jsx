import React, { useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";
import { ageOn } from "../utils/date.js";

const headers = [
  { key: "name", label: "Driver" },
  { key: "team_name", label: "Team" },
  { key: "nationality", label: "Nat." },
  { key: "age", label: "Age" },
  { key: "current_ability", label: "Overall" },
  { key: "contract_until", label: "Contract" },
];

const idOf = (obj) => String(obj?.driver_id ?? obj?.person_id ?? obj?.id ?? "");
const teamIdOf = (obj) => String(obj?.team_id ?? obj?.constructor_id ?? obj?.team ?? "");

function driverName(d) {
  return d?.display_name || d?.name || d?.driver_name || `${d?.first_name ?? ""} ${d?.last_name ?? ""}`.trim() || idOf(d) || "—";
}

export default function Drivers() {
  const gameState = useGame((s) => s.gameState);
  const drivers = Array.isArray(gameState?.drivers) ? gameState.drivers : [];
  const ratings = Array.isArray(gameState?.driverRatings) ? gameState.driverRatings : [];
  const contracts = Array.isArray(gameState?.contracts) ? gameState.contracts : [];
  const teamsDb = Array.isArray(gameState?.teams) ? gameState.teams : [];
  const activeYear = Number(gameState?.activeYear);

  const [q, setQ] = useState("");
  const [team, setTeam] = useState("ALL");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;

  const teamNames = useMemo(() => new Map(teamsDb.map((t) => [String(t?.team_id ?? t?.id ?? ""), t?.team_name || t?.name || t?.short_name || "—"])), [teamsDb]);
  const ratingByDriver = useMemo(() => new Map(ratings.map((r) => [idOf(r), r])), [ratings]);
  const contractByDriver = useMemo(() => {
    const map = new Map();
    for (const c of contracts) {
      const id = idOf(c);
      if (!id || !/driver/i.test(String(c?.role ?? c?.position ?? c?.contract_role ?? "driver"))) continue;
      const year = Number(c?.year ?? c?.season_year ?? activeYear);
      if (Number.isFinite(activeYear) && Number.isFinite(year) && year !== activeYear) continue;
      if (!map.has(id)) map.set(id, c);
    }
    return map;
  }, [contracts, activeYear]);

  const enriched = useMemo(() => drivers.map((d) => {
    const id = idOf(d);
    const rating = ratingByDriver.get(id) || {};
    const contract = contractByDriver.get(id) || {};
    const tid = teamIdOf(contract) || teamIdOf(d);
    const contractEnd = contract?.contract_until_year ?? contract?.contract_until ?? contract?.end_year ?? contract?.end_date ?? "—";
    return {
      ...d,
      id,
      name: driverName(d),
      team_id: tid || null,
      team_name: teamNames.get(tid) || contract?.team_name || d?.team_name || "—",
      nationality: d?.country_name || d?.nationality || d?.country || "—",
      age: d?.age ?? ageOn(gameState?.currentDateISO, d?.birthdate ?? d?.dob),
      current_ability: rating?.current_ability ?? rating?.overall ?? rating?.pace ?? "—",
      contract_until: contractEnd,
    };
  }), [drivers, ratingByDriver, contractByDriver, teamNames, gameState?.currentDateISO]);

  const teams = useMemo(() => ["ALL", ...Array.from(new Set(enriched.map((d) => d.team_name).filter((v) => v && v !== "—"))).sort()], [enriched]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return enriched.filter((d) => {
      const matchQ = !needle || [d.name, d.team_name, d.nationality].some((v) => String(v ?? "").toLowerCase().includes(needle));
      return matchQ && (team === "ALL" || d.team_name === team);
    });
  }, [enriched, q, team]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = Number(av), bn = Number(bv);
      const bothNumeric = av !== "—" && bv !== "—" && Number.isFinite(an) && Number.isFinite(bn);
      const cmp = bothNumeric ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const paged = sorted.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);

  const onSort = (key) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  return (
    <div className="grid gap-4">
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="text-lg font-semibold">Drivers</h2>
        <p className="text-sm text-gray-500">Season {gameState?.activeYear ?? "—"} · click a driver to open the profile.</p>
        <div className="mt-3 flex flex-col md:flex-row gap-2">
          <input className="border rounded-md px-3 py-2 text-sm flex-1" placeholder="Search driver/team/nationality…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <select className="border rounded-md px-3 py-2 text-sm" value={team} onChange={(e) => { setTeam(e.target.value); setPage(1); }}>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="border rounded-md px-3 py-2 text-sm" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            {headers.map((h) => <option key={h.key} value={h.key}>{`Sort by: ${h.label}`}</option>)}
          </select>
          <button className="border rounded-md px-3 py-2 text-sm" onClick={() => setSortDir((d) => d === "asc" ? "desc" : "asc")}>{sortDir === "asc" ? "Asc ↑" : "Desc ↓"}</button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50"><tr>{headers.map((h) => <th key={h.key} className="text-left font-semibold px-4 py-3 cursor-pointer select-none" onClick={() => onSort(h.key)}>{h.label}{sortKey === h.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</th>)}</tr></thead>
          <tbody>
            {!paged.length ? <tr><td className="px-4 py-6 text-center text-gray-500" colSpan={headers.length}>No drivers found.</td></tr> : paged.map((d) => (
              <tr key={d.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-2"><button type="button" data-entity="driver" data-id={d.id} className="font-medium hover:underline text-left">{d.name}</button></td>
                <td className="px-4 py-2">{d.team_name}</td>
                <td className="px-4 py-2">{d.nationality}</td>
                <td className="px-4 py-2">{d.age ?? "—"}</td>
                <td className="px-4 py-2">{d.current_ability}</td>
                <td className="px-4 py-2">{d.contract_until}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-600">{sorted.length} results • Page {pageClamped}/{totalPages}</div>
        <div className="flex gap-2">
          <button className="border rounded-md px-3 py-1 text-sm disabled:opacity-50" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageClamped <= 1}>Prev</button>
          <button className="border rounded-md px-3 py-1 text-sm disabled:opacity-50" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageClamped >= totalPages}>Next</button>
        </div>
      </div>
    </div>
  );
}
