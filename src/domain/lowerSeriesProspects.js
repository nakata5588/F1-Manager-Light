// src/domain/lowerSeriesProspects.js
//
// LS5 — Lower Series prospect visibility and F1 interest.
//
// This layer deliberately uses public Save-World evidence (Lower Series results,
// age, championship level and explicit academy/team links). It never reads a
// driver's hidden Potential Ability, so a high-PA prospect can still be missed
// if the alternative-history results do not attract F1 attention.

import { gameplayRngFor } from "../core/random.js";
import { teamReputation } from "./teamReputation.js";

export const LOWER_SERIES_PROSPECT_MODEL="lower_series_prospect_interest_v1";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const round1=(value)=>Math.round(Number(value||0)*10)/10;
const driverIdOf=(row)=>text(row?.driver_id??row?.person_id??row?.id);
const teamIdOf=(row)=>text(row?.team_id??row?.constructor_id??row?.id);

function contractActiveForYear(row,year){
  const status=text(row?.status||"active").toLowerCase();
  if(["released","ended","expired","cancelled","inactive"].includes(status))return false;
  const from=num(row?.contract_start_year??row?.start_year??row?.year,year);
  const to=num(row?.contract_until_year??row?.end_year??row?.year,year);
  return Number(year)>=Number(from)&&Number(year)<=Number(to);
}

function raceDriverContract(row){
  const role=text(row?.role??row?.position??row?.contract_role).toLowerCase();
  return /main|first|lead|second|driver\s*[12]|race/.test(role)
    && !/reserve|test/.test(role);
}

function activeF1TeamIds(gameState,year){
  const ids=new Set();
  for(const row of rows(gameState?.contracts)){
    if(!contractActiveForYear(row,year)||!raceDriverContract(row))continue;
    const id=teamIdOf(row);
    if(id)ids.add(id);
  }
  const playerTeamId=teamIdOf(gameState?.team||{});
  if(playerTeamId)ids.add(playerTeamId);
  return [...ids].sort();
}

function driverRecord(gameState,driverId){
  const id=text(driverId);
  return rows(gameState?.drivers).find((row)=>driverIdOf(row)===id)
    ||rows(gameState?.dbDrivers).find((row)=>driverIdOf(row)===id)
    ||{driver_id:id};
}

function academyConnection(gameState,driverId){
  const id=text(driverId);
  const playerTeamId=teamIdOf(gameState?.team||{});
  if(!id||!playerTeamId)return null;
  const entry=rows(gameState?.academy?.drivers).find((row)=>
    driverIdOf(row)===id&&text(row?.status||"active").toLowerCase()!=="inactive"
  );
  if(!entry)return null;
  return {
    f1_team_id:playerTeamId,
    relationship_type:text(entry?.mode)||"academy",
    source:"player_academy",
  };
}

function lowerTeamConnections(gameState,entry,year){
  const lowerTeamId=text(entry?.lower_team_id);
  if(!lowerTeamId)return [];
  const source=rows(gameState?.lowerSeriesTeamLinks).length
    ?rows(gameState.lowerSeriesTeamLinks)
    :rows(gameState?.dbLowerSeriesTeamLinks);
  return source
    .filter((row)=>text(row?.lower_team_id??row?.team_id)===lowerTeamId)
    .filter((row)=>{
      const from=num(row?.valid_from??row?.start_year,-Infinity);
      const to=num(row?.valid_to??row?.end_year,Infinity);
      return Number(year)>=from&&Number(year)<=to;
    })
    .map((row)=>({
      f1_team_id:text(row?.f1_team_id??row?.parent_team_id),
      relationship_type:text(row?.relationship_type??row?.link_type)||"affiliate",
      source:"lower_series_team_link",
    }))
    .filter((row)=>row.f1_team_id);
}

