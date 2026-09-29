// src/engine/LowerSeriesEngine.js
//
// LS4 — lightweight deterministic Lower Series championship core.
//
// lowerSeriesWorld remains the canonical state. This module only transforms
// that world: it resolves Save-World candidate placements, derives a light
// season calendar for levels 2-5, simulates due events deterministically,
// applies an era-aware scoring snapshot and rebuilds driver/team standings.
// It never writes to the canonical F1 results archive.

import { gameplayRngFor } from "../core/random.js";
import { championshipPointsSystem } from "../domain/championshipRules.js";
import { isRaceDriverContract } from "../domain/contractRoles.js";
import { rebuildLowerSeriesProspects } from "../domain/lowerSeriesProspects.js";
import { applyLowerSeriesWorldToDrivers } from "../domain/lowerSeriesWorld.js";

export const LOWER_SERIES_SIMULATION_MODEL="lower_series_light_v1";
export const LOWER_SERIES_CHAMPIONSHIP_MODEL="lower_series_championship_v2";
export const LOWER_SERIES_TEAM_MODEL="lower_series_team_light_v1";
export const LOWER_SERIES_SIMULATED_LEVELS=Object.freeze([2,3,4,5]);

const TRACKED_TEAM_CAPACITY=2;
const ROUNDS_BY_LEVEL=Object.freeze({2:10,3:8,4:7,5:6});

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const driverIdOf=(row)=>text(row?.driver_id??row?.person_id??row?.id);
const teamIdOf=(row)=>text(row?.lower_team_id??row?.team_id??row?.id);

function addDaysISO(year,days){
  const date=new Date(Date.UTC(Number(year),2,15));
  date.setUTCDate(date.getUTCDate()+Number(days||0));
  return date.toISOString().slice(0,10);
}

function activeF1RaceDriverIds(gameState){
  return new Set(
    rows(gameState?.contracts)
      .filter((row)=>String(row?.status||"active").toLowerCase()==="active")
      .filter(isRaceDriverContract)
      .map(driverIdOf)
      .filter(Boolean)
  );
}

function candidateRows(value){
  return rows(value)
    .map((row)=>({
      series_id:text(row?.series_id)||null,
      series_name:text(row?.series_name)||null,
      series_level:num(row?.series_level,null),
    }))
    .filter((row)=>row.series_id);
}

function cloneWorld(world){
  if(!world||typeof world!=="object")return null;
  return {
    ...world,
    series:rows(world.series).map((row)=>({...row})),
    teams:Object.fromEntries(
      Object.entries(world.teams||{}).map(([id,row])=>[id,{...row}])
    ),
    entries:Object.fromEntries(
      Object.entries(world.entries||{}).map(([id,row])=>[id,{
        ...row,
        series_candidates:candidateRows(row?.series_candidates),
      }])
    ),
    standings:Object.fromEntries(
      Object.entries(world.standings||{}).map(([id,value])=>[id,{
        ...(value||{}),
        points_table:rows(value?.points_table).slice(),
        drivers:rows(value?.drivers).map((row)=>({...row})),
        teams:rows(value?.teams).map((row)=>({...row})),
      }])
    ),
    prospects:Object.fromEntries(
      Object.entries(world.prospects||{}).map(([id,value])=>[id,{
        ...(value||{}),
        performance:value?.performance?{...value.performance}:null,
        f1_interest:rows(value?.f1_interest).map((row)=>({
          ...row,
          connection_sources:rows(row?.connection_sources).slice(),
        })),
        best_f1_interest:value?.best_f1_interest?{
          ...value.best_f1_interest,
          connection_sources:rows(value.best_f1_interest?.connection_sources).slice(),
        }:null,
      }])
    ),
    events:rows(world.events).map((row)=>({
      ...row,
      points_table:rows(row?.points_table).slice(),
    })),
    results:rows(world.results).map((row)=>({
      ...row,
      points_table:rows(row?.points_table).slice(),
      classification:rows(row?.classification).map((item)=>({...item})),
    })),
    history:rows(world.history).map((row)=>({...row})),
  };
}

