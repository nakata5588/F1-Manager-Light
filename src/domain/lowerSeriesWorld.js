// src/domain/lowerSeriesWorld.js
//
// LS2 — canonical Lower Series Save World.
//
// The Global Database supplies series structure, opening-year career evidence
// and eligibility rules. Once New Game starts, lowerSeriesWorld is the
// authoritative mutable placement world. Future historical results, teams and
// championship placements are never imported into an active career.

import {
  activeSeriesForYear,
  eligibleSeriesForDriver,
  isSeriesActiveInYear,
  seriesAgeEligibility,
  seriesIdOf,
  seriesLevelOf,
  seriesNameOf,
  seriesRuleForYear,
} from "./seriesCatalog.js";
import {
  activeLowerSeriesTeamsForYear,
  lowerSeriesTeamIdOf,
  lowerSeriesWorldTeamFromFact,
  matchLowerSeriesTeamFact,
} from "./lowerSeriesTeams.js";
import { carryLowerSeriesProspect } from "./lowerSeriesProspects.js";
import { openingLowerSeriesEntryForDriver } from "./lowerSeriesEntries.js";
import { lowerSeriesCareerMovement } from "./lowerSeriesCareerMovement.js";

export const LOWER_SERIES_WORLD_VERSION=5;

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
};
const driverIdOf=(row)=>text(row?.driver_id??row?.person_id??row?.id);
const yearOf=(row)=>num(row?.year??row?.season_year??row?.season??row?.yr,null);

function norm(value){
  return text(value).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"");
}

function lowerCareerLevel(row){
  const explicit=num(row?.series_level,null);
  if(Number.isFinite(explicit))return explicit;

  const raw=text(row?.series_division??row?.division??row?.series);
  const numeric=Number(raw);
  if(Number.isFinite(numeric)&&numeric>=1&&numeric<=5)return numeric;

  const value=norm(raw);
  if(!value)return null;
  if(value==="f1"||value.includes("formula1"))return 1;
  if(
    value==="f2"||value.includes("formula2")||value.includes("f3000")||
    value.includes("gp2")||value.includes("formula35")||value.includes("formulav835")
  )return 2;
  if(value==="f3"||value.includes("formula3")||value.includes("gp3"))return 3;
  if(value.includes("regional")||value.includes("formularenault")||value.includes("formulerenault"))return 4;
  if(
    value==="f4"||value.includes("formula4")||value.includes("formulaford")||
    value.includes("formulajunior")||value.includes("formulaabarth")
  )return 5;
  return null;
}

function seriesRuleId(rule){
  return text(rule?.series_rule_id??rule?.rule_id??rule?.id)||null;
}

function activeLowerSeries(seriesRows,year){
  return activeSeriesForYear(seriesRows,year,{levels:[2,3,4,5]});
}

function seriesRecord(series,ruleRows,year){
  const id=seriesIdOf(series);
  const level=seriesLevelOf(series);
  const rule=seriesRuleForYear(ruleRows,id,year);
  return {
    series_id:id,
    series_name:seriesNameOf(series),
    short_name:text(series?.short_name??series?.series_short_name)||null,
    series_level:Number.isFinite(level)?level:null,
    category:text(series?.category)||null,
    rule_id:seriesRuleId(rule),
    status:"active",
    source:"global_series_structure",
  };
}

function careerRowsForOpening(driverCareer,driverId,year){
  return rows(driverCareer)
    .filter((row)=>driverIdOf(row)===driverId&&yearOf(row)===Number(year))
    .filter((row)=>lowerCareerLevel(row)!==1);
}

function openingCareerEvidence(driverCareer,driverId,year,seriesId,seriesLevel){
  const candidates=careerRowsForOpening(driverCareer,driverId,year);
  if(!candidates.length)return null;

  if(seriesId){
    const exact=candidates.find((row)=>text(row?.series_id)===seriesId);
    if(exact)return exact;
  }

  if(Number.isFinite(Number(seriesLevel))){
    const level=candidates.find((row)=>lowerCareerLevel(row)===Number(seriesLevel));
    if(level)return level;
  }

  return candidates.length===1?candidates[0]:null;
}

function teamSlug(value){
  const slug=norm(value);
  return slug||"unknown";
}

