// src/domain/driverLifecycle.js
// D5 — Dynamic driver lifecycle and two-way permanent development.
//
// Historical data seeds the career. Once a save starts, lifecycle and permanent
// attribute movement are derived from the Save World: age, experience,
// development headroom, played-race performance, incidents and injuries.

import { ABILITY_ATTRIBUTE_WEIGHTS } from "./driverRating.js";
import { driverPerformanceEntries, driverFormSnapshot } from "./driverForm.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const round2=(v)=>Math.round(Number(v||0)*100)/100;
const rows=(v)=>Array.isArray(v)?v:[];

function idOf(row){return String(row?.driver_id??row?.person_id??row?.id??"");}
function sameId(a,b){return String(a??"")===String(b??"");}
function dateOnly(value){return String(value||"").slice(0,10);}
function monthKey(value){return dateOnly(value).slice(0,7);}
function previousMonthKey(value){
  const raw=dateOnly(value);
  const m=raw.match(/^(\d{4})-(\d{2})/);
  if(!m)return "";
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,1));
  d.setUTCMonth(d.getUTCMonth()-1);
  return d.toISOString().slice(0,7);
}
function monthsBackDate(value,months=4){
  const raw=dateOnly(value);
  const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m)return "";
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
  d.setUTCMonth(d.getUTCMonth()-months);
  return d.toISOString().slice(0,10);
}
function ageOf(gs,driver){
  const explicit=Number(driver?.age);
  if(Number.isFinite(explicit))return explicit;
  const year=Number(gs?.activeYear);
  const birth=String(driver?.dob??driver?.date_of_birth??driver?.birthdate??"").match(/^(\d{4})/);
  return birth&&Number.isFinite(year)?Math.max(0,year-Number(birth[1])):28;
}
function driverOf(gs,driverOrId){
  if(driverOrId&&typeof driverOrId==="object")return driverOrId;
  const id=String(driverOrId??"");
  return rows(gs?.drivers).find((row)=>sameId(idOf(row),id))
    ||rows(gs?.dbDrivers).find((row)=>sameId(idOf(row),id))
    ||{driver_id:id};
}
function ratingOf(gs,driverId,ratingInput=null){
  if(ratingInput)return ratingInput;
  return rows(gs?.driverRatings).find((row)=>sameId(idOf(row),driverId))
    ||rows(gs?.dbDriverRatings).find((row)=>sameId(idOf(row),driverId))
    ||null;
}
function careerSourceYear(gs){
  const source=Number(gs?.careerMeta?.sourceSeason);
  if(Number.isFinite(source))return source;
  return Number(gs?.activeYear)||null;
}
function actualRaceYears(gs,driverId){
  const years=new Set();
  for(const event of rows(gs?.results)){
    const found=rows(event?.classification).some((row)=>sameId(idOf(row),driverId));
    if(found&&Number.isFinite(Number(event?.year)))years.add(Number(event.year));
  }
  return [...years].sort((a,b)=>a-b);
}
function actualStarts(gs,driverId){
  return rows(gs?.results).reduce((sum,event)=>
    sum+(rows(event?.classification).some((row)=>sameId(idOf(row),driverId))?1:0),0);
}
function safeHistoricalRookieYear(gs,driver){
  const year=Number(driver?.f1_rookie_season??driver?.f1_debut_year);
  const boundary=careerSourceYear(gs);
  if(!Number.isFinite(year)||!Number.isFinite(boundary)||year>boundary)return null;
  return year;
}
export function driverCareerExperience(gs,driver){
  const driverId=idOf(driver);
  const year=Number(gs?.activeYear);
  const playedYears=actualRaceYears(gs,driverId);
  const historicalRookie=safeHistoricalRookieYear(gs,driver);
  const firstPlayed=playedYears[0]??null;
  const rookieYear=Number.isFinite(firstPlayed)
    ?Math.min(firstPlayed,Number.isFinite(historicalRookie)?historicalRookie:firstPlayed)
    :historicalRookie;
  const yearsRaced=Number.isFinite(year)&&Number.isFinite(rookieYear)
    ?Math.max(0,year-rookieYear+1)
    :0;

  let historicalStarts=0;
  const boundary=careerSourceYear(gs);
  if(Number.isFinite(boundary)){
    for(const row of rows(gs?.driverCareer).length?rows(gs.driverCareer):rows(gs?.dbDriverCareer)){
      if(!sameId(idOf(row),driverId))continue;
      const rowYear=Number(row?.year??row?.season_year);
      const series=String(row?.series_division??row?.series??"").toUpperCase();
      if(Number.isFinite(rowYear)&&rowYear<boundary&&(!series||series==="F1")){
        historicalStarts+=Math.max(0,Number(row?.starts??row?.races??0)||0);
      }
    }
  }

  return {
    rookieYear:Number.isFinite(rookieYear)?rookieYear:null,
    yearsRaced,
    starts:historicalStarts+actualStarts(gs,driverId),
    playedStarts:actualStarts(gs,driverId),
  };
}

