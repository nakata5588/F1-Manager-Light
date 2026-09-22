// src/domain/driverOpeningState.js
// Canonical helpers for historical New Game opening-state data.
//
// Opening-state rows describe what was knowable on January 1 of the selected
// historical season. They are authoritative only for that New Game season;
// once the career rolls forward, the simulated world must take over.

const unwrap=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unwrap(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unwrap(value.value);
  }
  return value;
};

const pick=(row,keys,fallback=undefined)=>{
  for(const key of keys){
    const value=unwrap(row?.[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fallback;
};

const upper=(value)=>String(value??"").trim().toUpperCase();

function yearFrom(value){
  if(value===null||value===undefined||value==="")return NaN;
  const direct=Number(value);
  if(Number.isInteger(direct))return direct;
  const match=String(value).match(/^(\d{4})/);
  return match?Number(match[1]):NaN;
}

function ageForYear(driver,year){
  const dob=String(pick(driver,["dob","date_of_birth","birthdate","birth_date"],""));
  const match=dob.match(/^(\d{4})(?:-(\d{2})-(\d{2}))?/);
  if(match){
    const born=Number(match[1]);
    if(Number.isFinite(born)){
      let age=Number(year)-born;
      // Opening State is the January 1 world. When month/day are known, a
      // birthday later in the year has not happened yet.
      if(match[2]&&match[3]){
        const month=Number(match[2]);
        const day=Number(match[3]);
        if(month>1||(month===1&&day>1))age-=1;
      }
      return Math.max(0,age);
    }
  }
  const explicit=Number(driver?.age);
  return Number.isFinite(explicit)?explicit:null;
}

export function openingStateYear(row){
  const direct=yearFrom(pick(row,["opening_state_year","year","season_year"],NaN));
  if(Number.isFinite(direct))return direct;
  return yearFrom(pick(row,["opening_date"],""));
}

export function openingDriverId(row){
  return String(pick(row,["driver_id","person_id","id"],""));
}

export function openingTeamId(row){
  return String(pick(row,["opening_team_id","team_id","constructor_id","team","constructor"],""));
}

export function openingStateRowsForYear(rows,year){
  const target=Number(year);
  return (rows||[]).filter((row)=>openingStateYear(row)===target);
}

export function openingStateMapForYear(rows,year){
  return new Map(
    openingStateRowsForYear(rows,year)
      .map((row)=>[openingDriverId(row),row])
      .filter(([id])=>id)
  );
}

export function openingStateApplies(driver,year){
  const stateYear=openingStateYear(driver);
  return Number.isFinite(stateYear)
    && stateYear===Number(year)
    && Boolean(
      pick(driver,["opening_world_status"],"")
      ||pick(driver,["opening_availability"],"")
      ||pick(driver,["runtime_market_policy"],"")
    );
}

export function openingStateExcluded(row){
  const visibility=upper(pick(row,["runtime_visibility"],""));
  const availability=upper(pick(row,["opening_availability"],""));
  const world=upper(pick(row,["opening_world_status"],""));
  return visibility==="EXCLUDE_ACTIVE_WORLD"
    ||availability==="DECEASED_UNAVAILABLE"
    ||world==="DECEASED";
}

export function openingStateIsRaceSeat(row){
  return upper(pick(row,["opening_world_status"],""))==="F1_CONTRACTED_RACE_SEAT";
}

export function openingStateIsTeamCommitment(row){
  const availability=upper(pick(row,["opening_availability"],""));
  return Boolean(openingTeamId(row))
    && (
      availability==="F1_CONTRACTED"
      ||availability==="F1_TEAM_COMMITMENT"
      ||availability==="F1_TEAM_COMMITMENT_NON_RACE"
      ||openingStateIsRaceSeat(row)
    );
}

export function openingStateNegotiationBlockReason(driver,year){
  if(!openingStateApplies(driver,year))return null;
  const availability=upper(pick(driver,["opening_availability"],""));
  const policy=upper(pick(driver,["runtime_market_policy"],""));

  if(availability==="DECEASED_UNAVAILABLE")return "deceased";
  if(availability==="RETIRED_UNAVAILABLE")return "retired";
  if(availability==="MARKET_STATUS_RESEARCH")return "market_status_research";
  if(policy==="BLOCKED")return "opening_state_blocked";
  if(policy==="ACADEMY_ONLY")return "academy_only";
  if(policy.includes("BLOCK_DIRECT_NEGOTIATION"))return "market_status_research";
  return null;
}

export function applyOpeningStateToDriver(driver,row,year,{youthMinAge=16,youthMaxAge=19}={}){
  if(!row)return driver?{...driver}:null;
  if(openingStateExcluded(row))return null;

  const targetYear=Number(year);
  const world=upper(pick(row,["opening_world_status"],""));
  const availability=upper(pick(row,["opening_availability"],""));
  const runtimePolicy=String(pick(row,["runtime_market_policy"],""));
  const age=ageForYear(driver||{},targetYear);

  const base={
    ...(driver||{}),
    opening_state_year:targetYear,
    opening_date:pick(row,["opening_date"],`${targetYear}-01-01`),
    opening_world_status:pick(row,["opening_world_status"],null),
    opening_availability:pick(row,["opening_availability"],null),
    opening_team_id:pick(row,["opening_team_id"],null),
    opening_team_name:pick(row,["opening_team_name"],null),
    opening_role:pick(row,["opening_role"],null),
    series_context:pick(row,["series_context"],null),
    season_world_status_reference:pick(row,["season_world_status_reference"],null),
    runtime_market_policy:runtimePolicy||null,
    opening_confidence:pick(row,["confidence"],null),
    opening_qa_status:pick(row,["qa_status"],null),
    opening_source_ids:pick(row,["source_ids"],null),
    age,
  };

  if(world==="RETIRED"||availability==="RETIRED_UNAVAILABLE"){
    return {
      ...base,
      status:"retired",
      active_lower_series:false,
      active_external_series:false,
      youth_eligible:false,
      canHireAcademy:false,
      canHireF1:false,
    };
  }

  const raceSeat=openingStateIsRaceSeat(row);
  const prospect=world==="PROSPECT";
  const external=world==="ACTIVE_OTHER_SERIES"||prospect;
  const outOfF1=world==="OUT_OF_F1_NO_SEAT"||world==="NEEDS_RESEARCH";
  const youth=prospect
    &&Number.isFinite(age)
    &&age>=Number(youthMinAge)
    &&age<=Number(youthMaxAge);

  let status="eligible";
  if(external)status=youth?"junior_only":"lower_series";
  else if(outOfF1)status="eligible";

  const blockReason=openingStateNegotiationBlockReason({
    ...base,
    opening_state_year:targetYear,
  },targetYear);
  const academyOnly=blockReason==="academy_only";
  const fullyBlocked=Boolean(blockReason)&&!academyOnly;
  const oldEnough=!Number.isFinite(age)||age>=18;

  return {
    ...base,
    status:raceSeat?"eligible":status,
    active_lower_series:external,
    active_external_series:external,
    youth_eligible:youth,
    canHireAcademy:youth&&!fullyBlocked,
    canHireF1:!blockReason&&oldEnough,
  };
}

export function openingMarketLabel(driver,year){
  if(!openingStateApplies(driver,year))return null;
  const availability=upper(pick(driver,["opening_availability"],""));
  const world=upper(pick(driver,["opening_world_status"],""));
  const policy=upper(pick(driver,["runtime_market_policy"],""));
  const age=Number(driver?.age);

  if(policy==="ACADEMY_ONLY")return "Academy";
  if(availability==="RETIRED_UNAVAILABLE"||world==="RETIRED")return "Retired";
  if(availability==="DECEASED_UNAVAILABLE"||world==="DECEASED")return "Unavailable";
  if(availability==="MARKET_STATUS_RESEARCH")return "Status Review";
  if(availability==="OTHER_SERIES_COMMITMENT"||availability==="ACTIVE_OTHER_SERIES_NO_F1_SEAT")return "Other Series";
  if(availability==="F1_TEAM_COMMITMENT_NON_RACE")return "Team Commitment";
  if(world==="PROSPECT")return Number.isFinite(age)&&age<=19?"Youth":"Prospect";
  if(world==="OUT_OF_F1_NO_SEAT")return "Free";
  return null;
}