function openingTeamFromCareer(row,seriesId,year,catalogTeams=[]){
  if(!row||!seriesId)return null;
  const name=text(row?.team_name??row?.team??row?.entrant_name??row?.constructor);
  const sourceId=text(row?.team_id??row?.entrant_id);
  if(!name&&!sourceId)return null;

  const catalogMatch=matchLowerSeriesTeamFact(catalogTeams,{
    seriesId,
    sourceTeamId:sourceId,
    teamName:name,
  });
  if(catalogMatch)return lowerSeriesWorldTeamFromFact(catalogMatch,year);

  const lowerTeamId=`ls_team:${seriesId}:${teamSlug(sourceId||name)}`;
  return {
    lower_team_id:lowerTeamId,
    series_id:seriesId,
    team_name:name||sourceId,
    source_team_id:sourceId||null,
    season_year:Number(year),
    team_strength:null,
    reliability:null,
    development_environment:null,
    calibration_status:"pending_simulation_model",
    source:"historical_opening_career_evidence",
  };
}

function openingTeamFromEntry(row,seriesId,year,catalogTeams=[]){
  if(!row||!seriesId)return null;
  const lowerTeamId=text(row?.lower_team_id??row?.team_id??row?.entrant_id);
  const teamName=text(row?.team_name??row?.entrant_name??row?.entrant);
  if(!lowerTeamId&&!teamName)return null;

  const catalogMatch=matchLowerSeriesTeamFact(catalogTeams,{
    seriesId,
    lowerTeamId,
    teamName,
  });
  return catalogMatch?lowerSeriesWorldTeamFromFact(catalogMatch,year):null;
}

function candidateRows(value){
  return rows(value).map((row)=>({
    series_id:text(row?.series_id)||null,
    series_name:text(row?.series_name)||null,
    series_level:num(row?.series_level,null),
  })).filter((row)=>row.series_id);
}

function openingEntry(placement,driver,year,driverCareer,lowerSeriesEntries,teams,catalogTeams){
  const driverId=text(placement?.driver_id??driverIdOf(driver));
  if(!driverId||!placement?.active_pre_f1_world)return null;

  const seriesId=text(placement?.series_id)||null;
  const level=num(placement?.series_level,null);
  const candidates=candidateRows(placement?.series_candidates);
  const factualEntry=openingLowerSeriesEntryForDriver(lowerSeriesEntries,{
    year,
    driverId,
    seriesId,
  });
  const career=factualEntry
    ?null
    :openingCareerEvidence(driverCareer,driverId,year,seriesId,level);
  const team=factualEntry
    ?openingTeamFromEntry(factualEntry,seriesId,year,catalogTeams)
    :openingTeamFromCareer(career,seriesId,year,catalogTeams);
  if(team)teams.set(team.lower_team_id,team);

  const resolution=text(placement?.series_resolution)||(
    seriesId?"opening_series":"unresolved"
  );
  const factualSource=Boolean(factualEntry);
  return {
    driver_id:driverId,
    series_id:seriesId,
    series_name:text(placement?.series_name)||null,
    series_level:level,
    rule_id:text(placement?.series_rule_id)||null,
    series_candidates:candidates,
    lower_team_id:team?.lower_team_id??null,
    team_name:(team?.team_name??text(factualEntry?.team_name))||null,
    car_no:text(factualEntry?.car_no)||null,
    factual_lower_entry_id:text(factualEntry?.lower_entry_id)||null,
    opening_source_url:text(factualEntry?.source_url)||null,
    opening_source:text(factualEntry?.source)||null,
    placement_status:seriesId
      ?(team?"placed_with_team":"series_only")
      :(candidates.length?"candidate_pool":"unresolved"),
    placement_source:factualSource
      ?"historical_lower_series_entry"
      :(team?"historical_opening_career_evidence":resolution),
    opening_seed:true,
    joined_world_year:Number(year),
  };
}

function emptyWorld(year,sourceSeason=year){
  return {
    version:LOWER_SERIES_WORLD_VERSION,
    authority:"save_world",
    season_year:Number(year),
    source_season:Number(sourceSeason),
    series:[],
    teams:{},
    entries:{},
    standings:{},
    prospects:{},
    events:[],
    results:[],
    history:[],
  };
}

