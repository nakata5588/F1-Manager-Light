// src/engine/GPEngine.js
import { defaultDriverCondition, driverCondition } from "../domain/driverRating.js";
import { combinedQualifyingPerformance, combinedRacePerformance } from "../domain/driverPerformance.js";
import { rngFor } from "../core/random.js";
import { buildRaceEntryState, raceEntryDriverIds, raceEntryTeamForDriver } from "../domain/raceEntry.js";
import { applyRaceHealthOutcomes } from "./InjuryEngine.js";
import { ensureTemporaryReplacements } from "./ReplacementEngine.js";
import { activeDriverContracts, currentDriverTeamId } from "../domain/driverContracts.js";
import { preferLiveRows } from "../domain/liveContracts.js";
import { teamCarPerformance } from "../domain/carPerformance.js";
import { applyRaceComponentWear } from "../domain/componentWear.js";

function rnorm(rng) { return (rng.next() - 0.5) * 0.6; }

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
function ratingFor(ratings,driver){
  return (ratings||[]).find((r)=>String(r?.driver_id??r?.id??"")===String(driver?.driver_id??driver?.id??""))||{};
}
function isWetGP(gp){
  const raw=String(
    gp?.weather ?? gp?.conditions ?? gp?.condition ?? gp?.forecast ?? ""
  ).toLowerCase();
  return /wet|rain|storm|shower/.test(raw);
}

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
  const driverId = pick(driver || {}, ["driver_id", "id"], null);
  if (driverId == null || driverId === "") return null;

  const entryTeamId = raceEntryTeamForDriver(gs?.raceEntryState, driverId);
  if (entryTeamId) return entryTeamId;

  const liveTeamId = currentDriverTeamId(gs, driverId);
  if (liveTeamId) return liveTeamId;

  const explicit = pick(driver || {}, ["team_id", "constructor_id", "team"], null);
  return explicit == null || explicit === "" ? null : String(explicit);
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
  const driverId=pick(driver||{},["driver_id","id"],null);
  const performance=teamCarPerformance(gs,teamId,driverId);
  let rel=Number(performance?.reliability);
  rel=Number.isFinite(rel)?rel/100:0.82;

  // User development/facilities can improve reliability, but only modestly.
  // The base value above is the same live car model used by Garage/Car Performance,
  // including installed-part condition and degradation penalties.
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

function incidentSeverity(rng, reason) {
  const collisionBias=String(reason||"").toLowerCase()==="collision"?0.06:0;
  const score=clamp(0.05+rng.next()*0.90+collisionBias,0.05,1);
  let label="low";
  if(score>=0.96)label="critical";
  else if(score>=0.82)label="high";
  else if(score>=0.55)label="medium";
  return { label, score:Number(score.toFixed(3)) };
}

export function raceAccidentChance(gs,rating,driverId){
  const model=accidentModelForYear(gs);
  const year=Number(gs?.activeYear);
  const damageProb=clamp(Number(pick(model,["damage_DNF_prob","damage_dnf_prob"],0.10)),0.04,0.25);
  const crashLik=clamp(Number(pick(rating||{},["crash_likelihood"],35))/100,0.05,0.95);
  const fatigue=Number(driverCondition(gs,driverId)?.fatigue ?? 0);
  const fatigueRisk=Math.max(0,fatigue-60)*0.0004;

  // 1980 is intentionally calibrated as a much more dangerous era for gameplay:
  // a neutral driver starts at a 15% Accident/Collision DNF chance per GP.
  // Driver crash tendency and extreme fatigue can move that risk around the baseline.
  if(year===1980){
    const crashAdjustment=(crashLik-0.35)*0.10;
    return clamp(0.15+crashAdjustment+fatigueRisk,0.08,0.25);
  }

  return clamp(0.012+crashLik*damageProb*0.32+fatigueRisk,0.01,0.12);
}

