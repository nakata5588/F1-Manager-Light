// src/domain/staffRoles.js
import { activeDriverContracts, teamIdOf as driverTeamIdOf } from "./driverContracts.js";
import {
  activeStaffContracts,
  contractEndYear,
  contractStartYear,
  staffContractsOf,
  staffIdOf,
  teamIdOfContract,
} from "./liveContracts.js";

const text=(value)=>String(value??"").trim();
const normalizeName=(value)=>text(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g," ")
  .trim();

export function resolveStaffId(gs,row){
  const direct=staffIdOf(row);
  if(direct)return direct;
  const name=normalizeName(row?.staff_name??row?.display_name??row?.name??row?.person_name);
  if(!name)return "";
  const core=[
    ...(Array.isArray(gs?.staffCore)?gs.staffCore:[]),
    ...(Array.isArray(gs?.dbStaffCore)?gs.dbStaffCore:[]),
  ];
  const matched=core.find((staff)=>normalizeName(staff?.staff_name??staff?.display_name??staff?.name)===name);
  return matched?staffIdOf(matched):"";
}

export function staffNameKey(value){
  return normalizeName(value);
}

function staffCoreRows(gs){
  const live=Array.isArray(gs?.staffCore)?gs.staffCore:[];
  return live.length?live:(Array.isArray(gs?.dbStaffCore)?gs.dbStaffCore:[]);
}

export function staffDeclaredPrimaryRole(gs,staffId){
  const id=text(staffId);
  const row=staffCoreRows(gs).find((staff)=>staffIdOf(staff)===id)||null;
  return canonicalStaffRole(row?.role_primary??row?.role??row?.position??"staff");
}

export function staffRecordedRoles(gs,staffId,{year=Number(gs?.activeYear),includeLegacy=false}={}){
  const id=text(staffId);
  if(!id)return [];
  const targetYear=Number(year);
  const rows=staffContractsOf(gs)
    .filter((contract)=>resolveStaffId(gs,contract)===id)
    .map((contract)=>{
      const direct=Number(contract?.year??contract?.season_year);
      const start=contractStartYear(contract,direct);
      const end=contractEndYear(contract,direct);
      return {
        role:staffContractRole(contract),
        start:Number.isFinite(start)?start:(Number.isFinite(direct)?direct:-Infinity),
        end:Number.isFinite(end)?end:(Number.isFinite(direct)?direct:Infinity),
      };
    })
    .filter((row)=>!Number.isFinite(targetYear)||row.start<=targetYear)
    .sort((a,b)=>{
      const aActive=Number.isFinite(targetYear)&&a.start<=targetYear&&a.end>=targetYear?1:0;
      const bActive=Number.isFinite(targetYear)&&b.start<=targetYear&&b.end>=targetYear?1:0;
      return bActive-aActive||b.start-a.start||b.end-a.end||staffRolePriority(a.role)-staffRolePriority(b.role);
    });

  const roles=[];
  const add=(role)=>{
    const canonical=canonicalStaffRole(role);
    if(canonical!=="staff"&&!roles.includes(canonical))roles.push(canonical);
  };
  for(const row of rows)add(row.role);
  if(includeLegacy)add(staffDeclaredPrimaryRole(gs,id));
  return roles;
}

export function staffPrimaryCareerRole(gs,staffId,options={}){
  return staffRecordedRoles(gs,staffId,options)[0]||staffDeclaredPrimaryRole(gs,staffId)||"staff";
}

export function canonicalStaffRole(value){
  const raw=text(value).toLowerCase().replace(/[\s-]+/g,"_");
  if(!raw)return "staff";
  const aliases={
    teamprincipal:"team_principal",
    team_manager:"team_principal",
    technicaldirector:"technical_director",
    chiefengineer:"chief_engineer",
    raceengineer:"race_engineer",
    strategist:"chief_strategist",
    chiefstrategist:"chief_strategist",
    chiefdesigner:"chief_designer",
    designer:"chief_designer",
    team_owner:"owner",
  };
  return aliases[raw]||raw;
}

export function staffRoleLabel(value){
  const role=canonicalStaffRole(value);
  const labels={
    owner:"Owner",
    team_principal:"Team Principal",
    technical_director:"Technical Director",
    chief_engineer:"Chief Engineer",
    race_engineer:"Race Engineer",
    chief_strategist:"Chief Strategist",
    chief_designer:"Chief Designer",
    sponsor_backer:"Sponsor Backer",
    main_driver:"Driver",
    second_driver:"Driver",
    test_driver:"Test Driver",
    junior:"Academy Driver",
    staff:"Staff",
  };
  return labels[role]||role.split("_").filter(Boolean).map((part)=>part[0].toUpperCase()+part.slice(1)).join(" ");
}