export function materializeLowerSeriesWorld({
  year,
  sourceSeason=year,
  series=[],
  seriesRules=[],
  placements=[],
  driverCareer=[],
  drivers=[],
  lowerSeriesTeams=[],
  lowerSeriesEntries=[],
}={}){
  const y=Number(year);
  if(!Number.isInteger(y))return emptyWorld(year,sourceSeason);

  const seriesRows=activeLowerSeries(series,y);
  const world=emptyWorld(y,sourceSeason);
  world.series=seriesRows.map((row)=>seriesRecord(row,seriesRules,y));

  const driverById=new Map(rows(drivers).map((driver)=>[driverIdOf(driver),driver]).filter(([id])=>id));
  const activeSeriesIds=new Set(world.series.map((row)=>text(row?.series_id)).filter(Boolean));
  const activeTeamFacts=activeLowerSeriesTeamsForYear(
    lowerSeriesTeams,
    y,
    {seriesIds:[...activeSeriesIds]}
  );
  const teams=new Map(
    activeTeamFacts
      .map((fact)=>lowerSeriesWorldTeamFromFact(fact,y))
      .filter(Boolean)
      .map((team)=>[team.lower_team_id,team])
  );
  const entries={};

  for(const placement of rows(placements)){
    if(!placement?.active_pre_f1_world)continue;
    const id=text(placement?.driver_id);
    const entry=openingEntry(
      placement,
      driverById.get(id)||null,
      y,
      driverCareer,
      lowerSeriesEntries,
      teams,
      activeTeamFacts
    );
    if(entry)entries[id]=entry;
  }

  world.teams=Object.fromEntries([...teams].sort(([a],[b])=>a.localeCompare(b)));
  world.entries=Object.fromEntries(Object.entries(entries).sort(([a],[b])=>a.localeCompare(b)));
  return world;
}

function targetLevelForDriver(driver,previousEntry){
  const previous=num(previousEntry?.series_level,null);
  if(Number.isFinite(previous))return previous;

  const explicit=num(driver?.lower_series_level,null);
  if(Number.isFinite(explicit))return explicit;

  const age=num(driver?.age,null);
  if(!Number.isFinite(age))return null;
  if(age<=17)return 5;
  if(age<=19)return 4;
  if(age<=21)return 3;
  return 2;
}

function successorSeries(seriesRows,previousSeriesId,targetYear){
  if(!previousSeriesId)return null;
  const previous=rows(seriesRows).find((row)=>seriesIdOf(row)===previousSeriesId);
  const successorId=text(previous?.successor_series_id);
  if(!successorId)return null;
  const successor=rows(seriesRows).find((row)=>seriesIdOf(row)===successorId);
  return successor&&isSeriesActiveInYear(successor,targetYear)?successor:null;
}

function resolveRuntimeSeries({
  driver,
  previousEntry,
  targetYear,
  series,
  seriesRules,
  targetLevelOverride=null,
}){
  const previousId=text(previousEntry?.series_id);
  const previousLevel=num(previousEntry?.series_level,null);
  const previousSeries=previousId
    ?rows(series).find((row)=>seriesIdOf(row)===previousId)
    :null;
  const targetLevel=Number.isFinite(Number(targetLevelOverride))
    ?Number(targetLevelOverride)
    :targetLevelForDriver(driver,previousEntry);
  const movementRequested=Number.isFinite(previousLevel)&&Number.isFinite(targetLevel)&&targetLevel!==previousLevel;

  if(movementRequested){
    const promoted=eligibleSeriesForDriver(
      series,seriesRules,driver,targetYear,{levels:[targetLevel]}
    );
    if(promoted.length===1){
      return {
        series:promoted[0].series,
        rule:promoted[0].rule,
        candidates:[],
        resolution:"career_movement_single_series",
      };
    }
    if(promoted.length>1){
      return {
        series:null,
        rule:null,
        candidates:promoted.map(({series:row})=>({
          series_id:seriesIdOf(row),
          series_name:seriesNameOf(row),
          series_level:seriesLevelOf(row),
        })),
        resolution:"career_movement_candidate_pool",
      };
    }
  }

  if(previousSeries&&isSeriesActiveInYear(previousSeries,targetYear)){
    const rule=seriesRuleForYear(seriesRules,previousId,targetYear);
    const eligibility=seriesAgeEligibility(driver,rule,targetYear);
    if(eligibility.eligible){
      return {
        series:previousSeries,
        rule,
        candidates:[],
        resolution:movementRequested
          ?"career_movement_blocked_no_active_series"
          :"save_world_continuity",
      };
    }
  }

  const successor=successorSeries(series,previousId,targetYear);
  if(successor){
    const successorId=seriesIdOf(successor);
    const rule=seriesRuleForYear(seriesRules,successorId,targetYear);
    const eligibility=seriesAgeEligibility(driver,rule,targetYear);
    if(eligibility.eligible){
      return {
        series:successor,
        rule,
        candidates:[],
        resolution:movementRequested
          ?"career_movement_blocked_structural_successor"
          :"structural_series_successor",
      };
    }
  }

  if(!Number.isFinite(targetLevel)){
    return {series:null,rule:null,candidates:[],resolution:"unresolved_level"};
  }

  const eligible=eligibleSeriesForDriver(
    series,seriesRules,driver,targetYear,{levels:[targetLevel]}
  );
  if(eligible.length===1){
    return {
      series:eligible[0].series,
      rule:eligible[0].rule,
      candidates:[],
      resolution:"single_active_eligible_series",
    };
  }

  return {
    series:null,
    rule:null,
    candidates:eligible.map(({series:row})=>({
      series_id:seriesIdOf(row),
      series_name:seriesNameOf(row),
      series_level:seriesLevelOf(row),
    })),
    resolution:eligible.length>1?"candidate_pool":"no_catalog_match",
  };
}