function applyRetirements(gs, timedRace, ratings, roundIndex, rng) {
  const finishers=[];
  const retirees=[];

  for(const row of timedRace){
    const driver=row.driver||{};
    const rating=(ratings||[]).find((r)=>String(r?.driver_id)===String(driver?.driver_id))||{};
    const rel=teamReliability(gs,driver);

    // Older/less reliable cars fail more often. Accident risk is calibrated separately.
    const mechanicalChance=clamp((1-rel)*0.68,0.015,0.28);
    const accidentChance=raceAccidentChance(gs,rating,driver?.driver_id);
    const roll=rng.next();

    let reason=null;
    if(roll<mechanicalChance) {
      const mechReasons=["Engine","Gearbox","Transmission","Electrical","Cooling","Fuel system","Suspension"];
      reason=rng.pick(mechReasons);
    } else if(roll<mechanicalChance+accidentChance) {
      reason=rng.next()<0.72?"Accident":"Collision";
    }

    if(!reason){
      finishers.push({...row,status:"Finished",retired:false,retirement_reason:null});
      continue;
    }

    const progress=0.12+rng.next()*0.80;
    const lapsCompleted=Math.max(1,Math.floor(60*progress));
    const incident=/accident|collision/i.test(reason)?incidentSeverity(rng,reason):null;
    retirees.push({
      ...row,
      status:"DNF",
      retired:true,
      retirement_reason:reason,
      incident_severity:incident?.label??null,
      incident_severity_score:incident?.score??null,
      laps_completed:lapsCompleted,
      total_time_ms:null,
      gap_to_winner_ms:null,
      gap_to_previous_ms:null,
    });
  }

  retirees.sort((a,b)=>Number(b.laps_completed||0)-Number(a.laps_completed||0));
  return [...finishers,...retirees].map((row,index)=>({...row,pos:index+1}));
}