export function driverPreviousMonthPerformance(gs,driverId,dateISO=gs?.currentDateISO){
  const key=previousMonthKey(dateISO);
  const entries=driverPerformanceEntries(gs,driverId).filter((row)=>monthKey(row?.dateISO)===key);
  const scores=entries.map((row)=>Number(row?.score)).filter(Number.isFinite);
  const driverErrors=entries.filter((row)=>row?.retirement_responsibility==="driver_error").length;
  const racingIncidents=entries.filter((row)=>row?.retirement_responsibility==="racing_incident").length;
  const mechanicalDnfs=entries.filter((row)=>row?.retirement_responsibility==="mechanical").length;
  const wins=entries.filter((row)=>!row?.retired&&Number(row?.finish_position)===1).length;
  const podiums=entries.filter((row)=>!row?.retired&&Number(row?.finish_position)>=1&&Number(row?.finish_position)<=3).length;
  return {
    monthKey:key,
    entries,
    starts:entries.length,
    averageScore:scores.length?round2(scores.reduce((a,b)=>a+b,0)/scores.length):null,
    driverErrors,
    racingIncidents,
    mechanicalDnfs,
    wins,
    podiums,
  };
}

function previousMonthMedical(gs,driverId,dateISO){
  const key=previousMonthKey(dateISO);
  return rows(gs?.medicalHistory).filter((row)=>
    sameId(row?.driver_id??row?.id,driverId) &&
    monthKey(row?.date)===key &&
    String(row?.outcome||"").toLowerCase()==="injury"
  );
}

const SEVERITY_RANK=Object.freeze({minor:1,moderate:2,serious:3,critical:4});
function strongestInjury(records){
  return records.slice().sort((a,b)=>
    (SEVERITY_RANK[String(b?.injury_severity||"").toLowerCase()]||0)-
    (SEVERITY_RANK[String(a?.injury_severity||"").toLowerCase()]||0)
  )[0]||null;
}

function change(attr,delta,source,reason){
  return {attr,delta:round2(delta),source,reason};
}