function resolveCandidatePlacements(gameState,world){
  const next=cloneWorld(world);
  if(!next)return world;

  for(const [driverId,entry] of Object.entries(next.entries||{})){
    if(entry?.series_id)continue;
    const candidates=candidateRows(entry?.series_candidates);
    if(!candidates.length)continue;

    const ordered=candidates.slice().sort((a,b)=>String(a.series_id).localeCompare(String(b.series_id)));
    const rng=gameplayRngFor(
      gameState,
      "lower-series-placement",
      `${next.season_year}:${driverId}:${ordered.map((row)=>row.series_id).join(",")}`
    );
    const chosen=ordered[Math.floor(rng.next()*ordered.length)]||ordered[0];
    next.entries[driverId]={
      ...entry,
      series_id:chosen.series_id,
      series_name:chosen.series_name,
      series_level:chosen.series_level,
      series_candidates:[],
      placement_status:entry?.lower_team_id?"placed_with_team":"series_only",
      placement_source:"save_world_candidate_resolution",
    };
  }
  return next;
}

function participantsBySeries(world,gameState){
  const excluded=activeF1RaceDriverIds(gameState);
  const bySeries=new Map();

  for(const entry of Object.values(world?.entries||{})){
    const driverId=text(entry?.driver_id);
    const seriesId=text(entry?.series_id);
    const level=num(entry?.series_level,null);
    if(!driverId||!seriesId||excluded.has(driverId))continue;
    if(!LOWER_SERIES_SIMULATED_LEVELS.includes(level))continue;
    if(!bySeries.has(seriesId))bySeries.set(seriesId,[]);
    bySeries.get(seriesId).push(entry);
  }

  for(const value of bySeries.values()){
    value.sort((a,b)=>String(a.driver_id).localeCompare(String(b.driver_id)));
  }
  return bySeries;
}

function teamReliabilityPercent(value){
  const raw=num(value,null);
  if(raw===null)return 90;
  return raw<=1?clamp(raw*100,0,100):clamp(raw,0,100);
}

function materializeTeamPerformance(gameState,world){
  const next=cloneWorld(world);
  if(!next)return world;
  const year=Number(next.season_year??gameState?.activeYear);
  if(!Number.isInteger(year))return next;

  for(const [teamId,team] of Object.entries(next.teams||{})){
    if(Number(team?.performance_profile_year)===year)continue;

    const rng=gameplayRngFor(
      gameState,
      "lower-series-team-profile",
      `${year}:${teamId}`
    );
    const previousProfileYear=num(team?.performance_profile_year,null);
    const carried=Number.isFinite(previousProfileYear)&&previousProfileYear<year;

    let teamStrength;
    let reliability;
    let developmentEnvironment;
    if(carried){
      const priorStrength=num(team?.team_strength,50);
      const priorReliability=teamReliabilityPercent(team?.reliability);
      const priorDevelopment=num(team?.development_environment,50);
      const developmentEffect=clamp((priorDevelopment-50)/25,-1,1);
      teamStrength=clamp(
        priorStrength+developmentEffect*0.75+(rng.next()-0.5)*2.2,
        35,72
      );
      reliability=clamp(
        priorReliability+(rng.next()-0.5)*1.8,
        80,98
      );
      developmentEnvironment=clamp(
        priorDevelopment+(rng.next()-0.5)*1.4,
        35,75
      );
    }else{
      const seededStrength=clamp(50+(rng.next()-0.5)*14,43,57);
      const seededReliability=clamp(90+(rng.next()-0.5)*8,86,94);
      const seededDevelopment=clamp(50+(rng.next()-0.5)*18,41,59);
      const neutralSeed=String(team?.calibration_status||"")==="neutral_catalog_seed";
      const hasExplicitProfile=
        num(team?.team_strength,null)!==null||
        num(team?.reliability,null)!==null||
        num(team?.development_environment,null)!==null;
      teamStrength=neutralSeed||!hasExplicitProfile
        ?seededStrength
        :num(team?.team_strength,seededStrength);
      reliability=neutralSeed||!hasExplicitProfile
        ?seededReliability
        :teamReliabilityPercent(team?.reliability??seededReliability);
      developmentEnvironment=neutralSeed||!hasExplicitProfile
        ?seededDevelopment
        :num(team?.development_environment,seededDevelopment);
    }

    next.teams[teamId]={
      ...team,
      team_strength:Number(teamStrength.toFixed(1)),
      reliability:Number(reliability.toFixed(1)),
      development_environment:Number(developmentEnvironment.toFixed(1)),
      performance_profile_year:year,
      performance_profile_model:LOWER_SERIES_TEAM_MODEL,
      calibration_status:carried?"save_world_light_evolution":"simulated_light_profile",
    };
  }
  return next;
}

