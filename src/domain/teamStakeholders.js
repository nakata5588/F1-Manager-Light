// src/domain/teamStakeholders.js
// Canonical team ownership / backer relationships.
//
// Historical owner rows currently live in staff_contracts. They remain valid
// historical facts, but simulated future ownership/backing is stored here so
// employment contracts, payroll and stakeholder relationships do not become
// the same system.

import {
  collectionRows,
  contractActiveForYear,
  contractEndYear,
  contractStartYear,
  staffIdOf,
  teamIdOfContract,
} from "./liveContracts.js";
import { canonicalStaffRole, resolveStaffId } from "./staffRoles.js";

export const TEAM_STAKEHOLDER_ROLES=Object.freeze(["owner","sponsor_backer"]);

const text=(value)=>String(value??"");
const num=(value,fallback=NaN)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const dateOnly=(value)=>text(value).slice(0,10);
const roleOf=(row)=>canonicalStaffRole(row?.stakeholder_role??row?.role??row?.position??"");

function teamIdOf(row){
  return text(row?.team_id??row?.team??row?.constructor_id);
}
function normalizedStatus(row){
  return text(row?.status||"active").toLowerCase();
}
function activeStakeholderRow(row,year){
  if(!row)return false;
  if(["ended","expired","released","inactive","void","sold"].includes(normalizedStatus(row)))return false;
  const start=num(row?.start_year??row?.contract_start_year??row?.contract_start??row?.year,-Infinity);
  const end=num(row?.end_year??row?.contract_until_year??row?.contract_until,Infinity);
  return Number(year)>=start&&Number(year)<=end;
}
function legacyRows(gs){
  const seen=new Set();
  const rows=[];
  for(const row of [
    ...collectionRows(gs?.dbStaffContracts),
    ...collectionRows(gs?.staffContracts),
  ]){
    const role=canonicalStaffRole(row?.role??row?.position);
    if(!TEAM_STAKEHOLDER_ROLES.includes(role))continue;
    const staffId=resolveStaffId(gs,row)||staffIdOf(row);
    const teamId=teamIdOfContract(row);
    if(!staffId||!teamId)continue;
    const start=contractStartYear(row,Number(row?.year));
    const end=contractEndYear(row,Number(row?.year));
    const key=[staffId,teamId,role,start,end].join("|");
    if(seen.has(key))continue;
    seen.add(key);
    rows.push({
      id:"legacy_stakeholder_"+key.replace(/[^a-zA-Z0-9_-]+/g,"_"),
      staff_id:staffId,
      staff_name:row?.staff_name??row?.name??staffId,
      team_id:teamId,
      team_name:row?.team_name??row?.constructor_name??teamId,
      stakeholder_role:role,
      start_year:start,
      end_year:end,
      start_date:row?.start_date??null,
      end_date:row?.end_date??null,
      status:row?.status??"active",
      source:"historical_staff_contract",
      legacy_contract:row,
    });
  }
  return rows;
}
export function liveTeamStakeholders(gs){
  return collectionRows(gs?.teamStakeholders);
}
export function teamStakeholderHistory(gs,{staffId=null,teamId=null,role=null}={}){
  const staff=text(staffId);
  const team=text(teamId);
  const canonical=role?canonicalStaffRole(role):null;
  const seen=new Set();
  const merged=[];
  for(const row of [...legacyRows(gs),...liveTeamStakeholders(gs)]){
    const r=roleOf(row);
    const sid=text(row?.staff_id??row?.person_id);
    const tid=teamIdOf(row);
    if(staff&&sid!==staff)continue;
    if(team&&tid!==team)continue;
    if(canonical&&r!==canonical)continue;
    if(!TEAM_STAKEHOLDER_ROLES.includes(r))continue;
    const start=num(row?.start_year??row?.year,NaN);
    const end=num(row?.end_year,NaN);
    const activeYear=Number(gs?.activeYear);
    if(Number.isFinite(activeYear)&&Number.isFinite(start)&&start>activeYear)continue;
    const key=[sid,tid,r,start,end,row?.source??""].join("|");
    if(seen.has(key))continue;
    seen.add(key);
    merged.push({
      ...row,
      staff_id:sid,
      team_id:tid,
      stakeholder_role:r,
      start_year:Number.isFinite(start)?start:null,
      end_year:Number.isFinite(end)?end:null,
    });
  }
  return merged.sort((a,b)=>
    num(b?.start_year,-Infinity)-num(a?.start_year,-Infinity)
    ||text(a?.team_id).localeCompare(text(b?.team_id))
  );
}
export function currentTeamStakeholder(gs,teamId,role){
  const year=Number(gs?.activeYear);
  const tid=text(teamId);
  const canonical=canonicalStaffRole(role);
  // Save-world relationships override legacy facts once they exist.
  const live=liveTeamStakeholders(gs)
    .filter((row)=>teamIdOf(row)===tid&&roleOf(row)===canonical)
    .filter((row)=>activeStakeholderRow(row,year))
    .sort((a,b)=>num(b?.start_year,-Infinity)-num(a?.start_year,-Infinity))[0];
  if(live)return {...live,stakeholder_role:canonical,team_id:tid};

  const legacy=legacyRows(gs)
    .filter((row)=>row.team_id===tid&&row.stakeholder_role===canonical)
    .filter((row)=>contractActiveForYear(row.legacy_contract,year))
    .sort((a,b)=>num(b?.start_year,-Infinity)-num(a?.start_year,-Infinity))[0];
  return legacy||null;
}
export const currentTeamOwner=(gs,teamId)=>currentTeamStakeholder(gs,teamId,"owner");
export const currentTeamBacker=(gs,teamId)=>currentTeamStakeholder(gs,teamId,"sponsor_backer");