export function driverMonthlyCareerDevelopmentPlan(gs,driverId,rating,dateISO=gs?.currentDateISO){
  const perf=driverPreviousMonthPerformance(gs,driverId,dateISO);
  const medical=previousMonthMedical(gs,driverId,dateISO);
  const plan=[];
  const reasons=[];

  // Experience is earned from races actually driven in the previous month,
  // rather than repeatedly rewarding cumulative season starts every month.
  if(perf.starts>0){
    const experience=Math.min(0.065,0.012+perf.starts*0.009);
    plan.push(change("race_intelligence",experience,"race_experience",`${perf.starts} race start(s) added judgement experience.`));
    plan.push(change("consistency",experience*0.55,"race_experience","Regular race mileage reinforced repeatability."));
    plan.push(change("technical_feedback",experience*0.40,"race_experience","Race mileage improved technical reference."));
    reasons.push(`+${perf.starts} race start(s) of experience`);
  }

  // Strong results are evaluated relative to the machinery by D4 Form.
  if(perf.starts>=2&&Number.isFinite(perf.averageScore)&&perf.averageScore>=76){
    const strength=Math.min(0.085,0.025+(perf.averageScore-76)*0.003);
    plan.push(change("pressure_handling",strength,"strong_performance","Sustained performance above the car baseline built confidence under pressure."));
    plan.push(change("mentality",strength*0.70,"strong_performance","Strong execution reinforced competitive resilience."));
    plan.push(change("consistency",strength*0.30,"strong_performance","Repeated strong weekends reinforced consistency."));
    if(perf.averageScore>=86&&perf.starts>=3){
      plan.push(change("racecraft",0.025,"breakout_performance","Exceptional sustained performance sharpened racecraft."));
    }
    reasons.push(`+Strong monthly Form (${perf.averageScore.toFixed(1)})`);
  }

  const success=Math.min(0.045,perf.wins*0.018+perf.podiums*0.006);
  if(success>0){
    plan.push(change("pressure_handling",success,"competitive_success","Wins and podiums strengthened execution in high-pressure situations."));
    plan.push(change("mentality",success*0.65,"competitive_success","Front-running results strengthened mentality."));
    reasons.push("+Competitive success");
  }

  // Poor Form must be sustained. A single bad GP should not permanently damage
  // a driver's talent profile.
  if(perf.starts>=2&&Number.isFinite(perf.averageScore)&&perf.averageScore<58){
    const setback=Math.min(0.22,0.050+(58-perf.averageScore)*0.008);
    plan.push(change("mentality",-setback,"sustained_underperformance","Repeated results below the car baseline hurt competitive resilience."));
    plan.push(change("pressure_handling",-setback*0.72,"sustained_underperformance","Sustained underperformance reduced confidence under pressure."));
    plan.push(change("consistency",-setback*0.52,"sustained_underperformance","Repeated weak weekends reduced repeatability."));
    if(perf.averageScore<48&&perf.starts>=3){
      plan.push(change("racecraft",-setback*0.22,"sustained_underperformance","A prolonged severe slump eroded race execution."));
    }
    reasons.push(`−Poor monthly Form (${perf.averageScore.toFixed(1)})`);
  }

  // Clear driver errors have consequences. Mechanical DNFs intentionally do
  // not enter this plan.
  if(perf.driverErrors>0){
    const count=Math.min(3,perf.driverErrors);
    plan.push(change("consistency",-0.140*count,"driver_error_regression","Driver-caused accidents reduced consistency."));
    plan.push(change("mentality",-0.100*count,"driver_error_regression","Driver-caused accidents damaged competitive resilience."));
    plan.push(change("pressure_handling",-0.070*count,"driver_error_regression","Mistakes under pressure reduced pressure handling."));
    plan.push(change("crash_likelihood",0.180*count,"driver_error_regression","Repeated driver-caused incidents increased the live accident tendency."));
    if(count>=2)plan.push(change("racecraft",-0.080,"driver_error_regression","Repeated incidents weakened wheel-to-wheel judgement."));
    reasons.push(`−${perf.driverErrors} driver-error incident(s)`);
  }

  if(perf.racingIncidents>0){
    const count=Math.min(3,perf.racingIncidents);
    plan.push(change("racecraft",-0.050*count,"racing_incident_regression","Repeated racing incidents reduced wheel-to-wheel execution."));
    plan.push(change("consistency",-0.035*count,"racing_incident_regression","Racing incidents reduced consistency."));
    plan.push(change("crash_likelihood",0.060*count,"racing_incident_regression","Repeated contact increased incident tendency."));
    reasons.push(`−${perf.racingIncidents} racing incident(s)`);
  }

  const injury=strongestInjury(medical);
  const severity=String(injury?.injury_severity||"").toLowerCase();
  if(severity==="moderate"){
    plan.push(change("adaptability",-0.080,"injury_regression","A moderate injury caused a small permanent adaptation setback."));
    plan.push(change("consistency",-0.050,"injury_regression","Recovery interrupted driving consistency."));
    reasons.push("−Moderate injury recovery");
  }else if(severity==="serious"){
    plan.push(change("pace",-0.250,"injury_regression","A serious injury caused a small permanent physical-performance setback."));
    plan.push(change("adaptability",-0.200,"injury_regression","A serious injury reduced adaptability after recovery."));
    plan.push(change("consistency",-0.150,"injury_regression","A serious injury disrupted consistency."));
    plan.push(change("mentality",-0.120,"injury_regression","A serious injury affected competitive resilience."));
    reasons.push("−Serious injury");
  }else if(severity==="critical"){
    plan.push(change("pace",-0.600,"injury_regression","A critical injury caused a meaningful permanent physical-performance setback."));
    plan.push(change("adaptability",-0.500,"injury_regression","A critical injury reduced adaptability after recovery."));
    plan.push(change("consistency",-0.350,"injury_regression","A critical injury disrupted consistency."));
    plan.push(change("mentality",-0.250,"injury_regression","A critical injury affected competitive resilience."));
    plan.push(change("pressure_handling",-0.180,"injury_regression","The severity of the accident affected pressure handling."));
    reasons.push("−Critical injury");
  }

  return {
    monthKey:perf.monthKey,
    performance:perf,
    medical,
    changes:plan,
    reasons,
    mechanicalDnfsIgnored:perf.mechanicalDnfs,
  };
}