function assignTeamLineups(gameState,world){
  const next=cloneWorld(world);
  if(!next)return world;
  const year=Number(next.season_year??gameState?.activeYear);
  if(!Number.isInteger(year))return next;

  const excluded=activeF1RaceDriverIds(gameState);
  const seriesIds=new Set(
    Object.values(next.entries||{})
      .map((entry)=>text(entry?.series_id))
      .filter(Boolean)
  );

  for(const seriesId of [...seriesIds].sort()){
    const teams=Object.values(next.teams||{})
      .filter((team)=>text(team?.series_id)===seriesId)
      .sort((a,b)=>String(teamIdOf(a)).localeCompare(String(teamIdOf(b))));
    if(!teams.length)continue;

    const entries=Object.values(next.entries||{})
      .filter((entry)=>text(entry?.series_id)===seriesId)
      .filter((entry)=>!excluded.has(text(entry?.driver_id)));
    if(!entries.length)continue;

    const teamById=new Map(teams.map((team)=>[teamIdOf(team),team]));
    const occupied=new Map(teams.map((team)=>[teamIdOf(team),0]));
    for(const entry of entries){
      const teamId=text(entry?.lower_team_id);
      if(teamById.has(teamId)){
        occupied.set(teamId,(occupied.get(teamId)||0)+1);
      }
    }

    const freeSlots=[];
    for(const team of teams){
      const teamId=teamIdOf(team);
      const available=Math.max(0,TRACKED_TEAM_CAPACITY-(occupied.get(teamId)||0));
      for(let slot=0;slot<available;slot++){
        const rng=gameplayRngFor(
          gameState,
          "lower-series-team-slot",
          `${year}:${seriesId}:${teamId}:${slot}`
        );
        freeSlots.push({
          team,
          teamId,
          slot,
          score:num(team?.team_strength,50)+(rng.next()-0.5)*4,
        });
      }
    }
    if(!freeSlots.length)continue;

    const unassigned=entries
      .filter((entry)=>!teamById.has(text(entry?.lower_team_id)))
      .map((entry)=>{
        const rating=ratingForDriver(gameState,entry.driver_id);
        const rng=gameplayRngFor(
          gameState,
          "lower-series-lineup-driver",
          `${year}:${seriesId}:${entry.driver_id}`
        );
        return {
          entry,
          score:abilityAnchor(rating)+(rng.next()-0.5)*5,
        };
      })
      .sort((a,b)=>
        b.score-a.score||
        String(a.entry.driver_id).localeCompare(String(b.entry.driver_id))
      );
    freeSlots.sort((a,b)=>
      b.score-a.score||
      String(a.teamId).localeCompare(String(b.teamId))||
      a.slot-b.slot
    );

    for(let index=0;index<Math.min(unassigned.length,freeSlots.length);index++){
      const {entry}=unassigned[index];
      const {team,teamId}=freeSlots[index];
      next.entries[entry.driver_id]={
        ...entry,
        lower_team_id:teamId,
        team_name:text(team?.team_name)||teamId,
        placement_status:"placed_with_team",
        lineup_source:"save_world_team_assignment",
      };
    }
  }

  return next;
}

function lowerSeriesScoringSnapshot(year){
  const system=championshipPointsSystem(year);
  return {
    points_system_id:system.points_system_id,
    points_table:rows(system.table).map((value)=>Number(value)||0),
    points_system_source:"f1_year_default",
    championship_model:LOWER_SERIES_CHAMPIONSHIP_MODEL,
  };
}

function pointsForPosition(table,position){
  const p=Number(position);
  return Number.isInteger(p)&&p>=1&&p<=rows(table).length
    ?Number(rows(table)[p-1])||0
    :0;
}