function archiveWorldSeason(world){
  if(!world||!Number.isInteger(Number(world.season_year)))return [];
  const history=rows(world.history).slice();
  if(history.some((row)=>Number(row?.season_year)===Number(world.season_year)))return history;
  history.push({
    season_year:Number(world.season_year),
    series:rows(world.series).map((row)=>({...row})),
    teams:Object.values(world.teams||{}).map((row)=>({...row})),
    entries:Object.values(world.entries||{}).map((row)=>({
      ...row,
      series_candidates:candidateRows(row?.series_candidates),
      career_movement:row?.career_movement?{...row.career_movement}:null,
    })),
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
    events:rows(world.events).map((row)=>({...row})),
    results:rows(world.results).map((row)=>({
      ...row,
      classification:rows(row?.classification).map((item)=>({...item})),
    })),
  });
  return history;
}

export function rollLowerSeriesWorld(world,{
  targetYear,
  drivers=[],
  series=[],
  seriesRules=[],
  lowerSeriesTeams=[],
  excludedDriverIds=[],
}={}){
  const year=Number(targetYear);
  if(!Number.isInteger(year))throw new TypeError("Lower Series target season must be an integer.");

  const hadWorld=Boolean(world&&typeof world==="object");
  const previous=hadWorld
    ?world
    :emptyWorld(year-1,year-1);
  const excluded=new Set(rows(excludedDriverIds).map(text).filter(Boolean));
  const previousEntries=previous.entries&&typeof previous.entries==="object"
    ?previous.entries
    :{};
  const previousTeams=previous.teams&&typeof previous.teams==="object"
    ?previous.teams
    :{};
  const previousProspects=previous.prospects&&typeof previous.prospects==="object"
    ?previous.prospects
    :{};

  const next=emptyWorld(year,previous.source_season??previous.season_year??year);
  next.series=activeLowerSeries(series,year).map((row)=>seriesRecord(row,seriesRules,year));
  next.history=hadWorld?archiveWorldSeason(previous):[];

  const entries={};
  const activeSeriesIds=new Set(next.series.map((row)=>text(row?.series_id)).filter(Boolean));
  const catalogKnownTeamIds=new Set(
    rows(lowerSeriesTeams).map(lowerSeriesTeamIdOf).filter(Boolean)
  );
  const activeTeamFacts=activeLowerSeriesTeamsForYear(
    lowerSeriesTeams,
    year,
    {seriesIds:[...activeSeriesIds]}
  );
  const teams=Object.fromEntries(
    activeTeamFacts
      .map((fact)=>lowerSeriesWorldTeamFromFact(fact,year,{
        previous:previousTeams[lowerSeriesTeamIdOf(fact)]||null,
      }))
      .filter(Boolean)
      .map((team)=>[team.lower_team_id,team])
  );

  for(const driver of rows(drivers)){
    const id=driverIdOf(driver);
    if(!id||excluded.has(id)||driver?.active_lower_series!==true)continue;

    const previousEntry=previousEntries[id]||null;
    const movement=previousEntry
      ?lowerSeriesCareerMovement(previous,driver,previousEntry,{targetYear:year})
      :null;
    const requestedLevel=Number.isFinite(Number(movement?.target_level))
      ?Number(movement.target_level)
      :targetLevelForDriver(driver,previousEntry);
    const resolved=resolveRuntimeSeries({
      driver,
      previousEntry,
      targetYear:year,
      series,
      seriesRules,
      targetLevelOverride:requestedLevel,
    });
    const resolvedSeries=resolved.series;
    const seriesId=resolvedSeries?seriesIdOf(resolvedSeries):null;
    const level=resolvedSeries
      ?seriesLevelOf(resolvedSeries)
      :requestedLevel;
    const candidates=candidateRows(resolved.candidates);
    const effectiveMovement=movement
      ?{
        ...movement,
        effective_level:Number.isFinite(level)?level:null,
        resolved_series_id:seriesId,
        placement_resolution:resolved.resolution,
        effective_outcome:
          movement.decision==="promote"
            ?(
              Number(level)===Number(movement.target_level)&&Boolean(seriesId)
                ?"promoted"
                :(candidates.length&&Number(level)===Number(movement.target_level)
                  ?"promotion_pending"
                  :"promotion_blocked")
            )
            :(movement.f1_ready?"f1_ready":"stayed"),
      }
      :null;
    const sameSeries=Boolean(seriesId&&previousEntry?.series_id===seriesId);
    const previousTeamId=text(previousEntry?.lower_team_id);
    const catalogCarried=previousTeamId?teams[previousTeamId]||null:null;
    const legacyCarried=previousTeamId&&!catalogKnownTeamIds.has(previousTeamId)
      ?previousTeams[previousTeamId]||null
      :null;
    const carriedTeam=sameSeries?(catalogCarried||legacyCarried):null;

    if(carriedTeam&&!teams[carriedTeam.lower_team_id]){
      teams[carriedTeam.lower_team_id]={
        ...carriedTeam,
        season_year:year,
        source:"save_world_continuity",
      };
    }

    entries[id]={
      driver_id:id,
      series_id:seriesId,
      series_name:resolvedSeries?seriesNameOf(resolvedSeries):null,
      series_level:Number.isFinite(level)?level:null,
      rule_id:seriesRuleId(resolved.rule),
      series_candidates:candidates,
      lower_team_id:carriedTeam?.lower_team_id??null,
      team_name:carriedTeam?.team_name??null,
      placement_status:seriesId
        ?(carriedTeam?"placed_with_team":"series_only")
        :(candidates.length?"candidate_pool":"unresolved"),
      placement_source:resolved.resolution,
      career_movement:effectiveMovement,
      opening_seed:false,
      joined_world_year:num(previousEntry?.joined_world_year,year),
    };
  }

  next.entries=Object.fromEntries(Object.entries(entries).sort(([a],[b])=>a.localeCompare(b)));
  next.teams=Object.fromEntries(Object.entries(teams).sort(([a],[b])=>a.localeCompare(b)));
  next.prospects=Object.fromEntries(
    Object.keys(next.entries)
      .sort()
      .map((id)=>[id,carryLowerSeriesProspect(previousProspects[id]||null,year)])
      .filter(([,value])=>Boolean(value))
  );
  return next;
}

