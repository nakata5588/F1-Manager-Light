// src/engine/ProgressionEngine.js
import {
  ensureAbilityAnchor,
  recalculateCurrentAbility,
} from "../domain/driverRating.js";
import {
  appendDriverMentalStateLog,
  applyMentalStateDeltaToCondition,
  mentalStateCondition,
  passiveMentalStateRecovery,
} from "../domain/driverMentalState.js";
import { currentDriverTeamId } from "../domain/driverContracts.js";
import { academyProgramDefinition } from "../domain/academyPrograms.js";
import {
  driverAttributeGroups,
  driverAttributeGroupScore,
  driverDevelopmentFocus,
  driverGroupDevelopmentPlan,
} from "../domain/driverAttributeGroups.js";
import { dynamicPotentialAdjustment } from "../domain/driverPotential.js";
import {
  driverLifecycleSnapshot,
  driverMonthlyCareerDevelopmentPlan,
} from "../domain/driverLifecycle.js";

function clamp(n,a=0,b=100){return Math.max(a,Math.min(b,Number(n)||0));}
function today(gs){return String(gs?.currentDateISO||"").slice(0,10);}
function idOf(o){return String(o?.driver_id??o?.person_id??o?.id??"");}
function pick(o,keys,fb=undefined){
  for(const k of keys){
    const v=o?.[k];
    const u=v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
    if(u!==undefined&&u!==null&&u!=="")return u;
  }
  return fb;
}
function birthYear(driver){
  const raw=String(pick(driver,["dob","birthdate","date_of_birth"],""));
  const m=raw.match(/^(\d{4})/);
  return m?Number(m[1]):NaN;
}
function ageOf(driver,year){
  const explicit=Number(driver?.age);
  if(Number.isFinite(explicit))return explicit;
  const born=birthYear(driver);
  return Number.isFinite(born)?Math.max(0,Number(year)-born):28;
}
function simpleHash(text){
  let h=2166136261;
  for(const ch of String(text||"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return Math.abs(h>>>0);
}
function meanRevert(value,target=50,rate=0.025){
  const v=Number(value);
  if(!Number.isFinite(v))return target;
  return clamp(v+(target-v)*rate);
}
function pitCrewFacilityLevel(gs,teamId){
  const userTeam=String(gs?.team?.team_id??gs?.team?.id??"");
  if(String(teamId)===userTeam){
    const direct=Number(gs?.hq?.facilityLevels?.pitcrew_training_level);
    if(Number.isFinite(direct))return clamp(direct,1,10);
  }
  const year=Number(gs?.activeYear);
  const rows=Array.isArray(gs?.facilities)&&gs.facilities.length?gs.facilities:(gs?.dbFacilities||[]);
  const row=rows.find((r)=>
    String(pick(r,["team_id","team"],""))===String(teamId) &&
    (!Number.isFinite(Number(pick(r,["year","season_year"],year)))||Number(pick(r,["year","season_year"],year))===year)
  );
  const value=Number(pick(row||{},["pitcrew_training_level"],5));
  return Number.isFinite(value)?clamp(value,1,10):5;
}
function applyPitCrewTraining(gs,dateISO){
  const world=gs?.raceStrategyWorld;
  if(!world?.pitCrews||typeof world.pitCrews!=="object")return gs;
  const pitCrews={...world.pitCrews};
  let changed=false;
  for(const [teamId,raw] of Object.entries(pitCrews)){
    const crew={...(raw||{})};
    const load=clamp(Number(crew.training_load??50),0,100);
    const intensity=load/100;
    const facility=pitCrewFacilityLevel(gs,teamId);
    const facilityFactor=0.82+facility*0.036;
    const avg=Number(crew.avg_time_s??6.8);
    const consistency=Number(crew.consistency??70);
    const error=Number(crew.error_rate??0.05);

    const paceGain=Math.max(0,avg-2.2)*0.00055*intensity*facilityFactor;
    const consistencyGain=Math.max(0,100-consistency)*0.00045*intensity*facilityFactor;
    const errorGain=Math.max(0,error-0.005)*0.0017*intensity*facilityFactor;

    pitCrews[teamId]={
      ...crew,
      training_load:load,
      avg_time_s:Number(Math.max(2.2,avg-paceGain).toFixed(3)),
      consistency:Number(Math.min(100,consistency+consistencyGain).toFixed(3)),
      error_rate:Number(Math.max(0.005,error-errorGain).toFixed(5)),
      last_training_date:dateISO,
    };
    changed=true;
  }
  return changed?{...gs,raceStrategyWorld:{...world,pitCrews}}:gs;
}
function resolveDriverTeamId(gs,driverId){
  return currentDriverTeamId(gs,driverId);
}
function simulatorLevel(gs,teamId){
  const userTeam=String(gs?.team?.team_id??gs?.team?.id??"");
  if(teamId&&teamId===userTeam){
    const override=Number(gs?.hq?.facilityLevels?.simulator_level);
    if(Number.isFinite(override))return override;
  }
  const year=Number(gs?.activeYear);
  const row=(gs?.facilities||[]).find((r)=>
    String(pick(r,["team_id","team"],""))===String(teamId) &&
    (!Number.isFinite(Number(pick(r,["year","season_year"],year)))||Number(pick(r,["year","season_year"],year))===year)
  );
  const level=Number(pick(row||{},["simulator_level"],5));
  return Number.isFinite(level)?level:5;
}
function ageCurve(age){
  if(age<=19)return 0.20;
  if(age<=22)return 0.16;
  if(age<=25)return 0.10;
  if(age<=29)return 0.045;
  if(age<=32)return 0.015;
  // 33–34 is deliberately a plateau. Age only becomes a negative permanent
  // development force from 35 onwards; young drivers never regress just by
  // moving from one birthday to the next.
  if(age<=34)return 0;
  if(age<=36)return -0.025;
  if(age<=39)return -0.060;
  return -0.10;
}
const GROWTH_ATTRS=[
  "pace","qualifying","racecraft","consistency","tire_management",
  "race_intelligence","pressure_handling","adaptability","mentality","technical_feedback",
];
const DECLINE_ATTRS=["pace","qualifying","start_launch","adaptability","consistency"];
const ATTRIBUTE_MULTIPLIER={
  pace:1.00,qualifying:0.90,racecraft:0.90,consistency:0.80,tire_management:0.65,
  race_intelligence:0.70,pressure_handling:0.55,adaptability:0.60,mentality:0.55,
  technical_feedback:0.50,start_launch:0.85,
};

function academySupportEntry(gs,driverId){
  return (gs?.academy?.drivers||[]).find((row)=>
    String(row?.driver_id??row?.person_id??row?.id??"")===String(driverId) &&
    String(row?.status??"active").toLowerCase()!=="inactive"
  )||null;
}
function youthProgrammeLevel(gs){
  const direct=Number(gs?.hq?.facilityLevels?.youth_program_level);
  if(Number.isFinite(direct))return clamp(direct,0,10);
  const year=Number(gs?.activeYear);
  const teamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const row=(gs?.facilities||gs?.dbFacilities||[]).find((r)=>
    String(pick(r,["team_id","team"],""))===teamId &&
    (!Number.isFinite(Number(pick(r,["year","season_year"],year)))||Number(pick(r,["year","season_year"],year))===year)
  );
  const value=Number(pick(row||{},["youth_program_level"],0));
  return Number.isFinite(value)?clamp(value,0,10):0;
}

function applyDelta(rating,key,delta,changes,driverId,dateISO,source){
  if(!Number.isFinite(Number(rating?.[key]))||!Number.isFinite(Number(delta))||Math.abs(delta)<0.001)return;
  const before=Number(rating[key]);
  const after=Math.round(clamp(before+delta)*100)/100;
  if(after===before)return;
  rating[key]=after;
  changes.push({dateISO,driverId,attr:key,before,after,delta:after-before,source});
}

function monthlyProgression(gs,ratings,dateISO,{trainingLedger={}}={}){
  const year=Number(gs?.activeYear);
  const monthKey=dateISO.slice(0,7);
  const driversById=new Map((gs?.drivers||[]).map((d)=>[idOf(d),d]));
  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const changes=[];
  const potentialChanges=[];
  const lifecycleUpdates=[];
  const abilityChanges=[];
  const nextRatings=(ratings||[]).map((raw)=>{
    const did=idOf(raw);
    const driver=driversById.get(did);
    if(!driver)return raw;

    let rating=ensureAbilityAnchor({...raw});
    const abilityBefore=Number(rating.current_ability);
    const driverChangeStart=changes.length;
    const age=ageOf(driver,year);
    const current=Number(rating.current_ability||0);
    const potential=Number(rating.potential_ability);
    const gap=Number.isFinite(potential)?Math.max(0,potential-current):10;
    const teamId=resolveDriverTeamId(gs,did);
    const sim=simulatorLevel(gs,teamId);
    const curve=ageCurve(age);
    const facilityFactor=0.80+Math.max(0,Math.min(10,sim))*0.035;

    if(curve>=0){
      const potentialFactor=Math.max(0.15,Math.min(1.35,gap/12||0.15));
      const base=curve*facilityFactor*potentialFactor;
      const offset=simpleHash(`${monthKey}:${did}:growth`)%GROWTH_ATTRS.length;
      for(let i=0;i<3;i++){
        const key=GROWTH_ATTRS[(offset+i*3)%GROWTH_ATTRS.length];
        applyDelta(rating,key,base*(ATTRIBUTE_MULTIPLIER[key]||0.6),changes,did,dateISO,"natural_development");
      }
    }else{
      const base=Math.abs(curve);
      for(const key of DECLINE_ATTRS){
        applyDelta(rating,key,-base*(ATTRIBUTE_MULTIPLIER[key]||0.7),changes,did,dateISO,"age_regression");
      }
    }

    // D5 career effects are event-based. Only the previous month's played
    // races/injuries are consumed here, so the same result cannot be rewarded
    // or punished repeatedly for the rest of the season.
    const careerPlan=driverMonthlyCareerDevelopmentPlan(gs,did,rating,dateISO);
    for(const item of careerPlan.changes){
      applyDelta(rating,item.attr,item.delta,changes,did,dateISO,item.source);
    }

    // Development focus is a persistent monthly choice. The same potential-
    // bounded group model is used for the player and AI so neither side can
    // spam individual attributes toward 100.
    let developmentGroup=null;
    let developmentSource=null;
    let developmentGain=0;

    let developmentTrainingDays=0;
    if(teamId && teamId===userTeamId){
      const ledger=trainingLedger?.[did]||trainingLedger?.[String(did).match(/(\d+)/)?.[1]?.padStart(4,"0")]||null;
      if(ledger&&String(ledger?.monthKey||"")!==monthKey){
        developmentGroup=ledger?.groupKey||null;
        developmentTrainingDays=Math.max(0,Number(ledger?.trainingDays)||0);
      }
      developmentSource=developmentGroup?`development_focus_${developmentGroup}`:null;
      const attendance=Math.max(0,Math.min(1,developmentTrainingDays/18));
      developmentGain=0.44*attendance*(0.90+Math.max(0,Math.min(10,sim))*0.02)*(age<=32?1:0.60);
    }else if(teamId){
      const available=driverAttributeGroups()
        .map((group)=>({key:group.key,score:driverAttributeGroupScore(rating,group.key)}))
        .filter((row)=>Number.isFinite(Number(row.score)))
        .sort((a,b)=>Number(a.score)-Number(b.score)||a.key.localeCompare(b.key));
      developmentGroup=available[0]?.key||null;
      developmentSource=developmentGroup?`ai_development_${developmentGroup}`:null;
      developmentGain=0.24*(0.90+Math.max(0,Math.min(10,sim))*0.02)*(age<=32?1:0.55);
    }

    if(developmentGroup&&developmentGain>0){
      const plan=driverGroupDevelopmentPlan(rating,developmentGroup,{baseGain:developmentGain});
      for(const item of plan){
        const actualKey=(item.aliases||[item.field]).find((key)=>Number.isFinite(Number(rating?.[key])))||item.field;
        applyDelta(rating,actualKey,item.delta,changes,did,dateISO,developmentSource);
      }
    }

    const academyEntry=academySupportEntry(gs,did);
    if(academyEntry){
      const plan=String(academyEntry.program||"General Development");
      const deltas=academyProgramDefinition(plan).deltas;
      const youthLevel=youthProgrammeLevel(gs);
      const formal=String(academyEntry.mode||"").toLowerCase()==="academy";
      const supportFactor=formal
        ?Math.max(0.85,Math.min(1.35,0.90+youthLevel*0.045))
        :0.68;
      const ageFactor=age<=22?1:age<=25?0.75:0.45;
      for(const [key,delta] of Object.entries(deltas)){
        applyDelta(rating,key,delta*supportFactor*ageFactor,changes,did,dateISO,"academy_"+plan.toLowerCase().replaceAll(" ","_"));
      }
    }

    rating=recalculateCurrentAbility(rating);

    const priorProgressionExists=Boolean(gs?._lastDriverProgressionMonth);
    const potentialTrainingDays=teamId===userTeamId
      ?developmentTrainingDays
      :(teamId?14:0);
    if(priorProgressionExists||potentialTrainingDays>0){
      const adjusted=dynamicPotentialAdjustment(
        {...gs,currentDateISO:dateISO},
        rating,
        did,
        {trainingDays:potentialTrainingDays,focusKey:developmentGroup}
      );
      rating=adjusted.rating;
      if(adjusted.change)potentialChanges.push(adjusted.change);
    }

    const driverChanges=changes.slice(driverChangeStart);
    const logKey=String(did||"").match(/(\d+)/)?.[1]?.padStart(4,"0")||String(did||"");
    const lifecycle=driverLifecycleSnapshot(
      {
        ...gs,
        currentDateISO:dateISO,
        driverAttrLog:{
          ...(gs?.driverAttrLog||{}),
          [logKey]:[...((gs?.driverAttrLog||{})[logKey]||[]),...driverChanges],
        },
      },
      driver,
      rating,
      {dateISO}
    );
    const previousStage=gs?.driverLifecycle?.[did]?.stage||null;
    lifecycleUpdates.push({
      driverId:did,
      state:{
        ...lifecycle,
        enteredAt:previousStage===lifecycle.stage
          ?gs?.driverLifecycle?.[did]?.enteredAt||dateISO
          :dateISO,
        previousStage,
      },
    });

    const abilityAfter=Number(rating.current_ability);
    abilityChanges.push({
      dateISO,
      driverId:did,
      before:Number.isFinite(abilityBefore)?abilityBefore:null,
      after:Number.isFinite(abilityAfter)?abilityAfter:null,
      delta:Number.isFinite(abilityBefore)&&Number.isFinite(abilityAfter)
        ?Math.round((abilityAfter-abilityBefore)*100)/100
        :null,
      stage:lifecycle.stage,
      trajectory:lifecycle.trajectory,
      sources:[...new Set(driverChanges.map((row)=>row.source).filter(Boolean))],
      reasons:[...careerPlan.reasons],
    });

    return rating;
  });

  return {
    ratings:nextRatings,
    changes,
    potentialChanges,
    lifecycleUpdates,
    abilityChanges,
    monthKey,
  };
}

function applyPlayerDevelopmentLoad(gs,dateISO){
  const teamId=String(gs?.team?.team_id??gs?.team?.id??"");
  if(!teamId)return gs;

  // Race-weekend duties replace normal weekday development training.
  const weekend=gs?.raceWeekendState;
  const weekendStart=String(weekend?.weekendStartDate||weekend?.practiceDate||"").slice(0,10);
  const weekendEnd=String(weekend?.raceDate||"").slice(0,10);
  const activeWeekend=Boolean(
    weekend&&
    String(weekend?.phase||"")!=="completed"&&
    weekendStart&&weekendEnd&&
    dateISO>=weekendStart&&dateISO<=weekendEnd
  );
  if(activeWeekend)return gs;

  const monthKey=dateISO.slice(0,7);
  const dow=new Date(`${dateISO}T00:00:00Z`).getUTCDay();
  const trainingDay=dow>=1&&dow<=5;
  const conditions={...(gs?.driverAttributes||{})};
  const ledger={...(gs?.driverDevelopmentTraining||{})};
  const focusMeta={...(gs?.driverDevelopmentFocusMeta||{})};
  let mentalStateLog={...(gs?.driverMentalStateLog||{})};

  for(const driver of gs?.drivers||[]){
    const did=idOf(driver);
    if(!did||resolveDriverTeamId(gs,did)!==teamId)continue;
    const groupKey=driverDevelopmentFocus(gs,did);
    if(!groupKey)continue;

    const previous=ledger[did]&&ledger[did].monthKey===monthKey
      ?{...ledger[did]}
      :{monthKey,groupKey,trainingDays:0,fatigueSpent:0,lastTrainingDate:null};
    previous.groupKey=groupKey;

    // If the focus was carried over from the previous month, the first
    // training day automatically commits it for the new month. This prevents
    // switching groups halfway through a month's accumulated workload.
    if(trainingDay&&String(focusMeta?.[did]?.monthKey||"")!==monthKey){
      focusMeta[did]={groupKey,monthKey,selectedAt:dateISO,autoCarried:true};
    }
    if(!trainingDay||previous.lastTrainingDate===dateISO){
      ledger[did]=previous;
      continue;
    }

    const current=mentalStateCondition(conditions[did]);
    const load=2.0;
    const nextCondition=applyMentalStateDeltaToCondition(current,{fatigue:load});
    conditions[did]=nextCondition;
    mentalStateLog=appendDriverMentalStateLog(mentalStateLog,did,{
      before:current,
      after:nextCondition,
      source:"development_training",
      reason:`${groupKey} development training`,
      dateISO,
      meta:{group_key:groupKey,fatigue_cost:load},
    });
    ledger[did]={
      ...previous,
      trainingDays:Number(previous.trainingDays||0)+1,
      fatigueSpent:Math.round((Number(previous.fatigueSpent||0)+load)*10)/10,
      lastTrainingDate:dateISO,
    };
  }

  return {
    ...gs,
    driverAttributes:conditions,
    driverMentalStateLog:mentalStateLog,
    driverDevelopmentTraining:ledger,
    driverDevelopmentFocusMeta:focusMeta,
  };
}

export function applyProgressionTick(gs){
  let next={...gs};
  const dateISO=today(gs);
  if(!dateISO)return next;

  const dict={...(gs.driverAttributes||{})};
  for(const d of gs.drivers||[]){
    const id=idOf(d);
    if(!id)continue;
    const curr=mentalStateCondition(dict[id]);
    dict[id]=passiveMentalStateRecovery(curr,{dateISO});
  }
  next.driverAttributes=dict;

  // Team operational morale is persistent but not permanent. Away from race
  // shocks it slowly returns toward neutral so one bad weekend cannot damage
  // technical throughput for the rest of the season.
  if(next?.teamOperationalState&&typeof next.teamOperationalState==="object"){
    const operational={...next.teamOperationalState};
    for(const [teamId,row] of Object.entries(operational)){
      const morale=Number(row?.morale);
      if(!Number.isFinite(morale))continue;
      operational[teamId]={
        ...row,
        morale:Math.round(meanRevert(morale,50,0.010)*10)/10,
      };
    }
    next.teamOperationalState=operational;
  }

  const afterPitCrew=applyPitCrewTraining(next,dateISO);
  next.raceStrategyWorld=afterPitCrew.raceStrategyWorld;

  const monthKey=dateISO.slice(0,7);
  if(gs?._lastDriverProgressionMonth!==monthKey){
    const {
      ratings,
      changes,
      potentialChanges,
      lifecycleUpdates,
      abilityChanges,
    }=monthlyProgression(
      next,
      gs.driverRatings||[],
      dateISO,
      {trainingLedger:gs?.driverDevelopmentTraining||{}}
    );
    next.driverRatings=ratings;
    next._lastDriverProgressionMonth=monthKey;

    if(changes.length){
      const log={...(gs.driverAttrLog||{})};
      for(const ch of changes){
        const digits=String(ch.driverId||"").match(/(\d+)/)?.[1]?.padStart(4,"0")||String(ch.driverId||"");
        log[digits]=[...(log[digits]||[]),ch].slice(-200);
      }
      next.driverAttrLog=log;
    }

    if(potentialChanges.length){
      const potentialLog={...(gs.driverPotentialLog||{})};
      for(const ch of potentialChanges){
        const key=String(ch.driverId||"");
        potentialLog[key]=[...(potentialLog[key]||[]),ch].slice(-120);
      }
      next.driverPotentialLog=potentialLog;
    }

    if(lifecycleUpdates.length){
      const lifecycle={...(gs?.driverLifecycle||{})};
      const lifecycleLog={...(gs?.driverLifecycleLog||{})};
      for(const update of lifecycleUpdates){
        lifecycle[update.driverId]=update.state;
        lifecycleLog[update.driverId]=[
          ...(lifecycleLog[update.driverId]||[]),
          update.state,
        ].slice(-120);
      }
      next.driverLifecycle=lifecycle;
      next.driverLifecycleLog=lifecycleLog;
    }

    if(abilityChanges.length){
      const abilityLog={...(gs?.driverAbilityLog||{})};
      for(const ch of abilityChanges){
        abilityLog[ch.driverId]=[
          ...(abilityLog[ch.driverId]||[]),
          ch,
        ].slice(-120);
      }
      next.driverAbilityLog=abilityLog;
    }
  }

  next=applyPlayerDevelopmentLoad(next,dateISO);
  return next;
}