function recentAttributeTrajectory(gs,driverId,dateISO){
  const since=monthsBackDate(dateISO,4);
  const rawKey=String(driverId);
  const normKey=rawKey.match(/(\d+)/)?.[1]?.padStart(4,"0")||rawKey;
  const direct=rows(gs?.driverAttrLog?.[rawKey]);
  const compat=normKey===rawKey?[]:rows(gs?.driverAttrLog?.[normKey]);
  const log=[...direct,...compat];
  let impact=0;
  let count=0;
  for(const row of log){
    const date=dateOnly(row?.dateISO);
    if(since&&date&&date<since)continue;
    const delta=Number(row?.delta);
    if(!Number.isFinite(delta))continue;
    const attr=String(row?.attr||"");
    impact+=attr==="crash_likelihood"?-delta:delta;
    count++;
  }
  return {impact:round2(impact),count};
}

function latestInjuryPressure(gs,driverId,dateISO){
  const since=monthsBackDate(dateISO,4);
  const recent=rows(gs?.medicalHistory).filter((row)=>
    sameId(row?.driver_id??row?.id,driverId) &&
    (!since||dateOnly(row?.date)>=since) &&
    String(row?.outcome||"").toLowerCase()==="injury"
  );
  const injury=strongestInjury(recent);
  return SEVERITY_RANK[String(injury?.injury_severity||"").toLowerCase()]||0;
}

function trajectoryLabel(impact){
  if(impact>=0.22)return "rising";
  if(impact<=-0.22)return "falling";
  return "stable";
}

