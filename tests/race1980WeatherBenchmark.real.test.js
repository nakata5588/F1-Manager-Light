// Real-data regression gate for the first playable 1980 Renault Grand Prix.
// This deliberately calls the gameplay weekend/finalization boundaries, not a
// synthetic one-lap race or an independent Results calculator.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { isRaceDriverContract } from "../src/domain/contractRoles.js";
import {
  createRaceWeekendState,
  completePracticeSession,
  completeQualifyingSession,
  continueRaceWeekendSession,
  completeRaceSession,
  syncRaceWeekendPhaseForDate,
  raceWeekendSchedule,
  shouldCreateWeekendForDate,
} from "../src/engine/RaceWeekendEngine.js";
import { buildRaceWeekendInput } from "../src/race2/adapters/GameStateInputAdapter.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState } from "../src/race2/core/RaceSimulation.js";
import { createLiveRaceRunner, runFastRace, runFastRaceToEnd } from "../src/race2/core/RaceRunner.js";
import { attachCanonicalRaceRuntime } from "../src/race2/runtime/RaceRuntime.js";
import { prepareGameStateForSave, extractGameStateFromStoredSave } from "../src/core/saveSafety.js";

function roundTripSave(state) {
  // The v2 manual/Continue payload is JSON, with this migration entry on load.
  const serialized = JSON.stringify(prepareGameStateForSave(state));
  return extractGameStateFromStoredSave(JSON.parse(serialized));
}

