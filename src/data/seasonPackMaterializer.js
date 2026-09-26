// src/data/seasonPackMaterializer.js
//
// Pure materializer for a historical starting season.
// Global data is editorial/reference data; the returned pack is only the
// playable state at the chosen starting year.
import { isDriverContract, isRaceDriverContract } from "../domain/contractRoles.js";
import {
  applyOpeningStateToDriver,
  openingDriverId,
  openingStateExcluded,
  openingStateIsRaceSeat,
  openingStateIsTeamCommitment,
  openingStateRowsForYear,
  openingTeamId,
} from "../domain/driverOpeningState.js";
import { canonicalTeamId, canonicalTeamName } from "../domain/teamIdentity.js";
import { championshipPointsSystem } from "../domain/championshipRules.js";

const unbox=(v)=>{
  if(v&&typeof v==="object"&&!Array.isArray(v)){
    if("error" in v&&!Object.prototype.hasOwnProperty.call(v,"result")&&!Object.prototype.hasOwnProperty.call(v,"value"))return null;
    if(Object.prototype.hasOwnProperty.call(v,"formula")&&Object.prototype.hasOwnProperty.call(v,"result")) {
      return v.result===undefined||v.result===null||v.result==="" ? null : unbox(v.result);
    }
    if(v.result!==undefined&&v.result!==null&&v.result!=="")return unbox(v.result);
    if(v.value!==undefined&&v.value!==null&&v.value!=="")return unbox(v.value);
  }
  return v;
};
const clean=(value)=>{
  const v=unbox(value);
  if(Array.isArray(v))return v.map(clean);
  if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clean(x)]));
  return v;
};
const pick=(o,keys,fb=undefined)=>{
  if(!o||typeof o!=="object")return fb;
  for(const k of keys){
    if(!Object.prototype.hasOwnProperty.call(o,k))continue;
    const v=unbox(o[k]);
    if(v!==undefined&&v!==null&&v!=="")return v;
  }
  return fb;
};
const asNum=(v,fb=NaN)=>{const raw=unbox(v);if(raw===null||raw===undefined||raw==="")return fb;const n=Number(raw);return Number.isFinite(n)?n:fb;};
const yearOf=(row)=>{
  const direct=asNum(pick(row,["year","season_year","season","yr"],NaN),NaN);
  if(Number.isFinite(direct))return direct;
  for(const k of ["race_date","date","start_date","end_date"]){
    const m=String(pick(row,[k],"")).match(/^(\d{4})/);
    if(m)return Number(m[1]);
  }
  return NaN;
};
const driverId=(r)=>String(pick(r,["driver_id","person_id","id"],""));
const staffId=(r)=>String(pick(r,["staff_id","person_id","id"],""));
const teamId=(r)=>String(pick(r,["team_id","constructor_id","team","constructor","id"],""));
const sponsorId=(r)=>String(pick(r,["sponsor_id","id"],""));
const birthYear=(r)=>{
  const m=String(pick(r,["dob","date_of_birth","birth_date"],"")).match(/^(\d{4})/);
  return m?Number(m[1]):NaN;
};
const ageAt=(r,year)=>{const y=birthYear(r);return Number.isFinite(y)?Math.max(0,year-y):null;};