function scheduleForSeries(series,year,seriesIndex){
  const level=num(series?.series_level,null);
  const total=ROUNDS_BY_LEVEL[level]||0;
  if(!total)return [];

  const scoring=lowerSeriesScoringSnapshot(year);
  const spanDays=210;
  const stagger=(seriesIndex*3)%10;
  return Array.from({length:total},(_,index)=>{
    const round=index+1;
    const progress=total===1?0:index/(total-1);
    const eventDate=addDaysISO(year,Math.round(progress*spanDays)+stagger);
    return {
      event_id:`ls:${year}:${series.series_id}:${round}`,
      season_year:Number(year),
      series_id:series.series_id,
      series_name:series.series_name,
      series_level:level,
      round,
      event_date:eventDate,
      status:"scheduled",
      simulation_model:LOWER_SERIES_SIMULATION_MODEL,
      ...scoring,
      points_table:scoring.points_table.slice(),
      schedule_source:"derived_lower_series_calendar",
    };
  });
}

export function initializeLowerSeriesSeason(gameState){
  const original=gameState?.lowerSeriesWorld;
  if(!original||typeof original!=="object")return gameState;

  let world=resolveCandidatePlacements(gameState,original);
  const year=Number(world.season_year??gameState?.activeYear);
  if(!Number.isInteger(year))return {...gameState,lowerSeriesWorld:world};

  world=materializeTeamPerformance(gameState,world);
  world=assignTeamLineups(gameState,world);

  const alreadyScheduled=rows(world.events).some((event)=>Number(event?.season_year)===year);
  if(!alreadyScheduled){
    const participants=participantsBySeries(world,gameState);
    const series=rows(world.series)
      .filter((row)=>LOWER_SERIES_SIMULATED_LEVELS.includes(num(row?.series_level,null)))
      .slice()
      .sort((a,b)=>String(a?.series_id).localeCompare(String(b?.series_id)));

    const events=[];
    for(const [index,row] of series.entries()){
      const count=participants.get(String(row?.series_id))?.length||0;
      // We only schedule championships represented by at least one tracked
      // prospect. A one-driver pool may still be skipped at event time until
      // the world contains genuine competition; zero-entry series stay inert.
      if(count<1)continue;
      const schedule=scheduleForSeries(row,year,index).map((event)=>({
        ...event,
        entry_count_at_schedule:count,
      }));
      events.push(...schedule);
    }
    world={
      ...world,
      events:events.sort((a,b)=>
        String(a.event_date).localeCompare(String(b.event_date))||
        String(a.series_id).localeCompare(String(b.series_id))||
        Number(a.round)-Number(b.round)
      ),
    };
  }

  world={
    ...world,
    prospects:rebuildLowerSeriesProspects(
      {...gameState,lowerSeriesWorld:world},
      world
    ),
  };

  const excluded=[...activeF1RaceDriverIds(gameState)];
  const drivers=applyLowerSeriesWorldToDrivers(
    gameState?.drivers||[],
    world,
    {inactiveDriverIds:excluded}
  );
  return {...gameState,lowerSeriesWorld:world,drivers};
}

function ratingForDriver(gameState,driverId){
  const id=text(driverId);
  const ratings=rows(gameState?.driverRatings).length
    ?rows(gameState.driverRatings)
    :rows(gameState?.dbDriverRatings);
  return ratings.find((row)=>driverIdOf(row)===id)||{};
}

function driverForId(gameState,driverId){
  const id=text(driverId);
  return rows(gameState?.drivers).find((row)=>driverIdOf(row)===id)
    ||rows(gameState?.dbDrivers).find((row)=>driverIdOf(row)===id)
    ||{driver_id:id};
}

function abilityAnchor(rating){
  const direct=num(
    rating?.current_ability??
    rating?.overall??
    rating?.rating,
    null
  );
  if(Number.isFinite(direct))return clamp(direct,0,100);

  const attrs=[
    rating?.pace,
    rating?.qualifying,
    rating?.racecraft,
    rating?.consistency,
  ].map((value)=>num(value,null)).filter(Number.isFinite);
  if(!attrs.length)return 50;
  return attrs.reduce((sum,value)=>sum+value,0)/attrs.length;
}