test("1980 Argentina tyre weather multi-scenario canonical race benchmark", {
  timeout: 1_500_000,
}, async () => {
  const pack = JSON.parse(await fs.readFile(
    new URL("../public/data/seasons/1980/season.json", import.meta.url), "utf8"
  ));
  assert.equal(pack.validation?.ok, true, JSON.stringify(pack.validation));
  const state = pack.state;
  assert.deepEqual(state.calendar.map(race => Number(race.laps)),
    [53, 40, 78, 80, 72, 76, 54, 76, 45, 54, 72, 60, 70, 59],
    "the entire 1980 career calendar must have sourced race distances");
  const renault = state.teams.find(t => String(t.team_name).toLowerCase() === "renault");
  assert.ok(renault, "Renault must be playable in the real 1980 Season Pack");
  const gp = state.calendar[0];
  const nextGp = state.calendar[1];
  assert.match(String(gp?.gp_name), /argentin/i);
  assert.ok(nextGp, "the 1980 calendar must continue after Argentina");

  const seats = (state.contracts || []).filter(isRaceDriverContract);
  const garageByTeam = {};
  for (const team of state.teams) {
    const teamId = String(team.team_id);
    garageByTeam[teamId] = {
      cars: seats.filter(seat => String(seat.team_id) === teamId)
        .slice(0, 2)
        .map((seat, i) => ({
          id: teamId === String(renault.team_id) ? `car_${i + 1}` : `${teamId}_race_${i + 1}`,
          kind: "race",
          driver_id: seat.driver_id,
          componentCondition: { engine: 100, suspension: 100 },
        })),
    };
  }
  assert.equal(garageByTeam[String(renault.team_id)].cars.length, 2);

  const initialDate = String(gp.race_date ?? gp.dateISO ?? gp.date).slice(0, 10);
  let gs = {
    ...state,
    activeYear: 1980,
    currentRound: 0,
    currentDateISO: initialDate,
    saveMeta: { schemaVersion: 2, seed: "renault-1980-first-full-race" },
    team: renault,
    driverAttributes: {},
    driverAvailability: {},
    medicalHistory: [],
    temporaryDriverAssignments: [],
    standings: { drivers: [], teams: [] },
    results: [],
    inbox: [],
    financeLog: [],
    finances: { balance: 10_000_000, budget: 10_000_000, season_spend: 0, season_income: 0 },
    settings: { gameplay: { enableInjuryRandomEvents: false, enableFatalities: false } },
    garage: garageByTeam[String(renault.team_id)],
    aiTechnicalWorld: { teams: Object.fromEntries(
      state.teams.filter(t => String(t.team_id) !== String(renault.team_id))
        .map(t => [String(t.team_id), { garage: garageByTeam[String(t.team_id)] }])
    ) },
  };

  gs = createRaceWeekendState(gs, { roundIndex: 0, gp, engineVersion: "rw2" });
  assert.equal(gs.raceWeekendState.phase, "practice");
  assert.ok(gs.raceEntryState.entries.length >= 20);
  gs = completePracticeSession(gs, { gp });
  assert.equal(gs.raceWeekendState.phase, "practice_complete");
  let completedQualifying = 0;
  for (let i = 0; i < 8 && gs.raceWeekendState.phase !== "grid_ready"; i++) {
    gs = { ...gs, currentDateISO: gs.raceWeekendState.raceDate };
    gs = continueRaceWeekendSession(gs);
    if (gs.raceWeekendState.phase === "qualifying") {
      gs = completeQualifyingSession(gs, { gp });
      completedQualifying++;
    }
  }
  assert.equal(completedQualifying, 2, "1980 must use two qualifying sessions");
  assert.equal(gs.raceWeekendState.phase, "grid_ready");
  assert.equal(gs.raceWeekendState.startingGrid.rows.length, 24);

  gs = { ...gs, currentDateISO: gs.raceWeekendState.raceDate };
  gs = continueRaceWeekendSession(gs);
  assert.equal(gs.raceWeekendState.phase, "race");
  const input = buildRaceWeekendInput(gs, { gp });
  assert.equal(input.engineVersion, "rw2");
  assert.equal(input.year, 1980);
  assert.ok(input.track.lengthM > 4000, "do not race on a synthetic short circuit");
  assert.equal(input.track.laps, 53, "Argentina 1980 was 53 full racing laps");
  assert.equal(input.startingGrid.length, 24);
  assert.ok(input.cars.length >= 24, "all starters must have real cars");


  const clamp=(v)=>Math.max(0,Math.min(1,v));
  const scenarios={
    progressive_rain:(lap)=>lap<=8?0:lap<=24?(lap-8)*0.048:lap<=36?0.77:Math.max(0.08,0.77-(lap-36)*0.035),
    drying:(lap)=>lap<=6?0.74:Math.max(0.02,0.74-(lap-6)*0.027),
    sustained_rain:(lap)=>0.82,
    showers:(lap)=>lap<=8?0.05:lap<=17?0.48:lap<=29?0.12:lap<=40?0.69:0.25,
  };
  const output=[];
  for(const [scenario,waterAtLap] of Object.entries(scenarios)){
    const timeline=Array.from({length:input.track.laps},(_,i)=>{
      const lap=i+1,wetness=clamp(waterAtLap(lap));
      const prev=clamp(waterAtLap(Math.max(1,lap-1)));
      const delta=lap===1?0:Number((wetness-prev).toFixed(3));
      const rain=delta>0.001?Math.min(0.85,0.2+delta*8):scenario==="sustained_rain"?0.70:0;
      return {
        lap,state:rain>=0.6?"HEAVY_RAIN":rain>0.1?"LIGHT_RAIN":wetness>0.25?"DRYING":"SUNNY",
        rain_intensity:rain,track_wetness:Number(wetness.toFixed(3)),
        wetness_delta:delta,grip_index:Math.round(85-40*wetness),rain_band:rain>0.5?"HEAVY":rain>0.1?"LIGHT":"NONE",
        air_temp_c:20,track_temp_c:24,visibility_index:Math.round(99-42*wetness),
        spray_index:Number((wetness*0.6).toFixed(3)),
        standing_water_index:Math.round(wetness*85),
        raceability_index:Math.max(25,95-Math.round(wetness*45)),
        raceability_hazard_index:Math.round(wetness*55),
      };
    });
    const override={
      ...input,seed:"1980-argentina-tyre-"+scenario,
      weather:{...input.weather,state:timeline[0].state,timeline,starting_track_wetness:timeline[0].track_wetness},
    };
    const initial=startRaceState(createRaceState(override));
    const started=Date.now();
    const finished=runFastRaceToEnd(initial,{maxSteps:200_000});
    assert.equal(finished.status,"finished",scenario+" did not finish");
    const byCar=finished.cars.map(car=>({
      id:car.carId,
      initial:initial.cars.find(c=>c.carId===car.carId)?.tyre?.category,
      stops:(car.pitState?.history||[]).map(stop=>({
        lap:stop.lap??stop.entry_lap??stop.service_lap??null,
        tyre:stop.tyre_to??stop.tyreTo??null,
        reason:stop.reason??null,
      })),
      dnf:Boolean(car.dnf||car.status==="dnf"),
    }));
    const stops=byCar.flatMap(car=>car.stops.map(stop=>({...stop,carId:car.id})));
    const line={
      scenario,seed:override.seed,startingWetness:timeline[0].track_wetness,
      entrants:initial.cars.length,laps:input.track.laps,
      ticks:finished.tick,wallMs:Date.now()-started,
      pitStops:stops.length,lapOneStops:stops.filter(stop=>Number(stop.lap)===1).length,
      dnfs:byCar.filter(car=>car.dnf).length,
      initialTyres:Object.fromEntries(["dry","intermediate","wet"].map(k=>[k,byCar.filter(c=>c.initial===k).length])),
      firstStops:stops.slice(0,25),stopsByReason:Object.fromEntries(
        [...new Set(stops.map(stop=>stop.reason))].map(reason=>[String(reason),stops.filter(s=>s.reason===reason).length])
      ),
    };
    output.push(line);
    console.log("ARGENTINA_1980_TYRE_BENCH="+JSON.stringify(line));
    assert.equal(line.entrants,24);
    assert.ok(line.pitStops<=line.entrants*5,"Excessive pit-stop churn: "+scenario);
  }
  assert.equal(output.length,4);
});
