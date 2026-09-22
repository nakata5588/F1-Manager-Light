// src/engine/RaceWeekendEngine.js
import { buildRaceEntryState } from "../domain/raceEntry.js";
import { ensureTemporaryReplacements } from "./ReplacementEngine.js";
import { runRaceWeekend, simulateQualifyingSession } from "./GPEngine.js";
import { practiceProgramme, simulatePracticeSession } from "./PracticeSetupEngine.js";
import { createRaceStrategyState, setRaceStrategySelection as setRaceStrategySelectionState } from "./RaceStrategyEngine.js";
import { advanceLiveRace, createLiveRaceState, issueLiveRaceCommand, liveRaceReadyToFinalize, resumeLiveRace } from "./LiveRaceEngine.js";
import { defaultDriverCondition, driverCondition } from "../domain/driverRating.js";
import {
  advancingDriverIds,
  buildQualifyingClassification,
  buildStartingGrid,
  buildWeekendSessions,
  currentQualifyingSession,
  nextPendingCompetitiveSession,
  qualifyingEntrantsForSession,
  resolveQualifyingRules,
  weekendScheduleFromSessions,
} from "./QualifyingRulesEngine.js";

const clampISO=(iso)=>String(iso||"").slice(0,10);

function parseISO(iso){
  const [y,m,d]=clampISO(iso).split("-").map(Number);
  return new Date(Date.UTC(y||0,(m||1)-1,d||1));
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
function teamForDriver(raceEntryState,driverId){
  return (raceEntryState?.entries||[]).find(
    (entry)=>String(entry?.driver_id??"")===String(driverId??"")
  )?.team_id||null;
}
function dateReached(current,target){
  const a=parseISO(current).getTime();
  const b=parseISO(target).getTime();
  return Number.isFinite(a)&&Number.isFinite(b)&&a>=b;
}
function sessionWithPatch(sessions,id,patch){
  return (sessions||[]).map((row)=>String(row?.id)===String(id)?{...row,...patch}:row);
}
function targetGpForWeekend(weekend,gp){
  return gp||{
    gp_id:weekend.gp_id,
    gp_name:weekend.gp_name,
    track_id:weekend.track_id,
    race_date:weekend.raceDate,
  };
}
function competitiveSessions(weekend){
  return (weekend?.sessions||[]).filter((row)=>["prequalifying","qualifying"].includes(row?.type));
}
function phaseAfterCompetitiveSession(weekend,currentDate){
  const next=nextPendingCompetitiveSession(weekend);
  if(!next)return "grid_ready";
  return dateReached(currentDate,next.dateISO)?"qualifying":"qualifying_wait";
}

function applyQualifyingFatigue(gs,rows,sessionType){
  const cost=sessionType==="prequalifying"?2:3;
  const dict={...(gs?.driverAttributes||{})};
  for(const row of rows||[]){
    const did=driverIdOf(row);
    if(!did)continue;
    const current=driverCondition(gs,did);
    dict[did]={
      ...defaultDriverCondition(),
      ...current,
      fatigue:Math.max(0,Math.min(100,Number(current?.fatigue||0)+cost)),
    };
  }
  return {...gs,driverAttributes:dict};
}

export const RACE_WEEKEND_PHASES=Object.freeze([
  "practice",
  "practice_complete",
  "qualifying",
  "qualifying_wait",
  "grid_ready",
  "race",
  "results",
  "completed",
]);

export function raceWeekendSchedule(gp,ruleInput={}){
  const sessions=buildWeekendSessions(ruleInput,gp);
  return {
    ...weekendScheduleFromSessions(sessions),
    sessions,
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
  const qualifyingRule=resolveQualifyingRules(next,gp);
  const raceEntryState=buildRaceEntryState(next,{
    roundIndex,
    gp,
    teamEntryLimits:qualifyingRule.team_entry_limits,
  });
  const schedule=raceWeekendSchedule(gp,qualifyingRule);
  const strategyBuilt=createRaceStrategyState(next,{gp,raceEntryState});
  next=strategyBuilt.gameState;
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
    practiceDate:schedule.practiceDate,
    qualifyingDate:schedule.qualifyingDate,
    raceDate:schedule.raceDate,
    weekendStartDate:schedule.weekendStartDate,
    sessions:schedule.sessions,
    active_session_id:"practice",
    entrants:(raceEntryState.entries||[]).map((entry)=>({...entry})),
    qualifying_rule_snapshot:{...qualifyingRule},
    practice:null,
    practice_selections:{},
    qualifying:{
      status:"pending",
      strategy:qualifyingRule.strategy,
      session_count:qualifyingRule.session_count,
      max_starters:qualifyingRule.max_starters,
      classification:[],
    },
    grid_penalties:[],
    startingGrid:null,
    // Backwards-compatible read alias. The authoritative entity is startingGrid.
    grid:null,
    race_strategy:strategyBuilt.state,
    completed_at:null,
  };
  return {...next,raceEntryState,raceWeekendState:state};
}

export function weekendStateForCurrentRound(gs){
  return gs?.raceWeekendState||null;
}

export function syncRaceWeekendPhaseForDate(gs,dateISO=gs?.currentDateISO){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase==="completed")return gs;
  const date=clampISO(dateISO);
  let phase=weekend.phase;
  let activeSessionId=weekend.active_session_id;

  // Report phases are deliberate user-facing gates. Calendar ticks must not
  // skip Practice or Qualifying reports even when the next session is on the
  // same date.
  if(phase==="grid_ready"&&dateReached(date,weekend.raceDate)){
    phase="race";
    activeSessionId="race";
  }
  if(phase==="results"&&date>weekend.raceDate){
    phase="completed";
    activeSessionId=null;
  }

  if(phase===weekend.phase&&activeSessionId===weekend.active_session_id)return gs;
  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      phase,
      active_session_id:activeSessionId,
      completed_at:phase==="completed"?date:weekend.completed_at,
    },
  };
}

