// src/engine/GPEngine.js
import { driverCondition, fatiguePenalty } from "../domain/driverRating.js";

function rnorm() { return (Math.random() - 0.5) * 0.6; }
function basePace(d, ratings, gs){
  const rec = (ratings || []).find(r => String(r.driver_id) === String(d.driver_id));
  const pace = Number(rec?.pace ?? rec?.overall ?? rec?.current_ability ?? 60);
  const overall = Number(rec?.current_ability ?? pace);
  const blended = Number.isFinite(overall) ? pace * 0.80 + overall * 0.20 : pace;
  return blended - fatiguePenalty(gs, d?.driver_id ?? d?.id);
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

function clamp(n,min,max){ return Math.max(min,Math.min(max,Number(n)||0)); }

function accidentModelForYear(gs) {
  const year=Number(gs?.activeYear);
  const src=gs?.accidentModel ?? gs?.dbAccidentModel ?? [];
  const arr=Array.isArray(src)?src:Object.values(src||{});
  const exact=arr.find((r)=>Number(pick(r,["year","season_year"],NaN))===year);
  if(exact)return exact;
  const historical=arr
    .filter((r)=>Number(pick(r,["year","season_year"],NaN))<=year)
    .sort((a,b)=>Number(pick(b,["year"],0))-Number(pick(a,["year"],0)));
  return historical[0]||{};
}

function teamReliability(gs, driver) {
  const teamId=resolveDriverTeamId(gs,driver);
  const year=Number(gs?.activeYear);
  const row=(gs?.teamEngines||gs?.dbTeamEngines||[]).find((r)=>
    String(pick(r,["team_id","team","constructor"],""))===String(teamId) &&
    Number(pick(r,["year","season_year"],year))===year
  );
  let rel=Number(pick(row||{},["reliability_override"],NaN));
  if(!Number.isFinite(rel)){
    const score=Number(pick(row||{},["reliability"],80));
    rel=Number.isFinite(score)?score/100:0.82;
  }

  // User development/facilities can improve reliability, but only modestly.
  const userTeamId=getTeamId(gs?.team||{});
  if(String(teamId)===String(userTeamId)){
    const manufacturing=facilityLevel(gs,teamId,"manufacturing_level");
    rel += (manufacturing-5)*0.004;
    const projects=[
      ...(gs?.development?.projects||[]),
      ...(gs?.development?.research||[]),
    ].filter((p)=>String(p?.area||p?.focus||"").toLowerCase().includes("reliab") && ["completed","done"].includes(String(p?.status||"").toLowerCase()));
    rel += projects.reduce((sum,p)=>sum+Math.max(0,Number(p?.target_gain||p?.gain||1))*0.004,0);
  }
  return clamp(rel,0.55,0.97);
}

function applyRetirements(gs, timedRace, ratings, roundIndex) {
  const model=accidentModelForYear(gs);
  const damageProb=clamp(Number(pick(model,["damage_DNF_prob","damage_dnf_prob"],0.10)),0.04,0.25);
  const finishers=[];
  const retirees=[];

  for(const row of timedRace){
    const driver=row.driver||{};
    const rating=(ratings||[]).find((r)=>String(r?.driver_id)===String(driver?.driver_id))||{};
    const rel=teamReliability(gs,driver);
    const crashLik=clamp(Number(pick(rating,["crash_likelihood"],35))/100,0.05,0.95);
    const fatigue=Number(driverCondition(gs,driver?.driver_id)?.fatigue ?? 20);

    // Older/less reliable cars fail more often. Crash likelihood is a separate route to DNF.
    const mechanicalChance=clamp((1-rel)*0.68,0.015,0.28);
    const fatigueRisk=Math.max(0,fatigue-60)*0.0004;
    const accidentChance=clamp(0.012 + crashLik*damageProb*0.32 + fatigueRisk,0.01,0.12);
    const roll=Math.random();

    let reason=null;
    if(roll<mechanicalChance) {
      const mechReasons=["Engine","Gearbox","Transmission","Electrical","Cooling","Fuel system","Suspension"];
      reason=mechReasons[(simpleRaceHash(`${roundIndex}:${driver?.driver_id}:mech`))%mechReasons.length];
    } else if(roll<mechanicalChance+accidentChance) {
      reason=Math.random()<0.72?"Accident":"Collision";
    }

    if(!reason){
      finishers.push({...row,status:"Finished",retired:false,retirement_reason:null});
      continue;
    }

    const progress=0.12+Math.random()*0.80;
    const lapsCompleted=Math.max(1,Math.floor(60*progress));
    retirees.push({
      ...row,
      status:"DNF",
      retired:true,
      retirement_reason:reason,
      laps_completed:lapsCompleted,
      total_time_ms:null,
      gap_to_winner_ms:null,
      gap_to_previous_ms:null,
    });
  }

  retirees.sort((a,b)=>Number(b.laps_completed||0)-Number(a.laps_completed||0));
  return [...finishers,...retirees].map((row,index)=>({...row,pos:index+1}));
}

function simpleRaceHash(text){
  let h=2166136261;
  for(const ch of String(text||"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return Math.abs(h>>>0);
}

function buildRaceTiming(race, ratings, roundIndex, gs) {
  if (!race.length) return race;

  // Synthetic simulation timing. The engine does not yet simulate individual laps,
  // so keep these values as race-output baselines rather than historical facts.
  const winnerTimeMs = Math.round((5100 + (roundIndex % 7) * 35 + Math.random() * 420) * 1000);
  let gapToWinnerMs = 0;
  let previousGapToWinnerMs = 0;

  const timed = race.map((row, index) => {
    const pace = basePace(row.driver, ratings, gs);
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

function sponsorObjectiveInfo(sp) {
  const raw = String(pick(sp, ["objective_type"], "") || "").toLowerCase().replace(/\s+/g, "_");
  const penalties = String(pick(sp, ["penalties"], "") || "").toLowerCase();
  let type = raw;
  let target = Number(pick(sp, ["objective_target","target_value"], NaN));

  if (!type || type === "performance") {
    if (/no wins?|win/.test(penalties)) { type = "wins"; target = Number.isFinite(target) ? target : 1; }
    else if (/no podium|podium/.test(penalties)) { type = "podiums"; target = Number.isFinite(target) ? target : 1; }
    else if (/outside top\s*5/.test(penalties)) { type = "constructor_position"; target = 5; }
    else if (/outside top\s*6/.test(penalties)) { type = "constructor_position"; target = 6; }
    else if (/no points?|points?/.test(penalties)) { type = "points"; target = Number.isFinite(target) ? target : 1; }
    else { type = "points"; target = Number.isFinite(target) ? target : 5; }
  }
  if (type === "top_6" || type === "top6") { type = "constructor_position"; target = 6; }
  if (type === "top_10" || type === "top10") { type = "constructor_position"; target = 10; }
  if (type === "wins") target = Number.isFinite(target) ? target : 1;
  if (type === "podiums") target = Number.isFinite(target) ? target : 2;
  if (type === "points") target = Number.isFinite(target) ? target : 10;
  if (type === "qualifying") target = Number.isFinite(target) ? target : 3;
  if (type === "branding") target = 1;
  return { type: type || "branding", target: Math.max(1, Number(target || 1)) };
}

function teamSeasonSponsorMetrics(gs, teamId) {
  const year = Number(gs?.activeYear);
  const events = (Array.isArray(gs?.results) ? gs.results : []).filter((r) => Number(r?.year) === year);
  let wins = 0, podiums = 0, points = 0, qualifying = 0;
  for (const event of events) {
    const rows = event?.classification || [];
    for (const row of rows) {
      if (String(row?.team_id || "") !== String(teamId)) continue;
      const p = Number(row?.position);
      points += Number(row?.points || 0);
      if (p === 1) wins += 1;
      if (p >= 1 && p <= 3) podiums += 1;
    }
    const qual = event?.qualifying || [];
    if (qual.some((row) => String(row?.team_id || "") === String(teamId) && Number(row?.position) <= 10)) {
      qualifying += 1;
    }
  }

  const constructorRow = (gs?.standings?.teams || []).find((r) =>
    String(r?.team_id ?? r?.constructor_id ?? "") === String(teamId)
  );
  return {
    races: events.length,
    totalRaces: Math.max(1, (gs?.calendar || []).length || events.length || 1),
    wins,
    podiums,
    points,
    qualifying,
    constructorPosition: Number(constructorRow?.position || 0) || null,
  };
}

function updateSponsorRelationships(next) {
  const year = Number(next?.activeYear);
  const teamId = getTeamId(next?.team || {});
  if (!teamId) return next;

  const source = Array.isArray(next?.sponsorsContracts) ? next.sponsorsContracts : [];
  if (!source.length) return next;

  const metrics = teamSeasonSponsorMetrics(next, teamId);
  const seasonFraction = Math.max(1 / metrics.totalRaces, metrics.races / metrics.totalRaces);
  let relationshipDeltaTotal = 0;
  let relationshipCount = 0;
  const sponsorMessages = [];

  const updated = source.map((sp) => {
    const tid = String(pick(sp, ["team_id","team","constructor"], ""));
    if (tid !== String(teamId)) return sp;

    const start = Number(pick(sp, ["start_year","year","season_year"], year));
    const end = Number(pick(sp, ["end_year","until_year"], year));
    if (year < start || year > end) return sp;

    const status = String(pick(sp, ["status"], "active")).toLowerCase();
    if (["terminated","expired"].includes(status)) return sp;

    const objective = sponsorObjectiveInfo(sp);
    const oldSatisfaction = Math.max(0, Math.min(100, Number(pick(sp, ["satisfaction"], 70)) || 70));
    let delta = 0;
    let note = "";

    if (objective.type === "constructor_position") {
      const pos = metrics.constructorPosition;
      if (!pos) {
        delta = 0;
        note = "Awaiting championship position.";
      } else if (pos <= objective.target) {
        delta = 4;
        note = `On target: Constructors P${pos} (target P${objective.target}).`;
      } else {
        const gap = pos - objective.target;
        delta = -Math.min(7, 2 + gap);
        note = `Below target: Constructors P${pos} (target P${objective.target}).`;
      }
    } else if (objective.type === "branding") {
      delta = 1;
      note = "Branding commitments maintained.";
    } else {
      const actual = Number(metrics[objective.type] || 0);
      const expected = objective.target * seasonFraction;
      if (actual >= objective.target) {
        delta = 6;
        note = `Season objective already achieved (${actual}/${objective.target}).`;
      } else if (actual + 0.001 >= expected) {
        delta = 3;
        note = `On pace for objective (${actual}/${objective.target}).`;
      } else {
        const severity = expected > 0 ? Math.min(6, Math.max(2, Math.ceil((expected - actual) * 2))) : 2;
        delta = -severity;
        note = `Behind objective pace (${actual}/${objective.target}; expected ${expected.toFixed(1)} by now).`;
      }
    }

    const satisfaction = Math.max(0, Math.min(100, oldSatisfaction + delta));
    relationshipDeltaTotal += delta;
    relationshipCount += 1;

    const broken = metrics.races >= 3 && satisfaction <= 20;
    if (broken) {
      const sponsorName = pick(sp, ["sponsor_name","name"], "Sponsor");
      sponsorMessages.push({
        id: `sponsor_break_${String(pick(sp, ["sponsor_id","id"], sponsorName))}_${clampISO(next.currentDateISO)}`,
        date: clampISO(next.currentDateISO),
        from: "Commercial",
        tag: "Sponsors",
        subject: `${sponsorName} ends partnership`,
        body: `Satisfaction fell to ${Math.round(satisfaction)}%. ${note} The sponsor has terminated the agreement.`,
      });
      return {
        ...sp,
        status: "terminated",
        end_date: clampISO(next.currentDateISO),
        satisfaction,
        relationship_note: note,
        objective_type: objective.type,
        objective_target: objective.target,
      };
    }

    return {
      ...sp,
      satisfaction,
      relationship_note: note,
      objective_type: objective.type,
      objective_target: objective.target,
    };
  });

  const activeForTeam = updated.filter((sp) =>
    String(pick(sp, ["team_id","team","constructor"], "")) === String(teamId) &&
    !["terminated","expired"].includes(String(pick(sp, ["status"], "active")).toLowerCase())
  );
  const avgSatisfaction = activeForTeam.length
    ? activeForTeam.reduce((sum, sp) => sum + Number(pick(sp, ["satisfaction"], 70) || 70), 0) / activeForTeam.length
    : 50;

  const brand = (next?.teamBrands || []).find((row) =>
    String(pick(row, ["team_id","team","constructor"], "")) === String(teamId)
  );
  const expectation = String(pick(brand || {}, ["board_expectation"], "")).toLowerCase();
  const baseCommercial =
    /championship|title/.test(expectation) ? 72 :
    /race_wins|win/.test(expectation) ? 64 :
    /podium/.test(expectation) ? 58 :
    /points|midfield/.test(expectation) ? 50 : 42;

  const oldCommercial = Number.isFinite(Number(next?.commercialScore))
    ? Number(next.commercialScore)
    : baseCommercial;
  const breakPenalty = sponsorMessages.length * 8;
  const trend = relationshipCount ? relationshipDeltaTotal / relationshipCount : 0;
  next.commercialScore = Math.max(0, Math.min(100,
    Math.round(oldCommercial * 0.72 + avgSatisfaction * 0.28 + trend * 0.35 - breakPenalty)
  ));
  next.sponsorsContracts = updated;
  if (sponsorMessages.length) next.inbox = [...sponsorMessages, ...(next.inbox || [])];
  return next;
}

function awardRaceBonuses(next, race, gpName) {
  const year = Number(next.activeYear);
  const teamId = getTeamId(next.team || {});
  const today = clampISO(next.currentDateISO);

  const financeLog = Array.isArray(next.financeLog) ? next.financeLog.slice() : [];

  const contracts = next.contracts || next.dbContracts || [];
  const driverRows = contracts.filter(r => {
    const y = Number(pick(r, ["year","season_year","start_year"], NaN));
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
    const y = Number(pick(r, ["year","season_year","start_year"], NaN));
    const tid = String(pick(r, ["team_id","team","constructor"]));
    const status = String(pick(r, ["status"], "active")).toLowerCase();
    return y === year && tid === String(teamId) && !["terminated","expired"].includes(status);
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
    .map(d => ({ d, score: basePace(d, ratings, gs) + rnorm()*5 }))
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

  const timedRace = buildRaceTiming(raceOrder, ratings, roundIndex, gs);
  const race = applyRetirements(gs, timedRace, ratings, roundIndex);

  const prevDrv = new Map((gs.standings?.drivers||[]).map(x => [String(x.driver_id), Number(x.points||0)]));
  race.forEach((r,i) => {
    const pts = r?.retired ? 0 : Number(pointsTable[i] || 0);
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
    const pts = row?.retired ? 0 : Number(pointsTable[i] || 0);
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
    points: row?.retired ? 0 : Number(pointsTable[index] || 0),
    status: row.status || (row.retired ? "DNF" : "Finished"),
    retired: Boolean(row.retired),
    retirement_reason: row.retirement_reason || null,
    laps_completed: row.laps_completed ?? null,
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
  const afterRelations = updateSponsorRelationships(afterBonuses);

  // A race weekend creates real physical load. Daily progression/rest then
  // brings this back down between events.
  const conditionDict={...(afterRelations.driverAttributes||{})};
  for(const row of race){
    const did=String(row?.driver?.driver_id??"");
    if(!did)continue;
    const curr={
      confidence:50,
      fatigue:20,
      morale:50,
      preparation:40,
      ...(conditionDict[did]||{}),
    };
    conditionDict[did]={...curr,fatigue:clamp(Number(curr.fatigue||0)+6,0,100)};
  }
  afterRelations.driverAttributes=conditionDict;

  afterRelations.inbox = [
    {
      id: `gp_${Date.now()}`,
      date: gs.currentDateISO,
      from: "Race Control",
      type: "GP",
      tag: "Race",
      subject: `${gpName} — Race Report`,
      body: `Winner: ${race.find((r)=>!r.retired)?.driver?.display_name || race.find((r)=>!r.retired)?.driver?.name || "—"}. ${race.filter((r)=>r.retired).length} retirement(s). Championship points updated.`,
      unread: true,
      actions: [
        { label: "Ver resultados", route: "/Results" },
        { label: "Ver classificação", route: "/Standings" },
      ],
    },
    ...(afterRelations.inbox || gs.inbox || []),
  ];

  return afterRelations;
}
