import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Slider from "@/components/ui/slider";
import { useGame } from "@/state/GameStore";

/** Helpers locais */
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const pickRandom = (arr, n) => {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
};
const difficulties = [
  { key: "easy", label: "Easy", budgetMul: 1.25 },
  { key: "normal", label: "Normal", budgetMul: 1.0 },
  { key: "hard", label: "Hard", budgetMul: 0.85 },
];

// Nome de piloto robusto p/ schemas diferentes (inclui driver_name do Excel)
function driverLabel(d = {}) {
  const first =
    d.first_name ?? d.firstname ?? d.given_name ?? d.forename ?? d.first ?? "";
  const last =
    d.last_name ?? d.lastname ?? d.family_name ?? d.surname ?? d.last ?? "";
  const combo = `${first} ${last}`.trim();
  return (
    d.driver_name || // Excel
    d.name ||
    d.display_name ||
    d.full_name ||
    d.fullname ||
    (combo.length ? combo : d.code) ||
    "Unknown"
  );
}

// Nome de equipa robusto
function teamLabel(t = {}) {
  return t.name || t.team_name || t.official_name || t.short_name || "Team";
}

export default function CreateTeam() {
  const navigate = useNavigate();
  const { gameState, applyYearFilter, startNewGameFromCreateTeam } = useGame();

  // === Years dinâmicos a partir do calendário carregado ===
  const years = useMemo(() => {
    const cal = gameState?.dbCalendar || [];
    const set = new Set(
      cal
        .map((gp) => {
          const s = String(gp.date || gp.race_date || "");
          return s && s.length >= 4 ? Number(s.slice(0, 4)) : NaN;
        })
        .filter((y) => Number.isFinite(y))
    );
    if (!set.size && Number.isFinite(gameState?.activeYear)) set.add(Number(gameState.activeYear));
    return Array.from(set).sort((a, b) => a - b).map(String);
  }, [gameState?.dbCalendar, gameState?.activeYear]);

  const [year, setYear] = useState(years[0] ?? "1980");
  useEffect(() => {
    if (year) applyYearFilter(Number(year));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  // === Dados filtrados por ano vindos do GameStore ===
  const teams = gameState?.teams || [];
  const drivers = gameState?.drivers || [];
  const contracts = gameState?.contracts || [];
  const teamEngines = gameState?.teamEngines || []; // vem de /data/team_engines.json

  // Derivar “engines” a partir de teamEngines (nome/id/fee se existir)
  const engines = useMemo(() => {
    const list = teamEngines
      .map((e, i) => ({
        id: e.engine_id || e.id || `eng_${i}`,
        name: e.engine_name || e.name || e.supplier || "Engine",
        supplier_fee: Number(e.supplier_fee ?? 1500000),
      }))
      .reduce((acc, it) => {
        if (!acc.find((x) => x.id === it.id)) acc.push(it);
        return acc;
      }, []);
    return list.length ? list : [{ id: "generic", name: "Generic Engine", supplier_fee: 1500000 }];
  }, [teamEngines]);

  // === Wizard state ===
  const [step, setStep] = useState(1);
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.team_id || "");
  const selectedTeam = useMemo(() => teams.find((t) => String(t.team_id) === String(selectedTeamId)), [teams, selectedTeamId]);

  const [teamName, setTeamName] = useState("");
  const [shortName, setShortName] = useState("");
  const [primary, setPrimary] = useState("#c81e1e");
  const [secondary, setSecondary] = useState("#111827");

  // Upload de logo
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [logoFileName, setLogoFileName] = useState("");

  const [engineId, setEngineId] = useState(engines[0]?.id || "");
  const [driver1, setDriver1] = useState("");
  const [driver2, setDriver2] = useState("");

  const [difficulty, setDifficulty] = useState("normal");
  const [startingBudget, setStartingBudget] = useState(5_000_000);

  // NOVO: mostrar só livres por defeito
  const [includeSigned, setIncludeSigned] = useState(false);

  useEffect(() => {
    if (selectedTeam) {
      setTeamName((prev) => prev || selectedTeam.name || selectedTeam.team_name || "");
      setShortName((prev) => prev || selectedTeam.short_name || selectedTeam.team_name || "");
      if (selectedTeam.colors?.primary) setPrimary(selectedTeam.colors.primary);
      if (selectedTeam.colors?.secondary) setSecondary(selectedTeam.colors.secondary);
    }
  }, [selectedTeam]);

  useEffect(() => {
    if (!engineId && engines[0]) setEngineId(engines[0].id);
  }, [engines, engineId]);

  const canContinueTeam = selectedTeamId && teamName && shortName;
  const canContinueDrivers = driver1 && driver2 && driver1 !== driver2;

  // Conjunto de drivers com contrato neste ano (schema-agnóstico)
  const contractedDriverIds = useMemo(() => {
    const ids = new Set();
    (contracts || []).forEach((c) => {
      const id =
        c.driver_id ?? c.person_id ?? c.driver ?? c.id ?? null;
      if (id) ids.add(String(id));
    });
    return ids;
  }, [contracts]);

  // Listas derivadas
  const freeDrivers = useMemo(() => {
    return (drivers || [])
      .filter((d) => d.status === "eligible")
      .filter((d) => !contractedDriverIds.has(String(d.driver_id)))
      .sort((a, b) => driverLabel(a).localeCompare(driverLabel(b)));
  }, [drivers, contractedDriverIds]);

  const allDriversWithFlag = useMemo(() => {
    return (drivers || [])
      .filter((d) => d.status !== "hidden")
      .map((d) => ({
        ...d,
        _signed: contractedDriverIds.has(String(d.driver_id)),
      }))
      .sort((a, b) => driverLabel(a).localeCompare(driverLabel(b)));
  }, [drivers, contractedDriverIds]);

  const selectableDrivers = includeSigned ? allDriversWithFlag : freeDrivers;

  const onRandomizeDrivers = () => {
    const pool = freeDrivers; // random só com LIVRES
    const picks = pickRandom(pool, 2);
    setDriver1(picks[0]?.driver_id || "");
    setDriver2(picks[1]?.driver_id || "");
  };

  const diffCfg = difficulties.find((d) => d.key === difficulty) || difficulties[1];
  const computedBudget = Math.round(startingBudget * diffCfg.budgetMul);

  // handler upload logo
  const onLogoChange = (file) => {
    if (!file) return;
    setLogoFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setLogoDataUrl(String(reader.result || ""));
    };
    reader.readAsDataURL(file);
  };

  const onFinish = () => {
    const payload = {
      year: Number(year),
      team: {
        templateFrom: selectedTeamId,
        team_id: `USR_${Date.now()}`,
        name: teamName,
        short_name: shortName,
        colors: { primary, secondary },
        engine_id: engineId,
        starting_budget: computedBudget,
        logo_data_url: logoDataUrl || null,
        logo_file_name: logoFileName || null,
      },
      drivers: [driver1, driver2],
      difficulty,
    };
    const ok = startNewGameFromCreateTeam(payload);
    if (ok) navigate("/Home");
  };

  return (
    <div className="min-h-screen bg-gray-700 text-white">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <h1 className="text-3xl font-bold">Create Your Team</h1>

        {/* Stepper */}
        <div className="flex items-center gap-2 text-sm">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`px-3 py-1 rounded-full ${
                step === s ? "bg-white text-black" : "bg-gray-600 text-white"
              }`}
            >
              Step {s}
            </div>
          ))}
        </div>

        {step === 1 && (
          <Card className="bg-gray-600 border-0">
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="text-sm">Season</label>
                  <select
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="w-full h-10 rounded-md bg-gray-700 border border-gray-500 px-3"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm">Start from existing team</label>
                  <select
                    value={selectedTeamId}
                    onChange={(e) => setSelectedTeamId(e.target.value)}
                    className="w-full h-10 rounded-md bg-gray-700 border border-gray-500 px-3"
                  >
                    <option value="" disabled>Pick a team</option>
                    {teams.map((t) => (
                      <option key={String(t.team_id)} value={String(t.team_id)}>
                        {teamLabel(t)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="text-right">
                  <Button disabled={!selectedTeamId} onClick={() => setStep(2)}>Continue</Button>
                </div>
              </div>

              {selectedTeam && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-gray-700">
                    <div className="text-xs opacity-70 mb-1">Template</div>
                    <div className="text-lg font-semibold">{teamLabel(selectedTeam)}</div>
                    <div className="text-xs opacity-70">Base facilities and HQ level will mirror this team.</div>
                  </div>
                  <div className="p-4 rounded-xl bg-gray-700">
                    <div className="text-xs opacity-70 mb-1">Calendar</div>
                    <div className="text-lg">{(gameState?.calendar || []).length} races</div>
                  </div>
                  <div className="p-4 rounded-xl bg-gray-700">
                    <div className="text-xs opacity-70 mb-1">Available engines</div>
                    <div className="text-lg">{engines.length}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="bg-gray-600 border-0">
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm">Team name</label>
                  <Input
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="e.g., Onyria GP"
                    className="bg-gray-700 border-gray-500 text-white"
                  />
                </div>
                <div>
                  <label className="text-sm">Short name (HUD)</label>
                  <Input
                    value={shortName}
                    onChange={(e) => setShortName(e.target.value)}
                    placeholder="e.g., ONY"
                    className="bg-gray-700 border-gray-500 text-white"
                  />
                </div>
                <div>
                  <label className="text-sm">Engine supplier</label>
                  <select
                    value={engineId}
                    onChange={(e) => setEngineId(e.target.value)}
                    className="w-full h-10 rounded-md bg-gray-700 border border-gray-500 px-3"
                  >
                    {engines.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-gray-700">
                  <div className="text-xs opacity-70 mb-1">Primary color</div>
                  <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="w-full h-12 rounded" />
                </div>
                <div className="p-4 rounded-xl bg-gray-700">
                  <div className="text-xs opacity-70 mb-1">Secondary color</div>
                  <input type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} className="w-full h-12 rounded" />
                </div>
                <div className="p-4 rounded-xl bg-gray-700">
                  <div className="text-xs opacity-70 mb-1">Preview</div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full" style={{ background: primary }} />
                    <div className="w-10 h-10 rounded-full" style={{ background: secondary }} />
                    {logoDataUrl ? (
                      <img
                        src={logoDataUrl}
                        alt="Team logo"
                        className="w-10 h-10 rounded-full object-cover border border-gray-600"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full border border-dashed border-gray-500 flex items-center justify-center text-xs opacity-70">
                        logo
                      </div>
                    )}
                    <div className="text-sm ml-2">{shortName || "??"}</div>
                  </div>
                </div>
              </div>

              {/* Upload do logo */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-3 p-4 rounded-xl bg-gray-700">
                  <div className="text-xs opacity-70 mb-2">Upload team logo (PNG/JPG)</div>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={(e) => onLogoChange(e.target.files?.[0] || null)}
                    className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-gray-600 file:text-white hover:file:bg-gray-500"
                  />
                  {logoFileName && <div className="text-xs opacity-70 mt-1">Selected: {logoFileName}</div>}
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
                <Button disabled={!canContinueTeam} onClick={() => setStep(3)}>Continue</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card className="bg-gray-600 border-0">
            <CardContent className="p-6 space-y-4">
              {/* Toggle para incluir contratados */}
              <div className="flex items-center justify-between">
                <div className="text-sm opacity-80">
                  Showing{" "}
                  <b>{freeDrivers.length}</b> free drivers
                  {!includeSigned ? null : (
                    <> + <b>{allDriversWithFlag.filter(d=>d._signed).length}</b> signed</>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeSigned}
                    onChange={(e) => setIncludeSigned(e.target.checked)}
                  />
                  Include signed drivers
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="text-sm">Driver 1</label>
                  <select
                    value={driver1}
                    onChange={(e) => setDriver1(e.target.value)}
                    className="w-full h-10 rounded-md bg-gray-700 border border-gray-500 px-3"
                  >
                    <option value="" disabled>Pick driver</option>
                    {(selectableDrivers || []).map((d) => (
                      <option key={d.driver_id} value={d.driver_id}>
                        {driverLabel(d)}{d._signed ? " (Signed)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm">Driver 2</label>
                  <select
                    value={driver2}
                    onChange={(e) => setDriver2(e.target.value)}
                    className="w-full h-10 rounded-md bg-gray-700 border border-gray-500 px-3"
                  >
                    <option value="" disabled>Pick driver</option>
                    {(selectableDrivers || []).map((d) => (
                      <option key={d.driver_id} value={d.driver_id}>
                        {driverLabel(d)}{d._signed ? " (Signed)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="text-right">
                  <Button variant="outline" onClick={onRandomizeDrivers}>Randomize</Button>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
                <Button disabled={!canContinueDrivers} onClick={() => setStep(4)}>Continue</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 4 && (
          <Card className="bg-gray-600 border-0">
            <CardContent className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <div className="text-sm">Difficulty</div>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="w-full h-10 rounded-md bg-gray-700 border border-gray-500 px-3"
                  >
                    {difficulties.map((d) => (
                      <option key={d.key} value={d.key}>{d.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <div className="text-sm">Starting budget</div>
                  <Slider
                    value={[startingBudget]}
                    min={1000000}
                    max={20000000}
                    step={250000}
                    onValueChange={(v) => setStartingBudget(clamp(v[0], 1_000_000, 20_000_000))}
                  />
                  <div className="text-xs opacity-70">Base: ${startingBudget.toLocaleString()} → With difficulty: ${computedBudget.toLocaleString()}</div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm">Engine fee (yearly)</div>
                  <div className="text-lg">
                    ${Number(engines.find((e) => e.id === engineId)?.supplier_fee || 0).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-gray-700">
                <div className="text-xs opacity-70 mb-2">Summary</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <div><b>Season:</b> {year}</div>
                  <div><b>Team:</b> {teamName} ({shortName})</div>
                  <div><b>Engine:</b> {engines.find((e) => e.id === engineId)?.name || "—"}</div>
                  <div><b>Drivers:</b> {[driver1, driver2].map((id) =>
                    (includeSigned ? allDriversWithFlag : freeDrivers).find((d) => d.driver_id === id)
                  )
                    .map((d) => d ? driverLabel(d) : "?").join(" & ")}</div>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep(3)}>Back</Button>
                <Button onClick={onFinish}>Start Career</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
