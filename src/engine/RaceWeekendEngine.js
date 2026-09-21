// src/engine/RaceWeekendEngine.js
import { buildRaceEntryState, raceEntryDriverIds } from "../domain/raceEntry.js";
import { ensureTemporaryReplacements } from "./ReplacementEngine.js";
import { runRaceWeekend, simulateQualifyingSession } from "./GPEngine.js";
import { practiceProgramme, simulatePracticeSession } from "./PracticeSetupEngine.js";

const clampISO=(iso)=>String(iso||"").slice(0,10);

function parseISO(iso){
  const [y,m,d]=clampISO(iso).split("-").map(Number);
  return new Date(Date.UTC(y||0,(m||1)-1,d||1));
}
function addDaysISO(iso,days){
  const date=parseISO(iso);
  if(Number.isNaN(+date))return clampISO(iso);
  date.setUTCDate(date.getUTCDate()+Number(days||0));
  return date.toISOString().slice(0,10);
}
function gpDateISO(gp){
  return clampISO(gp?.dateISO||gp?.date||gp?.race_date||gp?.start_date||gp?.end_date||gp?.raceDate);
}
function gpId(gp,roundIndex){
  return String(gp?.gp_id||gp?.id||gp?.track_id||`round_${Number(roundIndex)+1}`);
}
function driverIdOf(row){
  return String(row?.driver_id??row?.driver?.driver_id??row?.id??"");
}

export const RACE_WEEKEND_PHASES=Object.freeze([
  "practice",
  "practice_complete",
  "qualifying",
  "grid_ready",
  "race",
  "results",
  "completed",
]);

export function raceWeekendSchedule(gp){
  const raceDate=gpDateISO(gp);
  return {
    practiceDate:addDaysISO(raceDate,-2),
    qualifyingDate:addDaysISO(raceDate,-1),
    raceDate,
  };
}

export function isRaceWeekendActive(gs){
  const phase=String(gs?.raceWeekendState?.phase||"");
  return Boolean(phase)&&phase!=="completed";
}

export function createRaceWeekendState(gs,{roundIndex,gp}={}){
  if(!gs||!gp)return gs;
  const id=gpId(gp,roundIndex);
  const existing=gs?.raceWeekendState;
  if(existing&&String(existing.gp_id)===id&&String(existing.phase)!=="completed")return gs;

  let next=ensureTemporaryReplacements(gs,{roundIndex,gp});
  const raceEntryState=buildRaceEntryState(next,{roundIndex,gp});
  const schedule=raceWeekendSchedule(gp);
  const state={
    key:`${Number(next?.activeYear)||Number(gp?.year)||"season"}_${Number(roundIndex)+1}_${id}`,
    year:Number(next?.activeYear)||Number(gp?.year)||null,
    roundIndex:Number(roundIndex)||0,
    round:Number(roundIndex)+1,
    gp_id:id,
    gp_name:gp?.gp_name||gp?.name||`Round ${Number(roundIndex)+1}`,
    track_id:gp?.track_id||null,
    phase:"practice",
    created_at:clampISO(next?.currentDateISO),
    ...schedule,
    entrants:(raceEntryState.entries||[]).map((entry)=>({...entry})),
    practice:null,
    practice_selections:{},
    qualifying:null,
    grid:null,
    completed_at:null,
  };
  return {...next,raceEntryState,raceWeekendState:state};
}

export function weekendStateForCurrentRound(gs){
  const weekend=gs?.raceWeekendState;
  if(!weekend)return null;
  return weekend;
}

export function syncRaceWeekendPhaseForDate(gs,dateISO=gs?.currentDateISO){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase==="completed")return gs;
  const date=clampISO(dateISO);
  let phase=weekend.phase;

  if(phase==="practice_complete"&&date>=weekend.qualifyingDate)phase="qualifying";
  if(phase==="grid_ready"&&date>=weekend.raceDate)phase="race";
  if(phase==="results"&&date>weekend.raceDate)phase="completed";

  if(phase===weekend.phase)return gs;
  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      phase,
      completed_at:phase==="completed"?date:weekend.completed_at,
    },
  };
}

