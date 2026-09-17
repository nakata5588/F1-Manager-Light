import React, { useMemo } from "react";
import { useGame } from "../state/GameStore.js";
import { DriverPortrait, TeamLogo, flagFromCountry } from "../components/entity/EntityVisuals.jsx";

const unbox = (v) => v && typeof v === "object" && !Array.isArray(v) ? (v.result ?? v.value ?? v) : v;
const pick = (o, keys, fb = undefined) => {
  for (const k of keys) {
    const v = unbox(o?.[k]);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fb;
};
const idOf = (o) => String(pick(o, ["driver_id","person_id","id"], ""));
const teamIdOf = (o) => String(pick(o, ["team_id","constructor_id","team","constructor"], ""));

function niceRole(role) {
  return String(role || "driver").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function MyDrivers() {
  const gs = useGame((s) => s.gameState);
  const year = Number(gs?.activeYear);
  const myTeamId = String(gs?.team?.team_id ?? gs?.team?.id ?? "");
  const myTeamName = gs?.team?.team_name || gs?.team?.name || "My Team";
  const drivers = gs?.drivers?.length ? gs.drivers : gs?.dbDrivers || [];
  const contracts = gs?.contracts?.length ? gs.contracts : gs?.dbContracts || [];
  const ratings = gs?.driverRatings?.length ? gs.driverRatings : gs?.dbDriverRatings || [];

  const ratingById = useMemo(() => new Map(ratings.map((r) => [idOf(r), r])), [ratings]);
  const driverById = useMemo(() => new Map(drivers.map((d) => [idOf(d), d])), [drivers]);

  const rows = useMemo(() => contracts
    .filter((c) => {
      const role = String(pick(c, ["role","position","contract_role"], "")).toLowerCase();
      const cy = Number(pick(c, ["year","season_year"], year));
      return role.includes("driver") && teamIdOf(c) === myTeamId && (!Number.isFinite(year) || !Number.isFinite(cy) || cy === year);
    })
    .map((contract) => {
      const id = idOf(contract);
      const driver = driverById.get(id) || { driver_id: id, display_name: pick(contract, ["driver_name","name"], id) };
      const rating = ratingById.get(id) || {};
      return {
        id,
        driver,
        contract,
        name: driver.display_name || driver.name || pick(contract, ["driver_name","name"], id),
        role: niceRole(pick(contract, ["role","position"], "driver")),
        overall: pick(rating, ["current_ability","overall","pace"], "—"),
        salary: Number(pick(contract, ["salary","salary_yearly"], 0)) || 0,
        until: pick(contract, ["contract_until_year","contract_until","end_year","end_date"], "—"),
      };
    })
    .sort((a,b) => String(a.role).localeCompare(String(b.role))), [contracts, year, myTeamId, driverById, ratingById]);

  return (
    <div className="grid gap-4">
      <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
        <TeamLogo teamId={myTeamId} name={myTeamName} size="h-12 w-12" />
        <div>
          <h2 className="text-xl font-semibold">My Drivers</h2>
          <p className="text-sm text-gray-500">{myTeamName} · Season {year || "—"}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            data-entity="driver"
            data-id={row.id}
            className="bg-white rounded-xl shadow p-4 text-left hover:shadow-md transition"
          >
            <div className="flex items-center gap-4">
              <DriverPortrait driver={row.driver} size="h-20 w-20" />
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold truncate">{row.name}</div>
                <div className="text-sm text-gray-500">
                  {flagFromCountry(row.driver?.country_name || row.driver?.nationality, row.driver?.country_code)}{" "}
                  {row.driver?.country_name || row.driver?.nationality || "—"}
                </div>
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <Info label="Role" value={row.role} />
                  <Info label="Overall" value={row.overall} />
                  <Info label="Contract" value={row.until} />
                  <Info label="Salary" value={row.salary ? new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(row.salary) : "—"} />
                </div>
              </div>
            </div>
          </button>
        ))}
        {!rows.length && (
          <div className="bg-white rounded-xl shadow p-6 text-sm text-gray-500">
            No driver contracts found for this team in {year}.
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return <div><div className="text-xs text-gray-500">{label}</div><div className="font-medium">{value ?? "—"}</div></div>;
}