function performanceProfile(gameState,entry){
  const rating=ratingForDriver(gameState,entry.driver_id);
  const driver=driverForId(gameState,entry.driver_id);
  const ability=abilityAnchor(rating);
  const pace=num(rating?.pace,ability);
  const qualifying=num(rating?.qualifying,pace);
  const racecraft=num(rating?.racecraft,ability);
  const consistency=num(rating?.consistency,ability);
  const aggression=num(rating?.aggression,50);

  const team=entry?.lower_team_id
    ?gameState?.lowerSeriesWorld?.teams?.[entry.lower_team_id]||null
    :null;
  const teamStrength=num(team?.team_strength,50);
  const rawReliability=num(team?.reliability,null);
  const reliability=rawReliability===null
    ?0.90
    :(rawReliability>1?clamp(rawReliability,0,100)/100:clamp(rawReliability,0,1));

  return {
    driver,
    rating,
    ability,
    pace,
    qualifying,
    racecraft,
    consistency,
    aggression,
    teamStrength,
    reliability,
  };
}

function simulateEvent(gameState,world,event){
  const scoring={
    ...lowerSeriesScoringSnapshot(event?.season_year??world?.season_year??gameState?.activeYear),
    points_system_id:text(event?.points_system_id)||undefined,
    points_table:rows(event?.points_table).length
      ?rows(event.points_table).map((value)=>Number(value)||0)
      :undefined,
    points_system_source:text(event?.points_system_source)||undefined,
    championship_model:text(event?.championship_model)||undefined,
  };
  const fallback=lowerSeriesScoringSnapshot(event?.season_year??world?.season_year??gameState?.activeYear);
  scoring.points_system_id=scoring.points_system_id||fallback.points_system_id;
  scoring.points_table=scoring.points_table||fallback.points_table;
  scoring.points_system_source=scoring.points_system_source||fallback.points_system_source;
  scoring.championship_model=scoring.championship_model||fallback.championship_model;

  const entries=Object.values(world.entries||{})
    .filter((entry)=>String(entry?.series_id)===String(event.series_id))
    .filter((entry)=>!activeF1RaceDriverIds(gameState).has(String(entry?.driver_id)))
    .sort((a,b)=>String(a.driver_id).localeCompare(String(b.driver_id)));

  if(entries.length<2){
    return {
      event:{...event,status:"skipped",skip_reason:"insufficient_entries",completed_at:event.event_date},
      result:{
        event_id:event.event_id,
        season_year:event.season_year,
        series_id:event.series_id,
        series_name:event.series_name,
        series_level:event.series_level,
        round:event.round,
        event_date:event.event_date,
        status:"skipped",
        skip_reason:"insufficient_entries",
        pole_driver_id:null,
        classification:[],
        simulation_model:LOWER_SERIES_SIMULATION_MODEL,
        ...scoring,
        points_table:scoring.points_table.slice(),
      },
    };
  }

  const rng=gameplayRngFor(
    gameState,
    "lower-series-event",
    event.event_id
  );

  const profiles=entries.map((entry)=>{
    const profile=performanceProfile({...gameState,lowerSeriesWorld:world},entry);
    const qualiVariation=(rng.next()-0.5)*14;
    const raceVariation=(rng.next()-0.5)*18;
    const qualiScore=
      profile.ability*0.45+
      profile.qualifying*0.35+
      profile.teamStrength*0.15+
      profile.consistency*0.05+
      qualiVariation;
    const raceScore=
      profile.ability*0.40+
      profile.pace*0.18+
      profile.racecraft*0.18+
      profile.consistency*0.10+
      profile.teamStrength*0.14+
      raceVariation;
    const dnfChance=clamp(
      0.035+
      (1-profile.reliability)*0.45+
      (50-profile.consistency)*0.0015+
      Math.max(0,profile.aggression-75)*0.001,
      0.015,
      0.30
    );
    return {
      entry,
      profile,
      qualiScore,
      raceScore,
      dnf:rng.chance(dnfChance),
      dnfProgress:rng.next(),
    };
  });

  const grid=profiles.slice().sort((a,b)=>
    b.qualiScore-a.qualiScore||
    String(a.entry.driver_id).localeCompare(String(b.entry.driver_id))
  );
  const gridPosition=new Map(grid.map((item,index)=>[String(item.entry.driver_id),index+1]));
  const poleDriverId=String(grid[0]?.entry?.driver_id||"")||null;

  const finishers=profiles.filter((item)=>!item.dnf).sort((a,b)=>
    b.raceScore-a.raceScore||
    gridPosition.get(String(a.entry.driver_id))-gridPosition.get(String(b.entry.driver_id))
  );
  const dnfs=profiles.filter((item)=>item.dnf).sort((a,b)=>
    b.dnfProgress-a.dnfProgress||
    b.raceScore-a.raceScore
  );
  const ordered=[...finishers,...dnfs];

  const classification=ordered.map((item,index)=>{
    const position=index+1;
    const did=String(item.entry.driver_id);
    const finished=!item.dnf;
    return {
      position,
      driver_id:did,
      driver_name:text(item.profile.driver?.display_name??item.profile.driver?.name)||did,
      lower_team_id:item.entry.lower_team_id??null,
      team_name:item.entry.team_name??null,
      grid_position:gridPosition.get(did)??null,
      status:finished?"finished":"dnf",
      points:finished?pointsForPosition(scoring.points_table,position):0,
      pole:did===poleDriverId,
      performance_score:Number(item.raceScore.toFixed(3)),
    };
  });

  return {
    event:{...event,status:"completed",completed_at:event.event_date},
    result:{
      event_id:event.event_id,
      season_year:event.season_year,
      series_id:event.series_id,
      series_name:event.series_name,
      series_level:event.series_level,
      round:event.round,
      event_date:event.event_date,
      status:"completed",
      pole_driver_id:poleDriverId,
      classification,
      simulation_model:LOWER_SERIES_SIMULATION_MODEL,
      ...scoring,
      points_table:scoring.points_table.slice(),
    },
  };
}