export function continueRaceWeekendSession(gs){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase==="completed")return gs;
  const date=clampISO(gs?.currentDateISO);

  if(["practice_complete","qualifying_wait"].includes(String(weekend.phase))){
    const next=nextPendingCompetitiveSession(weekend);
    if(next&&dateReached(date,next.dateISO)){
      return {
        ...gs,
        raceWeekendState:{
          ...weekend,
          phase:"qualifying",
          active_session_id:next.id,
        },
      };
    }
  }

  if(weekend.phase==="grid_ready"&&dateReached(date,weekend.raceDate)){
    return {
      ...gs,
      raceWeekendState:{
        ...weekend,
        phase:"race",
        active_session_id:"race",
      },
    };
  }

  return gs;
}

export function shouldCreateWeekendForDate(gs,{roundIndex,gp,dateISO}={}){
  if(!gp)return false;
  const rule=resolveQualifyingRules(gs,gp);
  const schedule=raceWeekendSchedule(gp,rule);
  const date=clampISO(dateISO||gs?.currentDateISO);
  if(!date||!schedule.raceDate)return false;
  if(date<schedule.weekendStartDate||date>schedule.raceDate)return false;
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

export function setRaceStrategy(gs,{driverId,patch}={}){
  return setRaceStrategySelectionState(gs,{driverId,patch});
}

export function startLiveRace(gs,{gp}={}){
  return createLiveRaceState(gs,{gp});
}

export function advanceLiveRaceSession(gs,{gp,laps=1}={}){
  return advanceLiveRace(gs,{gp,laps});
}

export function setLiveRaceCommand(gs,command={}){
  return issueLiveRaceCommand(gs,command);
}

export function resumeLiveRaceSession(gs){
  return resumeLiveRace(gs);
}

export function completePracticeSession(gs,{gp}={}){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase!=="practice")return gs;
  const targetGp=targetGpForWeekend(weekend,gp);
  const session=simulatePracticeSession(gs,{
    gp:targetGp,
    selections:weekend.practice_selections||{},
  });
  if(!session.practice)return gs;

  const sessions=sessionWithPatch(weekend.sessions,"practice",{
    status:"completed",
    completed_at:clampISO(gs?.currentDateISO),
  });
  const interim={...weekend,sessions};
  const nextCompetitive=nextPendingCompetitiveSession(interim);

  return {
    ...session.gameState,
    raceWeekendState:{
      ...interim,
      phase:"practice_complete",
      active_session_id:nextCompetitive?.id||"grid",
      practice_selections:weekend.practice_selections||{},
      practice:session.practice,
    },
  };
}

