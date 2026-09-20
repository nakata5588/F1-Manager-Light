// src/pages/Team.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";
import { useModalStore } from "@/state/ModalStore";

/* ============== HELPERS ============== */
const fetchJSON = async (url) => {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return await r.json();
  } catch {
    return null;
  }
};
const firstNonEmpty = (...vals) =>
  vals.find((v) => v !== undefined && v !== null && v !== "") ?? undefined;
const safe = (x, d = "") => (x == null ? d : x);
const norm = (s) =>
  (s ?? "")
    .toString()
    .trim()
    .toLowerCase();
const normKey = (s) => norm(s).replace(/\s+/g, "_");
const seasonYearFrom = (gs) =>
  gs?.seasonYear ?? gs?.activeYear ?? gs?.calendar?.[0]?.year ?? new Date().getFullYear();

function val(obj, keys) {
  if (!obj) return undefined;
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined) return obj[k];
    const hit = Object.keys(obj).find((kk) => kk.toLowerCase() === k.toLowerCase());
    if (hit && obj[hit] !== undefined) return obj[hit];
  }
  return undefined;
}
function teamAliasesFromState(team) {
  const id = team?.team_id ?? team?.id ?? "";
  const code = team?.short_name ?? team?.code ?? "";
  const name = team?.team_name ?? team?.name ?? "";
  return Array.from(new Set([id, code, name].filter(Boolean).map((x) => normKey(x))));
}
function recordMatchesTeam(rec, teamAliases) {
  const cands = [
    val(rec, ["team_id", "Team_ID", "team", "teamId", "team_code", "code", "id", "name"]),
    val(rec, ["team_name", "Team_Name"]),
    val(rec, ["short", "short_name", "Short"]),
  ]
    .filter(Boolean)
    .map((x) => normKey(x));
  return cands.some((ck) => teamAliases.includes(ck));
}
function recordYear(rec) {
  return firstNonEmpty(val(rec, ["year", "Year", "season", "Season", "contract_year", "yr"]), null);
}
function slugify(s) {
  return norm(s).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function resolveTeamLogoPath(teamIdLower, year, explicitPath) {
  if (explicitPath) return explicitPath;
  return `/logos/teams/${teamIdLower}_${year}.png`;
}

/** normalizadores */
function normalizeDriverRole(role) {
  const r = norm(role);
  if (/(main|lead|first|driver1|race\s*driver|titular)/.test(r)) return "Main Driver";
  if (/(second|driver2|segundo)/.test(r)) return "Second Driver";
  if (/(reserve|reserva)/.test(r)) return "Reserve Driver";
  if (/(test|tester)/.test(r)) return "Test Driver";
  return "Driver";
}
function driverSlot(role) {
  const rr = normalizeDriverRole(role);
  if (rr === "Main Driver") return 0;
  if (rr === "Second Driver") return 1;
  if (rr === "Reserve Driver") return 2;
  if (rr === "Test Driver") return 3;
  return 9;
}
function normalizeStaffRole(role) {
  const r = norm(role).replaceAll("-", " ").replaceAll("_", " ").trim();
  if (/^(owner|propriet[aá]rio)/.test(r)) return "Owner";
  if (/(team principal|principal|tp|diretor de equipa|director de equipa)/.test(r)) return "Team Principal";
  if (/(technical director|diretor t[eé]cnico)/.test(r)) return "Technical Director";
  if (/(chief designer|designer chefe)/.test(r)) return "Chief Designer";
  if (/(head of aero|aero lead|chefe de aer[oó])/.test(r)) return "Head of Aero";
  if (/(chief engineer|chefe de engenheiros|chief_engineer)/.test(r)) return "Chief Engineer";
  if (/(sporting director|diretor desportivo)/.test(r)) return "Sporting Director";
  if (/(race engineer|engenheiro de pista)/.test(r)) return "Race Engineer";
  if (/(head mechanic|chefe de mec[aâ]nicos)/.test(r)) return "Head Mechanic";
  return role || "Staff";
}

/* ============== COMPONENT ============== */
export default function Team() {
  const { gameState } = useGame();
  const openEntity = useModalStore((s) => s.open);

  // callback estável para abrir o DriverModal (igual ao Home.jsx)
  const openDriver = useCallback(
    (driverId) => {
      if (!driverId) return;
      openEntity({ type: "driver", id: driverId, tab: "contract" });
    },
    [openEntity]
  );

  const [teamBrands, setTeamBrands] = useState(null);
  const [teamBrandColors, setTeamBrandColors] = useState(null);
  const [contracts, setContracts] = useState(null);
  const [staffContracts, setStaffContracts] = useState(null);
  const [rdProjects, setRdProjects] = useState(null);
  const [driversDb, setDriversDb] = useState(null);
  const [engines, setEngines] = useState(null);

  const seasonYear = seasonYearFrom(gameState);
  const team = gameState?.team || {};
  const teamAliases = teamAliasesFromState(team);
  const idLower = String(team?.team_id ?? team?.id ?? "").toLowerCase();

  useEffect(() => {
    (async () => {
      const [tb, tbc, cts, staffs, devs, drv, eng] = await Promise.all([
        fetchJSON("/data/team_brands.json"),
        fetchJSON("/data/team_brand.json"),
        fetchJSON("/data/contracts.json"),
        fetchJSON("/data/staff_contracts.json"),
        fetchJSON("/data/rd_projects.json"),
        (async () => (await fetchJSON("/data/drivers.json")) ?? (await fetchJSON("/data/all_drivers.json")))(),
        fetchJSON("/data/team_engines.json"),
      ]);
      setTeamBrands(tb);
      setTeamBrandColors(tbc);
      setContracts(cts);
      setStaffContracts(staffs);
      setRdProjects(devs);
      setDriversDb(drv);
      setEngines(eng);
    })();
  }, [idLower, seasonYear]);

  /* --------- COLORS --------- */
  const colorsRow = useMemo(() => {
    if (!teamBrandColors) return null;
    if (Array.isArray(teamBrandColors)) {
      const sameTeam = teamBrandColors.filter((r) => recordMatchesTeam(r, teamAliases));
      const exact = sameTeam.find((r) => String(recordYear(r)) === String(seasonYear));
      return exact || sameTeam[0] || null;
    } else {
      const keys = Object.keys(teamBrandColors);
      const keyHit = keys.find((k) => teamAliases.includes(normKey(k)));
      const node = keyHit ? teamBrandColors[keyHit] : null;
      if (!node) return null;
      if (Array.isArray(node)) {
        const exact = node.find((r) => String(recordYear(r)) === String(seasonYear));
        return exact || node[0] || null;
      }
      if (node.by_year?.[seasonYear]) return node.by_year[seasonYear];
      return node;
    }
  }, [teamBrandColors, teamAliases, seasonYear]);

  const primaryColor =
    firstNonEmpty(val(colorsRow, ["primary_color"]), val(colorsRow, ["primary"])) ||
    firstNonEmpty(
      val(
        (Array.isArray(teamBrands) ? teamBrands.find((r) => recordMatchesTeam(r, teamAliases) && String(recordYear(r)) === String(seasonYear)) : null) || {},
        ["primary_color", "primary"]
      )
    ) ||
    "#111827";
  const secondaryColor =
    firstNonEmpty(val(colorsRow, ["secondary_color"]), val(colorsRow, ["secondary"])) ||
    firstNonEmpty(
      val(
        (Array.isArray(teamBrands) ? teamBrands.find((r) => recordMatchesTeam(r, teamAliases) && String(recordYear(r)) === String(seasonYear)) : null) || {},
        ["secondary_color", "secondary"]
      )
    ) ||
    "#e5e7eb";
  const accentColor =
    firstNonEmpty(val(colorsRow, ["accent_color"]), val(colorsRow, ["accent"])) ||
    firstNonEmpty(
      val(
        (Array.isArray(teamBrands) ? teamBrands.find((r) => recordMatchesTeam(r, teamAliases) && String(recordYear(r)) === String(seasonYear)) : null) || {},
        ["accent_color", "accent"]
      )
    ) ||
    "#9ca3af";

  /* --------- Budget & HQ (team_brands.json) --------- */
  const brandRow = useMemo(() => {
    if (!teamBrands) return null;
    if (Array.isArray(teamBrands)) {
      const sameTeam = teamBrands.filter((r) => recordMatchesTeam(r, teamAliases));
      const exact = sameTeam.find((r) => String(recordYear(r)) === String(seasonYear));
      return exact || sameTeam[0] || null;
    } else {
      const keys = Object.keys(teamBrands);
      const keyHit = keys.find((k) => teamAliases.includes(normKey(k)));
      const node = keyHit ? teamBrands[keyHit] : null;
      if (!node) return null;
      if (Array.isArray(node)) {
        const exact = node.find((r) => String(recordYear(r)) === String(seasonYear));
        return exact || node[0] || null;
      }
      if (node.by_year?.[seasonYear]) return node.by_year[seasonYear];
      return node;
    }
  }, [teamBrands, teamAliases, seasonYear]);

  const resolvedBudget = useMemo(() => {
    const sb = val(brandRow, ["starting_budget", "Starting_Budget", "budget_start", "startingBudget"]);
    return sb != null ? Number(sb) : null;
  }, [brandRow]);

  const hqSummary = useMemo(() => {
    if (!brandRow) return null;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    return {
      manufacturing: num(val(brandRow, ["manufacturing_level", "manufacturing_leve", "factory_level", "manufacturing"])),
      wind_tunnel: num(val(brandRow, ["wind_tunnel_level", "wind_tunnel"])),
      simulator: num(val(brandRow, ["simulator_level", "simulator"])),
      aero_dept: num(val(brandRow, ["aero_dept_level", "aero_department_level", "aero_level"])),
      chassis_shop: num(val(brandRow, ["chassis_shop_level", "_chassis_shop_level", "chassis_level"])),
      pitcrew_training: num(val(brandRow, ["pitcrew_training_level", "pit_crew_training_level", "pitcrew"])),
      youth_program: num(val(brandRow, ["youth_program_level", "academy_level", "youth_program"])),
      maintenance_cost: num(val(brandRow, ["maintenance_cost", "maintenanceCost"])),
    };
  }, [brandRow]);

  /* --------- Power Unit (team_engines.json) --------- */
  const powerUnit = useMemo(() => {
    if (!engines) return "";
    const pickFromEntry = (entry) => {
      if (!entry) return "";
      const dir = firstNonEmpty(val(entry, ["engine_name"]), val(entry, ["engine"]), val(entry, ["power_unit"]));
      if (dir) return dir;
      const by = val(entry, ["by_year", "byYear", "years"]);
      if (by) {
        const y = by[String(seasonYear)] ?? by[Number(seasonYear)];
        if (y) return firstNonEmpty(val(y, ["engine_name"]), val(y, ["engine"]), val(y, ["power_unit"])) || "";
      }
      if (Array.isArray(entry)) {
        const hit = entry.find((x) => String(recordYear(x)) === String(seasonYear));
        if (hit) return firstNonEmpty(val(hit, ["engine_name"]), val(hit, ["engine"]), val(hit, ["power_unit"])) || "";
      }
      return "";
    };

    if (Array.isArray(engines)) {
      const forTeam = engines.filter((e) => recordMatchesTeam(e, teamAliases));
      const exact = forTeam.find((e) => String(recordYear(e)) === String(seasonYear));
      return pickFromEntry(exact || forTeam[0]);
    } else {
      const keys = Object.keys(engines);
      const keyHit = keys.find((k) => teamAliases.includes(normKey(k)));
      const node = keyHit ? engines[keyHit] : null;
      if (!node) return "";
      if (Array.isArray(node)) {
        const exact = node.find((e) => String(recordYear(e)) === String(seasonYear));
        return pickFromEntry(exact || node[0]);
      }
      return pickFromEntry(node);
    }
  }, [engines, teamAliases, seasonYear]);

  /* --------- Drivers + enrich com drivers.json --------- */
  const driversIndex = useMemo(() => {
    const idx = { byId: new Map(), byName: new Map() };
    if (!driversDb) return idx;
    const push = (rec) => {
      const did = val(rec, ["driver_id", "id"]);
      const dname = val(rec, ["display_name", "name", "driver_name"]);
      if (did) idx.byId.set(normKey(did), rec);
      if (dname) idx.byName.set(normKey(dname), rec);
    };
    if (Array.isArray(driversDb)) driversDb.forEach(push);
    else Object.values(driversDb || {}).forEach((rec) => (Array.isArray(rec) ? rec.forEach(push) : push(rec)));
    return idx;
  }, [driversDb]);

  const teamDrivers = useMemo(() => {
    if (!Array.isArray(contracts)) return [];
    const rows = contracts.filter(
      (r) => recordMatchesTeam(r, teamAliases) && String(recordYear(r)) === String(seasonYear)
    );

    return rows
      .map((r, i) => {
        const name = firstNonEmpty(val(r, ["driver_name", "name", "driver"]), `Driver ${i + 1}`);
        const driverId = val(r, ["driver_id", "id"]);
        const normIdKey = driverId ? normKey(driverId) : null;
        const normNameKey = normKey(name);

        const fromDb =
          (normIdKey && driversIndex.byId.get(normIdKey)) ||
          driversIndex.byName.get(normNameKey) ||
          null;

        const portrait = val(fromDb, ["portrait_path", "portrait", "photo"]);
        const profileUrl = firstNonEmpty(val(fromDb, ["url", "profile_url", "link"]), `/drivers/${slugify(name)}`);

        return {
          driverId: driverId ?? val(fromDb, ["driver_id", "id"]) ?? normNameKey,
          name,
          role: normalizeDriverRole(val(r, ["role", "Role"])),
          portrait_path: portrait,
          profileUrl,
        };
      })
      .sort((a, b) => driverSlot(a.role) - driverSlot(b.role));
  }, [contracts, teamAliases, seasonYear, driversIndex]);

  /* --------- Staff --------- */
  const keyStaff = useMemo(() => {
    if (!Array.isArray(staffContracts)) return [];
    const rows = staffContracts.filter(
      (r) => recordMatchesTeam(r, teamAliases) && String(recordYear(r)) === String(seasonYear)
    );

    return rows.map((r, i) => ({
      staff_name: firstNonEmpty(val(r, ["staff_name", "name", "staff"]), `Staff ${i + 1}`),
      role: normalizeStaffRole(val(r, ["role", "Role"])),
    }));
  }, [staffContracts, teamAliases, seasonYear]);

  /* --------- Development --------- */
  const devProjects = useMemo(() => {
    if (!Array.isArray(rdProjects)) return [];
    const rows = rdProjects.filter(
      (r) => recordMatchesTeam(r, teamAliases) && String(recordYear(r)) === String(seasonYear)
    );

    return rows.map((r) => ({
      title: firstNonEmpty(val(r, ["title", "part", "component", "project_name"]), "Project"),
      status: firstNonEmpty(val(r, ["status", "state"]), "Active"),
    }));
  }, [rdProjects, teamAliases, seasonYear]);

  /* --------- Header --------- */
  const header = {
    name: safe(firstNonEmpty(team.team_name, team.name), "Your Team"),
    base: safe(firstNonEmpty(team.team_base, team.base), ""),
    short: safe(team.short_name, ""),
    budget: resolvedBudget,
    primary: primaryColor,
    secondary: secondaryColor,
    accent: accentColor,
    powerUnit: powerUnit,
    logo: resolveTeamLogoPath(String(team?.team_id ?? team?.id ?? "").toLowerCase(), seasonYear, firstNonEmpty(team.logo_path, team.logo)),
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="h-14 w-14 rounded-xl ring-1 ring-black/5 flex items-center justify-center overflow-hidden"
            style={{ background: header.secondary }}
          >
            {header.logo ? (
              <img
                src={header.logo}
                alt={header.name}
                className="h-full w-full object-contain"
                onError={(e) => {
                  if (e.currentTarget.dataset.fallback !== "1") {
                    e.currentTarget.dataset.fallback = "1";
                    e.currentTarget.src = `/logos/teams/${String(team?.team_id ?? team?.id ?? "").toLowerCase()}.png`;
                  } else {
                    e.currentTarget.style.display = "none";
                  }
                }}
              />
            ) : (
              <div className="h-8 w-8 rounded" style={{ background: header.primary }} />
            )}
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold">{header.name}</h1>
            <div className="text-sm text-muted-foreground">
              {header.short ? `${header.short} • ` : ""}
              {header.base ? `${header.base}` : ""}
              {seasonYear ? ` • ${seasonYear}` : ""}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ColorSwatch label="Primary" value={header.primary} />
          <ColorSwatch label="Secondary" value={header.secondary} />
          <ColorSwatch label="Accent" value={header.accent} />
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Base</div>
            <div className="text-lg font-medium">{header.base || "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Budget</div>
            <div className="text-lg font-semibold">
              {header.budget != null ? formatMoney(header.budget) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Power Unit</div>
            <div className="text-lg font-medium">{header.powerUnit || "—"}</div>
          </CardContent>
        </Card>
      </div>

      {/* Drivers */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-medium">Drivers</h2>
            <Button variant="outline" disabled>
              Manage Line-up
            </Button>
          </div>

          {teamDrivers.length === 0 ? (
            <div className="text-sm text-muted-foreground">No drivers found for {seasonYear}.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {teamDrivers.map((d, idx) => (
                <DriverCard key={idx} d={d} color={header.primary} onOpen={openDriver} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Staff / HQ / Development */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Staff */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Staff</div>
              <Button variant="outline" size="sm" disabled>
                Manage
              </Button>
            </div>
            {keyStaff.length === 0 ? (
              <div className="text-xs text-muted-foreground">No staff found for {seasonYear}.</div>
            ) : (
              <ul className="text-sm space-y-1">
                {keyStaff.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.staff_name}</span>
                    <span className="text-muted-foreground"> — {s.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* HQ */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">HQ</div>
              <Button variant="outline" size="sm" disabled>
                Upgrade
              </Button>
            </div>
            {hqSummary ? (
              <div className="text-sm grid grid-cols-2 gap-y-1">
                <div className="text-muted-foreground">Manufacturing</div>
                <div className="font-medium">{levelOrDash(hqSummary.manufacturing)}</div>
                <div className="text-muted-foreground">Wind Tunnel</div>
                <div className="font-medium">{levelOrDash(hqSummary.wind_tunnel)}</div>
                <div className="text-muted-foreground">Simulator</div>
                <div className="font-medium">{levelOrDash(hqSummary.simulator)}</div>
                <div className="text-muted-foreground">Aero Dept</div>
                <div className="font-medium">{levelOrDash(hqSummary.aero_dept)}</div>
                <div className="text-muted-foreground">Chassis Shop</div>
                <div className="font-medium">{levelOrDash(hqSummary.chassis_shop)}</div>
                <div className="text-muted-foreground">Pitcrew Training</div>
                <div className="font-medium">{levelOrDash(hqSummary.pitcrew_training)}</div>
                <div className="text-muted-foreground">Youth Program</div>
                <div className="font-medium">{levelOrDash(hqSummary.youth_program)}</div>
                <div className="text-muted-foreground">Maintenance Cost</div>
                <div className="font-medium">{moneyOrDash(hqSummary.maintenance_cost)}</div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No HQ data for {seasonYear}.</div>
            )}
          </CardContent>
        </Card>

        {/* Development */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Development</div>
              <Button variant="outline" size="sm" disabled>
                Projects
              </Button>
            </div>
            {devProjects.length === 0 ? (
              <div className="text-xs text-muted-foreground">No projects for {seasonYear}.</div>
            ) : (
              <ul className="text-sm space-y-1">
                {devProjects.map((p, i) => (
                  <li key={i}>
                    <span className="font-medium">{p.title}</span>
                    <span className="text-muted-foreground"> — {p.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ============== UI bits ============== */
function DriverCard({ d, color, onOpen }) {
  const onClick = (e) => {
    e.preventDefault();
    if (onOpen) onOpen(d.driverId);
  };

  return (
    <div className="rounded-xl border p-3 flex items-center gap-3">
      <div className="h-12 w-12 rounded-md overflow-hidden ring-1 ring-black/5 bg-muted/40 flex items-center justify-center">
        {d.portrait_path ? (
          <img src={d.portrait_path} alt={d.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-6 w-6 rounded" style={{ background: color }} />
        )}
      </div>
      <div className="flex-1">
        <a href={d.profileUrl} onClick={onClick} className="font-medium leading-tight hover:underline">
          {d.name}
        </a>
        <div className="text-xs text-muted-foreground">{d.role}</div>
      </div>
    </div>
  );
}

function ColorSwatch({ label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="h-5 w-5 rounded-md ring-1 ring-black/10" style={{ background: value }} />
    </div>
  );
}
function levelOrDash(n) {
  return n == null ? "—" : String(n);
}
function moneyOrDash(n) {
  if (n == null) return "—";
  return formatMoney(n);
}
function formatMoney(n) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
      Number(n)
    );
  } catch {
    return `${n}`;
  }
}
