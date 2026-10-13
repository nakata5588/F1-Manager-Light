// src/race2/diagnostics/RaceBehaviourAudit.js
// RW11A: read-only diagnostics for canonical race behaviour.
// This module never mutates RaceState and never influences race physics.

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

const round=(value,digits=3)=>{
  const parsed=finite(value,null);
  return parsed==null?null:Number(parsed.toFixed(digits));
};

function countBy(values,keyOf){
  const counts={};
  for(const value of values||[]){
    const key=String(keyOf(value)??"unknown");
    counts[key]=(counts[key]||0)+1;
  }
  return counts;
}

function average(values){
  const rows=(values||[]).map((value)=>finite(value,null)).filter((value)=>value!=null);
  if(!rows.length)return null;
  return rows.reduce((sum,value)=>sum+value,0)/rows.length;
}

function minimum(values){
  const rows=(values||[]).map((value)=>finite(value,null)).filter((value)=>value!=null);
  return rows.length?Math.min(...rows):null;
}

function eventCount(events,type){
  return (events||[]).filter((event)=>String(event?.type||"")===type).length;
}

export function summarizeRaceBehaviour(state,{scenario=null,seed=null}={}){
  const events=Array.isArray(state?.events)?state.events:[];
  const cars=Array.isArray(state?.cars)?state.cars:[];
  const overtakeStarts=events.filter((event)=>event?.type==="overtake_started");
  const overtakeFailures=events.filter((event)=>event?.type==="overtake_failed");
  const pitServices=events.filter((event)=>event?.type==="pit_service_completed");
  const damageEvents=events.filter((event)=>event?.type==="damage");
  const controlEvents=events.filter((event)=>event?.type==="race_control_changed");
  const damagedCars=cars.filter((car)=>
    Array.isArray(car?.damage?.damaged_components)&&car.damage.damaged_components.length>0
  );
  const retiredCars=cars.filter((car)=>car?.dnf||String(car?.status||"").toLowerCase()==="dnf");
  const tyreConditions=cars.map((car)=>car?.tyre?.condition);
  const tyreWearPerLap=cars.map((car)=>car?.tyre?.wear_per_lap_pct);
  const tyreAges=cars.map((car)=>car?.tyre?.age_laps);
  const paceCounts=countBy(cars,(car)=>car?.resources?.paceMode??"unknown");

  return {
    scenario,
    seed:seed??state?.seed??null,
    status:state?.status??null,
    fieldSize:cars.length,
    tick:Math.max(0,Math.floor(finite(state?.tick,0))),
    raceTimeMs:Math.max(0,finite(state?.officialRaceTimeMs,finite(state?.simulationTimeMs,0))),
    eventTypes:countBy(events,(event)=>event?.type??"unknown"),
    overtakes:{
      attempts:overtakeStarts.length,
      completed:eventCount(events,"overtake_completed"),
      failed:overtakeFailures.length,
      aborted:eventCount(events,"overtake_aborted"),
      contacts:eventCount(events,"contact"),
      averageStartGapM:round(average(overtakeStarts.map((event)=>event?.payload?.gapM)),3),
      averageClosingPotentialMs:round(average(overtakeStarts.map((event)=>event?.payload?.closingPotentialMs)),3),
      averageDurationMs:round(average(overtakeStarts.map((event)=>event?.payload?.durationMs)),1),
      failureReasons:countBy(overtakeFailures,(event)=>event?.payload?.reason??"unknown"),
    },
    pits:{
      entries:eventCount(events,"pit_entry"),
      services:pitServices.length,
      exits:eventCount(events,"pit_exit"),
      repairs:pitServices.filter((event)=>
        Array.isArray(event?.payload?.repairedComponents)&&event.payload.repairedComponents.length>0
      ).length,
      doubleStacks:pitServices.filter((event)=>Boolean(event?.payload?.doubleStack)).length,
      crewErrors:pitServices.filter((event)=>Boolean(event?.payload?.crewError)).length,
      reasons:countBy(events.filter((event)=>event?.type==="pit_entry"),(event)=>event?.payload?.reason??"unknown"),
    },
    incidents:{
      contacts:eventCount(events,"contact"),
      accidents:eventCount(events,"accident"),
      mechanicalFailures:eventCount(events,"mechanical_failure"),
      damageEvents:damageEvents.length,
      retirements:eventCount(events,"retirement"),
      averageDamagePct:round(average(
        damageEvents.map((event)=>event?.payload?.damage?.overall_damage_pct)
      ),2),
    },
    finalState:{
      dnfs:retiredCars.length,
      carsCarryingDamage:damagedCars.length,
      averageDamagePct:round(average(damagedCars.map((car)=>car?.damage?.overall_damage_pct)),2),
      maxDamagePct:round(Math.max(0,...damagedCars.map((car)=>finite(car?.damage?.overall_damage_pct,0))),2),
    },
    tyres:{
      averageCondition:round(average(tyreConditions),2),
      minimumCondition:round(minimum(tyreConditions),2),
      averageWearPerLapPct:round(average(tyreWearPerLap),3),
      averageAgeLaps:round(average(tyreAges),2),
    },
    pace:paceCounts,
    raceControl:{
      changes:controlEvents.length,
      transitions:countBy(controlEvents,(event)=>
        `${String(event?.payload?.from||"UNKNOWN")}->${String(event?.payload?.to||"UNKNOWN")}`
      ),
      extensions:eventCount(events,"race_control_extended"),
    },
  };
}

