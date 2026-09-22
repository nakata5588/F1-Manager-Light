// src/domain/driverPotential.js
// Dynamic potential ceiling. Historical peak_ability seeds the starting point,
// but the live Save World can move that ceiling up or down as a career unfolds.

import { carPerformanceRanking } from "./carPerformance.js";
import { currentDriverTeamId } from "./driverContracts.js";
import { driverFormSnapshot } from "./driverForm.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const round2=(v)=>Math.round(Number(v||0)*100)/100;

function idOf(row){return String(row?.driver_id??row?.person_id??row?.id??"");}
function ageOf(gs,driverId){
  const driver=(gs?.drivers||[]).find((row)=>idOf(row)===String(driverId))||{};
  const explicit=Number(driver?.age);
  if(Number.isFinite(explicit))return explicit;
  const birth=String(driver?.dob??driver?.date_of_birth??"").match(/^(\d{4})/);
  const year=Number(gs?.activeYear);
  return birth&&Number.isFinite(year)?Math.max(0,year-Number(birth[1])):28;
}
function academySupported(gs,driverId){
  return (gs?.academy?.drivers||[]).some((row)=>
    idOf(row)===String(driverId)&&String(row?.status??"active").toLowerCase()!=="inactive"
  );
}

export function driverEnvironmentSignal(gs,driverId){
  const teamId=currentDriverTeamId(gs,driverId);
  if(!teamId){
    return {
      score:academySupported(gs,driverId)?0.05:-0.35,
      teamId:null,
      teamRank:null,
      teamCount:(gs?.teams||[]).length||null,
      label:academySupported(gs,driverId)?"Academy environment":"No competitive F1 environment",
    };
  }

  const ranking=carPerformanceRanking(gs);
  const row=ranking.find((item)=>String(item?.team_id??"")===String(teamId));
  const count=Math.max(1,ranking.length);
  const rank=Number(row?.rank)||Math.ceil(count/2);
  const score=count<=1?0:1-2*((rank-1)/(count-1));
  return {
    score:Math.max(-1,Math.min(1,score)),
    teamId:String(teamId),
    teamRank:rank,
    teamCount:count,
    label:rank<=Math.ceil(count*0.25)?"Front-running team":
      rank>=Math.ceil(count*0.75)?"Backmarker environment":"Midfield environment",
  };
}

function trainingSignal(trainingDays){
  const days=Math.max(0,Number(trainingDays)||0);
  if(days>=16)return 1;
  if(days>=10)return 0.65;
  if(days>=5)return 0.30;
  if(days>0)return 0.10;
  return -0.18;
}

function ageFactor(age){
  if(age<=22)return 1;
  if(age<=25)return 0.90;
  if(age<=28)return 0.72;
  if(age<=31)return 0.52;
  if(age<=34)return 0.34;
  return 0.24;
}

export function dynamicPotentialAdjustment(gs,rating,driverId,{trainingDays=0,focusKey=null}={}){
  if(!rating)return {rating,change:null};
  const current=Number(rating?.current_ability);
  const livePotential=Number(rating?.potential_ability);
  if(!Number.isFinite(livePotential))return {rating,change:null};

  const anchorRaw=Number(rating?._potential_anchor);
  const anchor=Number.isFinite(anchorRaw)?anchorRaw:livePotential;
  const form=driverFormSnapshot(gs,driverId);
  const formScore=Number(form?.score);
  const formSignal=Number.isFinite(formScore)
    ?Math.max(-1,Math.min(1,(formScore-65)/18))
    :0;
  const environment=driverEnvironmentSignal(gs,driverId);
  const trainSignal=trainingSignal(trainingDays);
  const age=ageOf(gs,driverId);
  const factor=ageFactor(age);

  // Results relative to machinery matter most. Team environment and sustained
  // development support can expand the ceiling; poor form, weak environment or
  // neglected development can erode it.
  let raw=formSignal*0.19+environment.score*0.085+trainSignal*0.09;
  if(age>=33)raw-=0.035+(age-33)*0.008;

  const delta=Math.max(-0.36,Math.min(0.36,raw*factor));
  const lowerBound=Math.max(Number.isFinite(current)?current:0,anchor-10);
  const upperBound=Math.min(98,anchor+6);
  const after=round2(clamp(livePotential+delta,lowerBound,upperBound));
  const before=round2(livePotential);

  const next={
    ...rating,
    _potential_anchor:round2(anchor),
    potential_ability:after,
  };

  if(Math.abs(after-before)<0.001)return {rating:next,change:null};

  return {
    rating:next,
    change:{
      dateISO:String(gs?.currentDateISO||"").slice(0,10),
      driverId:String(driverId),
      before,
      after,
      delta:round2(after-before),
      anchor:round2(anchor),
      form_score:Number.isFinite(formScore)?Math.round(formScore*10)/10:null,
      form_signal:round2(formSignal),
      environment_signal:round2(environment.score),
      environment_label:environment.label,
      team_rank:environment.teamRank,
      training_days:Number(trainingDays)||0,
      development_focus:focusKey||null,
      age,
      source:"dynamic_potential",
    },
  };
}