export function lowerSeriesEntry(world,driverId){
  const id=text(driverId);
  if(!id||!world?.entries||typeof world.entries!=="object")return null;
  return world.entries[id]??null;
}

export function applyLowerSeriesWorldToDrivers(drivers,world,{inactiveDriverIds=[]}={}){
  const inactive=new Set(rows(inactiveDriverIds).map(text).filter(Boolean));
  return rows(drivers).map((driver)=>{
    const id=driverIdOf(driver);
    if(!id)return driver;

    if(inactive.has(id)){
      return {
        ...driver,
        active_lower_series:false,
        lower_series_id:null,
        lower_series_name:null,
        lower_series_level:null,
        lower_series_candidates:[],
        lower_series_resolution:"left_for_f1_race_seat",
        lower_series_prospect_reputation:null,
        lower_series_f1_interest:[],
        lower_series_f1_ready:false,
        lower_series_career_movement:null,
      };
    }

    const entry=lowerSeriesEntry(world,id);
    if(!entry)return driver;
    const prospect=world?.prospects?.[id]||null;

    return {
      ...driver,
      active_lower_series:true,
      lower_series_id:entry.series_id,
      lower_series_name:entry.series_name,
      lower_series_level:entry.series_level,
      lower_series_candidates:candidateRows(entry.series_candidates),
      lower_series_resolution:entry.placement_source,
      lower_series_rule_id:entry.rule_id,
      lower_series_team_id:entry.lower_team_id,
      lower_series_team_name:entry.team_name,
      lower_series_prospect_reputation:prospect?.prospect_reputation??null,
      lower_series_f1_interest:rows(prospect?.f1_interest).map((row)=>({...row})),
      lower_series_best_f1_interest:prospect?.best_f1_interest?{...prospect.best_f1_interest}:null,
      lower_series_academy_team_id:prospect?.academy_team_id??null,
      lower_series_f1_ready:Boolean(entry?.career_movement?.f1_ready),
      lower_series_career_movement:entry?.career_movement?{...entry.career_movement}:null,
      world_runtime_source:"lower_series_world",
    };
  });
}