function rowsAtYear(rows,year){
  return (rows||[]).filter((r)=>yearOf(r)===year);
}
function rowsInRange(rows,year){
  return (rows||[]).filter((r)=>{
    const from=asNum(pick(r,["year_from","start_year","from_year","contract_start_year","contract_start"],NaN),NaN);
    const to=asNum(pick(r,["year_to","end_year","to_year","contract_until_year","contract_until"],Infinity),Infinity);
    if(!Number.isFinite(from))return yearOf(r)===year;
    return year>=from&&year<=to;
  });
}
function exactOrLatest(rows,year,keyFn,wantedIds){
  const byId=new Map();
  for(const row of rows||[]){
    const id=keyFn(row);
    if(!id||wantedIds&&!wantedIds.has(id))continue;
    const ry=yearOf(row);
    if(!Number.isFinite(ry)||ry>year)continue;
    const prev=byId.get(id);
    if(!prev||yearOf(prev)<ry)byId.set(id,row);
  }
  return [...byId.values()].map((r)=>({...clean(r),year}));
}
function exactOrLatestTeamRows(rows,year,teamIds){
  return exactOrLatest(rows,year,teamId,teamIds);
}
function unique(rows,keyFn){
  const m=new Map();
  for(const r of rows||[]){const id=keyFn(r);if(id)m.set(id,r);}
  return [...m.values()];
}
function activeContractRows(rows,year){
  const exact=rowsAtYear(rows,year);
  const ranged=rowsInRange(rows,year);
  return unique([...ranged,...exact],(r)=>[
    driverId(r)||staffId(r)||sponsorId(r),
    teamId(r),
    String(pick(r,["role","position","type"],"")),
  ].join("|"));
}
function seedContractPriority(row,year,teamHistory=[]){
  const exact=yearOf(row)===year?10000:0;
  const start=asNum(pick(row,["contract_start_year","contract_start","start_year"],NaN),NaN);
  const recency=Number.isFinite(start)?Math.min(999,Math.max(0,start-1900)):0;
  const did=driverId(row);
  const tid=teamId(row);
  const historyMatches=(teamHistory||[]).filter((h)=>driverId(h)===did&&teamId(h)===tid);
  const firstRound=Math.min(...historyMatches.map((h)=>asNum(pick(h,["first_round","round_from","start_round"],999),999)));
  const historyScore=historyMatches.length
    ? (firstRound<=1?500:250)+Math.min(100,historyMatches.length*10)
    : 0;
  return exact+historyScore+recency;
}
function reconcileSeedDriverContracts(rows,year,teamHistory=[]){
  // A ranged row from the previous year and an exact row for the selected year
  // can describe the same driver/team with different role labels. Keep only the
  // best current seed row for that driver/team.
  const byDriverTeam=new Map();
  for(const row of rows||[]){
    const did=driverId(row);
    const tid=teamId(row);
    if(!did||!tid)continue;
    const key=`${did}|${tid}`;
    const prev=byDriverTeam.get(key);
    if(!prev||seedContractPriority(row,year,teamHistory)>=seedContractPriority(prev,year,teamHistory)){
      byDriverTeam.set(key,row);
    }
  }

  // A New Game grid cannot put one race driver in two teams. If the historical
  // seed data contains overlapping season-level rows, prefer the exact/current
  // affiliation and let the normal historical bootstrap refill the vacated seat.
  const raceByDriver=new Map();
  const nonRace=[];
  for(const row of byDriverTeam.values()){
    if(!isRaceDriverContract(row)){ nonRace.push(row); continue; }
    const did=driverId(row);
    const prev=raceByDriver.get(did);
    if(!prev||seedContractPriority(row,year,teamHistory)>seedContractPriority(prev,year,teamHistory)){
      raceByDriver.set(did,row);
    }
  }
  return [...nonRace,...raceByDriver.values()];
}
function teamIdsForSeason(g,year){
  const ids=new Set();
  const authoritative=rowsAtYear(g.teamSeasons,year);
  if(authoritative.length){
    for(const row of authoritative){const id=teamId(row);if(id)ids.add(id);}
    return ids;
  }

  // Compatibility fallback for years that do not yet have generated
  // team_seasons coverage. Once team_seasons exists for a year, auxiliary
  // technical/contract datasets must not expand the managerial team list.
  for(const row of rowsAtYear(g.carStats,year)){const id=teamId(row);if(id)ids.add(id);}
  for(const row of rowsAtYear(g.teamBrands,year)){const id=teamId(row);if(id)ids.add(id);}
  for(const row of activeContractRows(g.contracts,year)){const id=teamId(row);if(id)ids.add(id);}
  for(const row of openingStateRowsForYear(g.driverOpeningState||[],year)){
    const id=openingTeamId(row);if(id)ids.add(id);
  }
  for(const row of rowsAtYear(g.driverCareer,year)){
    if(String(pick(row,["series_division","division","series"],"")).toUpperCase()==="F1"){
      const id=teamId(row);if(id)ids.add(id);
    }
  }
  return ids;
}
function driverStatus(driver,year,contracted){
  const born=birthYear(driver);
  const age=Number.isFinite(born)?year-born:null;
  const start=asNum(pick(driver,["career_start_year"],NaN),NaN);
  const debut=asNum(pick(driver,["f1_rookie_season","f1_debut_year"],NaN),NaN);
  const end=asNum(pick(driver,["career_end_year","last_f1_season"],Infinity),Infinity);
  const deathRaw=String(pick(driver,["death_date"],"")).trim();
  const death=asNum(deathRaw.slice(0,4),Infinity);
  if(Number.isFinite(born)&&year<born)return null;
  // Historical New Game snapshots represent the world on January 1.
  // A driver who dies later in the selected season must therefore still exist
  // at game start (e.g. Villeneuve / Paletti in 1982).
  const diedBeforeSeasonStart=/^\d{4}-\d{2}-\d{2}$/.test(deathRaw)
    ? deathRaw<=`${year}-01-01`
    : (Number.isFinite(death)&&death<year);
  if(diedBeforeSeasonStart)return null;
  // Exact season participation/contract evidence outranks stale career-end
  // metadata. This is especially important in later eras where the master
  // career range is not yet fully curated.
  if(contracted)return {status:"eligible",active_lower_series:false,canHireF1:true,canHireAcademy:false,youth_eligible:false};
  if(Number.isFinite(end)&&year>end)return null;
  const explicit=Number.isFinite(start)&&start<=year&&Number.isFinite(debut)&&year<debut;
  const inferred=!Number.isFinite(start)&&Number.isFinite(debut)&&year<debut&&(debut-year)<=3&&age!==null&&age>=16;
  const lower=explicit||inferred;
  if(lower){
    const youth=age!==null&&age>=16&&age<=19;
    const canHireF1=age!==null&&age>=18;
    return {status:youth?"junior_only":"lower_series",active_lower_series:true,canHireF1,canHireAcademy:youth,youth_eligible:youth};
  }
  if(Number.isFinite(debut)&&debut<=year)return {status:"eligible",active_lower_series:false,canHireF1:true,canHireAcademy:false,youth_eligible:false};
  return null;
}
function effectiveSingle(rows,year){
  const exact=rowsAtYear(rows,year);
  if(exact.length)return clean(exact);
  const past=(rows||[]).filter((r)=>Number.isFinite(yearOf(r))&&yearOf(r)<=year).sort((a,b)=>yearOf(b)-yearOf(a));
  return past.length?[{...clean(past[0]),year}]:[];
}
function effectiveRange(rows,year){
  const ranged=rowsInRange(rows,year);
  if(ranged.length)return clean(ranged);
  return effectiveSingle(rows,year);
}
function effectiveQualifyingRules(g,year){
  const historical=effectiveSingle(g.qualifyingRules||[],year)[0]||{};
  const overrides=rowsInRange(g.qualifyingRuleOverrides||[],year).map(clean);
  const generic=overrides.filter((row)=>!pick(row,["gp_id","event_id","track_id","circuit_id"],null));
  const eventOverrides=overrides.filter((row)=>pick(row,["gp_id","event_id","track_id","circuit_id"],null));
  const merged=generic.reduce((acc,row)=>({...acc,...row}),{...clean(historical)});
  return {
    ...merged,
    year,
    rule_source:"historical_seed_calibration",
    event_overrides:eventOverrides,
  };
}
function calendarRows(rows,year){
  return rowsAtYear(rows,year)
    .map((r,index)=>{
      const copy={...clean(r),year,season_year:year,round:asNum(pick(r,["round"],index+1),index+1)};
      for(const k of ["winner","winner_id","winner_driver_id","winner_team_id","result","results","classification","points","champion","race_winner"])delete copy[k];
      return copy;
    })
    .sort((a,b)=>Number(a.round)-Number(b.round));
}