function standingFor(world,entry){
  const seriesId=text(entry?.series_id);
  const standing=world?.standings?.[seriesId]||null;
  const driver=rows(standing?.drivers).find((row)=>driverIdOf(row)===driverIdOf(entry))||null;
  return {standing,driver};
}

function defaultReputation(entry){
  const level=num(entry?.series_level,5);
  return clamp(32-level*2,18,28);
}

function performanceSignal(entry,standingRow,standings){
  if(!standingRow)return {
    starts:0,
    position:null,
    field_size:rows(standings?.drivers).length,
    points:0,
    wins:0,
    podiums:0,
    score:null,
    exposure:0,
  };

  const field=Math.max(1,rows(standings?.drivers).length);
  const position=num(standingRow?.position,field);
  const starts=Math.max(0,num(standingRow?.starts,0));
  const leaderPoints=Math.max(0,num(rows(standings?.drivers)[0]?.points,0));
  const points=Math.max(0,num(standingRow?.points,0));
  const wins=Math.max(0,num(standingRow?.wins,0));
  const podiums=Math.max(0,num(standingRow?.podiums,0));
  const rankScore=field<=1?0.5:clamp((field-position)/(field-1),0,1);
  const pointsShare=leaderPoints>0?clamp(points/leaderPoints,0,1):0;
  const winRate=starts>0?clamp(wins/starts,0,1):0;
  const podiumRate=starts>0?clamp(podiums/starts,0,1):0;
  const score=(rankScore*0.42+pointsShare*0.28+winRate*0.18+podiumRate*0.12)*100;
  return {
    starts,
    position,
    field_size:field,
    points:round1(points),
    wins,
    podiums,
    score:round1(score),
    exposure:clamp(starts/4,0,1),
  };
}

function prospectReputation(gameState,world,entry,previous){
  const driver=driverRecord(gameState,entry.driver_id);
  const age=num(driver?.age,null);
  const perf=standingFor(world,entry);
  const signal=performanceSignal(entry,perf.driver,perf.standing);
  const level=clamp(num(entry?.series_level,5),2,5);
  const levelWeight={2:1,3:0.92,4:0.84,5:0.76}[level]||0.8;
  const ageBonus=Number.isFinite(age)?clamp((22-age)*1.8,-6,10):0;
  const seasonStart=clamp(
    num(previous?.season_start_reputation,previous?.prospect_reputation??defaultReputation(entry)),
    0,100
  );

  if(signal.score===null||signal.starts===0){
    return {
      prospect_reputation:round1(seasonStart),
      season_start_reputation:round1(seasonStart),
      performance:signal,
    };
  }

  const target=clamp(20+signal.score*0.72*levelWeight+ageBonus,8,96);
  const blend=0.15+0.75*signal.exposure;
  const reputation=seasonStart*(1-blend)+target*blend;
  return {
    prospect_reputation:round1(clamp(reputation,0,100)),
    season_start_reputation:round1(seasonStart),
    performance:signal,
  };
}

function interestStatus(score,{academy=false}={}){
  if(academy)return "academy_priority";
  if(score>=74)return "priority";
  if(score>=60)return "interested";
  if(score>=46)return "monitoring";
  return "none";
}

