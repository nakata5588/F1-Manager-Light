// src/components/entity/TeamModal.jsx
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useModalStore } from "../../state/ModalStore.js";
import { useGame } from "../../state/GameStore.js";
import { contractRoleLabel, isDriverContract } from "../../domain/contractRoles.js";

/* ===================== TABS ===================== */
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "staff",    label: "Staff" },
  { key: "car",      label: "Car" },
  { key: "hq",       label: "Headquarters" },
  { key: "history",  label: "History" },
];

/* ===================== HELPERS ===================== */
const fmtMoney = (n) =>
  n == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function flagFromCountry(country = "", code = "") {
  const cc = (code || "").toUpperCase();
  if (cc.length === 2) return String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  const s = String(country).toLowerCase();
  if (s.includes("austria")) return "🇦🇹";
  if (s.includes("united kingdom") || s.includes("uk") || s.includes("brit")) return "🇬🇧";
  if (s.includes("ital")) return "🇮🇹";
  if (s.includes("german")) return "🇩🇪";
  if (s.includes("france")) return "🇫🇷";
  if (s.includes("spain")) return "🇪🇸";
  if (s.includes("japan")) return "🇯🇵";
  if (s.includes("nether")) return "🇳🇱";
  if (s.includes("brazil")) return "🇧🇷";
  return "🏳️";
}

function Info({ label, value }) {
  return (
    <div className="min-w-[12rem]">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium">{value ?? "—"}</div>
    </div>
  );
}

/** Pega o primeiro array verdadeirinho em várias chaves possíveis do gameState */
function getArr(gs, keys) {
  for (const k of keys) {
    const v = gs?.[k];
    if (Array.isArray(v) && v.length) return v;
  }
  return [];
}

/** Procura linha por team_id + year; se não encontrar por year, devolve a mais recente desse team */
function findByTeamAndYear(list, idStr, year) {
  if (!Array.isArray(list) || !list.length) return null;
  // match direto por id e ano
  const exact = list.find(r =>
    String(r.team_id ?? r.team ?? r.constructor ?? r.id) === idStr &&
    (year == null || r.year == null || Number(r.year) === Number(year))
  );
  if (exact) return exact;
  // senão, última (maior year) desse team
  const allTeam = list.filter(r => String(r.team_id ?? r.team ?? r.constructor ?? r.id) === idStr);
  if (!allTeam.length) return null;
  allTeam.sort((a,b) => Number(b.year ?? 0) - Number(a.year ?? 0));
  return allTeam[0];
}