export function currentStakeholderTeamForStaff(gs,staffId,role){
  const year=Number(gs?.activeYear);
  const sid=text(staffId);
  const canonical=canonicalStaffRole(role);
  const teams=new Set([
    ...collectionRows(gs?.teams),
    ...collectionRows(gs?.dbTeams),
  ].map(teamIdOf).filter(Boolean));
  for(const teamId of teams){
    const row=currentTeamStakeholder(gs,teamId,canonical);
    if(row&&text(row?.staff_id)===sid)return row;
  }
  // Also check live relationships for teams that may not be in the current grid list.
  return liveTeamStakeholders(gs).find((row)=>
    text(row?.staff_id)===sid&&
    roleOf(row)===canonical&&
    activeStakeholderRow(row,year)
  )||null;
}
export function stakeholderRoleExperience(gs,staffId){
  const sid=text(staffId);
  const roles=new Set();
  const core=[
    ...collectionRows(gs?.staffCore),
    ...collectionRows(gs?.dbStaffCore),
  ].find((row)=>staffIdOf(row)===sid);
  const primary=canonicalStaffRole(core?.role_primary??core?.role);
  if(TEAM_STAKEHOLDER_ROLES.includes(primary))roles.add(primary);
  for(const row of teamStakeholderHistory(gs,{staffId:sid})){
    if(TEAM_STAKEHOLDER_ROLES.includes(row.stakeholder_role))roles.add(row.stakeholder_role);
  }
  return [...roles];
}
export function addTeamStakeholder(gs,{
  staffId,
  staffName=null,
  teamId,
  teamName=null,
  role,
  acquisitionValue=0,
  investment=0,
  source="simulation_stakeholder_market",
  dateISO=null,
}={}){
  const sid=text(staffId);
  const tid=text(teamId);
  const canonical=canonicalStaffRole(role);
  if(!sid||!tid||!TEAM_STAKEHOLDER_ROLES.includes(canonical))return gs;
  if(currentTeamStakeholder(gs,tid,canonical))return gs;
  if(currentStakeholderTeamForStaff(gs,sid,canonical))return gs;
  const year=Number(gs?.activeYear);
  const date=dateOnly(dateISO||gs?.currentDateISO);
  const row={
    id:["stakeholder",canonical,year,tid,sid].join("_"),
    staff_id:sid,
    staff_name:staffName||sid,
    team_id:tid,
    team_name:teamName||tid,
    stakeholder_role:canonical,
    start_year:year,
    end_year:null,
    start_date:date||null,
    end_date:null,
    status:"active",
    acquisition_value:Math.max(0,Math.round(Number(acquisitionValue)||0)),
    investment:Math.max(0,Math.round(Number(investment)||0)),
    source,
  };
  return {...gs,teamStakeholders:[...liveTeamStakeholders(gs),row]};
}
export function endTeamStakeholder(gs,{teamId,role,reason="ended",dateISO=null}={}){
  const tid=text(teamId);
  const canonical=canonicalStaffRole(role);
  const year=Number(gs?.activeYear);
  const date=dateOnly(dateISO||gs?.currentDateISO);
  let changed=false;
  const rows=liveTeamStakeholders(gs).map((row)=>{
    if(teamIdOf(row)!==tid||roleOf(row)!==canonical||!activeStakeholderRow(row,year))return row;
    changed=true;
    return {
      ...row,
      status:"ended",
      end_year:year,
      end_date:date||null,
      end_reason:reason,
    };
  });
  return changed?{...gs,teamStakeholders:rows}:gs;
}
