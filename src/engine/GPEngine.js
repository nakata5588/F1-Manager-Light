// src/engine/GPEngine.js
function rnorm() { return (Math.random() - 0.5) * 0.6; }
function basePace(d, ratings){
  const rec = (ratings || []).find(r => String(r.driver_id) === String(d.driver_id));
  return Number(rec?.pace ?? rec?.overall ?? 60);
}

const unwrap = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.result !== undefined && value.result !== null && value.result !== "") return value.result;
    if (value.value !== undefined && value.value !== null && value.value !== "") return value.value;
  }
  return value;
};

const pick = (obj, keys, fb = undefined) => {
  for (const k of keys) {
    const v = unwrap(obj ? obj[k] : undefined);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fb;
};
const clampISO = (iso) => String(iso || "").slice(0, 10);
const getTeamId = (t) => String(pick(t, ["team_id","id","name","team_name","short_name"], JSON.stringify(t)));

function getActivePointsTable(gs) {
  const rec = gs?.pointsSystem;
  if (Array.isArray(rec?.table) && rec.table.length) return rec.table.map(Number);
  if (rec?.table && typeof rec.table === "object") {
    return Object.keys(rec.table)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => Number(rec.table[k]) || 0);
  }
  if (Array.isArray(rec?.places_csv)) return rec.places_csv.map(Number).filter(Number.isFinite);
  if (rec?.places_csv != null) {
    const out = String(rec.places_csv).split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
    if (out.length) return out;
  }
  return [9,6,4,3,2,1];
}

function findDriverFinishPos(raceArr, driverId) {
  const row = raceArr.find(r => String(r.driver?.driver_id) === String(driverId));
  return row ? rPos(row) : null;
}

function rPos(row) {
  return row?.pos ?? row?.position ?? null;
}

function resolveDriverTeamId(gs, driver) {
  const explicit = pick(driver || {}, ["team_id", "constructor_id", "team"], null);
  if (explicit != null && explicit !== "") return String(explicit);

  const driverId = pick(driver || {}, ["driver_id", "id"], null);
  if (driverId == null || driverId === "") return null;

  const activeYear = Number(gs?.activeYear);
  const contracts = gs?.contracts || gs?.dbContracts || [];
  const contract = contracts.find((row) => {
    const contractDriverId = pick(row, ["driver_id", "person_id", "id"], null);
    if (String(contractDriverId ?? "") !== String(driverId)) return false;

    const role = String(pick(row, ["role", "position", "contract_role", "type"], "")).toLowerCase();
    if (role && !role.includes("driver")) return false;

    const contractYear = Number(pick(row, ["year", "season_year"], NaN));
    return !Number.isFinite(activeYear) || !Number.isFinite(contractYear) || contractYear === activeYear;
  });

  const teamId = pick(contract || {}, ["team_id", "team", "constructor", "constructor_id"], null);
  return teamId == null || teamId === "" ? null : String(teamId);
}

function facilityLevel(gs, teamId, key) {
  if (!teamId) return 5;
  const override = gs?.hq?.facilityLevels?.[key];
  if (override != null && override !== "") return Number(override) || 0;
  const year = Number(gs?.activeYear);
  const row = (gs?.facilities || gs?.dbFacilities || []).find((r) => {
    const tid = String(pick(r, ["team_id","team"], ""));
    const ry = Number(pick(r, ["year","season_year"], year));
    return tid === String(teamId) && (!Number.isFinite(year) || !Number.isFinite(ry) || ry === year);
  });
  const value = pick(row || {}, [key], 5);
  return value == null || value === "" ? 5 : Number(value) || 0;
}

function raceOperationsBonus(gs, driver) {
  const teamId = resolveDriverTeamId(gs, driver);
  const pitLevel = facilityLevel(gs, teamId, "pitcrew_training_level");
  return (pitLevel - 5) * 0.12;
}

