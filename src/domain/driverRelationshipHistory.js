// src/domain/driverRelationshipHistory.js
// Read-only historical relationship context derived from completed F1 career rows.
// This never creates gameplay affinity/rivalry: historical rows establish that two
// entities shared a team, while Save World relationship scores remain simulated.

import {
  historicalCareerDriverMatches,
  mergeHistoricalCareerSources,
  normalizeHistoricalName,
  resolveHistoricalTeamId,
} from "./driverCareerIdentity.js";

const text=(value)=>String(value??"").trim();
const num=(value,fb=null)=>{
  const n=Number(value);
  return Number.isFinite(n)?n:fb;
};
const driverIdOf=(row)=>text(row?.driver_id??row?.driverId??row?.person_id??row?.id);
const driverNameOf=(row)=>text(row?.display_name??row?.driver_name??row?.name??[row?.first_name,row?.last_name].filter(Boolean).join(" "));
const teamNameOf=(row)=>text(row?.team_name??row?.team??row?.constructor);
const careerYear=(row)=>num(row?.year??row?.season_year,null);
const isF1=(row)=>text(row?.series_division??row?.division??row?.series??"F1").toUpperCase()==="F1";
const raced=(row)=>{
  const starts=num(row?.races??row?.starts,null);
  return starts==null?true:starts>0;
};

function uniqueRows(rows=[]){
  const map=new Map();
  for(const row of rows){
    const id=driverIdOf(row);
    const name=normalizeHistoricalName(driverNameOf(row));
    const key=id||name;
    if(key&&!map.has(key))map.set(key,row);
  }
  return [...map.values()];
}

function resolveHistoricalDriver(row,drivers=[]){
  const exact=drivers.find((driver)=>driverIdOf(driver)&&driverIdOf(driver)===driverIdOf(row));
  const matched=exact||drivers.find((driver)=>historicalCareerDriverMatches(row,{
    driverId:driverIdOf(driver),
    driverName:driverNameOf(driver),
  }));
  const name=driverNameOf(matched)||driverNameOf(row)||driverIdOf(row)||"Historical driver";
  const id=driverIdOf(matched)||driverIdOf(row)||("historical_driver:"+normalizeHistoricalName(name));
  return {id,name,driver:matched||null};
}

function yearsOf(group){
  return [...group].map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
}

function neutralHistoricalRecord({driverId,targetType,targetId,targetName,years,teamIds=[],teamNames=[]}){
  const ordered=yearsOf(years);
  return {
    driver_id:text(driverId),
    target_type:targetType,
    target_id:text(targetId),
    target_name:text(targetName),
    team_id:teamIds.length===1?text(teamIds[0]):null,
    team_ids:[...new Set(teamIds.map(text).filter(Boolean))],
    team_names:[...new Set(teamNames.map(text).filter(Boolean))],
    trust:50,
    respect:50,
    affinity:50,
    satisfaction:50,
    rivalry:0,
    score:50,
    status:"neutral",
    rivalry_status:"low",
    active:false,
    historical:true,
    source:"historical_career",
    years:ordered,
    first_year:ordered[0]??null,
    last_year:ordered.at(-1)??null,
  };
}

export function historicalDriverRelationshipRecords(gs,{driverId,driverName=null}={}){
  const did=text(driverId);
  const activeYear=num(gs?.activeYear,null);
  if(!did||!Number.isFinite(activeYear))return [];

  const teams=[
    ...(Array.isArray(gs?.dbTeams)?gs.dbTeams:[]),
    ...(Array.isArray(gs?.teams)?gs.teams:[]),
  ];
  const drivers=uniqueRows([
    ...(Array.isArray(gs?.dbDrivers)?gs.dbDrivers:[]),
    ...(Array.isArray(gs?.drivers)?gs.drivers:[]),
  ]);
  const career=mergeHistoricalCareerSources(
    Array.isArray(gs?.driverCareer)?gs.driverCareer:[],
    Array.isArray(gs?.dbDriverCareer)?gs.dbDriverCareer:[],
    teams
  ).filter((row)=>{
    const year=careerYear(row);
    return isF1(row)&&raced(row)&&Number.isFinite(year)&&year<activeYear;
  });

  const subjectRows=career.filter((row)=>historicalCareerDriverMatches(row,{driverId:did,driverName}));
  if(!subjectRows.length)return [];

  const teamGroups=new Map();
  for(const row of subjectRows){
    const year=careerYear(row);
    const teamId=resolveHistoricalTeamId(row,teams);
    const teamName=teamNameOf(row)||teams.find((team)=>text(team?.team_id??team?.id)===teamId)?.team_name||teamId;
    const targetId=teamId||("historical_team:"+normalizeHistoricalName(teamName));
    if(!targetId)continue;
    const group=teamGroups.get(targetId)||{years:new Set(),name:teamName||targetId};
    group.years.add(year);
    if(teamName)group.name=teamName;
    teamGroups.set(targetId,group);
  }

  const teammateGroups=new Map();
  for(const subject of subjectRows){
    const year=careerYear(subject);
    const subjectTeamId=resolveHistoricalTeamId(subject,teams);
    const subjectTeamName=teamNameOf(subject);
    for(const row of career){
      if(careerYear(row)!==year)continue;
      const rowTeamId=resolveHistoricalTeamId(row,teams);
      const sameTeam=subjectTeamId&&rowTeamId
        ?subjectTeamId===rowTeamId
        :normalizeHistoricalName(teamNameOf(row))===normalizeHistoricalName(subjectTeamName);
      if(!sameTeam)continue;
      if(historicalCareerDriverMatches(row,{driverId:did,driverName}))continue;

      const target=resolveHistoricalDriver(row,drivers);
      if(!target.id)continue;
      const key=target.id;
      const group=teammateGroups.get(key)||{
        years:new Set(),
        target,
        teamIds:new Set(),
        teamNames:new Set(),
      };
      group.years.add(year);
      if(rowTeamId)group.teamIds.add(rowTeamId);
      const rowTeamName=teamNameOf(row)||subjectTeamName;
      if(rowTeamName)group.teamNames.add(rowTeamName);
      teammateGroups.set(key,group);
    }
  }

  const result=[];
  for(const [targetId,group] of teamGroups){
    result.push(neutralHistoricalRecord({
      driverId:did,
      targetType:"team",
      targetId,
      targetName:group.name,
      years:group.years,
      teamIds:[targetId],
      teamNames:[group.name],
    }));
  }
  for(const [targetId,group] of teammateGroups){
    result.push(neutralHistoricalRecord({
      driverId:did,
      targetType:"teammate",
      targetId,
      targetName:group.target.name,
      years:group.years,
      teamIds:[...group.teamIds],
      teamNames:[...group.teamNames],
    }));
  }
  return result;
}

export function formatRelationshipYears(years=[]){
  const values=[...new Set((Array.isArray(years)?years:[]).map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
  if(!values.length)return "";
  if(values.length===1)return String(values[0]);
  const contiguous=values.every((year,index)=>index===0||year===values[index-1]+1);
  if(contiguous)return values[0]+"–"+values.at(-1);
  return values.join(", ");
}