export function shouldCreateWeekendForDate(gs,{roundIndex,gp,dateISO}={}){
  if(!gp)return false;
  const schedule=raceWeekendSchedule(gp);
  const date=clampISO(dateISO||gs?.currentDateISO);
  if(!date||!schedule.raceDate)return false;
  if(date<schedule.practiceDate||date>schedule.raceDate)return false;
  const existing=gs?.raceWeekendState;
  if(existing&&existing.phase!=="completed")return false;
  return true;
}

export function setPracticeProgramme(gs,{driverId,programmeId}={}){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase!=="practice"||!driverId)return gs;
  const programme=practiceProgramme(programmeId);
  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      practice_selections:{
        ...(weekend.practice_selections||{}),
        [String(driverId)]:programme.id,
      },
    },
  };
}

export function completePracticeSession(gs,{gp}={}){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase!=="practice")return gs;
  const targetGp=gp||{
    gp_id:weekend.gp_id,
    gp_name:weekend.gp_name,
    track_id:weekend.track_id,
    race_date:weekend.raceDate,
  };
  const session=simulatePracticeSession(gs,{
    gp:targetGp,
    selections:weekend.practice_selections||{},
  });
  if(!session.practice)return gs;
  return {
    ...session.gameState,
    raceWeekendState:{
      ...weekend,
      phase:"practice_complete",
      practice_selections:weekend.practice_selections||{},
      practice:session.practice,
    },
  };
}

export function completeQualifyingSession(gs,{gp}={}){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase!=="qualifying")return gs;
  const roundIndex=Number(weekend.roundIndex)||0;
  const targetGp=gp||{
    gp_id:weekend.gp_id,
    gp_name:weekend.gp_name,
    track_id:weekend.track_id,
    race_date:weekend.raceDate,
  };
  const session=simulateQualifyingSession(gs,{
    roundIndex,
    gp:targetGp,
    raceEntryOverride:gs?.raceEntryState,
  });
  const normalized=session.qualifying.map((row,index)=>({
    position:Number(row.pos??index+1),
    driver_id:driverIdOf(row),
    team_id:(session.raceEntryState.entries||[]).find((entry)=>String(entry.driver_id)===driverIdOf(row))?.team_id||null,
    performance:Number(row.performance||0),
  }));
  const grid=normalized.map((row)=>({
    grid:row.position,
    driver_id:row.driver_id,
    team_id:row.team_id,
    qualifying_position:row.position,
    qualifying_performance:row.performance,
    penalty_places:0,
  }));
  return {
    ...session.gameState,
    raceWeekendState:{
      ...weekend,
      phase:"grid_ready",
      qualifying:{
        completed_at:clampISO(gs?.currentDateISO),
        status:"completed",
        classification:normalized,
      },
      grid,
    },
  };
}

export async function completeRaceSession(gs,{gp}={}){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase!=="race")return gs;
  const targetGp=gp||{
    gp_id:weekend.gp_id,
    gp_name:weekend.gp_name,
    track_id:weekend.track_id,
    race_date:weekend.raceDate,
  };
  const next=await runRaceWeekend(gs,{
    roundIndex:Number(weekend.roundIndex)||0,
    gp:targetGp,
    qualifyingOverride:weekend.qualifying?.classification||[],
    raceEntryOverride:gs?.raceEntryState,
  });
  return {
    ...next,
    raceWeekendState:{
      ...weekend,
      phase:"results",
      practice:weekend.practice,
      qualifying:weekend.qualifying,
      grid:weekend.grid,
      race_result_key:next?.lastRace?.resultKey||null,
      race_completed_at:clampISO(next?.currentDateISO),
    },
  };
}
