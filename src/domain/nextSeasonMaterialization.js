// src/domain/nextSeasonMaterialization.js
// Stage 7.7A — materialise Next Season technical packages into target-year carStats.
//
// Historical future carStats are never imported. A target-year baseline is built
// from the simulated current car plus the team's own Next Season programme.

const str=(v)=>String(v??"");
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const round=(v,d=2)=>Number(Number(v||0).toFixed(d));

const AREA_FIELDS=Object.freeze({
  aero:["aero_spec"],
  chassis:["chassis_spec","suspension_spec","brakes_spec"],
  powertrain:["gearbox_spec","turbo_spec"],
  hybrid:["kers_spec","ers_mgu_k","ers_mgu_h","battery_pack"],
  cooling:["cooling_spec"],
  reliability:["reliability","electronics_spec"],
});

function teamIdOf(row){
  return str(row?.team_id??row?.team??row?.constructor_id??row?.constructor);
}

function yearOf(row){
  const n=Number(row?.year??row?.season_year);
  return Number.isFinite(n)?n:null;
}

function sourceCarRows(state,previousYear){
  const rows=Array.isArray(state?.carStats)?state.carStats:[];
  const exact=rows.filter((row)=>yearOf(row)===Number(previousYear));
  return exact.length?exact:rows;
}

function playerTeamId(state){
  return str(state?.team?.team_id??state?.team?.id);
}

function playerProgramme(state){
  return state?.development?.nextSeasonCar||null;
}

function aiProgramme(state,teamId){
  return state?.aiTechnicalWorld?.teams?.[str(teamId)]?.development?.nextSeasonCar||null;
}

function programmeForTeam(state,teamId){
  return str(teamId)===playerTeamId(state)
    ?playerProgramme(state)
    :aiProgramme(state,teamId);
}

function programmeMatchesTarget(programme,targetYear){
  return Boolean(
    programme &&
    typeof programme==="object" &&
    Number(programme?.targetSeason??programme?.target_season)===Number(targetYear) &&
    programme?.technical_package &&
    typeof programme.technical_package==="object"
  );
}

function normalizedReliability(value){
  const v=num(value,NaN);
  if(!Number.isFinite(v))return NaN;
  return v<=1?v*100:v;
}

function denormalizedReliability(value,source){
  const src=num(source,NaN);
  return Number.isFinite(src)&&src<=1
    ?round(clamp(value)/100,4)
    :round(clamp(value),2);
}

function normalizedFieldValue(field,value){
  if(field==="reliability")return normalizedReliability(value);
  const n=Number(value);
  return Number.isFinite(n)?n:NaN;
}

function materializableFields(source,area){
  return (AREA_FIELDS[area]||[]).filter((field)=>{
    if(["aero_spec","chassis_spec","suspension_spec","brakes_spec","gearbox_spec","cooling_spec","reliability"].includes(field)){
      return Number.isFinite(Number(source?.[field]));
    }
    // Special technology families are never invented during rollover.
    const value=Number(source?.[field]);
    return Number.isFinite(value)&&value>0;
  });
}

function packageAreaRow(pkg,area){
  return pkg?.areas?.[area]||pkg?.rows?.find?.((row)=>str(row?.id)===str(area))||null;
}

function packageTargetForArea(programme,area){
  const pkg=programme?.technical_package||{};
  const row=packageAreaRow(pkg,area);
  if(!row||row?.applicable===false)return NaN;
  const progress=clamp(num(programme?.overall_progress??pkg?.progress,0),0,100);

  if(progress>=85){
    const validated=Number(row?.validated);
    if(Number.isFinite(validated))return clamp(validated);
  }
  if(progress>=60){
    const integrated=Number(row?.integrated_projected);
    if(Number.isFinite(integrated))return clamp(integrated);
  }
  const projected=Number(row?.projected);
  if(Number.isFinite(projected))return clamp(projected);
  return NaN;
}

function readinessWeight(programme){
  const progress=clamp(num(programme?.overall_progress,0),0,100);
  if(programme?.status==="completed"&&progress>=99.999)return 1;
  return progress/100;
}

function incompletePenalty(programme){
  const progress=clamp(num(programme?.overall_progress,0),0,100);
  if(programme?.status==="completed"&&progress>=99.999)return 0;
  const remaining=1-progress/100;
  const scale=progress<60?3.5:progress<85?2.5:1.5;
  return remaining*scale;
}

function materializeArea(source,programme,area){
  const fields=materializableFields(source,area);
  if(!fields.length)return {};
  const values=fields
    .map((field)=>({field,value:normalizedFieldValue(field,source?.[field])}))
    .filter((row)=>Number.isFinite(row.value));
  if(!values.length)return {};

  const currentAverage=values.reduce((sum,row)=>sum+row.value,0)/values.length;
  const target=packageTargetForArea(programme,area);
  if(!Number.isFinite(target))return {};

  const readiness=readinessWeight(programme);
  const penalty=incompletePenalty(programme);
  const realised=clamp(currentAverage+(target-currentAverage)*readiness-penalty);
  const spreadRetention=0.35;

  return Object.fromEntries(values.map(({field,value})=>{
    const offset=(value-currentAverage)*spreadRetention;
    const next=clamp(realised+offset);
    return [
      field,
      field==="reliability"
        ?denormalizedReliability(next,source?.[field])
        :round(next,2),
    ];
  }));
}

