// src/domain/driverForm.js
// Race-by-race driver evaluation and rolling Form.
// Form evaluates what the driver did with the machinery available; it is not
// another permanent attribute and must not feed directly into Overall.

import { carPerformanceRanking } from "./carPerformance.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const round1=(v)=>Math.round(Number(v||0)*10)/10;
const rows=(v)=>Array.isArray(v)?v:[];

function normId(value){
  const raw=String(value??"");
  const m=raw.match(/(\d+)/);
  return m?m[1].padStart(4,"0"):raw;
}
function sameId(a,b){return Boolean(normId(a)&&normId(a)===normId(b));}
function driverIdOf(row){return String(row?.driver_id??row?.driver?.driver_id??row?.id??"");}
function teamIdOf(row){return String(row?.team_id??row?.constructor_id??row?.driver?.team_id??"");}
function num(v,fb=null){const n=Number(v);return Number.isFinite(n)?n:fb;}

export function retirementResponsibility(reasonInput){
  const reason=String(reasonInput||"").toLowerCase();
  if(!reason)return {key:"unknown",label:"Retirement",penalty:-2};
  if(/engine|gearbox|transmission|electrical|cooling|fuel|hydraulic|suspension|brake|turbo|oil|fire|mechanical|power unit|driveshaft|clutch/.test(reason)){
    return {key:"mechanical",label:"Mechanical retirement",penalty:0};
  }
  if(/accident|crash|spin|spun|driver error|mistake/.test(reason)){
    return {key:"driver_error",label:"Driver-error retirement",penalty:-14};
  }
  if(/collision|contact/.test(reason)){
    return {key:"racing_incident",label:"Racing-incident retirement",penalty:-7};
  }
  return {key:"unknown",label:"Retirement",penalty:-2};
}

function participantTeams(resultEntry){
  return [...new Set(rows(resultEntry?.classification).map(teamIdOf).filter(Boolean))];
}

function carExpectation(gs,resultEntry,teamId){
  const fieldSize=Math.max(1,rows(resultEntry?.classification).length);
  const teams=participantTeams(resultEntry);
  const teamCount=Math.max(1,teams.length);
  const ranking=carPerformanceRanking(gs)
    .filter((row)=>teams.includes(String(row?.team_id??"")))
    .map((row,index)=>({...row,rank:index+1}));
  const rankRow=ranking.find((row)=>String(row?.team_id??"")===String(teamId));
  const rank=rankRow?.rank??Math.ceil(teamCount/2);
  const slotsPerTeam=fieldSize/teamCount;
  const expected=(rank-0.5)*slotsPerTeam+0.5;
  return {
    teamRank:rank,
    teamCount,
    carScore:num(rankRow?.overall,70),
    expectedPosition:round1(clamp(expected,1,fieldSize)),
  };
}

function rowForDriver(list,driverId){
  return rows(list).find((row)=>sameId(driverIdOf(row),driverId))||null;
}
function teammateRow(list,driverId,teamId){
  return rows(list).find((row)=>teamIdOf(row)===String(teamId)&&!sameId(driverIdOf(row),driverId))||null;
}

function pushFactor(factors,key,value,message,tone=null){
  if(!Number.isFinite(Number(value))||Math.abs(Number(value))<0.01)return;
  factors.push({key,value:round1(value),message,tone:tone||(value>0?"positive":value<0?"negative":"neutral")});
}