function meanOf(summaries,selector){
  return round(average((summaries||[]).map(selector)),3);
}

export function aggregateRaceBehaviour(summaries=[]){
  const rows=(summaries||[]).filter(Boolean);
  return {
    runs:rows.length,
    overtakes:{
      attempts:meanOf(rows,(row)=>row?.overtakes?.attempts),
      completed:meanOf(rows,(row)=>row?.overtakes?.completed),
      failed:meanOf(rows,(row)=>row?.overtakes?.failed),
      contacts:meanOf(rows,(row)=>row?.overtakes?.contacts),
      averageStartGapM:meanOf(rows,(row)=>row?.overtakes?.averageStartGapM),
      averageClosingPotentialMs:meanOf(rows,(row)=>row?.overtakes?.averageClosingPotentialMs),
      averageDurationMs:meanOf(rows,(row)=>row?.overtakes?.averageDurationMs),
    },
    pits:{
      services:meanOf(rows,(row)=>row?.pits?.services),
      repairs:meanOf(rows,(row)=>row?.pits?.repairs),
      doubleStacks:meanOf(rows,(row)=>row?.pits?.doubleStacks),
    },
    incidents:{
      damageEvents:meanOf(rows,(row)=>row?.incidents?.damageEvents),
      retirements:meanOf(rows,(row)=>row?.incidents?.retirements),
    },
    finalState:{
      dnfs:meanOf(rows,(row)=>row?.finalState?.dnfs),
      carsCarryingDamage:meanOf(rows,(row)=>row?.finalState?.carsCarryingDamage),
    },
    tyres:{
      averageCondition:meanOf(rows,(row)=>row?.tyres?.averageCondition),
      minimumCondition:meanOf(rows,(row)=>row?.tyres?.minimumCondition),
      averageWearPerLapPct:meanOf(rows,(row)=>row?.tyres?.averageWearPerLapPct),
    },
    raceControl:{
      changes:meanOf(rows,(row)=>row?.raceControl?.changes),
    },
  };
}


// RW59: measure real green-flag gaps instead of treating a 20-minute Safety
// Car tail as a passing drought. This only reads canonical event history.
export function summarizeGreenFlagPassingWindows(state){
  const raceEndMs=Math.max(0,finite(state?.simulationTimeMs,0));
  const records=(state?.events||[])
    .filter(e=>e?.type==="overtake_started"||e?.type==="race_control_changed")
    .map((e,index)=>({event:e,index,time:Math.max(0,Math.min(raceEndMs,finite(e?.timeMs,0)))}))
    .sort((a,b)=>a.time-b.time||a.index-b.index);
  const attempts=records.filter(x=>x.event.type==="overtake_started").map(x=>x.time);
  const absoluteBoundaries=[0,...attempts,raceEndMs];
  let longestUnrestricted=null;
  const register=(existing,start,end)=>{
    const item={startMs:start,endMs:end,durationMs:Math.max(0,end-start)};
    return !existing||item.durationMs>existing.durationMs?item:existing;
  };
  for(let i=1;i<absoluteBoundaries.length;i++){
    longestUnrestricted=register(longestUnrestricted,absoluteBoundaries[i-1],absoluteBoundaries[i]);
  }

  let mode="GREEN",greenFlagStart=0,greenLastAttempt=0;
  let greenFlagDurationMs=0;
  let longestGreenFlag=null;
  for(const {event,time} of records){
    if(event.type==="overtake_started"){
      if(mode==="GREEN"){
        longestGreenFlag=register(longestGreenFlag,greenLastAttempt,time);
        greenLastAttempt=time;
      }
      continue;
    }
    const nextMode=String(event?.payload?.to||mode).toUpperCase();
    if(mode==="GREEN"&&nextMode!=="GREEN"){
      greenFlagDurationMs+=time-greenFlagStart;
      longestGreenFlag=register(longestGreenFlag,greenLastAttempt,time);
    }
    if(mode!=="GREEN"&&nextMode==="GREEN"){
      greenFlagStart=time;
      greenLastAttempt=time;
    }
    mode=nextMode;
  }
  if(mode==="GREEN"){
    greenFlagDurationMs+=raceEndMs-greenFlagStart;
    longestGreenFlag=register(longestGreenFlag,greenLastAttempt,raceEndMs);
  }
  return {
    raceEndMs,attempts:attempts.length,
    greenFlagDurationMs,
    neutralisedDurationMs:Math.max(0,raceEndMs-greenFlagDurationMs),
    longestUnrestrictedWindow:longestUnrestricted,
    longestGreenFlagWindow:longestGreenFlag,
    finalMode:mode,
  };
}