export function staffRoleDepartment(value){
  const role=canonicalStaffRole(value);
  if(["owner","team_principal"].includes(role))return "Leadership";
  if(["technical_director","chief_engineer","chief_designer","head_vehicle_performance"].includes(role))return "Technical";
  if(["race_engineer","chief_strategist","sporting_director"].includes(role))return "Trackside";
  if(role==="sponsor_backer")return "Commercial";
  return "Staff";
}

export function staffRoleScope(value){
  return canonicalStaffRole(value)==="race_engineer"?"driver":"team";
}

export function staffRolePriority(value){
  const role=canonicalStaffRole(value);
  const order={
    owner:10,
    team_principal:20,
    technical_director:30,
    chief_engineer:40,
    chief_designer:50,
    chief_strategist:60,
    race_engineer:70,
    sponsor_backer:90,
  };
  return order[role]??80;
}

export function staffContractRole(contract){
  return canonicalStaffRole(contract?.role??contract?.position??contract?.job??contract?.role_primary);
}

// Role coverage is historical/structural, not the same thing as a currently
// active incumbent. A released or terminated contract can still prove that a
// role exists in this era, so coverage deliberately ignores contract status
// while respecting the contract's season interval.
export function staffRoleIsRepresented(gs,role){
  const target=canonicalStaffRole(role);
  const year=Number(gs?.activeYear);
  return staffContractsOf(gs).some((contract)=>{
    if(staffContractRole(contract)!==target)return false;
    if(!Number.isFinite(year))return true;
    const direct=Number(contract?.year??contract?.season_year);
    const start=contractStartYear(contract,direct);
    const end=contractEndYear(contract,direct);
    const lo=Number.isFinite(start)?start:(Number.isFinite(direct)?direct:-Infinity);
    const hi=Number.isFinite(end)?end:(Number.isFinite(direct)?direct:Infinity);
    return year>=lo&&year<=hi;
  });
}

export function activeChampionshipTeamIds(gs){
  const ids=new Set(
    activeDriverContracts(gs,{raceOnly:true})
      .map(driverTeamIdOf)
      .filter(Boolean)
  );
  if(ids.size)return ids;
  for(const contract of activeStaffContracts(gs)){
    const teamId=teamIdOfContract(contract);
    if(teamId)ids.add(teamId);
  }
  return ids;
}

export function raceEngineerEraCoverage(gs){
  const teamIds=activeChampionshipTeamIds(gs);
  const contracts=activeStaffContracts(gs)
    .filter((contract)=>staffContractRole(contract)==="race_engineer")
    .filter((contract)=>!teamIds.size||teamIds.has(teamIdOfContract(contract)));
  const teamsWith=new Set(contracts.map(teamIdOfContract).filter(Boolean));
  const teamCount=teamIds.size;
  let status="not_recorded";
  if(contracts.length){
    status=teamCount>0&&teamsWith.size>=teamCount?"complete":"partial";
  }
  return {
    year:Number(gs?.activeYear)||null,
    status,
    contract_count:contracts.length,
    team_count:teamCount,
    teams_with_role:teamsWith.size,
    dedicated_role_recorded:contracts.length>0,
    label:status==="not_recorded"
      ?"Dedicated Race Engineer role not recorded for this era"
      :status==="complete"
        ?"Dedicated Race Engineer role recorded across the field"
        :"Dedicated Race Engineer role only partially recorded",
  };
}

export function teamStaffStructure(gs,teamId){
  const tid=String(teamId??"");
  return activeStaffContracts(gs,{teamId:tid})
    .map((contract)=>({
      ...contract,
      staff_id:resolveStaffId(gs,contract),
      team_id:teamIdOfContract(contract),
      canonical_role:staffContractRole(contract),
      role_label:staffRoleLabel(staffContractRole(contract)),
      department:staffRoleDepartment(staffContractRole(contract)),
      scope:staffRoleScope(staffContractRole(contract)),
    }))
    .sort((a,b)=>staffRolePriority(a.canonical_role)-staffRolePriority(b.canonical_role)
      ||String(a?.staff_name??a?.name??a.staff_id).localeCompare(String(b?.staff_name??b?.name??b.staff_id)));
}
