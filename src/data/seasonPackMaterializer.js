// src/data/seasonPackMaterializer.js
//
// Pure materializer for a historical starting season.
// Global data is editorial/reference data; the returned pack is only the
// playable state at the chosen starting year.
import { isDriverContract, isRaceDriverContract } from "../domain/contractRoles.js";

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
function teamIdsForSeason(g,year){
  const ids=new Set();
  for(const row of rowsAtYear(g.teamSeasons,year)){const id=teamId(row);if(id)ids.add(id);}
  for(const row of rowsAtYear(g.carStats,year)){const id=teamId(row);if(id)ids.add(id);}
  for(const row of rowsAtYear(g.teamBrands,year)){const id=teamId(row);if(id)ids.add(id);}
  for(const row of activeContractRows(g.contracts,year)){const id=teamId(row);if(id)ids.add(id);}
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
  const death=asNum(String(pick(driver,["death_date"],"")).slice(0,4),Infinity);
  if(Number.isFinite(born)&&year<born)return null;
  if(year>=death)return null;
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
    return {status:youth?"junior_only":"lower_series",active_lower_series:true,canHireF1:false,canHireAcademy:youth,youth_eligible:youth};
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
function calendarRows(rows,year){
  return rowsAtYear(rows,year)
    .map((r,index)=>{
      const copy={...clean(r),year,season_year:year,round:asNum(pick(r,["round"],index+1),index+1)};
      for(const k of ["winner","winner_id","winner_driver_id","winner_team_id","result","results","classification","points","champion","race_winner"])delete copy[k];
      return copy;
    })
    .sort((a,b)=>Number(a.round)-Number(b.round));
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
    const id=String(rawId||"");
    if(!id||/^\[object/i.test(id))return "";
    const row=teamMaster.get(id);
    const name=String(pick(row||{},["team_name","name","short_name"],"")).trim();
    if(!name)return id;

    if(/^team lotus$/i.test(name) && masterNameToId.has("lotus")) return masterNameToId.get("lotus");

    const dash=name.indexOf("-");
    if(dash>0){
      const base=name.slice(0,dash).trim().toLowerCase();
      if(masterNameToId.has(base)) return masterNameToId.get(base);
    }
    return id;
  };

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

  let contracts=activeContractRows(g.contracts,year)
    .map(normalizeTeamRow).filter(Boolean)
    .filter((r)=>teamIds.has(teamId(r)) && driverId(r));

  const assignedDrivers=new Set(contracts.filter(isDriverContract).map(driverId).filter(Boolean));
  const historicalPoolForTeam=(tid)=>{
    const ranked=new Map();
    for(const row of seasonRows.filter((r)=>teamId(r)===tid)){
      const details=Array.isArray(row.drivers)&&row.drivers.length
        ? row.drivers
        : (Array.isArray(row.driver_ids)?row.driver_ids.map((id,index)=>({driver_id:id,first_source_index:index,appearances:0})):[]);
      for(const rec of details){
        const id=String(rec?.driver_id||"");
        if(!id)continue;
        const prev=ranked.get(id);
        const score={
          driver_id:id,
          first_round:Number.isFinite(Number(rec?.first_round))?Number(rec.first_round):999,
          first_source_index:Number.isFinite(Number(rec?.first_source_index))?Number(rec.first_source_index):999999,
          appearances:Number(rec?.appearances||0),
        };
        if(!prev || score.first_round<prev.first_round || (score.first_round===prev.first_round && score.first_source_index<prev.first_source_index)) ranked.set(id,score);
      }
    }
    for(const row of f1Career.filter((r)=>teamId(r)===tid)){
      const id=driverId(row);
      if(id&&!ranked.has(id))ranked.set(id,{driver_id:id,first_round:998,first_source_index:999998,appearances:Number(pick(row,["races","starts"],0))||0});
    }
    return [...ranked.values()]
      .sort((a,b)=>a.first_round-b.first_round || a.first_source_index-b.first_source_index || b.appearances-a.appearances || a.driver_id.localeCompare(b.driver_id))
      .map((x)=>x.driver_id);
  };

  const teamNameById=new Map(teams.map((t)=>[teamId(t),pick(t,["team_name","name","short_name"],teamId(t))]));
  const addBootstrapContract=(tid,did,source)=>{
    const teamContracts=contracts.filter((r)=>teamId(r)===tid && isRaceDriverContract(r));
    const role=teamContracts.length===0?"Main Driver":"Second Driver";
    contracts.push({
      year,
      team_id:tid,
      team_name:teamNameById.get(tid)||tid,
      driver_id:did,
      driver_name:driverNameForBootstrap(did),
      role,
      status:"active",
      contract_start_year:year,
      contract_until_year:year,
      synthetic:true,
      source,
    });
    assignedDrivers.add(did);
  };

  for(const tid of teamIds){
    let teamContracts=contracts.filter((r)=>teamId(r)===tid && isRaceDriverContract(r));
    const historicalCandidates=historicalPoolForTeam(tid);
    for(const did of historicalCandidates){
      if(teamContracts.length>=2)break;
      if(assignedDrivers.has(did))continue;
      addBootstrapContract(tid,did,"season_results_bootstrap");
      teamContracts=contracts.filter((r)=>teamId(r)===tid && isRaceDriverContract(r));
    }
  }

  // Last-resort playable-grid bootstrap. This should only be used when the
  // historical source lacks a resolvable second seat.
  const bootstrapRatings=new Map(
    exactOrLatest(g.driverRatings||[],year,driverId,null).map((r)=>[driverId(r),r])
  );
  const fallbackDrivers=(g.drivers||[])
    .filter((d)=>{
      const id=driverId(d);
      if(!id||assignedDrivers.has(id))return false;
      const debut=asNum(pick(d,["f1_rookie_season","f1_debut_year"],NaN),NaN);
      const end=asNum(pick(d,["career_end_year","last_f1_season"],Infinity),Infinity);
      const death=asNum(String(pick(d,["death_date"],"")).slice(0,4),Infinity);
      return Number.isFinite(debut)&&debut<=year&&year<=end&&year<death;
    })
    .sort((a,b)=>{
      const ar=asNum(pick(bootstrapRatings.get(driverId(a))||{},["current_ability","pace"],0),0);
      const br=asNum(pick(bootstrapRatings.get(driverId(b))||{},["current_ability","pace"],0),0);
      return br-ar || driverId(a).localeCompare(driverId(b));
    });
  for(const tid of teamIds){
    let teamContracts=contracts.filter((r)=>teamId(r)===tid && isRaceDriverContract(r));
    while(teamContracts.length<2){
      const next=fallbackDrivers.find((d)=>!assignedDrivers.has(driverId(d)));
      if(!next)break;
      addBootstrapContract(tid,driverId(next),"ai_grid_bootstrap");
      teamContracts=contracts.filter((r)=>teamId(r)===tid && isRaceDriverContract(r));
    }
  }

  const contractedDriverIds=new Set(contracts.filter(isDriverContract).map(driverId).filter(Boolean));
  const gridDriverIds=new Set(contractedDriverIds);
  for(const row of seasonRows)for(const id of Array.isArray(row.driver_ids)?row.driver_ids:[])if(id)gridDriverIds.add(String(id));
  for(const row of f1Career){const id=driverId(row);if(id)gridDriverIds.add(id);}

  const drivers=[];
  const driverMaster=new Map((g.drivers||[]).map((d)=>[driverId(d),d]).filter(([id])=>id));
  const careerByDriver=new Map(f1Career.map((d)=>[driverId(d),d]).filter(([id])=>id));
  const contractByDriver=new Map(contracts.map((d)=>[driverId(d),d]).filter(([id])=>id));
  const candidateIds=new Set(driverMaster.keys());
  for(const id of gridDriverIds)candidateIds.add(id);

  for(const id of candidateIds){
    const d=driverMaster.get(id)||careerByDriver.get(id)||contractByDriver.get(id)||{driver_id:id};
    const status=driverStatus(d,year,gridDriverIds.has(id));
    if(!status)continue;
    drivers.push({
      ...clean(d),
      driver_id:id,
      display_name:pick(d,["display_name","driver_name","name"],pick(careerByDriver.get(id)||{},["driver_name"],pick(contractByDriver.get(id)||{},["driver_name","name"],id))),
      ...status,
      age:ageAt(d,year),
    });
  }
  const driverIds=new Set(drivers.map(driverId));
  const driverRatings=exactOrLatest(g.driverRatings,year,driverId,driverIds);
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

  const pack={
    format:"f1ml-season-pack",
    schemaVersion:1,
    year,
    generatedFrom:"global-runtime-json",
    generatedAt:null,
    state:{
      calendar,
      teams,
      drivers,
      driverRatings,
      driverCareer,
      driverHistory,
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
      eraSafety:effectiveSingle(g.eraSafety,year),
      accidentModel:effectiveSingle(Array.isArray(g.accidentModel)?g.accidentModel:[],year),
      tyres:effectiveRange(g.tyres,year),
      pointsSystem:effectiveRange(g.pointsSystems,year)[0]||null,
      penaltiesRules:effectiveRange(g.penaltiesRules,year),
      financialRules:effectiveRange(g.financialRules,year),
      agendaBlocks:effectiveRange(g.agendaBlocks,year),
      youthIntakeRules:effectiveRange(g.youthIntakeRules,year),
      contractRules:effectiveRange(g.contractRules,year),
      scoutingZones:clean(g.scoutingZones||[]),
      trackLayoutByYear:rowsAtYear(g.trackLayoutByYear,year).map(clean),
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

  const teamIds=new Set((s.teams||[]).map(teamId).filter(Boolean));
  const driverIds=new Set((s.drivers||[]).map(driverId).filter(Boolean));
  const orphanContracts=(s.contracts||[]).filter((r)=>!teamIds.has(teamId(r))||!driverIds.has(driverId(r))).length;
  if(orphanContracts)issues.push(`orphan_driver_contracts:${orphanContracts}`);

  const gridContracts=(s.contracts||[]).filter(isRaceDriverContract);
  const warnings=[];
  if(gridContracts.length<Math.min(2,teamIds.size*2))warnings.push(`sparse_driver_contracts:${gridContracts.length}`);
  if((s.staffCore||[]).length<teamIds.size)warnings.push(`sparse_staff:${(s.staffCore||[]).length}`);

  return {
    ok:issues.length===0,
    issues,
    warnings,
    counts:{
      calendar:(s.calendar||[]).length,
      teams:(s.teams||[]).length,
      drivers:(s.drivers||[]).length,
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
