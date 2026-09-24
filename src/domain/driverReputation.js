// src/domain/driverReputation.js
// D6.2 — dynamic Save World reputation.
//
// Reputation is public/paddock standing, not driving talent. Race outcomes may
// move it gradually, but it never feeds Overall or permanent driver ability.

import { driverPerformanceEntries } from "./driverForm.js";

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const round1=(value)=>Math.round(Number(value||0)*10)/10;
const rows=(value)=>Array.isArray(value)?value:[];

function normId(value){
  const raw=String(value??"");
  const digits=raw.match(/(\d+)/)?.[1];
  return digits?digits.padStart(4,"0"):raw.toLowerCase();
}
function sameId(a,b){return Boolean(normId(a)&&normId(a)===normId(b));}
function driverIdOf(row){return String(row?.driver_id??row?.driver?.driver_id??row?.id??"");}
function num(value,fb=null){const n=Number(value);return Number.isFinite(n)?n:fb;}

function expectationDelta(entry){
  if(!entry||entry?.retired)return null;
  const explicit=num(entry?.expectation_delta);
  if(Number.isFinite(explicit))return explicit;
  const expected=num(entry?.expected_finish);
  const finish=num(entry?.finish_position);
  return Number.isFinite(expected)&&Number.isFinite(finish)?expected-finish:null;
}

function expectationStreak(recentEntries,currentDelta){
  if(!Number.isFinite(currentDelta)||Math.abs(currentDelta)<1.5)return 0;
  const previous=rows(recentEntries)
    .slice()
    .sort((a,b)=>String(b?.dateISO||"").localeCompare(String(a?.dateISO||""))||num(b?.round,0)-num(a?.round,0))
    .map(expectationDelta)
    .filter(Number.isFinite)
    .slice(0,2);
  if(previous.length<2)return 0;
  const sequence=[currentDelta,...previous];
  if(sequence.every((value)=>value>=1.5))return 1;
  if(sequence.every((value)=>value<=-1.5))return -1;
  return 0;
}

export function raceReputationChange({
  reputation=50,
  evaluation=null,
  recentEntries=[],
}={}){
  const before=clamp(num(reputation,50));
  if(!evaluation)return {before,after:before,delta:0,reasons:[]};

  const retirement=String(evaluation?.retirement_responsibility||"").toLowerCase();
  if(evaluation?.retired&&["mechanical","unknown"].includes(retirement)){
    return {
      before,
      after:before,
      delta:0,
      reasons:[retirement==="mechanical"?"Mechanical retirement is reputation-neutral":"Unattributed retirement is reputation-neutral"],
    };
  }

  let rawDelta=0;
  const reasons=[];

  if(evaluation?.retired){
    if(retirement==="driver_error"){
      rawDelta-=0.9;
      reasons.push("Driver-error retirement");
    }else if(retirement==="racing_incident"){
      rawDelta-=0.35;
      reasons.push("Racing-incident retirement");
    }
  }else{
    const expectedDelta=expectationDelta(evaluation);
    if(Number.isFinite(expectedDelta)&&Math.abs(expectedDelta)>=0.75){
      const contribution=Math.max(-0.85,Math.min(0.85,expectedDelta*0.14));
      rawDelta+=contribution;
      reasons.push(
        expectedDelta>0
          ?`Outperformed car expectation by ${expectedDelta.toFixed(1)} position(s)`
          :`Underperformed car expectation by ${Math.abs(expectedDelta).toFixed(1)} position(s)`
      );
    }

    const teammateDelta=num(evaluation?.teammate_race_delta);
    if(Number.isFinite(teammateDelta)&&Math.abs(teammateDelta)>=0.5){
      rawDelta+=Math.max(-0.30,Math.min(0.30,teammateDelta*0.07));
      reasons.push(
        teammateDelta>0
          ?`Finished ahead of team-mate by ${Math.abs(teammateDelta).toFixed(0)} position(s)`
          :`Finished behind team-mate by ${Math.abs(teammateDelta).toFixed(0)} position(s)`
      );
    }

    const teammateQualifyingDelta=num(evaluation?.teammate_qualifying_delta);
    if(Number.isFinite(teammateQualifyingDelta)&&Math.abs(teammateQualifyingDelta)>=1){
      rawDelta+=Math.max(-0.10,Math.min(0.10,teammateQualifyingDelta*0.025));
    }

    const finish=num(evaluation?.finish_position);
    if(finish===1){
      rawDelta+=0.65;
      reasons.push("Race win");
    }else if(Number.isFinite(finish)&&finish<=3){
      rawDelta+=0.30;
      reasons.push(`Podium P${finish}`);
    }

    const streak=expectationStreak(recentEntries,expectedDelta);
    if(streak>0){
      rawDelta+=0.35;
      reasons.push("Three-race run above expectations");
    }else if(streak<0){
      rawDelta-=0.40;
      reasons.push("Three-race run below expectations");
    }
  }

  // Established stars gain reputation more slowly and have more to lose;
  // emerging drivers can build standing faster through genuine overperformance.
  const compression=rawDelta>=0
    ?Math.max(0.55,Math.min(1,1.10-before/180))
    :Math.max(0.85,Math.min(1.25,0.85+before/250));
  const delta=round1(Math.max(-1.5,Math.min(1.5,rawDelta*compression)));
  const after=round1(clamp(before+delta));

  return {before:round1(before),after,delta,reasons};
}