function driverStandingRows(seriesId,results){
  const stats=new Map();
  for(const result of results.filter((row)=>row.series_id===seriesId&&row.status==="completed")){
    for(const row of rows(result.classification)){
      const id=text(row?.driver_id);
      if(!id)continue;
      const current=stats.get(id)||{
        driver_id:id,
        driver_name:text(row?.driver_name)||id,
        lower_team_id:row?.lower_team_id??null,
        team_name:row?.team_name??null,
        starts:0,finishes:0,wins:0,podiums:0,poles:0,dnfs:0,points:0,
        best_finish:null,
      };
      current.starts+=1;
      if(row.status==="finished")current.finishes+=1;
      else current.dnfs+=1;
      if(Number(row.position)===1&&row.status==="finished")current.wins+=1;
      if(Number(row.position)<=3&&row.status==="finished")current.podiums+=1;
      if(row.pole)current.poles+=1;
      current.points+=Number(row.points)||0;
      if(row.status==="finished"){
        current.best_finish=current.best_finish==null
          ?Number(row.position)
          :Math.min(current.best_finish,Number(row.position));
      }
      stats.set(id,current);
    }
  }

  const ordered=[...stats.values()].sort((a,b)=>
    b.points-a.points||
    b.wins-a.wins||
    b.podiums-a.podiums||
    (a.best_finish??999)-(b.best_finish??999)||
    String(a.driver_id).localeCompare(String(b.driver_id))
  );
  return ordered.map((row,index)=>({...row,position:index+1}));
}

function teamStandingRows(seriesId,results){
  const teams=new Map();
  for(const result of results.filter((row)=>row.series_id===seriesId&&row.status==="completed")){
    for(const row of rows(result.classification)){
      const id=text(row?.lower_team_id);
      if(!id)continue;
      const current=teams.get(id)||{
        lower_team_id:id,
        team_name:text(row?.team_name)||id,
        points:0,
        wins:0,
        podiums:0,
      };
      current.points+=Number(row.points)||0;
      if(Number(row.position)===1&&row.status==="finished")current.wins+=1;
      if(Number(row.position)<=3&&row.status==="finished")current.podiums+=1;
      teams.set(id,current);
    }
  }
  const ordered=[...teams.values()].sort((a,b)=>
    b.points-a.points||
    b.wins-a.wins||
    b.podiums-a.podiums||
    String(a.lower_team_id).localeCompare(String(b.lower_team_id))
  );
  return ordered.map((row,index)=>({...row,position:index+1,series_id:seriesId}));
}

function scoringForSeries(world,seriesId){
  const scheduled=rows(world?.events).find((row)=>text(row?.series_id)===seriesId);
  const result=rows(world?.results).find((row)=>text(row?.series_id)===seriesId);
  const source=scheduled||result||{};
  const fallback=lowerSeriesScoringSnapshot(world?.season_year);
  return {
    points_system_id:text(source?.points_system_id)||fallback.points_system_id,
    points_table:rows(source?.points_table).length
      ?rows(source.points_table).map((value)=>Number(value)||0)
      :fallback.points_table.slice(),
    points_system_source:text(source?.points_system_source)||fallback.points_system_source,
    championship_model:text(source?.championship_model)||fallback.championship_model,
  };
}