function historicalSnapshotToRating(row,year){
  const copy=clean(row||{});
  const rating={
    year,
    driver_id:driverId(copy),
    driver_name:pick(copy,["display_name","driver_name","name"],driverId(copy)),
    current_ability:asNum(pick(copy,["current_ability"],NaN),null),
    potential_ability:asNum(pick(copy,["peak_ability"],NaN),null),
    pace:asNum(pick(copy,["current_pace"],NaN),null),
    qualifying:asNum(pick(copy,["current_qualifying"],NaN),null),
    start_launch:asNum(pick(copy,["current_start_launch"],NaN),null),
    racecraft:asNum(pick(copy,["current_racecraft"],NaN),null),
    wet_skill:asNum(pick(copy,["current_wet_skill"],NaN),null),
    consistency:asNum(pick(copy,["current_consistency"],NaN),null),
    tire_management:asNum(pick(copy,["current_tire_management"],NaN),null),
    race_intelligence:asNum(pick(copy,["current_race_intelligence"],NaN),null),
    technical_feedback:asNum(pick(copy,["current_technical_feedback"],NaN),null),
    adaptability:asNum(pick(copy,["current_adaptability"],NaN),null),
    resource_management:asNum(pick(copy,["current_resource_management"],NaN),null),
    ers_fuel_management:asNum(pick(copy,["current_resource_management"],NaN),null),
    mentality:asNum(pick(copy,["current_mentality"],NaN),null),
    pressure_handling:asNum(pick(copy,["current_pressure_handling"],NaN),null),
    leadership:asNum(pick(copy,["current_leadership"],NaN),null),
    team_player:asNum(pick(copy,["current_team_player"],NaN),null),
    car_development_impact:asNum(pick(copy,["current_car_development_impact"],NaN),null),
    aggression:asNum(pick(copy,["current_aggression"],NaN),null),
    crash_likelihood:asNum(pick(copy,["current_crash_likelihood"],NaN),null),
    career_stage:pick(copy,["career_stage"],null),
    development_curve:pick(copy,["development_curve"],null),
    rating_tier:pick(copy,["rating_tier"],null),
    rating_confidence:pick(copy,["profile_confidence","rating_confidence"],null),
    development_headroom:asNum(pick(copy,["development_headroom"],NaN),null),
    source_baseline_year:year,
    source:"historical_rating_snapshot_r2b",
    rating_model:"R2B",
  };
  return Object.fromEntries(Object.entries(rating).filter(([,v])=>v!==null&&v!==undefined&&v!==""));
}

