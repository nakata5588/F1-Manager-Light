// src/domain/scoutingPolicy.js
// Scouting depth and familiarity policy.
// Scouting improves information precision; it never creates gameplay ratings.

const rows=(value)=>Array.isArray(value)?value:[];
const num=(value,fallback=0)=>{
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const idOf=(row)=>String(row?.driver_id??row?.person_id??row?.id??"");

function driverRecord(gs,driverOrId){
  if(driverOrId&&typeof driverOrId==="object")return driverOrId;
  const id=String(driverOrId??"");
  return [...rows(gs?.dbDrivers),...rows(gs?.drivers)].find((row)=>idOf(row)===id)||null;
}

function ratingRecord(gs,driverId){
  const id=String(driverId||"");
  const pool=rows(gs?.driverRatings).length?rows(gs?.driverRatings):rows(gs?.dbDriverRatings);
  return pool.find((row)=>idOf(row)===id)||{};
}

export function driverScoutingFamiliarity(gs,driverOrId){
  const driver=driverRecord(gs,driverOrId)||{};
  const driverId=idOf(driver)||String(driverOrId??"");
  const rating=ratingRecord(gs,driverId);
  const activeYear=Number(gs?.activeYear);

  const reputation=clamp(num(rating?.reputation,num(driver?.reputation,25)),0,100);

  let starts=0;
  for(const row of [...rows(gs?.dbDriverCareer),...rows(gs?.driverCareer)]){
    if(idOf(row)!==driverId)continue;
    const year=Number(row?.year??row?.season_year);
    if(Number.isFinite(activeYear)&&Number.isFinite(year)&&year>activeYear)continue;
    const series=String(row?.series_division??row?.series??"F1").toUpperCase();
    if(series&&series!=="F1")continue;
    starts+=Math.max(0,num(row?.starts,row?.races??0));
  }

  if(!starts){
    for(const event of rows(gs?.results)){
      if(Number.isFinite(activeYear)&&Number(event?.year)>activeYear)continue;
      if(rows(event?.classification).some((row)=>idOf(row)===driverId))starts+=1;
    }
  }

  const experience=clamp((Math.log1p(starts)/Math.log(151))*100,0,100);
  const contracted=rows(gs?.contracts).some((row)=>
    idOf(row)===driverId&&String(row?.status??"active").toLowerCase()!=="released"
  );
  const score=clamp(reputation*0.64+experience*0.31+(contracted?5:0),0,100);

  return {
    driver_id:driverId,
    score:Number(score.toFixed(1)),
    reputation:Number(reputation.toFixed(1)),
    starts,
    experience:Number(experience.toFixed(1)),
  };
}

export function specificScoutingPlan(gs,driverOrId,{
  depth="light",
  travelDays=0,
  networkQuality=55,
  weeklyCost=0,
}={}){
  const normalizedDepth=String(depth||"light").toLowerCase()==="deep"?"deep":"light";
  const familiarity=driverScoutingFamiliarity(gs,driverOrId);
  const travel=Math.max(0,Math.round(num(travelDays,0)));
  const network=clamp(num(networkQuality,55),0,100);

  const analysisDays=normalizedDepth==="deep"?14:6;
  const recognitionFactor=clamp(1.22-familiarity.score*0.0065,0.58,1.22);
  const networkFactor=clamp(1.15-(network-50)*0.006,0.72,1.18);
  const duration=Math.max(2,Math.round(travel+analysisDays*recognitionFactor*networkFactor));
  const costMultiplier=normalizedDepth==="deep"?1.15:0.70;
  const cost=Math.round(Math.ceil(duration/7)*Math.max(0,num(weeklyCost,0))*costMultiplier);

  return {
    depth:normalizedDepth,
    duration,
    cost,
    familiarity,
    reportScope:normalizedDepth==="deep"
      ?"Exact current ability and attributes; full potential assessment."
      :"Narrower current-ability and attribute ranges; potential remains estimated.",
  };
}