export function evaluateDriverRacePerformance(gs,resultEntry,driverId){
  const race=rowForDriver(resultEntry?.classification,driverId);
  if(!race)return null;
  const teamId=teamIdOf(race);
  const qualifying=rowForDriver(resultEntry?.qualifying,driverId);
  const grid=rowForDriver(resultEntry?.startingGrid,driverId);
  const teamRace=teammateRow(resultEntry?.classification,driverId,teamId);
  const raceTeammateDriverId=driverIdOf(teamRace)||null;
  // Race Weekend qualifying classifications can omit team_id. Once the
  // teammate is known from the race classification, match qualifying by
  // driver identity instead of requiring team_id to be repeated there.
  const teamQual=raceTeammateDriverId
    ?rowForDriver(resultEntry?.qualifying,raceTeammateDriverId)
    :teammateRow(resultEntry?.qualifying,driverId,teamId);
  const expectation=carExpectation(gs,resultEntry,teamId);
  const finish=num(race?.position);
  const gridPosition=num(grid?.grid??qualifying?.position);
  const qualifyingPosition=num(qualifying?.position);
  const retired=Boolean(race?.retired)||String(race?.status||"").toUpperCase()==="DNF";
  const retirement=retired?retirementResponsibility(race?.retirement_reason):null;
  let teammateQualifyingDelta=null;
  let teammateRaceDelta=null;
  let teammateDriverId=raceTeammateDriverId||driverIdOf(teamQual)||null;

  let score=65;
  const factors=[];

  if(Number.isFinite(qualifyingPosition)){
    const delta=clamp(expectation.expectedPosition-qualifyingPosition,-5,5);
    const effect=delta*1.25;
    score+=effect;
    pushFactor(
      factors,
      "qualifying_vs_car",
      effect,
      delta>0
        ?`Qualified P${qualifyingPosition}, ahead of the car's ~P${expectation.expectedPosition.toFixed(1)} baseline.`
        :delta<0
          ?`Qualified P${qualifyingPosition}, below the car's ~P${expectation.expectedPosition.toFixed(1)} baseline.`
          :"Qualified in line with the car's expected level."
    );
  }

  if(teamQual&&Number.isFinite(qualifyingPosition)){
    const matePos=num(teamQual?.position);
    if(Number.isFinite(matePos)){
      const diff=clamp(matePos-qualifyingPosition,-4,4);
      teammateQualifyingDelta=round1(diff);
      const effect=diff*0.9;
      score+=effect;
      pushFactor(
        factors,
        "qualifying_vs_teammate",
        effect,
        diff>0?`Out-qualified the team-mate by ${Math.abs(diff)} position(s).`:
          diff<0?`Was out-qualified by the team-mate by ${Math.abs(diff)} position(s).`:
          "Matched the team-mate in qualifying."
      );
    }
  }

  if(retired&&retirement?.key==="mechanical"){
    factors.push({
      key:"mechanical_dnf",
      value:0,
      tone:"neutral",
      message:`${retirement.label}: race-result penalties are neutralised for Form.`,
    });
  }else{
    if(Number.isFinite(finish)){
      const resultDelta=clamp(expectation.expectedPosition-finish,-6,6);
      const resultEffect=resultDelta*1.9;
      score+=resultEffect;
      pushFactor(
        factors,
        "result_vs_car",
        resultEffect,
        resultDelta>0
          ?`Finished P${finish} with machinery expected around P${expectation.expectedPosition.toFixed(1)}.`
          :resultDelta<0
            ?`Finished P${finish}, below the car's ~P${expectation.expectedPosition.toFixed(1)} baseline.`
            :"Finished close to the car's expected level."
      );

      if(Number.isFinite(gridPosition)&&!retired){
        const gain=clamp(gridPosition-finish,-6,6);
        const effect=gain*0.8;
        score+=effect;
        pushFactor(
          factors,
          "positions_gained",
          effect,
          gain>0?`Gained ${Math.abs(gain)} position(s) from the grid.`:
            gain<0?`Lost ${Math.abs(gain)} position(s) from the grid.`:
            "Finished in the starting position."
        );
      }
    }

    if(teamRace&&Number.isFinite(finish)){
      const mateRetired=Boolean(teamRace?.retired)||String(teamRace?.status||"").toUpperCase()==="DNF";
      const mateResponsibility=mateRetired?retirementResponsibility(teamRace?.retirement_reason):null;
      const mateFinish=num(teamRace?.position);
      if(Number.isFinite(mateFinish)&&(!mateRetired||mateResponsibility?.key!=="mechanical")){
        const diff=clamp(mateFinish-finish,-5,5);
        teammateRaceDelta=round1(diff);
        const effect=diff*1.0;
        score+=effect;
        pushFactor(
          factors,
          "race_vs_teammate",
          effect,
          diff>0?`Finished ${Math.abs(diff)} position(s) ahead of the team-mate.`:
            diff<0?`Finished ${Math.abs(diff)} position(s) behind the team-mate.`:
            "Matched the team-mate's race result."
        );
      }
    }
  }

  if(retired&&retirement){
    score+=retirement.penalty;
    if(retirement.penalty<0){
      pushFactor(
        factors,
        retirement.key,
        retirement.penalty,
        retirement.key==="driver_error"
          ?`${retirement.label}: ${race?.retirement_reason||"incident"}.`
          :retirement.key==="racing_incident"
            ?`Racing incident: ${race?.retirement_reason||"contact"}.`
            :`Retired: ${race?.retirement_reason||"unknown cause"}.`
      );
    }
  }else if(finish===1){
    score+=4;
    pushFactor(factors,"win",4,"Won the race.");
  }else if(Number.isFinite(finish)&&finish<=3){
    score+=2;
    pushFactor(factors,"podium",2,`Finished on the podium in P${finish}.`);
  }

  score=round1(clamp(score,25,98));
  return {
    driver_id:driverId,
    team_id:teamId||null,
    year:Number(resultEntry?.year)||Number(gs?.activeYear)||null,
    round:Number(resultEntry?.round)||null,
    gp_id:resultEntry?.gp_id||null,
    gp_name:resultEntry?.name||resultEntry?.gp_name||null,
    dateISO:resultEntry?.dateISO||gs?.currentDateISO||null,
    score,
    expected_finish:expectation.expectedPosition,
    expectation_delta:Number.isFinite(finish)&&!(retired&&retirement?.key==="mechanical")
      ?round1(expectation.expectedPosition-finish)
      :null,
    teammate_driver_id:teammateDriverId,
    teammate_qualifying_delta:teammateQualifyingDelta,
    teammate_race_delta:retired&&retirement?.key==="mechanical"?null:teammateRaceDelta,
    car_rank:expectation.teamRank,
    car_score:expectation.carScore,
    qualifying_position:qualifyingPosition,
    grid_position:gridPosition,
    finish_position:finish,
    retired,
    retirement_reason:race?.retirement_reason||null,
    retirement_responsibility:retirement?.key||null,
    factors,
  };
}