/* ===================== COMPONENT ===================== */
export default function TeamModal({ entity, onClose, pageMode = false }) {
  const modalSetTab = useModalStore((s) => s.setTab);
  const rawTab = entity.tab || "overview";
  const initialTab = ["overview","staff","car","hq","history"].includes(rawTab) ? rawTab : "overview";
  const [pageTab,setPageTab] = useState(initialTab);
  const activeTab = pageMode ? pageTab : initialTab;
  const setTab = (tab) => {
    if(pageMode) setPageTab(tab);
    else modalSetTab(tab);
  };

  const idStr = String(entity.id);
  const gs    = useGame((s) => s.gameState);
  const year  = gs?.activeYear;

  /* ---------- Bases / catálogos ---------- */
  const teams       = getArr(gs, ["teams","dbTeams","constructors","dbConstructors"]);
  // Busca simplificada: filtra por ano e id
  const teamBrands = getArr(gs, ["teamBrands","dbTeamBrands"]);
  const brand = useMemo(() => teamBrands.find(b => String(b.team_id) === idStr && Number(b.year) === Number(year)), [teamBrands, idStr, year]);
  const team = useMemo(() => teams.find(t => String(t.team_id ?? t.id ?? t.team) === idStr), [teams, idStr]);

  /* ---------- Logos ---------- */
  const logoCandidates = useMemo(() => {
    const cands = [];
    if (idStr) {
      cands.push(`/logos/${idStr}.png`, `/logos/${idStr}.svg`, `/logos/teams/${idStr}.png`, `/logos/teams/${idStr}.svg`);
    }
    if (brand?.logo_path) cands.push(brand.logo_path);
    if (team?.logo_path)  cands.push(team.logo_path);
    return cands;
  }, [idStr, brand?.logo_path, team?.logo_path]);

  /* ---------- Team Engines (fonte única para Engine Supplier/Power) ---------- */
  const teamEngines = getArr(gs, ["teamEngines","dbTeamEngines","team_engines","db_team_engines"]);
  const teamEngineRow = useMemo(() => findByTeamAndYear(teamEngines, idStr, year), [teamEngines, idStr, year]);

  const engineSupplierName = useMemo(() =>
      teamEngineRow?.power_unit ?? teamEngineRow?.engine_name ?? teamEngineRow?.engine_supplier ?? "—",
    [teamEngineRow]
  );

  const enginePowerValue = useMemo(() => {
    // tenta várias colunas habituais
    const v = teamEngineRow?.power ?? teamEngineRow?.engine_power ?? teamEngineRow?.Power ?? teamEngineRow?.Ovrl;
    return v != null ? v : "—";
  }, [teamEngineRow]);

  /* ---------- Facilities (overview: chassis/aero/avg/academy) ---------- */
  // cobrimos nomes corretos e o teu “facilites” antigo
  const facilitiesAll = getArr(gs, ["facilities","dbFacilities"]);
  const facilitiesRow = useMemo(() => facilitiesAll.find(f => String(f.team_id) === idStr && Number(f.year) === Number(year)), [facilitiesAll, idStr, year]);

  const chassisQuality = facilitiesRow?._chassis_shop_level ?? "—";
  const aeroQuality    = facilitiesRow?.aero_dept_level ?? "—";
  const FACILITY_KEYS_RANGE = [
    "_chassis_shop_level",
    "aero_dept_level",
    "manufacturing_leve",
    "wind_tunnel_level",
    "simulator_level",
    "pitcrew_training_level"
  ];
  const facilitiesLevelAvg = useMemo(() => {
    if (!facilitiesRow) return null;
    const vals = FACILITY_KEYS_RANGE
      .map(k => Number(facilitiesRow[k]))
      .filter(n => Number.isFinite(n));
    return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0) / vals.length) : null;
  }, [facilitiesRow]);
  const academyLevel = facilitiesRow?.youth_program_level ?? "—";

  /* ---------- Team Principal (staff_contracts / staf_contracts) ---------- */
  const staffContractsAll = getArr(gs, ["staffContracts","dbStaffContracts","stafContracts","dbStafContracts","staff_contracts","db_staff_contracts"]);
  const principal = useMemo(() => {
    const rec = staffContractsAll.find(sc =>
      String(sc.team_id ?? sc.team ?? sc.id) === idStr &&
      (year == null || sc.year == null || Number(sc.year) === Number(year)) &&
      (String(sc.role ?? "").toLowerCase() === "team_principal" ||
       String(sc.role ?? "").toLowerCase().includes("team principal"))
    );
    return rec?.staff_name || rec?.name || rec?.person_name || null;
  }, [staffContractsAll, idStr, year]);

  /* ---------- Drivers atuais via contracts ---------- */
  const contractsAll = getArr(gs, ["contracts","dbContracts","driverContracts","dbDriverContracts"]);
  const driverContracts = useMemo(() => contractsAll.filter(c =>
    String(c.team_id ?? c.team ?? c.constructor) === idStr &&
    (year == null || c.year == null || Number(c.year) === Number(year)) &&
    isDriverContract(c)
  ), [contractsAll, idStr, year]);

  const driversAll = getArr(gs, ["drivers","dbDrivers"]);
  const drivers = useMemo(() => {
    const byId = new Map(driversAll.map((d) => [String(d.driver_id ?? d.id), d]));
    const order = { "Main Driver": 0, "Second Driver": 1, "Reserve Driver": 2, "Test Driver": 3, "Race Driver": 4 };
    return driverContracts
      .map((contract) => {
        const driverId = String(contract.driver_id ?? contract.person_id ?? contract.id ?? "");
        const driver = byId.get(driverId);
        if (!driver) return null;
        return {
          ...driver,
          __contract: contract,
          __role: contractRoleLabel(contract),
          __salary: contract.salary ?? contract.salary_yearly ?? null,
        };
      })
      .filter(Boolean)
      .sort((a,b) => (order[a.__role] ?? 9) - (order[b.__role] ?? 9));
  }, [driversAll, driverContracts]);

  /* ---------- Títulos (achievements) ---------- */
  const achAll = getArr(gs, ["achievements","dbAchievements"]);
  const achList = Array.isArray(achAll) ? achAll : (achAll?.list || []);
  const champs = useMemo(() => {
    let driversTitles = 0, constructors = 0;
    for (const a of achList) {
      if (String(a?.team_id ?? a?.team ?? a?.id) !== idStr) continue;
      if (Number(a?.driver_championship) > 0) driversTitles += 1;
      if (Number(a?.team_championship) > 0) constructors += 1;
    }
    return { driversTitles, constructors };
  }, [achList, idStr]);

  /* ---------- Carreiras para "History" ---------- */
  const careerAll = getArr(gs, ["driverCareer","dbDriverCareer","career","dbCareer"]);
  const historyRows = useMemo(() => {
    const rows = careerAll.filter(r => String(r?.team_id ?? r?.team ?? r?.constructor) === idStr);
    return rows.slice().sort((a,b) => (Number(a.year||0)-Number(b.year||0)) || String(a.driver_name||"").localeCompare(String(b.driver_name||"")));
  }, [careerAll, idStr]);

  if (!team && !brand) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Team not found</h3>
          {!pageMode && <button onClick={onClose} className="p-2 rounded hover:bg-gray-100"><X size={18}/></button>}
        </div>
        <p className="text-sm text-gray-500">ID: {entity.id}</p>
      </div>
    );
  }

  /* ---------- Header meta ---------- */
  const name         = team?.team_name || team?.name || brand?.official_name || "Team";
  const country      = team?.country || brand?.country || "";
  const countryCode  = team?.country_code || brand?.country_code || "";
  const flag         = flagFromCountry(country, countryCode);
  const founded      = team?.founded_year || brand?.founded_year || "—";
  const colorHex     = brand?.color_primary || team?.color_primary || null;
  const teamBase     = team?.team_base || team?.base || brand?.base || "";
  const budget = (() => {
    if (team?.budget != null) return team.budget;
    const sb = brand?.starting_budget ?? brand?.startingBudget;
    return sb != null ? sb : null;
  })();

  /* ---------- UI ---------- */
  const DriverCard = ({ d }) => (
    <button
      type="button"
      className="flex items-center gap-3 rounded-xl border bg-white hover:shadow px-3 py-2 text-left"
      data-entity="driver"
      data-id={d.driver_id ?? d.id}
    >
      {d.portrait_path ? (
        <img
          src={d.portrait_path}
          alt={d.display_name || d.name}
          className="h-12 w-12 rounded object-cover"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      ) : (
        <div className="h-12 w-12 rounded bg-gray-100 flex items-center justify-center text-sm font-semibold">
          {(d.display_name || d.name || "?").slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        {d.prefered_number != null && <div className="text-xs text-gray-500 leading-tight">#{d.prefered_number}</div>}
        <div className="text-sm font-semibold leading-tight truncate">{d.display_name || d.name}</div>
        <div className="text-xs text-gray-500 mt-1">{d.__role || "Driver"}</div>
      </div>
    </button>
  );

  return (
    <div className={`flex flex-col ${pageMode ? "min-h-[calc(100vh-5rem)] rounded-2xl border bg-white shadow-xl" : "h-[92vh]"}`}>
      {/* HEADER */}
      <div className="px-5 py-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* logo com fallback chain */}
          {logoCandidates.length > 0 && (
            <img
              src={logoCandidates[0]}
              alt={name}
              className="h-10 w-10 object-contain rounded bg-white"
              onError={(e) => {
                const img = e.currentTarget;
                const next = (img.dataset.next ? JSON.parse(img.dataset.next) : logoCandidates).slice(1);
                if (next.length) {
                  img.src = next[0];
                  img.dataset.next = JSON.stringify(next);
                } else {
                  img.style.display = "none";
                }
              }}
              data-next={JSON.stringify(logoCandidates)}
            />
          )}
          <div>
            <div className="text-2xl font-extrabold leading-tight">{name}</div>
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <span className="inline-flex items-center gap-1">
                <span className="text-base">{flag}</span>
                {country || "—"}
              </span>
              <span>•</span>
              <span>Founded {founded}</span>
              {teamBase && (
                <>
                  <span>•</span>
                  <span>{teamBase}</span>
                </>
              )}
              {colorHex && (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-2">
                    color
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-3 w-3 rounded border" style={{ background: colorHex }} />
                      <code className="text-xs text-gray-700">
                        {(String(colorHex).startsWith("#") ? colorHex : `#${colorHex}`).toUpperCase()}
                      </code>
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        {!pageMode && (
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100" aria-label="Close">
            <X size={18} />
          </button>
        )}
      </div>

      {/* TABS */}
      <div className="flex border-b bg-gray-50">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === t.key ? "bg-white border-x border-t rounded-t -mb-px" : "text-gray-600 hover:text-black"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* CONTENT */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Info label="Budget"              value={fmtMoney(budget)} />
                <Info label="Chassis Quality"     value={chassisQuality} />
                <Info label="Engine Supplier"     value={engineSupplierName} />
                <Info label="Engine Power"        value={enginePowerValue} />
                <Info label="Aerodynamic Quality" value={aeroQuality} />
                <Info label="Facilities Level"    value={facilitiesLevelAvg ?? "—"} />
                <Info label="Academy Level"       value={academyLevel ?? "—"} />
                <Info label="Team Principal"      value={principal ?? "—"} />
              </div>

              {/* Drivers */}
              <div>
                <div className="text-base font-semibold mb-2">Drivers</div>
                {drivers.length ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {drivers.map((d) => <DriverCard key={d.driver_id ?? d.id} d={d} />)}
                  </div>
                ) : (
                  <div className="text-sm text-gray-600">No drivers linked.</div>
                )}
              </div>
            </div>

            {/* Championships */}
            <div>
              <div className="text-base font-semibold mb-2">Championships</div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border p-4 bg-white">
                  <div className="text-sm text-gray-500">Drivers’ Titles</div>
                  <div className="text-3xl font-extrabold">{champs.driversTitles}</div>
                </div>
                <div className="rounded-xl border p-4 bg-white">
                  <div className="text-sm text-gray-500">Constructors’ Titles</div>
                  <div className="text-3xl font-extrabold">{champs.constructors}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STAFF */}
        {activeTab === "staff" && (
          <div className="overflow-x-auto">
            {staffContractsAll.filter(sc =>
              String(sc.team_id ?? sc.team ?? sc.id) === idStr &&
              (year == null || sc.year == null || Number(sc.year) === Number(year))
            ).length ? (
              <table className="min-w-full text-sm">
                <thead className="text-gray-500 text-xs">
                  <tr>
                    <th className="text-left pr-3 py-1">Name</th>
                    <th className="text-left pr-3 py-1">Role</th>
                    <th className="text-right pr-3 py-1">Salary</th>
                    <th className="text-left pr-3 py-1">From</th>
                    <th className="text-left pr-0 py-1">Until</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {staffContractsAll
                    .filter(sc =>
                      String(sc.team_id ?? sc.team ?? sc.id) === idStr &&
                      (year == null || sc.year == null || Number(sc.year) === Number(year))
                    )
                    .map((sc, i) => (
                      <tr key={i}>
                        <td className="pr-3 py-1">{sc.staff_name || sc.name || sc.person_name || "—"}</td>
                        <td className="pr-3 py-1">{sc.role || "—"}</td>
                        <td className="text-right pr-3 py-1">{fmtMoney(sc.salary)}</td>
                        <td className="pr-3 py-1">{sc.start_date || sc.start_year || "—"}</td>
                        <td className="pr-0 py-1">{sc.end_date || sc.contract_until || sc.end_year || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-gray-600">No staff contracts for this year.</p>
            )}
          </div>
        )}

        {/* CAR */}
        {activeTab === "car" && (
          <div className="grid gap-3">
            <div className="text-sm"><span className="text-gray-500">Power Unit:</span> <span className="font-medium">{engineSupplierName}</span></div>
            <div className="text-sm"><span className="text-gray-500">Engine Power:</span> <span className="font-medium">{enginePowerValue}</span></div>
            <div className="text-sm"><span className="text-gray-500">Primary Color:</span>{" "}
              <span className="inline-block h-3 w-3 rounded border align-middle mr-1" style={{ background: colorHex || "#999" }} />
              <code className="text-xs">{colorHex || "—"}</code>
            </div>
          </div>
        )}

        {/* HQ */}
        {activeTab === "hq" && (
          <div className="grid gap-3">
            <div className="text-sm"><span className="text-gray-500">Base:</span> <span className="font-medium">{teamBase || "—"}</span></div>
            <div className="text-sm"><span className="text-gray-500">Facilities Avg:</span> <span className="font-medium">{facilitiesLevelAvg ?? "—"}</span></div>
            <div className="text-sm"><span className="text-gray-500">Academy Level:</span> <span className="font-medium">{academyLevel ?? "—"}</span></div>
          </div>
        )}

        {/* HISTORY */}
        {activeTab === "history" && (
          <div className="overflow-x-auto">
            {historyRows.length ? (
              <table className="min-w-full text-sm">
                <thead className="text-gray-500 text-xs">
                  <tr>
                    <th className="text-left pr-3 py-1">Year</th>
                    <th className="text-left pr-3 py-1">Driver</th>
                    <th className="text-left pr-3 py-1">Series</th>
                    <th className="text-right pr-3 py-1">Starts</th>
                    <th className="text-right pr-3 py-1">Wins</th>
                    <th className="text-right pr-3 py-1">Podiums</th>
                    <th className="text-right pr-3 py-1">Poles</th>
                    <th className="text-right pr-3 py-1">FLaps</th>
                    <th className="text-right pr-3 py-1">Points</th>
                    <th className="text-right pr-0 py-1">Pos</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {historyRows.map((r, i) => (
                    <tr key={`${r.year}-${i}`}>
                      <td className="pr-3 py-1">{r.year ?? "—"}</td>
                      <td className="pr-3 py-1">{r.driver_name || "—"}</td>
                      <td className="pr-3 py-1">{r.series_division ?? r.series ?? "—"}</td>
                      <td className="text-right pr-3 py-1">{r.starts ?? r.races ?? 0}</td>
                      <td className="text-right pr-3 py-1">{r.wins ?? 0}</td>
                      <td className="text-right pr-3 py-1">{r.podiums ?? 0}</td>
                      <td className="text-right pr-3 py-1">{r.poles ?? 0}</td>
                      <td className="text-right pr-3 py-1">{r.fastest_laps ?? 0}</td>
                      <td className="text-right pr-3 py-1">{r.points ?? 0}</td>
                      <td className="text-right pr-0 py-1">
                        {r.champ_pos != null ? (isFinite(Number(r.champ_pos)) ? `P${r.champ_pos}` : String(r.champ_pos)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-gray-600">No history available.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
