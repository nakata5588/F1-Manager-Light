// src/domain/carPerformance.js
//
// Shared car-performance model. This is intentionally independent from the UI
// so race simulation, comparisons and the future Garage/Car page use the same
// numbers.

const unwrap=(v)=>{
  if(v&&typeof v==="object"&&!Array.isArray(v))return v.result ?? v.value ?? null;
  return v;
};
const pick=(o,keys,fb=undefined)=>{
  for(const k of keys){
    const v=unwrap(o?.[k]);
    if(v!==undefined&&v!==null&&v!=="")return v;
  }
  return fb;
};
const n=(v,fb=NaN)=>{const x=Number(unwrap(v));return Number.isFinite(x)?x:fb;};
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const round1=(v)=>Math.round(Number(v||0)*10)/10;

const CHASSIS_KEYS=[
  ["chassis_spec",0.25],
  ["aero_spec",0.24],
  ["gearbox_spec",0.12],
  ["suspension_spec",0.13],
  ["brakes_spec",0.10],
  ["cooling_spec",0.08],
  ["electronics_spec",0.04],
  ["turbo_spec",0.02],
  ["kers_spec",0.01],
  ["ers_mgu_k",0.005],
  ["ers_mgu_h",0.005],
];

function weightedAvailable(row,pairs){
  let total=0,sum=0;
  for(const [key,w] of pairs){
    const value=n(row?.[key],NaN);
    if(!Number.isFinite(value))continue;
    total+=w;
    sum+=clamp(value)*w;
  }
  return total>0?sum/total:null;
}
function rowForTeam(rows,teamId,year){
  const list=Array.isArray(rows)?rows:[];
  const exact=list.find((r)=>
    String(pick(r,["team_id","team","constructor_id","constructor"],""))===String(teamId) &&
    (!Number.isFinite(Number(year)) || !Number.isFinite(n(pick(r,["year","season_year"],NaN),NaN)) || n(pick(r,["year","season_year"],NaN),NaN)===Number(year))
  );
  if(exact)return exact;
  return list.find((r)=>String(pick(r,["team_id","team","constructor_id","constructor"],""))===String(teamId))||null;
}

export function teamCarPerformance(gs,teamId){
  const year=Number(gs?.activeYear);
  const car=rowForTeam(gs?.carStats||gs?.dbCarStats||[],teamId,year)||{};
  const engine=rowForTeam(gs?.teamEngines||gs?.dbTeamEngines||[],teamId,year)||{};

  const chassis=weightedAvailable(car,CHASSIS_KEYS);
  const enginePower=n(pick(engine,["power","engine_power","Ovrl","overall"],NaN),NaN);
  const integration=n(pick(engine,["chassis_integration"],NaN),NaN);
  const engineOverall=n(pick(engine,["Ovrl","overall"],NaN),NaN);

  const power=Number.isFinite(enginePower)
    ? (Number.isFinite(integration)?enginePower*0.82+integration*0.18:enginePower)
    : (Number.isFinite(engineOverall)?engineOverall:(chassis??70));

  let carReliability=n(pick(car,["reliability"],NaN),NaN);
  if(Number.isFinite(carReliability)&&carReliability<=1)carReliability*=100;
  let engineReliability=n(pick(engine,["reliability_override"],NaN),NaN);
  if(Number.isFinite(engineReliability)&&engineReliability<=1)engineReliability*=100;
  if(!Number.isFinite(engineReliability))engineReliability=n(pick(engine,["reliability"],NaN),NaN);

  const reliability=Number.isFinite(carReliability)&&Number.isFinite(engineReliability)
    ? carReliability*0.55+engineReliability*0.45
    : Number.isFinite(carReliability)?carReliability:Number.isFinite(engineReliability)?engineReliability:75;

  const aero=n(car?.aero_spec,chassis??70);
  const chassisSpec=n(car?.chassis_spec,chassis??70);
  const gearbox=n(car?.gearbox_spec,chassis??70);
  const brakes=n(car?.brakes_spec,chassis??70);
  const suspension=n(car?.suspension_spec,chassis??70);

  const qualifying=clamp(
    aero*0.30+chassisSpec*0.22+power*0.28+gearbox*0.10+suspension*0.10
  );
  const race=clamp(
    (chassis??70)*0.52+power*0.28+reliability*0.08+brakes*0.06+suspension*0.06
  );
  const overall=clamp(qualifying*0.42+race*0.48+reliability*0.10);

  return {
    team_id:String(teamId??""),
    overall:round1(overall),
    qualifying:round1(qualifying),
    race:round1(race),
    reliability:round1(reliability),
    chassis:round1(chassis??70),
    power:round1(power),
    source:{car,engine},
  };
}

export function carPerformanceRanking(gs){
  return (gs?.teams||[])
    .map((team)=>{
      const id=String(team?.team_id??team?.id??"");
      return {
        ...teamCarPerformance(gs,id),
        team_name:team?.team_name||team?.name||id,
      };
    })
    .sort((a,b)=>b.overall-a.overall||String(a.team_name).localeCompare(String(b.team_name)))
    .map((row,index)=>({...row,rank:index+1}));
}
