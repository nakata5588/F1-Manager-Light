// src/pages/Team.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

/* ---------------- helpers ---------------- */
const tryPaths = async (paths) => {
  for (const p of paths) {
    try {
      const r = await fetch(p);
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
};
const firstNonEmpty = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? undefined;
const safe = (x, d = "") => (x == null ? d : x);
const normId = (s) =>
  (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w\-]+/g, "");

function seasonYearFrom(gameState) {
  return gameState?.seasonYear ?? gameState?.calendar?.[0]?.year ?? new Date().getFullYear();
}

/** Encontra entrada de branding em objetos OU arrays */
function findBrandEntry(brands, teamId, teamName) {
  const key1 = teamId;
  const key2 = normId(teamName);
  if (!brands) return null;

  // Caso 1: objeto indexado
  if (!Array.isArray(brands)) {
    return brands[key1] || brands[key2] || null;
  }

  // Caso 2: array de objetos
  const byId = brands.find(
    (b) =>
      normId(b.team_id ?? b.id ?? b.key ?? b.name) === normId(key1) ||
      normId(b.team_id ?? b.id ?? b.key ?? b.name) === key2
  );
  return byId || null;
}

/** Resolve engine_name a partir do dataset engines (objeto ou array) e do ano */
function resolveEngineName(enginesData, teamId, teamName, seasonYear) {
  if (!enginesData) return null;

  const pickFromEntry = (entry) => {
    if (!entry) return null;

    // formatos comuns:
    // 1) string direta ("Ford Cosworth DFV")
    if (typeof entry === "string") return entry;

    // 2) { engine_name, engine_id }
    if (entry.engine_name) return entry.engine_name;

    // 3) { engine: "Renault" }  (fallback antigo)
    if (entry.engine) return entry.engine;

    // 4) { by_year: { "1980": "Ford", "1981": { engine_name: "Renault" } } }
    if (entry.by_year) {
      const y = String(seasonYear);
      const val = entry.by_year[y] ?? entry.by_year[Number(y)];
      if (val) {
        if (typeof val === "string") return val;
        if (val.engine_name) return val.engine_name;
        if (val.engine) return val.engine;
      }
    }

    // 5) array de anos: [ {year, engine_name}, ... ] OU [ {year, engine}, ... ]
    if (Array.isArray(entry)) {
      const hit = entry.find((x) => String(x.year) === String(seasonYear));
      if (hit) {
        return hit.engine_name || hit.engine || null;
      }
    }

    return null;
  };

  // Caso A: objeto indexado por team_id
  if (!Array.isArray(enginesData)) {
    const entry = enginesData[teamId] || enginesData[normId(teamName)] || null;
    return pickFromEntry(entry);
  }

  // Caso B: array de registos
  // formatos: { team_id, year?, engine_name?, engine_id? } ou variantes
  const cand = enginesData
    .filter((e) => {
      const tKey = normId(e.team_id ?? e.team ?? e.teamId ?? e.id ?? e.name);
      return tKey === normId(teamId) || tKey === normId(teamName);
    })
    .sort((a, b) => {
      // preferir o que tiver ano exatamente igual
      const ay = String(a.year ?? a.season ?? "");
      const by = String(b.year ?? b.season ?? "");
      const target = String(seasonYear);
      const amatch = ay === target ? 0 : 1;
      const bmatch = by === target ? 0 : 1;
      return amatch - bmatch;
    });

  if (cand.length === 0) return null;

  // Primeiro matching por ano; se não houver, primeiro registo válido
  const exact = cand.find((e) => String(e.year ?? e.season ?? "") === String(seasonYear));
  const chosen = exact || cand[0];
  return chosen.engine_name || chosen.engine || null;
}

/* -------------- component --------------- */
export default function Team() {
  const { gameState } = useGame();

  const [brands, setBrands] = useState(null);
  const [contracts, setContracts] = useState(null);
  const [enginesData, setEnginesData] = useState(null);
  const [driversAll, setDriversAll] = useState(null);
  const [teamsJson, setTeamsJson] = useState(null);

  const seasonYear = seasonYearFrom(gameState);
  const team = gameState?.team || {};
  const teamId = team?.team_id ?? team?.id ?? normId(team?.team_name || team?.name);
  const teamName = firstNonEmpty(team?.team_name, team?.name, "Your Team");
  const idLower = String(teamId || "").toLowerCase();

  // caminho direto para o logo pelo team_id (ex.: /logos/teams/t_0004.png)
  const guessLogoById = `/logos/teams/${idLower}.png`;

  // fetch dos dados do /public
  useEffect(() => {
    (async () => {
      const [brandsJson, contractsJson, enginesJson, driversJson, teamsData] = await Promise.all([
        tryPaths(["/data/team_brands.json", "/data/brands.json", "/data/teams_branding.json"]),
        tryPaths(["/data/contracts.json", "/data/team_contracts.json", "/data/contracts_drivers.json"]),
        tryPaths(["/data/team_engines.json", "/data/engines_by_team.json", "/data/team_power_units.json"]),
        tryPaths(["/data/drivers.json", "/data/all_drivers.json"]),
        tryPaths(["/data/teams.json"]),
      ]);
      setBrands(brandsJson);
      setContracts(contractsJson);
      setEnginesData(enginesJson);
      setDriversAll(driversJson);
      setTeamsJson(teamsData);
    })();
  }, [idLower]);

  /* --------- Colors from team_brands --------- */
  const brandEntry = useMemo(() => findBrandEntry(brands, teamId, teamName), [brands, teamId, teamName]);

  // suportar várias chaves possíveis vindas do ficheiro
  const primaryColor = firstNonEmpty(
    brandEntry?.primary,
    brandEntry?.primary_color,
    brandEntry?.color_primary,
    brandEntry?.hex_primary,
    team.primary_color,
    team.color_primary,
    "#111827"
  );
  const secondaryColor = firstNonEmpty(
    brandEntry?.secondary,
    brandEntry?.secondary_color,
    brandEntry?.color_secondary,
    brandEntry?.hex_secondary,
    team.secondary_color,
    team.color_secondary,
    "#e5e7eb"
  );

  /* --------- Power Unit (engine_name only) --------- */
  const powerUnit = useMemo(() => {
    // 1) tentar engines dataset (com engine_name/engine e variações por ano)
    const fromEngines = resolveEngineName(enginesData, teamId, teamName, seasonYear);
    if (fromEngines) return fromEngines;

    // 2) fallback: teams.json pode ter engine_name/engine/power_unit
    if (Array.isArray(teamsJson)) {
      const t = teamsJson.find((x) => normId(x.team_id ?? x.id ?? x.name) === normId(teamId));
      const v = firstNonEmpty(t?.engine_name, t?.engine, t?.power_unit, t?.engine_supplier);
      if (v) return v;
    }

    // 3) fallback: valores que venham no próprio state
    return firstNonEmpty(team.engine_name, team.power_unit, team.engine, team.engine_supplier, "");
  }, [enginesData, teamsJson, team, teamId, teamName, seasonYear]);

  /* --------- Drivers from contracts.json --------- */
  const teamDrivers = useMemo(() => {
    let base = Array.isArray(team?.drivers) ? team.drivers : [];

    if ((!base || base.length === 0) && Array.isArray(contracts)) {
      const withinSeason = (c) => {
        const sy = Number(c.start_year ?? c.start ?? c.year ?? seasonYear);
        const ey = Number(c.end_year ?? c.end ?? c.until ?? sy);
        const hasYearList = Array.isArray(c.years);
        const okYear = hasYearList
          ? c.years.map(String).includes(String(seasonYear))
          : (Number.isFinite(sy) ? seasonYear >= sy : true) &&
            (Number.isFinite(ey) ? seasonYear <= ey : true);

        const tId = c.team_id ?? c.team ?? c.teamId;
        return okYear && (normId(tId) === normId(teamId) || normId(tId) === normId(teamName));
      };

      base = contracts.filter(withinSeason).map((c, idx) => ({
        driver_id: c.driver_id ?? c.driver ?? c.id ?? `D_${idx + 1}`,
        slot: c.role === "reserve" ? 2 : idx,
      }));
    }

    const enrich = (dLite, idx) => {
      const did = typeof dLite === "string" ? dLite : dLite?.driver_id ?? dLite?.id;
      const slot = typeof dLite === "object" ? dLite?.slot ?? idx : idx;

      const fromState =
        (Array.isArray(gameState?.drivers) &&
          gameState.drivers.find((x) => normId(x.driver_id ?? x.id) === normId(did))) ||
        null;

      const fromAll =
        (Array.isArray(driversAll) &&
          driversAll.find((x) => normId(x.driver_id ?? x.id) === normId(did))) ||
        null;

      const src = fromState || fromAll || {};
      return {
        driver_id: did || src.driver_id || src.id || `D_${idx + 1}`,
        display_name: src.display_name ?? src.name ?? dLite?.display_name ?? dLite?.name ?? (did || "Driver"),
        prefered_number: firstNonEmpty(src.prefered_number, src.number, dLite?.prefered_number, dLite?.number, ""),
        country_name: firstNonEmpty(src.country_name, src.nationality, dLite?.country_name, ""),
        portrait_path: src.portrait_path ?? dLite?.portrait_path,
        slot,
      };
    };

    const list = (base || []).map(enrich);
    return list.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)).slice(0, 4);
  }, [team?.drivers, contracts, gameState?.drivers, driversAll, seasonYear, teamId, teamName]);

  /* --------- Header info --------- */
  const header = {
    name: safe(firstNonEmpty(team.team_name, team.name), "Your Team"),
    base: safe(firstNonEmpty(team.team_base, team.base), ""),
    engine: safe(powerUnit, ""),
    short: safe(team.short_name, ""),
    budget: safe(team.budget, gameState?.budget ?? null),
    primary: primaryColor,
    secondary: secondaryColor,
    logo: firstNonEmpty(team.logo_path, team.logo, `/logos/teams/${idLower}.png`) || null,
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
                  e.currentTarget.style.display = "none";
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
              {header.engine ? ` • PU: ${header.engine}` : ""}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ColorSwatch label="Primary" value={header.primary} />
          <ColorSwatch label="Secondary" value={header.secondary} />
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
            <div className="text-sm text-muted-foreground">Power Unit</div>
            <div className="text-lg font-medium">{header.engine || "—"}</div>
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
      </div>

      {/* Drivers lineup */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-medium">Drivers</h2>
            <Button variant="outline" disabled>
              Manage Line-up
            </Button>
          </div>

          {teamDrivers.length === 0 ? (
            <div className="text-sm text-muted-foreground">No drivers found for this team.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {teamDrivers.map((d, idx) => (
                <DriverCard key={d.driver_id || idx} d={d} teamColors={{ primary: header.primary }} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick links / placeholders */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <PlaceholderTile title="Staff" desc="Key roles and skills" />
        <PlaceholderTile title="HQ" desc="Facilities & upgrades" />
        <PlaceholderTile title="Development" desc="Car projects & parts" />
      </div>
    </div>
  );
}

/* ---------------- UI bits ---------------- */
function DriverCard({ d, teamColors }) {
  return (
    <div className="rounded-xl border p-3 flex items-center gap-3">
      <div className="h-16 w-16 rounded-lg overflow-hidden bg-muted/40 flex items-center justify-center ring-1 ring-black/5">
        {d.portrait_path ? (
          <img src={d.portrait_path} alt={d.display_name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-8 w-8 rounded" style={{ background: teamColors.primary }} />
        )}
      </div>
      <div className="flex-1">
        <div className="font-medium leading-tight">{d.display_name}</div>
        <div className="text-xs text-muted-foreground">
          {d.country_name ? d.country_name : ""}
          {d.prefered_number ? ` • #${d.prefered_number}` : ""}
        </div>
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

function PlaceholderTile({ title, desc }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground mb-1">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </CardContent>
    </Card>
  );
}

function formatMoney(n) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
      Number(n)
    );
  } catch {
    return `${n}`;
  }
}