export function applyRaceReputation(gs,resultEntry){
  if(!gs||!resultEntry)return {gameState:gs,resultEntry};

  const active=rows(gs?.driverRatings).map((row)=>({...row}));
  const seed=rows(gs?.dbDriverRatings);
  const logs={...(gs?.driverReputationLog||{})};
  const changes=new Map();

  const ensureRating=(driverId)=>{
    let index=active.findIndex((row)=>sameId(driverIdOf(row),driverId));
    if(index>=0)return {index,rating:active[index]};
    const historical=seed.find((row)=>sameId(driverIdOf(row),driverId));
    if(!historical)return null;
    active.push({...historical});
    index=active.length-1;
    return {index,rating:active[index]};
  };

  for(const row of rows(resultEntry?.classification)){
    const driverId=driverIdOf(row);
    const evaluation=row?.driver_performance;
    if(!driverId||!evaluation)continue;

    const ratingRef=ensureRating(driverId);
    if(!ratingRef)continue;
    const previous=driverPerformanceEntries(gs,driverId)
      .filter((entry)=>
        String(entry?.year)!==String(evaluation?.year)||
        String(entry?.round)!==String(evaluation?.round)
      );

    const currentRep=num(ratingRef.rating?.reputation,num(ratingRef.rating?.current_ability,50));
    const change=raceReputationChange({
      reputation:currentRep,
      evaluation,
      recentEntries:previous,
    });

    if(change.delta!==0){
      active[ratingRef.index]={...ratingRef.rating,reputation:change.after};
      const key=String(driverId);
      logs[key]=[
        ...(logs[key]||[]),
        {
          dateISO:evaluation?.dateISO??gs?.currentDateISO??null,
          year:evaluation?.year??gs?.activeYear??null,
          round:evaluation?.round??null,
          gp_id:evaluation?.gp_id??null,
          gp_name:evaluation?.gp_name??null,
          before:change.before,
          after:change.after,
          delta:change.delta,
          reasons:change.reasons,
        },
      ].slice(-120);
    }

    changes.set(normId(driverId),change);
  }

  const enriched={
    ...resultEntry,
    classification:rows(resultEntry?.classification).map((row)=>{
      const change=changes.get(normId(driverIdOf(row)));
      return change?{...row,driver_reputation:change}:{...row};
    }),
  };

  return {
    gameState:{
      ...gs,
      driverRatings:active,
      driverReputationLog:logs,
    },
    resultEntry:enriched,
  };
}

export function driverReputationHistory(gs,driverId,{limit=12}={}){
  const wanted=normId(driverId);
  const entries=[];
  for(const [key,list] of Object.entries(gs?.driverReputationLog||{})){
    if(normId(key)!==wanted)continue;
    for(const row of rows(list))entries.push(row);
  }
  return entries
    .slice()
    .sort((a,b)=>String(b?.dateISO||"").localeCompare(String(a?.dateISO||""))||num(b?.round,0)-num(a?.round,0))
    .slice(0,Math.max(1,Number(limit)||12));
}