function driverRatingsForSeason(g,year,wantedIds){
  const wanted=wantedIds instanceof Set?wantedIds:null;
  const exactV2=rowsAtYear(g.historicalRatingSnapshots||[],year)
    .filter((r)=>!wanted||wanted.has(driverId(r)))
    .map((r)=>historicalSnapshotToRating(r,year))
    .filter((r)=>r.driver_id);
  const byId=new Map(exactV2.map((r)=>[driverId(r),r]));
  const legacy=exactOrLatest(g.driverRatings||[],year,driverId,wanted);
  for(const row of legacy){
    const id=driverId(row);
    if(id&&!byId.has(id))byId.set(id,{...clean(row),year,source:pick(row,["source"],"legacy_driver_ratings")});
  }
  return [...byId.values()];
}

export function materializeSeasonPack(globalData,yearInput){
  const year=Number(yearInput);
  if(!Number.isInteger(year))throw new TypeError("Season year must be an integer.");
  const g=globalData||{};
  const rawTeamIds=teamIdsForSeason(g,year);
  const rawSeasonTeamRows=rowsAtYear(g.teamSeasons,year);
  const rawSeasonBrandRows=rowsAtYear(g.teamBrands,year);
  const teamMaster=new Map((g.teams||[]).map((t)=>[teamId(t),t]).filter(([id])=>id&&!/^\[object/i.test(id)));
  const masterNameToId=new Map();
  for(const [id,row] of teamMaster){
    const name=String(pick(row,["team_name","name","short_name"],"")).trim();
    if(name)masterNameToId.set(name.toLowerCase(),id);
  }

  const managerialTeamId=(rawId)=>{
    const id=canonicalTeamId(String(rawId||""));
    if(!id||/^\[object/i.test(id))return "";
    const row=teamMaster.get(id);
    const name=canonicalTeamName(String(pick(row||{},["team_name","name","short_name"],"")).trim());
    if(!name)return id;

    if(/^team lotus$/i.test(name) && masterNameToId.has("lotus")) return masterNameToId.get("lotus");

    const dash=name.indexOf("-");
    if(dash>0){
      const base=name.slice(0,dash).trim().toLowerCase();
      if(masterNameToId.has(base)) return masterNameToId.get(base);
    }
    return id;
  };

  const openingStateRows=openingStateRowsForYear(g.driverOpeningState||[],year)
    .map((row)=>({
      ...clean(row),
      opening_team_id:managerialTeamId(openingTeamId(row))||null,
    }));
  const hasOpeningState=openingStateRows.length>0;
  const openingByDriver=new Map(
    openingStateRows.map((row)=>[openingDriverId(row),row]).filter(([id])=>id)
  );

  const teamIds=new Set([...rawTeamIds].map(managerialTeamId).filter(Boolean));
  const normalizeTeamRow=(row)=>{
    const id=managerialTeamId(teamId(row));
    return id?{...clean(row),team_id:id}:null;
  };
  const seasonTeamRows=rawSeasonTeamRows.map(normalizeTeamRow).filter(Boolean);
  const seasonBrandRows=rawSeasonBrandRows.map(normalizeTeamRow).filter(Boolean);
  const teamSeasonById=new Map(seasonTeamRows.map((t)=>[teamId(t),t]).filter(([id])=>id));
  const teamBrandById=new Map(seasonBrandRows.map((t)=>[teamId(t),t]).filter(([id])=>id));
  const teams=[...teamIds].map((id)=>{
    const base=teamMaster.get(id)||teamSeasonById.get(id)||teamBrandById.get(id)||{};
    const seasonRec=teamSeasonById.get(id)||{};
    const brandRec=teamBrandById.get(id)||{};
    return {
      ...clean(base),
      team_id:id,
      team_name:pick(brandRec,["team_name","team_official_name","short_name"],pick(base,["team_name","name","short_name"],pick(seasonRec,["team_name"],id))),
    };
  });
  // Race-result participation and F1 career rows repair incomplete contract data.
  const seasonRows=seasonTeamRows;
  const f1Career=rowsAtYear(g.driverCareer,year)
    .filter((r)=>String(pick(r,["series_division","division","series"],"")).toUpperCase()==="F1")
    .map(normalizeTeamRow).filter(Boolean);

  const driverMasterForBootstrap=new Map((g.drivers||[]).map((d)=>[driverId(d),d]).filter(([id])=>id));
  const driverNameForBootstrap=(id)=>{
    const d=driverMasterForBootstrap.get(String(id))||{};
    return pick(d,["display_name","driver_name","name"],String(id));
  };
  const isDriverContract=(row)=>{
    const role=String(pick(row,["role","position","contract_role","type"],"driver")).toLowerCase();
    return !role || role.includes("driver") || role.includes("main") || role.includes("second") || role.includes("test");
  };

  const seedTeamHistory=rowsAtYear(g.driverTeamHistory||[],year)
    .map(normalizeTeamRow).filter(Boolean);
  const historicalContractRows=activeContractRows(g.contracts,year)
    .map(normalizeTeamRow).filter(Boolean)
    .filter((r)=>teamIds.has(teamId(r)) && driverId(r));
  const teamNameById=new Map(teams.map((t)=>[teamId(t),pick(t,["team_name","name","short_name"],teamId(t))]));

  let contracts;
  if(hasOpeningState){
    const historicalByDriverTeam=new Map(
      historicalContractRows.map((row)=>[[driverId(row),teamId(row)].join("|"),row])
    );
    contracts=openingStateRows
      .filter(openingStateIsTeamCommitment)
      .map((opening)=>{
        const did=openingDriverId(opening);
        const tid=managerialTeamId(openingTeamId(opening));
        if(!did||!tid)return null;
        const base=historicalByDriverTeam.get([did,tid].join("|"))||{};
        const rawRole=String(pick(opening,["opening_role"],pick(base,["role","position","contract_role"],""))||"");
        const role=openingStateIsRaceSeat(opening)
          ? (/second/i.test(rawRole)?"Second Driver":(/main|first|lead/i.test(rawRole)?"Main Driver":"Race Driver"))
          : (rawRole||"Driver");
        return {
          ...clean(base),
          year,
          team_id:tid,
          team_name:pick(opening,["opening_team_name"],teamNameById.get(tid)||tid),
          driver_id:did,
          driver_name:driverNameForBootstrap(did),
          role,
          status:"active",
          contract_start_year:asNum(pick(base,["contract_start_year","contract_start","start_year"],year),year),
          contract_until_year:asNum(pick(base,["contract_until_year","contract_until","end_year"],year),year),
          opening_state_seed:true,
          synthetic:false,
          source:"driver_opening_state",
          opening_world_status:pick(opening,["opening_world_status"],null),
          opening_availability:pick(opening,["opening_availability"],null),
        };
      })
      .filter(Boolean);
  }else{
    contracts=reconcileSeedDriverContracts(
      historicalContractRows,
      year,
      seedTeamHistory
    );
  }

  // Historical Starting Conditions -> Dynamic Alternative Future:
  // New Game preserves the contracts that exist on the opening date.
  // Do NOT fill vacant seats from later-season Results or from strong free
  // agents. Once the Save World starts, MarketEngine handles AI recruitment
  // through normal negotiations.

  const contractedDriverIds=new Set(contracts.filter(isDriverContract).map(driverId).filter(Boolean));
  const gridDriverIds=new Set(contractedDriverIds);
  if(!hasOpeningState){
    for(const row of seasonRows)for(const id of Array.isArray(row.driver_ids)?row.driver_ids:[])if(id)gridDriverIds.add(String(id));
    for(const row of f1Career){const id=driverId(row);if(id)gridDriverIds.add(id);}
  }

  const drivers=[];
  const driverMaster=new Map((g.drivers||[]).map((d)=>[driverId(d),d]).filter(([id])=>id));
  const careerByDriver=new Map(f1Career.map((d)=>[driverId(d),d]).filter(([id])=>id));
  const contractByDriver=new Map(contracts.map((d)=>[driverId(d),d]).filter(([id])=>id));
  const candidateIds=hasOpeningState
    ?new Set(openingStateRows.filter((row)=>!openingStateExcluded(row)).map(openingDriverId).filter(Boolean))
    :new Set(driverMaster.keys());
  for(const id of gridDriverIds)candidateIds.add(id);

  for(const id of candidateIds){
    const d=driverMaster.get(id)||careerByDriver.get(id)||contractByDriver.get(id)||{driver_id:id};
    const base={
      ...clean(d),
      driver_id:id,
      display_name:pick(d,["display_name","driver_name","name"],pick(careerByDriver.get(id)||{},["driver_name"],pick(contractByDriver.get(id)||{},["driver_name","name"],id))),
      age:ageAt(d,year),
    };

    if(hasOpeningState){
      const opening=openingByDriver.get(id);
      if(!opening)continue;
      const materialized=applyOpeningStateToDriver(base,opening,year);
      if(materialized)drivers.push(materialized);
      continue;
    }

    const status=driverStatus(d,year,gridDriverIds.has(id));
    if(!status)continue;
    drivers.push({...base,...status});
  }
  const driverIds=new Set(drivers.map(driverId));
  const driverRatings=driverRatingsForSeason(g,year,driverIds);
  const driverCareer=rowsAtYear(g.driverCareer,year).map(clean);
  const driverHistory=(g.driverHistory||[])
    .filter((r)=>driverIds.has(driverId(r)) && Number(yearOf(r)) < year)
    .map(clean);

  const staffContracts=activeContractRows(g.staffContracts,year)
    .map(normalizeTeamRow).filter(Boolean)
    .filter((r)=>teamIds.has(teamId(r))).map(clean);
  const contractedStaffIds=new Set(staffContracts.map(staffId).filter(Boolean));
  const staffRatingRows=exactOrLatest(g.staffRatings,year,staffId,null);
  const staffRatingIds=new Set(staffRatingRows.map(staffId));
  const staffIds=new Set([...contractedStaffIds,...staffRatingIds]);
  const staffMaster=new Map((g.staffCore||[]).map((s)=>[staffId(s),s]).filter(([id])=>id));
  const staffContractById=new Map(staffContracts.map((s)=>[staffId(s),s]).filter(([id])=>id));
  const staffCore=[...staffIds].map((id)=>{
    const s=staffMaster.get(id)||staffContractById.get(id)||{staff_id:id};
    return {
      ...clean(s),
      staff_id:id,
      staff_name:pick(s,["staff_name","display_name","name"],pick(staffContractById.get(id)||{},["staff_name","name"],id)),
      age:ageAt(s,year),
    };
  });
  const staffRatings=staffRatingRows.filter((r)=>staffIds.has(staffId(r)));

  const normalizeTeamSource=(rows)=>rows.map(normalizeTeamRow).filter(Boolean);
  const teamBrands=exactOrLatestTeamRows(normalizeTeamSource(g.teamBrands||[]),year,teamIds);
  const teamEngines=exactOrLatestTeamRows(normalizeTeamSource(g.teamEngines||[]),year,teamIds);
  const facilities=exactOrLatestTeamRows(normalizeTeamSource(g.facilities||[]),year,teamIds);
  const carStats=exactOrLatestTeamRows(normalizeTeamSource(g.carStats||[]),year,teamIds);
  const sponsorsContracts=activeContractRows(g.sponsorsContracts,year)
    .map(normalizeTeamRow).filter(Boolean)
    .filter((r)=>teamIds.has(teamId(r)));
  const calendar=calendarRows(g.calendar,year);
  const ratingModel=driverRatings.some((r)=>String(r?.source||"")==="historical_rating_snapshot_r2b")?"R2B":"legacy";

  const pack={
    format:"f1ml-season-pack",
    schemaVersion:1,
    year,
    ratingModel,
    generatedFrom:"global-runtime-json",
    generatedAt:null,
    state:{
      calendar,
      teams,
      drivers,
      driverRatings,
      driverCareer,
      driverHistory,
      driverOpeningState:openingStateRows,
      contracts,
      staffCore,
      staffRatings,
      staffContracts,
      teamBrands,
      teamEngines,
      facilities,
      carStats,
      sponsorsContracts,
      rules:effectiveSingle(g.rules,year),
      qualifyingRules:effectiveQualifyingRules(g,year),
      eraSafety:effectiveSingle(g.eraSafety,year),
      accidentModel:effectiveSingle(Array.isArray(g.accidentModel)?g.accidentModel:[],year),
      tyres:effectiveRange(g.tyres,year),
      pointsSystem:championshipPointsSystem(year,effectiveRange(g.pointsSystems,year)[0]||null),
      penaltiesRules:effectiveRange(g.penaltiesRules,year),
      financialRules:effectiveRange(g.financialRules,year),
      agendaBlocks:effectiveRange(g.agendaBlocks,year),
      youthIntakeRules:effectiveRange(g.youthIntakeRules,year),
      contractRules:effectiveRange(g.contractRules,year),
      scoutingZones:clean(g.scoutingZones||[]),
      coreTracks:clean(g.coreTracks||[]),
      trackLayoutByYear:effectiveRange(g.trackLayoutByYear,year),
    },
  };
  const validation=validateSeasonPack(pack);
  return {...pack,validation};
}

export function validateSeasonPack(pack){
  const issues=[];
  const s=pack?.state||{};
  const year=Number(pack?.year);
  if(pack?.format!=="f1ml-season-pack")issues.push("invalid_format");
  if(!Number.isInteger(year))issues.push("invalid_year");
  if(!Array.isArray(s.calendar)||!s.calendar.length)issues.push("no_calendar");
  if(!Array.isArray(s.teams)||!s.teams.length)issues.push("no_teams");
  if(!Array.isArray(s.drivers)||!s.drivers.length)issues.push("no_drivers");
  if(!s.qualifyingRules||typeof s.qualifyingRules!=="object")issues.push("no_qualifying_rules");
  if(year>=1980&&year<=1985&&pack?.ratingModel!=="R2B")issues.push("missing_r2b_driver_ratings");

  const teamIds=new Set((s.teams||[]).map(teamId).filter(Boolean));
  const driverIds=new Set((s.drivers||[]).map(driverId).filter(Boolean));
  const orphanContracts=(s.contracts||[]).filter((r)=>!teamIds.has(teamId(r))||!driverIds.has(driverId(r))).length;
  if(orphanContracts)issues.push(`orphan_driver_contracts:${orphanContracts}`);

  const gridContracts=(s.contracts||[]).filter(isRaceDriverContract);
  const seenRaceDrivers=new Set();
  let duplicateRaceAssignments=0;
  for(const row of gridContracts){
    const did=driverId(row);
    if(!did)continue;
    if(seenRaceDrivers.has(did))duplicateRaceAssignments++;
    else seenRaceDrivers.add(did);
  }
  if(duplicateRaceAssignments)issues.push(`duplicate_race_driver_contracts:${duplicateRaceAssignments}`);
  const warnings=[];
  const openingRows=Array.isArray(s.driverOpeningState)?s.driverOpeningState:[];
  if(openingRows.length){
    const openingActiveRows=openingRows.filter((row)=>!openingStateExcluded(row));
    const openingIds=new Set(openingActiveRows.map(openingDriverId).filter(Boolean));
    const openingRaceRows=openingActiveRows.filter(openingStateIsRaceSeat);
    const missingOpeningDrivers=[...openingIds].filter((id)=>!driverIds.has(id));
    if(missingOpeningDrivers.length)issues.push(`missing_opening_drivers:${missingOpeningDrivers.length}`);
    if(gridContracts.length!==openingRaceRows.length){
      issues.push(`opening_grid_contract_mismatch:${gridContracts.length}/${openingRaceRows.length}`);
    }
    const leakedBootstrap=(s.contracts||[]).filter((row)=>
      ["season_results_bootstrap","ai_grid_bootstrap"].includes(String(row?.source||""))
    ).length;
    if(leakedBootstrap)issues.push(`opening_state_bootstrap_leak:${leakedBootstrap}`);

    const ratingIds=new Set((s.driverRatings||[]).map(driverId).filter(Boolean));
    const raceRatingMissing=openingRaceRows
      .map(openingDriverId)
      .filter((id)=>id&&!ratingIds.has(id));
    if(raceRatingMissing.length)issues.push(`opening_race_drivers_without_rating:${raceRatingMissing.length}`);
    const allRatingMissing=[...openingIds].filter((id)=>!ratingIds.has(id));
    if(allRatingMissing.length)warnings.push(`opening_drivers_without_rating:${allRatingMissing.length}`);
  }else if(gridContracts.length<Math.min(2,teamIds.size*2)){
    warnings.push(`sparse_driver_contracts:${gridContracts.length}`);
  }
  if((s.staffCore||[]).length<teamIds.size)warnings.push(`sparse_staff:${(s.staffCore||[]).length}`);

  return {
    ok:issues.length===0,
    issues,
    warnings,
    counts:{
      calendar:(s.calendar||[]).length,
      teams:(s.teams||[]).length,
      drivers:(s.drivers||[]).length,
      driverRatings:(s.driverRatings||[]).length,
      openingState:(s.driverOpeningState||[]).length,
      contractedDrivers:gridContracts.length,
      staff:(s.staffCore||[]).length,
      staffContracts:(s.staffContracts||[]).length,
    },
  };
}

export function discoverSupportedYears(globalData){
  const years=new Set();
  for(const row of globalData?.calendar||[]){const y=yearOf(row);if(Number.isInteger(y))years.add(y);}
  for(const row of globalData?.teamSeasons||[]){const y=yearOf(row);if(Number.isInteger(y))years.add(y);}
  return [...years].sort((a,b)=>a-b);
}