function buildRaceTiming(race, ratings, roundIndex, gs, rng) {
  if (!race.length) return race;

  // Synthetic simulation timing. The engine does not yet simulate individual laps,
  // so keep these values as race-output baselines rather than historical facts.
  const winnerTimeMs = Math.round((5100 + (roundIndex % 7) * 35 + rng.next() * 420) * 1000);
  let gapToWinnerMs = 0;
  let previousGapToWinnerMs = 0;

  const timed = race.map((row, index) => {
    const pace = Number(row.performance ?? combinedRacePerformance({
      gs,
      driver:row.driver,
      rating:ratingFor(ratings,row.driver),
      teamId:resolveDriverTeamId(gs,row.driver),
      wet:false,
    }));
    if (index > 0) {
      const stepSeconds = 0.65 + rng.next() * 4.8 + Math.max(0, 90 - pace) * 0.035;
      gapToWinnerMs += Math.round(stepSeconds * 1000);
    }
    const gapToPreviousMs = index === 0 ? 0 : Math.max(0, gapToWinnerMs - previousGapToWinnerMs);
    previousGapToWinnerMs = gapToWinnerMs;

    const bestLapMs = Math.round((72.5 + Math.max(0, 100 - pace) * 0.13 + rng.next() * 1.8) * 1000);
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

  const driverRows = activeDriverContracts(next,{teamId});

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

  const sponsors = preferLiveRows(next,"sponsorsContracts","dbSponsorsContracts");
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


export function simulateQualifyingSession(gs,{roundIndex,gp,raceEntryOverride=null}={}){
  let next=ensureTemporaryReplacements(gs,{roundIndex,gp});
  const raceEntryState=raceEntryOverride||buildRaceEntryState(next,{roundIndex,gp});
  next={...next,raceEntryState};

  const allDrivers=(next.drivers||[]).slice();
  const enteredIds=new Set(raceEntryDriverIds(raceEntryState));
  const drivers=allDrivers.filter((driver)=>enteredIds.has(String(driver?.driver_id??driver?.id??"")));
  const ratings=next.driverRatings||[];
  const activeYear=Number(next?.activeYear);
  const gpEntropyId=gp?.gp_id||gp?.id||gp?.track_id||`round_${Number(roundIndex)+1}`;
  const qualifyingRng=rngFor(next,`${activeYear||"season"}-${gpEntropyId}-qualifying`);
  const wet=isWetGP(gp);

  const qualifying=drivers
    .map((driver)=>{
      const rating=ratingFor(ratings,driver);
      const teamId=resolveDriverTeamId(next,driver);
      const score=combinedQualifyingPerformance({gs:next,driver,rating,teamId,wet})+rnorm(qualifyingRng)*4;
      return {d:driver,score};
    })
    .sort((a,b)=>b.score-a.score)
    .map((row,index)=>({pos:index+1,driver:row.d,performance:row.score}));

  return {gameState:next,raceEntryState,qualifying};
}

function qualifyingFromOverride(gs,rows=[]){
  const driverById=new Map((gs?.drivers||[]).map((driver)=>[
    String(driver?.driver_id??driver?.id??""),
    driver,
  ]));
  return (rows||[])
    .map((row,index)=>{
      const driverId=String(row?.driver_id??row?.driver?.driver_id??"");
      const driver=driverById.get(driverId);
      if(!driver)return null;
      return {
        pos:Number(row?.position??row?.pos??index+1),
        driver,
        performance:Number(row?.performance??row?.score??0),
      };
    })
    .filter(Boolean)
    .sort((a,b)=>a.pos-b.pos);
}

export async function runRaceWeekend(gs, { roundIndex, gp, qualifyingOverride=null, raceEntryOverride=null } = {}) {
  const qualifyingSession=simulateQualifyingSession(gs,{roundIndex,gp,raceEntryOverride});
  gs=qualifyingSession.gameState;
  const raceEntryState=qualifyingSession.raceEntryState;
  const next={...gs};
  const allDrivers=(gs.drivers||[]).slice();
  const activeYear=Number(gs?.activeYear);
  const enteredIds=new Set(raceEntryDriverIds(raceEntryState));
  const drivers=allDrivers.filter((d)=>enteredIds.has(String(d?.driver_id??d?.id??"")));
  const ratings=gs.driverRatings||[];
  const teamsById=new Map((gs.teams||[]).map(t=>[String(t.team_id||t.id||t.name),t]));
  const pointsTable=getActivePointsTable(gs);
  const gpEntropyId=gp?.gp_id||gp?.id||gp?.track_id||`round_${Number(roundIndex)+1}`;
  const entropyBase=`${activeYear||"season"}-${gpEntropyId}`;
  const raceOrderRng=rngFor(gs,`${entropyBase}-race-order`);
  const timingRng=rngFor(gs,`${entropyBase}-timing`);
  const incidentRng=rngFor(gs,`${entropyBase}-incidents`);

  const wet=isWetGP(gp);
  const qualy=Array.isArray(qualifyingOverride)&&qualifyingOverride.length
    ?qualifyingFromOverride(gs,qualifyingOverride)
    :qualifyingSession.qualifying;

  const fieldSize=Math.max(1,qualy.length);
  const raceOrder = qualy
    .map((q) => {
      const rating=ratingFor(ratings,q.driver);
      const teamId=resolveDriverTeamId(gs,q.driver);
      const racePerf=combinedRacePerformance({gs,driver:q.driver,rating,teamId,wet});
      const gridBonus=(fieldSize-q.pos)*0.18;
      const launchBonus=(Number(rating?.start_launch??60)-60)*0.025;
      const opsBonus=raceOperationsBonus(gs,q.driver);
      return {
        ...q,
        raceScore:racePerf+gridBonus+launchBonus+opsBonus+rnorm(raceOrderRng)*6,
      };
    })
    .sort((a,b)=>b.raceScore-a.raceScore)
    .map((x,i)=>({pos:i+1,driver:x.driver,performance:x.raceScore}));

  const timedRace = buildRaceTiming(raceOrder, ratings, roundIndex, gs, timingRng);
  const race = applyRetirements(gs, timedRace, ratings, roundIndex, incidentRng);

  const previousDriverStandings=gs.standings?.drivers||[];
  const prevDrv = new Map(previousDriverStandings.map(x => [String(x.driver_id), Number(x.points||0)]));
  race.forEach((r,i) => {
    const pts = r?.retired ? 0 : Number(pointsTable[i] || 0);
    const id = String(r.driver.driver_id);
    prevDrv.set(id, (prevDrv.get(id)||0) + pts);
  });
  const driverById=new Map(allDrivers.map((d)=>[String(d?.driver_id??d?.id??""),d]));
  const previousStandingById=new Map(previousDriverStandings.map((row)=>[String(row?.driver_id??""),row]));
  const championshipDriverIds=new Set([
    ...prevDrv.keys(),
    ...drivers.map((d)=>String(d?.driver_id??d?.id??"")).filter(Boolean),
  ]);
  const driverStandings = [...championshipDriverIds].map((id) => {
    const d=driverById.get(String(id))||{};
    const previous=previousStandingById.get(String(id))||{};
    return {
      driver_id:id,
      name:d.display_name || d.name || `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || previous.name || id,
      team_id:resolveDriverTeamId(gs,d)||previous.team_id||null,
      points:prevDrv.get(String(id))||0,
    };
  })
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
    raceEntry: raceEntryState.entries.map((entry) => ({ ...entry })),
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
  const afterInjuries = applyRaceHealthOutcomes(afterRelations, { gp, race });
  const afterWear = applyRaceComponentWear(afterInjuries, { gp, race });

  // Race weekends change physical and psychological condition. Conditions are
  // 0-100 scales: fatigue 0=fresh/100=exhausted; the others use 50 as neutral.
  const conditionDict={...(afterWear.driverAttributes||{})};
  const qualifyingPos=new Map(qualy.map((row)=>[String(row?.driver?.driver_id??""),Number(row.pos)]));
  for(const row of race){
    const did=String(row?.driver?.driver_id??"");
    if(!did)continue;
    const curr={...defaultDriverCondition(),...(conditionDict[did]||{})};
    const finish=Number(row.pos);
    const start=Number(qualifyingPos.get(did)??finish);
    const positionDelta=Number.isFinite(start)&&Number.isFinite(finish)?start-finish:0;

    let confidenceDelta=Math.max(-2,Math.min(2,positionDelta*0.35));
    let moraleDelta=Math.max(-1.5,Math.min(1.5,positionDelta*0.25));
    if(row.retired){
      confidenceDelta-=4;
      moraleDelta-=2;
    }else if(finish===1){
      confidenceDelta+=5;
      moraleDelta+=4;
    }else if(finish<=3){
      confidenceDelta+=3;
      moraleDelta+=2;
    }else if(finish<=Math.max(5,Math.ceil(race.length/2))){
      confidenceDelta+=1;
      moraleDelta+=0.5;
    }

    const raceFatigue=(row.retired?8:12)+(wet?2:0);
    conditionDict[did]={
      ...curr,
      fatigue:clamp(Number(curr.fatigue||0)+raceFatigue,0,100),
      preparation:clamp(Number(curr.preparation||50)-10,0,100),
      confidence:clamp(Number(curr.confidence||50)+confidenceDelta,0,100),
      morale:clamp(Number(curr.morale||50)+moraleDelta,0,100),
    };
  }
  afterWear.driverAttributes=conditionDict;

  const reserveReplacements=(raceEntryState.entries||[]).filter((entry)=>entry.entry_type==="reserve_replacement");
  const emergencyReplacements=(raceEntryState.entries||[]).filter((entry)=>entry.entry_type==="emergency_substitute");
  afterWear.inbox = [
    {
      id: `gp_${Date.now()}`,
      date: gs.currentDateISO,
      from: "Race Control",
      type: "GP",
      tag: "Race",
      subject: `${gpName} — Race Report`,
      body: `Winner: ${race.find((r)=>!r.retired)?.driver?.display_name || race.find((r)=>!r.retired)?.driver?.name || "—"}. ${race.filter((r)=>r.retired).length} retirement(s).${reserveReplacements.length ? ` ${reserveReplacements.length} reserve replacement(s) participated.` : ""}${emergencyReplacements.length ? ` ${emergencyReplacements.length} emergency substitute(s) participated.` : ""} Championship points updated.`,
      unread: true,
      actions: [
        { label: "Ver resultados", route: "/Results" },
        { label: "Ver classificação", route: "/Standings" },
      ],
    },
    ...(afterWear.inbox || gs.inbox || []),
  ];

  return afterWear;
}