export function formLabel(score){
  const value=Number(score);
  if(!Number.isFinite(value))return "No form";
  if(value>=84)return "Excellent";
  if(value>=76)return "Strong";
  if(value>=68)return "Good";
  if(value>=58)return "Average";
  if(value>=48)return "Poor";
  return "Very Poor";
}

export function rollingDriverForm(entriesInput,limit=5){
  const entries=rows(entriesInput)
    .slice()
    .sort((a,b)=>String(b?.dateISO||"").localeCompare(String(a?.dateISO||""))||Number(b?.round||0)-Number(a?.round||0))
    .slice(0,Math.max(1,limit));
  if(!entries.length)return {score:null,label:"No form",sample:0,trend:0,entries:[]};

  const weights=[1,0.85,0.70,0.55,0.40];
  let sum=0,total=0;
  entries.forEach((entry,index)=>{
    const value=num(entry?.score);
    if(!Number.isFinite(value))return;
    const weight=weights[index]??Math.max(0.25,1-index*0.15);
    sum+=value*weight;
    total+=weight;
  });
  if(!total)return {score:null,label:"No form",sample:0,trend:0,entries};

  const score=round1(sum/total);
  const latest=num(entries[0]?.score,score);
  const oldest=num(entries[entries.length-1]?.score,score);
  return {
    score,
    label:formLabel(score),
    sample:entries.length,
    trend:round1(latest-oldest),
    entries,
  };
}

function resultEventForEntry(gs,entry){
  const year=Number(entry?.year);
  const round=Number(entry?.round);
  const gpId=String(entry?.gp_id??"");
  return rows(gs?.results).find((event)=>{
    if(Number.isFinite(year)&&Number(event?.year)!==year)return false;
    if(Number.isFinite(round)&&Number(event?.round)!==round)return false;
    if(gpId&&String(event?.gp_id??"")&&String(event.gp_id)!==gpId)return false;
    return true;
  })||null;
}