function rebuildStandings(world){
  const results=rows(world?.results);
  const standings={};
  for(const series of rows(world?.series)){
    const id=text(series?.series_id);
    if(!id||!LOWER_SERIES_SIMULATED_LEVELS.includes(num(series?.series_level,null)))continue;
    const driverRows=driverStandingRows(id,results);
    const teamRows=teamStandingRows(id,results);
    const completed=results.filter((row)=>row.series_id===id&&row.status==="completed");
    const scheduled=rows(world?.events).filter((row)=>row.series_id===id);
    const complete=scheduled.length>0&&scheduled.every((row)=>["completed","skipped"].includes(String(row.status)));
    const scoring=scoringForSeries(world,id);
    standings[id]={
      series_id:id,
      series_name:series?.series_name??id,
      series_level:num(series?.series_level,null),
      ...scoring,
      points_table:scoring.points_table.slice(),
      drivers:driverRows,
      teams:teamRows,
      updated_through_round:completed.reduce((max,row)=>Math.max(max,Number(row.round)||0),0),
      complete,
      champion_driver_id:complete?driverRows[0]?.driver_id??null:null,
      champion_team_id:complete?teamRows[0]?.lower_team_id??null:null,
    };
  }
  return standings;
}

export function processLowerSeriesTick(gameState,{throughDate=null}={}){
  if(!gameState?.lowerSeriesWorld)return gameState;
  let state=initializeLowerSeriesSeason(gameState);
  let world=cloneWorld(state.lowerSeriesWorld);
  if(!world)return state;

  const today=text(throughDate??state?.currentDateISO).slice(0,10);
  if(!today)return state;

  const existingResultIds=new Set(rows(world.results).map((row)=>String(row?.event_id)).filter(Boolean));
  const due=rows(world.events)
    .filter((event)=>!["completed","skipped"].includes(String(event?.status)))
    .filter((event)=>String(event?.event_date||"").slice(0,10)<=today)
    .sort((a,b)=>
      String(a.event_date).localeCompare(String(b.event_date))||
      String(a.series_id).localeCompare(String(b.series_id))||
      Number(a.round)-Number(b.round)
    );

  if(!due.length){
    const standings=rebuildStandings(world);
    if(JSON.stringify(standings)===JSON.stringify(world.standings||{}))return state;
    return {...state,lowerSeriesWorld:{...world,standings}};
  }

  const eventById=new Map(rows(world.events).map((event)=>[String(event.event_id),event]));
  const results=rows(world.results).slice();

  for(const event of due){
    if(existingResultIds.has(String(event.event_id)))continue;
    const simulated=simulateEvent(state,world,event);
    eventById.set(String(event.event_id),simulated.event);
    results.push(simulated.result);
    existingResultIds.add(String(event.event_id));
    world={...world,results};
  }

  world={
    ...world,
    events:[...eventById.values()].sort((a,b)=>
      String(a.event_date).localeCompare(String(b.event_date))||
      String(a.series_id).localeCompare(String(b.series_id))||
      Number(a.round)-Number(b.round)
    ),
    results:results.sort((a,b)=>
      String(a.event_date).localeCompare(String(b.event_date))||
      String(a.series_id).localeCompare(String(b.series_id))||
      Number(a.round)-Number(b.round)
    ),
  };
  world={...world,standings:rebuildStandings(world)};
  world={
    ...world,
    prospects:rebuildLowerSeriesProspects(
      {...state,lowerSeriesWorld:world},
      world
    ),
  };

  const excluded=[...activeF1RaceDriverIds(state)];
  return {
    ...state,
    lowerSeriesWorld:world,
    drivers:applyLowerSeriesWorldToDrivers(
      state.drivers||[],
      world,
      {inactiveDriverIds:excluded}
    ),
  };
}

export function completeLowerSeriesSeason(gameState){
  const year=Number(gameState?.lowerSeriesWorld?.season_year??gameState?.activeYear);
  if(!Number.isInteger(year))return gameState;
  return processLowerSeriesTick(gameState,{throughDate:`${year}-12-31`});
}