function buildRaceTiming(race, ratings, roundIndex) {
  if (!race.length) return race;

  // Synthetic simulation timing. The engine does not yet simulate individual laps,
  // so keep these values as race-output baselines rather than historical facts.
  const winnerTimeMs = Math.round((5100 + (roundIndex % 7) * 35 + Math.random() * 420) * 1000);
  let gapToWinnerMs = 0;
  let previousGapToWinnerMs = 0;

  const timed = race.map((row, index) => {
    const pace = basePace(row.driver, ratings);
    if (index > 0) {
      const stepSeconds = 0.65 + Math.random() * 4.8 + Math.max(0, 90 - pace) * 0.035;
      gapToWinnerMs += Math.round(stepSeconds * 1000);
    }
    const gapToPreviousMs = index === 0 ? 0 : Math.max(0, gapToWinnerMs - previousGapToWinnerMs);
    previousGapToWinnerMs = gapToWinnerMs;

    const bestLapMs = Math.round((72.5 + Math.max(0, 100 - pace) * 0.13 + Math.random() * 1.8) * 1000);
    return {
      ...row,
      total_time_ms: winnerTimeMs + gapToWinnerMs,
      gap_to_winner_ms: gapToWinnerMs,
      gap_to_previous_ms: gapToPreviousMs,
      best_lap_ms: bestLapMs,
      fastest_lap: false,
    };
  });

  const fastest = timed.reduce((best, row, index, arr) =>
    row.best_lap_ms < arr[best].best_lap_ms ? index : best, 0);
  timed[fastest] = { ...timed[fastest], fastest_lap: true };
  return timed;
}

function awardRaceBonuses(next, race, gpName) {
  const year = Number(next.activeYear);
  const teamId = getTeamId(next.team || {});
  const today = clampISO(next.currentDateISO);

  const financeLog = Array.isArray(next.financeLog) ? next.financeLog.slice() : [];

  const contracts = next.contracts || next.dbContracts || [];
  const driverRows = contracts.filter(r => {
    const y = Number(pick(r, ["year","season_year"], NaN));
    const role = String(pick(r, ["role","position","contract_role"], "")).toLowerCase();
    const tid = String(pick(r, ["team_id","team","constructor"]));
    return y === year && tid === String(teamId) && role.includes("driver");
  });

  const txPilot = [];
  for (const c of driverRows) {
    const driverId = pick(c, ["driver_id","person_id","id"]);
    const name = pick(c, ["driver_name","name"], `Driver ${driverId}`);
    const pos = findDriverFinishPos(race, driverId);
    if (!pos) continue;

    const bonusWin = Number(pick(c, ["bonus_win"], 0)) || 0;
    const bonusPod = Number(pick(c, ["bonus_podium"], 0)) || 0;

    if (pos === 1 && bonusWin) {
      txPilot.push({
        id: `tx_bonusdrv_win_${driverId}_${today}`,
        dateISO: today,
        type: "expense",
        category: "Bonus - Driver",
        desc: `${name} — Win bonus @ ${gpName}`,
        amount: -Math.abs(bonusWin),
        sig: `bonusDwin:${teamId}:${year}:${driverId}:${today}`,
      });
    } else if ((pos === 2 || pos === 3) && bonusPod) {
      txPilot.push({
        id: `tx_bonusdrv_podium_${driverId}_${today}`,
        dateISO: today,
        type: "expense",
        category: "Bonus - Driver",
        desc: `${name} — Podium bonus @ ${gpName}`,
        amount: -Math.abs(bonusPod),
        sig: `bonusDpod:${teamId}:${year}:${driverId}:${today}`,
      });
    }
  }

  const sponsors = next.sponsorsContracts || next.dbSponsorsContracts || [];
  const spRows = sponsors.filter(r => {
    const y = Number(pick(r, ["year","season_year"], NaN));
    const tid = String(pick(r, ["team_id","team","constructor"]));
    return y === year && tid === String(teamId);
  });

  const teamDriverIds = (next.drivers || []).filter(d => resolveDriverTeamId(next, d) === String(teamId))
    .map(d => String(d.driver_id));

  const anyWin = race.some(r => rPos(r) === 1 && teamDriverIds.includes(String(r.driver?.driver_id)));
  const anyPod = race.some(r => (rPos(r) === 2 || rPos(r) === 3) && teamDriverIds.includes(String(r.driver?.driver_id)));

  const txSponsor = [];
  for (const s of spRows) {
    const name = pick(s, ["sponsor_name","name"], "Sponsor");
    const bonusWin = Number(pick(s, ["bonus_win"], 0)) || 0;
    const bonusPod = Number(pick(s, ["bonus_podium"], 0)) || 0;

    if (anyWin && bonusWin) {
      txSponsor.push({
        id: `tx_spon_win_${String(s.sponsor_id || name)}_${today}`,
        dateISO: today,
        type: "income",
        category: "Bonus - Sponsor",
        desc: `${name} — Win bonus @ ${gpName}`,
        amount: Math.abs(bonusWin),
        sig: `bonusSwin:${teamId}:${year}:${String(s.sponsor_id || name)}:${today}`,
      });
    } else if (anyPod && bonusPod) {
      txSponsor.push({
        id: `tx_spon_pod_${String(s.sponsor_id || name)}_${today}`,
        dateISO: today,
        type: "income",
        category: "Bonus - Sponsor",
        desc: `${name} — Podium bonus @ ${gpName}`,
        amount: Math.abs(bonusPod),
        sig: `bonusSpod:${teamId}:${year}:${String(s.sponsor_id || name)}:${today}`,
      });
    }
  }

  const sigs = new Set(financeLog.map(t => t.sig));
  const fresh = [...txPilot, ...txSponsor].filter(t => !sigs.has(t.sig));
  if (fresh.length) next.financeLog = [...fresh, ...financeLog];

  return next;
}

