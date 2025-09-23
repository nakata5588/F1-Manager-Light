// src/engine/GPEngine.js
function rnorm() { return (Math.random() - 0.5) * 0.6; }
function basePace(d, ratings){
  const rec = (ratings || []).find(r => String(r.driver_id) === String(d.driver_id));
  return Number(rec?.pace ?? rec?.overall ?? 60);
}
const POINTS = [10,8,6,5,4,3,2,1];

const pick = (obj, keys, fb = undefined) => {
  for (const k of keys) {
    const v = obj ? obj[k] : undefined;
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fb;
};
const clampISO = (iso) => String(iso || "").slice(0, 10);
const getTeamId = (t) => String(pick(t, ["team_id","id","name","team_name","short_name"], JSON.stringify(t)));

function findDriverFinishPos(raceArr, driverId) {
  const row = raceArr.find(r => String(r.driver?.driver_id) === String(driverId));
  return row ? row.pos : null;
}

function awardRaceBonuses(next, race, gpName) {
  const year = Number(next.activeYear);
  const teamId = getTeamId(next.team || {});
  const today = clampISO(next.currentDateISO);

  const financeLog = Array.isArray(next.financeLog) ? next.financeLog.slice() : [];

  // --- Pilotos: bónus win/podium
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

  // --- Sponsors: bónus win/podium por GP (se definido no contrato)
  const sponsors = next.sponsorsContracts || next.dbSponsorsContracts || [];
  const spRows = sponsors.filter(r => {
    const y = Number(pick(r, ["year","season_year"], NaN));
    const tid = String(pick(r, ["team_id","team","constructor"]));
    return y === year && tid === String(teamId);
  });

  // Se QUALQUER piloto da equipa ganhou/pódio, aplicar bónus sponsor correspondente
  const teamDriverIds = (next.drivers || []).filter(d => String(d.team_id || d.constructor_id || d.team || "") === String(teamId))
    .map(d => String(d.driver_id));

  const anyWin = race.some(r => r.pos === 1 && teamDriverIds.includes(String(r.driver?.driver_id)));
  const anyPod = race.some(r => (r.pos === 2 || r.pos === 3) && teamDriverIds.includes(String(r.driver?.driver_id)));

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

  // anexar (com dedupe simples por sig)
  const sigs = new Set(financeLog.map(t => t.sig));
  const fresh = [...txPilot, ...txSponsor].filter(t => !sigs.has(t.sig));
  if (fresh.length) {
    next.financeLog = [...fresh, ...financeLog];
  }

  return next;
}

export async function runRaceWeekend(gs, { roundIndex, gp }) {
  const next = { ...gs };
  const drivers = (gs.drivers || []).slice();
  const ratings = gs.driverRatings || [];
  const teamsById = new Map((gs.teams||[]).map(t => [String(t.team_id||t.id||t.name), t]));

  // QUALIFYING
  const qualy = drivers
    .map(d => ({ d, score: basePace(d, ratings) + rnorm()*5 }))
    .sort((a,b) => b.score - a.score)
    .map((x,i) => ({ pos: i+1, driver: x.d }));

  // RACE
  const race = qualy
    .map(q => ({ ...q, raceDelta: Math.round(rnorm()*4) }))
    .sort((a,b) => (a.pos + a.raceDelta) - (b.pos + b.raceDelta))
    .map((x,i) => ({ pos: i+1, driver: x.driver }));

  // STANDINGS (drivers)
  const prevDrv = new Map((gs.standings?.drivers||[]).map(x => [String(x.driver_id), Number(x.points||0)]));
  race.forEach((r,i) => {
    const pts = POINTS[i] || 0;
    const id = String(r.driver.driver_id);
    prevDrv.set(id, (prevDrv.get(id)||0) + pts);
  });
  const driverStandings = drivers.map(d => ({
    driver_id: d.driver_id,
    name: d.display_name || d.name,
    points: prevDrv.get(String(d.driver_id)) || 0
  })).sort((a,b) => b.points - a.points || a.name.localeCompare(b.name));

  // STANDINGS (teams) — soma simples
  const teamPts = new Map();
  for (const row of driverStandings) {
    const drv = drivers.find(x => String(x.driver_id) === String(row.driver_id));
    const teamId = String(drv?.team_id || drv?.constructor_id || drv?.team || "");
    if (!teamId) continue;
    teamPts.set(teamId, (teamPts.get(teamId)||0) + (row.points||0));
  }
  const teamStandings = Array.from(teamPts.entries())
    .map(([team_id, points]) => ({
      team_id, team_name: teamsById.get(team_id)?.team_name || teamsById.get(team_id)?.name || team_id, points
    }))
    .sort((a,b) => b.points - a.points || a.team_name.localeCompare(b.team_name));

  next.standings = { drivers: driverStandings, teams: teamStandings };

  // Guardar um "lastRace" para uma página/relatório
  const gpName = gp?.gp_name || gp?.name || `Round ${roundIndex+1}`;
  next.lastRace = {
    roundIndex,
    gpName,
    date: gs.currentDateISO,
    qualy,
    race,
    driverStandings,
    teamStandings,
  };

  // === NOVO: aplicar bónus financeiros por corrida ===
  const afterBonuses = awardRaceBonuses(next, race, gpName);

  // Mensagem com link
  afterBonuses.inbox = [
    {
      id: `gp_${Date.now()}`,
      date: gs.currentDateISO,
      from: "Race Control",
      tag: "Race",
      subject: `${gpName} — Resultados`,
      body: `Vencedor: ${race[0]?.driver?.display_name || race[0]?.driver?.name}. Pontos atualizados.`,
      actions: [
        { label: "Ver relatório do GP", route: "/gp-report" },
        { label: "Ver classificação", route: "/standings" },
      ],
    },
    ...(gs.inbox || []),
  ];

  return afterBonuses;
}