function hydrateTeammateComparison(gs,driverId,entry){
  if(!entry||typeof entry!=="object")return entry;
  const needsRace=entry?.teammate_race_delta==null;
  const needsQualifying=entry?.teammate_qualifying_delta==null;
  const needsDriver=entry?.teammate_driver_id==null;
  if(!needsRace&&!needsQualifying&&!needsDriver)return entry;

  const event=resultEventForEntry(gs,entry);
  if(!event)return entry;
  const race=rowForDriver(event?.classification,driverId);
  if(!race)return entry;
  const teamId=teamIdOf(race)||String(entry?.team_id??"");
  const teamRace=teammateRow(event?.classification,driverId,teamId);
  const teammateId=String(entry?.teammate_driver_id??driverIdOf(teamRace)??"");
  if(!teammateId)return entry;

  const qualifying=rowForDriver(event?.qualifying,driverId);
  const teamQual=rowForDriver(event?.qualifying,teammateId);
  const next={...entry,teammate_driver_id:teammateId};

  if(needsQualifying&&qualifying&&teamQual){
    const driverPos=num(qualifying?.position);
    const matePos=num(teamQual?.position);
    if(Number.isFinite(driverPos)&&Number.isFinite(matePos)){
      next.teammate_qualifying_delta=round1(clamp(matePos-driverPos,-4,4));
    }
  }

  if(needsRace&&teamRace){
    const driverRetired=Boolean(race?.retired)||String(race?.status||"").toUpperCase()==="DNF";
    const driverResponsibility=driverRetired?retirementResponsibility(race?.retirement_reason):null;
    const mateRetired=Boolean(teamRace?.retired)||String(teamRace?.status||"").toUpperCase()==="DNF";
    const mateResponsibility=mateRetired?retirementResponsibility(teamRace?.retirement_reason):null;
    const driverFinish=num(race?.position);
    const mateFinish=num(teamRace?.position);
    const comparableDriver=!driverRetired||driverResponsibility?.key!=="mechanical";
    const comparableMate=!mateRetired||mateResponsibility?.key!=="mechanical";
    if(comparableDriver&&comparableMate&&Number.isFinite(driverFinish)&&Number.isFinite(mateFinish)){
      next.teammate_race_delta=round1(clamp(mateFinish-driverFinish,-5,5));
    }
  }

  return next;
}

export function driverPerformanceEntries(gs,driverId){
  const dict=gs?.driverPerformanceLog||{};
  const direct=dict?.[String(driverId)];
  const key=normId(driverId);
  const source=Array.isArray(direct)
    ?direct
    :Array.isArray(dict?.[key])
      ?dict[key]
      :[];
  return source.map((entry)=>hydrateTeammateComparison(gs,driverId,entry));
}

export function driverFormSnapshot(gs,driverId){
  const stored=gs?.driverForm?.[String(driverId)]??gs?.driverForm?.[normId(driverId)];
  if(stored&&typeof stored==="object")return stored;
  return rollingDriverForm(driverPerformanceEntries(gs,driverId));
}

export function applyRacePerformanceEvaluation(gs,resultEntry){
  if(!gs||!resultEntry)return {gameState:gs,resultEntry};
  const log={...(gs?.driverPerformanceLog||{})};
  const form={...(gs?.driverForm||{})};
  const evaluations=new Map();

  for(const race of rows(resultEntry?.classification)){
    const did=driverIdOf(race);
    if(!did)continue;
    const evaluation=evaluateDriverRacePerformance(gs,resultEntry,did);
    if(!evaluation)continue;
    evaluations.set(normId(did),evaluation);

    const key=String(did);
    const existing=driverPerformanceEntries({...gs,driverPerformanceLog:log},did)
      .filter((row)=>String(row?.year)!==String(evaluation.year)||String(row?.round)!==String(evaluation.round));
    const nextEntries=[...existing,evaluation]
      .sort((a,b)=>String(a?.dateISO||"").localeCompare(String(b?.dateISO||""))||Number(a?.round||0)-Number(b?.round||0))
      .slice(-20);
    log[key]=nextEntries;
    form[key]=rollingDriverForm(nextEntries);
  }

  const enriched={
    ...resultEntry,
    classification:rows(resultEntry?.classification).map((row)=>{
      const evaluation=evaluations.get(normId(driverIdOf(row)));
      return evaluation?{...row,driver_performance:evaluation}:{...row};
    }),
  };

  return {
    gameState:{...gs,driverPerformanceLog:log,driverForm:form},
    resultEntry:enriched,
  };
}