function interestRows(gameState,world,entry,reputation){
  const year=Number(world?.season_year??gameState?.activeYear);
  const driverId=driverIdOf(entry);
  const academy=academyConnection(gameState,driverId);
  const lowerLinks=lowerTeamConnections(gameState,entry,year);
  const connections=[...(academy?[academy]:[]),...lowerLinks];
  const connectionByTeam=new Map();
  for(const connection of connections){
    const id=text(connection?.f1_team_id);
    if(!id)continue;
    if(!connectionByTeam.has(id))connectionByTeam.set(id,[]);
    connectionByTeam.get(id).push(connection);
  }

  const teamIds=new Set(activeF1TeamIds(gameState,year));
  for(const id of connectionByTeam.keys())teamIds.add(id);

  const output=[];
  for(const teamId of [...teamIds].sort()){
    const links=connectionByTeam.get(teamId)||[];
    const academyLink=links.some((row)=>row.source==="player_academy");
    const partnerLink=links.some((row)=>row.source==="lower_series_team_link");
    const rng=gameplayRngFor(gameState,"lower-series-f1-interest",`${year}:${driverId}:${teamId}`);
    const fit=(rng.next()-0.5)*16;
    const prestige=teamReputation(gameState,teamId);
    const selectivity=clamp((prestige-45)*0.18,0,9);
    const connectionBoost=(academyLink?30:0)+(partnerLink?18:0);
    const score=round1(clamp(reputation*0.84+fit-selectivity+connectionBoost,0,100));
    const status=interestStatus(score,{academy:academyLink});
    if(status==="none"&&!links.length)continue;
    output.push({
      f1_team_id:teamId,
      score,
      status,
      relationship_type:academyLink
        ?text(links.find((row)=>row.source==="player_academy")?.relationship_type)||"academy"
        :partnerLink
          ?text(links.find((row)=>row.source==="lower_series_team_link")?.relationship_type)||"affiliate"
          :null,
      connection_sources:[...new Set(links.map((row)=>row.source))],
    });
  }

  return output.sort((a,b)=>
    b.score-a.score||
    a.f1_team_id.localeCompare(b.f1_team_id)
  );
}

export function rebuildLowerSeriesProspects(gameState,world){
  if(!world||typeof world!=="object")return {};
  const previous=world.prospects&&typeof world.prospects==="object"?world.prospects:{};
  const next={};

  for(const entry of Object.values(world.entries||{})){
    const driverId=driverIdOf(entry);
    if(!driverId||!entry?.series_id)continue;
    const rep=prospectReputation(gameState,world,entry,previous[driverId]||null);
    const interests=interestRows(gameState,world,entry,rep.prospect_reputation);
    next[driverId]={
      driver_id:driverId,
      season_year:Number(world?.season_year??gameState?.activeYear),
      series_id:text(entry?.series_id)||null,
      series_level:num(entry?.series_level,null),
      lower_team_id:text(entry?.lower_team_id)||null,
      prospect_reputation:rep.prospect_reputation,
      season_start_reputation:rep.season_start_reputation,
      performance:rep.performance,
      f1_interest:interests,
      best_f1_interest:interests[0]||null,
      academy_team_id:interests.find((row)=>row.status==="academy_priority")?.f1_team_id??null,
      model:LOWER_SERIES_PROSPECT_MODEL,
      talent_signal_source:"lower_series_results_and_explicit_links_only",
    };
  }

  return Object.fromEntries(Object.entries(next).sort(([a],[b])=>a.localeCompare(b)));
}

export function lowerSeriesProspect(world,driverId){
  return world?.prospects?.[text(driverId)]??null;
}

export function lowerSeriesF1Interest(world,driverId,teamId=null){
  const prospect=lowerSeriesProspect(world,driverId);
  if(!prospect)return teamId==null?[]:null;
  const list=rows(prospect?.f1_interest);
  if(teamId==null)return list;
  return list.find((row)=>text(row?.f1_team_id)===text(teamId))||null;
}

export function carryLowerSeriesProspect(previous,year){
  if(!previous)return null;
  const carried=round1(clamp(num(previous?.prospect_reputation,defaultReputation(previous))*0.9,0,100));
  return {
    driver_id:text(previous?.driver_id)||null,
    season_year:Number(year),
    series_id:null,
    series_level:null,
    lower_team_id:null,
    prospect_reputation:carried,
    season_start_reputation:carried,
    performance:{
      starts:0,position:null,field_size:0,points:0,wins:0,podiums:0,score:null,exposure:0,
    },
    f1_interest:[],
    best_f1_interest:null,
    academy_team_id:null,
    model:LOWER_SERIES_PROSPECT_MODEL,
    talent_signal_source:"lower_series_results_and_explicit_links_only",
  };
}
