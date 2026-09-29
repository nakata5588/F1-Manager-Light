// src/domain/staffHistory.js
// Canonical Staff career history derived from historical/live employment
// contracts plus ownership/backer relationships. No duplicate history table.

import {
  collectionRows,
  contractEndYear,
  contractStartYear,
  staffIdOf,
  teamIdOfContract,
} from "./liveContracts.js";
import { canonicalStaffRole, resolveStaffId, staffRoleLabel } from "./staffRoles.js";
import { teamStakeholderHistory } from "./teamStakeholders.js";

const text=(value)=>String(value??"");
const num=(value,fallback=NaN)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const teamIdOf=(row)=>text(row?.team_id??row?.team??row?.constructor_id);

function teamRows(gs){
  const rows=[
    ...collectionRows(gs?.teams),
    ...collectionRows(gs?.dbTeams),
  ];
  const seen=new Set();
  return rows.filter((row)=>{
    const id=teamIdOf(row);
    if(!id||seen.has(id))return false;
    seen.add(id);
    return true;
  });
}
function teamNameMap(gs){
  return new Map(teamRows(gs).map((row)=>[
    teamIdOf(row),
    text(row?.team_name??row?.name??row?.short_name??teamIdOf(row)),
  ]));
}
function employmentRows(gs,staffId){
  const sid=text(staffId);
  const seen=new Map();
  for(const row of [
    ...collectionRows(gs?.dbStaffContracts),
    ...collectionRows(gs?.staffContracts),
  ]){
    const resolved=resolveStaffId(gs,row)||staffIdOf(row);
    if(resolved!==sid)continue;
    const role=canonicalStaffRole(row?.role??row?.position??row?.job);
    // Owner/backer history is normalized by teamStakeholders so we do not show
    // the same historical fact as both employment and ownership.
    if(["owner","sponsor_backer"].includes(role))continue;
    const start=contractStartYear(row,num(row?.year,NaN));
    const end=contractEndYear(row,num(row?.year,start));
    const team=teamIdOfContract(row);
    const key=[sid,team,role,start,end].join("|");
    // Live save-world rows should replace the historical seed if both describe
    // the same assignment.
    seen.set(key,{
      kind:"employment",
      staff_id:sid,
      team_id:team,
      team_name:row?.team_name??row?.constructor_name??null,
      role,
      role_label:staffRoleLabel(role),
      start_year:Number.isFinite(start)?start:null,
      end_year:Number.isFinite(end)?end:null,
      status:text(row?.status||"active").toLowerCase(),
      salary:num(row?.salary??row?.salary_yearly,NaN),
      source:row?.source??"historical_staff_contract",
      raw:row,
    });
  }
  return [...seen.values()];
}

export function staffCareerHistory(gs,staffId){
  const sid=text(staffId);
  if(!sid)return [];
  const names=teamNameMap(gs);
  const employment=employmentRows(gs,sid);
  const stakeholders=teamStakeholderHistory(gs,{staffId:sid}).map((row)=>({
    kind:row.stakeholder_role==="owner"?"ownership":"backing",
    staff_id:sid,
    team_id:row.team_id,
    team_name:row.team_name??null,
    role:row.stakeholder_role,
    role_label:staffRoleLabel(row.stakeholder_role),
    start_year:row.start_year,
    end_year:row.end_year,
    status:text(row?.status||"active").toLowerCase(),
    acquisition_value:num(row?.acquisition_value,NaN),
    investment:num(row?.investment,NaN),
    source:row?.source??"team_stakeholder",
    raw:row,
  }));
  return [...employment,...stakeholders]
    .map((row)=>({
      ...row,
      team_name:row.team_name||names.get(row.team_id)||row.team_id||"Unknown Team",
    }))
    .sort((a,b)=>
      num(b?.start_year,-Infinity)-num(a?.start_year,-Infinity)
      ||num(b?.end_year,-Infinity)-num(a?.end_year,-Infinity)
      ||text(a?.team_name).localeCompare(text(b?.team_name))
    );
}

export function staffCareerSummary(gs,staffId){
  const history=staffCareerHistory(gs,staffId);
  const teams=new Set(history.map((row)=>row.team_id).filter(Boolean));
  const roles=new Set(history.map((row)=>row.role).filter(Boolean));
  return {
    assignments:history.length,
    teams:teams.size,
    roles:[...roles],
    first_year:history.length?Math.min(...history.map((row)=>num(row.start_year,Infinity))):null,
    latest_year:history.length?Math.max(...history.map((row)=>num(row.end_year??gs?.activeYear,-Infinity))):null,
  };
}