export function completeQualifyingSession(gs,{gp}={}){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase!=="qualifying")return gs;
  const current=currentQualifyingSession(weekend);
  if(!current||current.status==="completed")return gs;

  const roundIndex=Number(weekend.roundIndex)||0;
  const targetGp=targetGpForWeekend(weekend,gp);
  const eligibleDriverIds=qualifyingEntrantsForSession(weekend,current);
  const simulated=simulateQualifyingSession(gs,{
    roundIndex,
    gp:targetGp,
    raceEntryOverride:gs?.raceEntryState,
    sessionKey:`${weekend.key}-${current.id}`,
    eligibleDriverIds,
  });

  const sessionGameState=applyQualifyingFatigue(simulated.gameState,simulated.qualifying,current.type);

  let normalized=simulated.qualifying.map((row,index)=>({
    position:Number(row.pos??index+1),
    driver_id:driverIdOf(row),
    team_id:teamForDriver(simulated.raceEntryState,driverIdOf(row)),
    performance:Number(row.performance||0),
    lap_time_ms:Number(row.lap_time_ms||0),
  }));

  const rule=weekend.qualifying_rule_snapshot||resolveQualifyingRules(simulated.gameState,targetGp);
  let completedCurrent={
    ...current,
    status:"completed",
    completed_at:clampISO(gs?.currentDateISO),
    results:normalized,
  };

  const advanced=advancingDriverIds(completedCurrent,rule);
  if(current.type==="prequalifying"){
    const allowed=new Set(advanced);
    normalized=normalized.map((row)=>({...row,status:allowed.has(String(row.driver_id))?"ADVANCED":"DNPQ"}));
    completedCurrent={...completedCurrent,results:normalized};
  }else if(current.advance_count){
    const allowed=new Set(advanced);
    normalized=normalized.map((row)=>({...row,status:allowed.has(String(row.driver_id))?"ADVANCED":"ELIMINATED"}));
    completedCurrent={...completedCurrent,results:normalized};
  }

  let sessions=sessionWithPatch(weekend.sessions,current.id,completedCurrent);
  let interim={...weekend,sessions};

  const next=nextPendingCompetitiveSession(interim);
  if(next){
    const shouldRestrict=current.type==="prequalifying"||Boolean(current.advance_count);
    if(shouldRestrict){
      sessions=sessionWithPatch(sessions,next.id,{eligible_driver_ids:advanced});
      interim={...interim,sessions};
    }
    const phase="qualifying_wait";
    const qualifying={
      ...(weekend.qualifying||{}),
      status:"in_progress",
      completed_sessions:competitiveSessions(interim).filter((row)=>row.status==="completed").length,
      classification:weekend.qualifying?.classification||[],
    };
    return {
      ...sessionGameState,
      raceEntryState:simulated.raceEntryState,
      raceWeekendState:{
        ...interim,
        phase,
        active_session_id:next.id,
        qualifying,
      },
    };
  }

  const classification=buildQualifyingClassification(interim,rule);
  const startingGrid=buildStartingGrid(
    {...interim,currentDateISO:gs?.currentDateISO},
    classification,
    weekend.grid_penalties||[]
  );
  startingGrid.generated_at=clampISO(gs?.currentDateISO);

  sessions=sessionWithPatch(sessions,"grid",{
    status:"completed",
    completed_at:clampISO(gs?.currentDateISO),
    results:startingGrid.rows,
  });

  return {
    ...sessionGameState,
    raceEntryState:simulated.raceEntryState,
    raceWeekendState:{
      ...interim,
      sessions,
      phase:"grid_ready",
      active_session_id:"grid",
      qualifying:{
        ...(weekend.qualifying||{}),
        status:"completed",
        completed_at:clampISO(gs?.currentDateISO),
        strategy:rule.strategy,
        session_count:rule.session_count,
        max_starters:rule.max_starters,
        field_size:classification.length,
        cutoff_position:rule.max_starters,
        classification,
      },
      startingGrid,
      grid:startingGrid.rows,
    },
  };
}

export async function completeRaceSession(gs,{gp}={}){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase!=="race")return gs;
  if(weekend.live_race&&!liveRaceReadyToFinalize(gs))return gs;
  const targetGp=targetGpForWeekend(weekend,gp);
  const startingGridRows=weekend?.startingGrid?.rows||weekend?.grid||[];
  if(!startingGridRows.length)return gs;

  const next=await runRaceWeekend(gs,{
    roundIndex:Number(weekend.roundIndex)||0,
    gp:targetGp,
    startingGridOverride:startingGridRows,
    qualifyingClassificationOverride:weekend.qualifying?.classification||[],
    raceEntryOverride:gs?.raceEntryState,
  });
  const sessions=sessionWithPatch(weekend.sessions,"race",{
    status:"completed",
    completed_at:clampISO(next?.currentDateISO),
  });
  return {
    ...next,
    raceWeekendState:{
      ...weekend,
      sessions,
      phase:"results",
      active_session_id:"race",
      practice:weekend.practice,
      qualifying:weekend.qualifying,
      startingGrid:weekend.startingGrid,
      grid:startingGridRows,
      race_strategy:{
        ...(weekend.race_strategy||{}),
        status:"completed",
        race_summary:next?.lastRace?.strategySummary||null,
      },
      race_result_key:next?.lastRace?.resultKey||null,
      race_completed_at:clampISO(next?.currentDateISO),
    },
  };
}