export function driverLifecycleSnapshot(gs,driverOrId,ratingInput=null,{dateISO=gs?.currentDateISO}={}){
  const driver=driverOf(gs,driverOrId);
  const driverId=idOf(driver);
  const rating=ratingOf(gs,driverId,ratingInput)||{};
  const age=ageOf(gs,driver);
  const current=Number(rating?.current_ability);
  const potential=Number(rating?.potential_ability);
  const headroom=Number.isFinite(current)&&Number.isFinite(potential)?Math.max(0,potential-current):0;
  const form=driverFormSnapshot(gs,driverId);
  const formScore=Number(form?.score);
  const experience=driverCareerExperience(gs,driver);
  const trajectory=recentAttributeTrajectory(gs,driverId,dateISO);
  const trajectoryKey=trajectoryLabel(trajectory.impact);
  const previous=driverPreviousMonthPerformance(gs,driverId,dateISO);
  const injuryPressure=latestInjuryPressure(gs,driverId,dateISO);
  const status=String(driver?.status||"").toLowerCase();

  const positiveFactors=[
    {
      key:"form",
      label:"Strong Form",
      value:Number.isFinite(formScore)?Math.max(0,formScore-60)*1.25:0,
      explanation:"Recent results above the car/team expectation create development momentum.",
    },
    {
      key:"headroom",
      label:"Potential Headroom",
      value:Math.min(24,headroom*2.5),
      explanation:"The gap between Current Ability and Dynamic Potential leaves room for permanent growth.",
    },
    {
      key:"trajectory",
      label:"Rising Attributes",
      value:trajectory.impact>0?Math.min(24,trajectory.impact*18):0,
      explanation:"Recent permanent attribute gains reinforce a positive development trajectory.",
    },
    {
      key:"experience",
      label:"Race Experience",
      value:previous.starts>0?Math.min(12,previous.starts*3):0,
      explanation:"Actual race mileage improves judgement, consistency and technical learning.",
    },
  ].filter((item)=>item.value>0).map((item)=>({...item,value:round2(item.value)}));

  const negativeFactors=[
    {
      key:"age",
      label:"Age Regression",
      value:Math.max(0,age-34)*5,
      explanation:"Age only becomes a permanent regression pressure from 35 onwards; 33–34 is a plateau.",
    },
    {
      key:"form",
      label:"Poor Form",
      value:Number.isFinite(formScore)?Math.max(0,60-formScore)*1.3:0,
      explanation:"Sustained results below the car/team expectation can erode mental and consistency attributes.",
    },
    {
      key:"trajectory",
      label:"Falling Attributes",
      value:trajectory.impact<0?Math.min(28,Math.abs(trajectory.impact)*20):0,
      explanation:"Recent permanent attribute losses reinforce a negative trajectory.",
    },
    {
      key:"driver_errors",
      label:"Driver Errors",
      value:previous.driverErrors*9,
      explanation:"Driver-caused mistakes and accidents can reduce consistency, pressure handling and racecraft.",
    },
    {
      key:"racing_incidents",
      label:"Racing Incidents",
      value:previous.racingIncidents*4,
      explanation:"Repeated contact and avoidable incidents add smaller regression pressure.",
    },
    {
      key:"injury",
      label:"Injury Recovery",
      value:injuryPressure*7,
      explanation:"Recent significant injuries can interrupt development and, in severe cases, leave a permanent setback.",
    },
  ].filter((item)=>item.value>0).map((item)=>({...item,value:round2(item.value)}));

  const positivePressure=clamp(
    positiveFactors.reduce((sum,item)=>sum+Number(item.value||0),0),
    0,100
  );
  const negativePressure=clamp(
    negativeFactors.reduce((sum,item)=>sum+Number(item.value||0),0),
    0,100
  );

  let stage;
  const terminal=["retired","deceased","withdrawn"].includes(status);
  const actualRookie=experience.rookieYear===Number(gs?.activeYear)&&experience.playedStarts<=20;

  if(terminal){
    stage="retirement_window";
  }else if(age<=21&&experience.playedStarts===0&&experience.starts<3){
    stage="youth";
  }else if(actualRookie||(experience.playedStarts>0&&experience.playedStarts<=20&&experience.yearsRaced<=1)){
    stage="rookie";
  }else if(
    age>=40 ||
    (age>=38&&(trajectoryKey==="falling"||(!Number.isFinite(formScore)||formScore<58))) ||
    (age>=36&&Number.isFinite(formScore)&&formScore<48&&trajectoryKey==="falling")
  ){
    stage="retirement_window";
  }else if(
    age>=35 &&
    ((Number.isFinite(formScore)&&formScore<55)||trajectoryKey==="falling") &&
    negativePressure>positivePressure+8
  ){
    stage="decline";
  }else if(
    age<=30 &&
    headroom>=2.5 &&
    (trajectoryKey!=="falling"||!Number.isFinite(formScore)||formScore>=60)
  ){
    stage="developing";
  }else if(
    age<=32 &&
    headroom>=4 &&
    Number.isFinite(formScore)&&formScore>=65
  ){
    // Late bloomers may stay on a genuine development path instead of being
    // forced into Prime purely by age.
    stage="developing";
  }else if(age>=32||experience.yearsRaced>=8){
    stage="veteran";
  }else{
    stage="prime";
  }

  const labels={
    youth:"Youth / Junior",
    rookie:"Rookie",
    developing:"Developing",
    prime:"Prime",
    veteran:"Veteran",
    decline:"Decline",
    retirement_window:"Retirement Window",
  };

  const reasons=[];
  if(headroom>=4)reasons.push(`${round2(headroom)} ability points of live potential headroom`);
  if(Number.isFinite(formScore))reasons.push(`Form ${round2(formScore)} · ${form?.label||"—"}`);
  if(trajectoryKey!=="stable")reasons.push(`Permanent attributes are ${trajectoryKey}`);
  if(previous.driverErrors)reasons.push(`${previous.driverErrors} recent driver-error incident(s)`);
  if(injuryPressure>=3)reasons.push("Recent serious/critical injury");
  if(age>=35)reasons.push(`Age ${age} adds physical decline pressure`);
  if(experience.yearsRaced)reasons.push(`${experience.yearsRaced} F1 season(s) of experience`);

  return {
    driver_id:driverId,
    stage,
    label:labels[stage],
    age,
    currentAbility:Number.isFinite(current)?round2(current):null,
    potentialAbility:Number.isFinite(potential)?round2(potential):null,
    headroom:round2(headroom),
    formScore:Number.isFinite(formScore)?round2(formScore):null,
    formLabel:form?.label||"No form",
    yearsRaced:experience.yearsRaced,
    starts:experience.starts,
    playedStarts:experience.playedStarts,
    rookieYear:experience.rookieYear,
    trajectory:trajectoryKey,
    trajectoryLabel:trajectoryKey.charAt(0).toUpperCase()+trajectoryKey.slice(1),
    trajectoryImpact:trajectory.impact,
    positivePressure:round2(positivePressure),
    negativePressure:round2(negativePressure),
    positiveFactors,
    negativeFactors,
    reasons,
    asOf:dateOnly(dateISO)||null,
  };
}

export function driverLifecycleState(gs,driverOrId,ratingInput=null){
  const driver=driverOf(gs,driverOrId);
  const driverId=idOf(driver);
  const stored=gs?.driverLifecycle?.[driverId];
  if(stored&&typeof stored==="object")return stored;
  return driverLifecycleSnapshot(gs,driver,ratingInput);
}

export function abilityImpactForAttributeDelta(attr,delta){
  const weight=Number(ABILITY_ATTRIBUTE_WEIGHTS?.[attr]);
  if(!Number.isFinite(weight))return 0;
  return round2((weight<0?-1:1)*Math.abs(weight)*Number(delta||0));
}