export function materializeTeamNextSeasonCar(source,programme,targetYear){
  const next={...source,year:Number(targetYear),season_year:Number(targetYear)};
  if(!programmeMatchesTarget(programme,targetYear)){
    return {
      ...next,
      generation_source:"simulated_car_carryover",
      source_season:yearOf(source),
      next_season_programme_status:programme?.status||"not_started",
      next_season_programme_progress:round(num(programme?.overall_progress,0),2),
    };
  }

  const pkg=programme.technical_package;
  const updates={};
  for(const area of Object.keys(AREA_FIELDS)){
    Object.assign(updates,materializeArea(source,programme,area));
  }

  return {
    ...next,
    ...updates,
    generation_source:"next_season_technical_package",
    source_season:yearOf(source),
    next_season_programme_status:programme?.status||null,
    next_season_programme_progress:round(num(programme?.overall_progress,0),2),
    next_season_readiness:pkg?.readiness||programme?.readiness||null,
    next_season_philosophy:pkg?.philosophy?.id??programme?.technical_philosophy?.id??"balanced",
    next_season_package_version:num(pkg?.version,1),
  };
}

export function materializeNextSeasonCarStats(state,targetYear){
  const previousYear=Number(state?.activeYear??Number(targetYear)-1);
  return sourceCarRows(state,previousYear).map((source)=>{
    const teamId=teamIdOf(source);
    return materializeTeamNextSeasonCar(
      source,
      programmeForTeam(state,teamId),
      targetYear
    );
  });
}

function archiveAIProgrammes(state,targetYear){
  if(!state?.aiTechnicalWorld?.teams)return state?.aiTechnicalWorld;
  const date=`${Number(targetYear)}-01-01`;
  const teams=Object.fromEntries(Object.entries(state.aiTechnicalWorld.teams).map(([teamId,teamState])=>{
    const dev=teamState?.development||{};
    const programme=dev?.nextSeasonCar;
    const programmeTarget=Number(programme?.targetSeason??programme?.target_season);
    const existing=Array.isArray(teamState?.next_season_history)?teamState.next_season_history:[];
    let history=existing;

    if(programme&&programmeTarget===Number(targetYear)){
      const archived={
        target_season:Number(targetYear),
        archived_at:date,
        status:programme?.status||"not_started",
        progress:round(num(programme?.overall_progress,0),2),
        readiness:programme?.technical_package?.readiness??programme?.readiness??null,
        philosophy_id:programme?.technical_package?.philosophy?.id??programme?.technical_philosophy?.id??"balanced",
        strategy_id:dev?.technicalStrategy?.id||"balanced",
        technical_package:programme?.technical_package||null,
      };
      history=[
        ...existing.filter((row)=>Number(row?.target_season)!==Number(targetYear)),
        archived,
      ].sort((a,b)=>Number(a?.target_season)-Number(b?.target_season)).slice(-8);
    }

    return [teamId,{
      ...teamState,
      next_season_history:history,
      development:{
        ...dev,
        nextSeasonCar:programme&&programmeTarget===Number(targetYear)?null:dev?.nextSeasonCar??null,
        technicalStrategy:null,
      },
      strategy_planning:{
        ...(teamState?.strategy_planning||{}),
        season_year:Number(targetYear),
        last_review_date:null,
        next_review_date:null,
        reason:"season_reset",
      },
    }];
  }));
  return {...state.aiTechnicalWorld,teams};
}

function archivePlayerProgramme(state,targetYear){
  const dev=state?.development||{};
  const programme=dev?.nextSeasonCar;
  const target=Number(programme?.targetSeason??programme?.target_season);
  const matches=programme&&target===Number(targetYear);
  const existing=Array.isArray(dev?.nextSeasonHistory)?dev.nextSeasonHistory:[];

  if(!matches){
    return {
      ...dev,
      technicalStrategy:null,
    };
  }

  const archived={
    target_season:Number(targetYear),
    archived_at:`${Number(targetYear)}-01-01`,
    status:programme?.status||"not_started",
    progress:round(num(programme?.overall_progress,0),2),
    readiness:programme?.technical_package?.readiness??programme?.readiness??null,
    philosophy_id:programme?.technical_package?.philosophy?.id??programme?.technical_philosophy?.id??"balanced",
    strategy_id:dev?.technicalStrategy?.id||"balanced",
    technical_package:programme?.technical_package||null,
  };
  const history=[
    ...existing.filter((row)=>Number(row?.target_season)!==Number(targetYear)),
    archived,
  ].sort((a,b)=>Number(a?.target_season)-Number(b?.target_season)).slice(-12);

  return {
    ...dev,
    nextSeasonHistory:history,
    nextSeasonCar:null,
    technicalStrategy:null,
  };
}

export function materializeNextSeasonTechnicalWorld(state,targetYear){
  if(!state||typeof state!=="object")return state;
  const carStats=materializeNextSeasonCarStats(state,targetYear);
  return {
    ...state,
    carStats,
    development:archivePlayerProgramme(state,targetYear),
    aiTechnicalWorld:archiveAIProgrammes(state,targetYear),
  };
}