export async function runRaceWeekend(gs, { roundIndex, gp }) {
  const next = { ...gs };
  const allDrivers = (gs.drivers || []).slice();
  const activeYear = Number(gs?.activeYear);
  const contractedIds = new Set(
    (gs.contracts || gs.dbContracts || [])
      .filter((row) => {
        const role = String(pick(row, ["role", "position", "contract_role", "type"], "")).toLowerCase();
        const year = Number(pick(row, ["year", "season_year"], NaN));
        return role.includes("driver") && (!Number.isFinite(activeYear) || !Number.isFinite(year) || year === activeYear);
      })
      .map((row) => String(pick(row, ["driver_id", "person_id", "id"], "")))
      .filter(Boolean)
  );
  const drivers = contractedIds.size
    ? allDrivers.filter((d) => contractedIds.has(String(d?.driver_id ?? d?.id ?? "")))
    : allDrivers.filter((d) => d?.status !== "junior_only" && d?.status !== "hidden");
  const ratings = gs.driverRatings || [];
  const teamsById = new Map((gs.teams||[]).map(t => [String(t.team_id||t.id||t.name), t]));
  const pointsTable = getActivePointsTable(gs);

  const qualy = drivers
    .map(d => ({ d, score: basePace(d, ratings) + rnorm()*5 }))
    .sort((a,b) => b.score - a.score)
    .map((x,i) => ({ pos: i+1, driver: x.d }));

  const raceOrder = qualy
    .map((q) => ({
      ...q,
      raceDelta: rnorm() * 4,
      opsBonus: raceOperationsBonus(gs, q.driver),
    }))
    .sort((a,b) => (a.pos + a.raceDelta - a.opsBonus) - (b.pos + b.raceDelta - b.opsBonus))
    .map((x,i) => ({ pos: i+1, driver: x.driver }));

  const race = buildRaceTiming(raceOrder, ratings, roundIndex);

  const prevDrv = new Map((gs.standings?.drivers||[]).map(x => [String(x.driver_id), Number(x.points||0)]));
  race.forEach((r,i) => {
    const pts = Number(pointsTable[i] || 0);
    const id = String(r.driver.driver_id);
    prevDrv.set(id, (prevDrv.get(id)||0) + pts);
  });
  const driverStandings = drivers.map(d => ({
    driver_id: d.driver_id,
    name: d.display_name || d.name || `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim(),
    team_id: resolveDriverTeamId(gs, d),
    points: prevDrv.get(String(d.driver_id)) || 0
  }))
    .sort((a,b) => b.points - a.points || String(a.name || "").localeCompare(String(b.name || "")))
    .map((row, index) => ({ ...row, position: index + 1 }));

  const teamPts = new Map();
  for (const team of gs.teams || []) {
    const id = getTeamId(team);
    if (id) teamPts.set(id, 0);
  }
  for (const row of gs.standings?.teams || []) {
    const id = String(row?.team_id ?? row?.constructor_id ?? "");
    if (id) teamPts.set(id, Number(row?.points || 0));
  }
  race.forEach((row, i) => {
    const teamId = resolveDriverTeamId(gs, row.driver);
    if (!teamId) return;
    const pts = Number(pointsTable[i] || 0);
    teamPts.set(teamId, (teamPts.get(teamId) || 0) + pts);
  });
  const teamStandings = Array.from(teamPts.entries())
    .map(([team_id, points]) => ({
      team_id,
      team_name: teamsById.get(team_id)?.team_name || teamsById.get(team_id)?.name || team_id,
      points
    }))
    .sort((a,b) => b.points - a.points || String(a.team_name || "").localeCompare(String(b.team_name || "")))
    .map((row, index) => ({ ...row, position: index + 1 }));

  next.standings = { drivers: driverStandings, teams: teamStandings };

  const gpName = gp?.gp_name || gp?.name || `Round ${roundIndex+1}`;
  const year = Number(gs.activeYear) || Number(gp?.year) || null;
  const round = Number(roundIndex) + 1;
  const gpId = gp?.gp_id || gp?.id || gp?.track_id || `round_${round}`;
  const resultKey = `${year ?? "season"}_${round}_${gpId}`;
  const classification = race.map((row, index) => ({
    position: row.pos,
    driver_id: row.driver?.driver_id ?? null,
    team_id: resolveDriverTeamId(gs, row.driver),
    points: Number(pointsTable[index] || 0),
    total_time_ms: row.total_time_ms,
    gap_to_winner_ms: row.gap_to_winner_ms,
    gap_to_previous_ms: row.gap_to_previous_ms,
    best_lap_ms: row.best_lap_ms,
    fastest_lap: Boolean(row.fastest_lap),
  }));

  const resultEntry = {
    key: resultKey,
    year,
    round,
    gp_id: gpId,
    name: gpName,
    dateISO: clampISO(gs.currentDateISO),
    qualifying: qualy.map((row) => ({
      position: row.pos,
      driver_id: row.driver?.driver_id ?? null,
      team_id: resolveDriverTeamId(gs, row.driver),
    })),
    classification,
  };

  next.results = [
    ...(Array.isArray(gs.results) ? gs.results.filter((r) => r?.key !== resultKey) : []),
    resultEntry,
  ];

  next.lastRace = {
    roundIndex,
    gpName,
    date: gs.currentDateISO,
    qualy,
    race,
    driverStandings,
    teamStandings,
    resultKey,
  };

  const afterBonuses = awardRaceBonuses(next, race, gpName);

  afterBonuses.inbox = [
    {
      id: `gp_${Date.now()}`,
      date: gs.currentDateISO,
      from: "Race Control",
      tag: "Race",
      subject: `${gpName} — Resultados`,
      body: `Vencedor: ${race[0]?.driver?.display_name || race[0]?.driver?.name || "—"}. Pontos atualizados.`,
      actions: [
        { label: "Ver resultados", route: "/Results" },
        { label: "Ver classificação", route: "/Standings" },
      ],
    },
    ...(gs.inbox || []),
  ];

  return afterBonuses;
}
