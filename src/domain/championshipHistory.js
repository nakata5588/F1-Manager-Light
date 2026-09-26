// src/domain/championshipHistory.js
// Central championship resolver.
//
// Canonical rule:
// - seasons before careerMeta.sourceSeason come from the historical results
//   cache (dbDriverHistory, generated from race results);
// - played seasons come from Save World standings/results;
// - achievements/career positions are compatibility fallbacks only.
//
// Profiles, team summaries and championship history should consume this domain
// instead of independently recalculating championship outcomes.

const rows=(value)=>Array.isArray(value)?value:[];
const unbox=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unbox(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unbox(value.value);
  }
  return value;
};
const str=(value)=>String(unbox(value)??"");
const num=(value,fb=0)=>Number.isFinite(Number(unbox(value)))?Number(unbox(value)):fb;
const teamIdOf=(row)=>str(row?.team_id??row?.constructor_id??row?.id);
const driverIdOf=(row)=>str(row?.driver_id??row?.driverId??row?.id);
const normalizeName=(value)=>str(value)
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"")
  .replace(/[^a-z0-9]+/g,"")
  .trim();

function teamNameFor(teamsById,teamId,fallback="—"){
  const map=teamsById instanceof Map
    ?teamsById
    :new Map(rows(teamsById).map((team)=>[teamIdOf(team),team]));
  const team=map.get(String(teamId));
  return str(team?.team_name??team?.name??team?.short_name??fallback)||fallback;
}

function driverNameFor(driversById,driverId,fallback="—"){
  const map=driversById instanceof Map
    ?driversById
    :new Map(rows(driversById).map((driver)=>[driverIdOf(driver),driver]));
  const driver=map.get(String(driverId));
  return str(driver?.display_name??driver?.driver_name??driver?.name??fallback)||fallback;
}

function careerSourceSeason(gs){
  const source=Number(gs?.careerMeta?.sourceSeason);
  if(Number.isFinite(source))return source;
  const active=Number(gs?.activeYear);
  return Number.isFinite(active)?active:Infinity;
}

function teamsById(gs){
  const map=new Map();
  for(const team of [...rows(gs?.dbTeams),...rows(gs?.teams)]){
    const id=teamIdOf(team);
    if(id)map.set(id,{...(map.get(id)||{}),...team});
  }
  return map;
}

function driversById(gs){
  const map=new Map();
  for(const driver of [...rows(gs?.dbDrivers),...rows(gs?.drivers)]){
    const id=driverIdOf(driver);
    if(id)map.set(id,{...(map.get(id)||{}),...driver});
  }
  return map;
}

function preferredTeam(teamEntries=[]){
  return teamEntries.slice().sort((a,b)=>
    b.starts-a.starts||
    b.points-a.points||
    String(a.id).localeCompare(String(b.id))
  )[0]||null;
}

export function aggregateHistoricalDrivers(history,year,drivers=[],teams=[]){
  const driverMap=new Map();
  const teamMap=teams instanceof Map?teams:new Map(rows(teams).map((team)=>[teamIdOf(team),team]));
  const driverDb=drivers instanceof Map?drivers:new Map(rows(drivers).map((driver)=>[driverIdOf(driver),driver]));

  for(const row of rows(history)){
    if(Number(unbox(row?.year))!==Number(year))continue;
    const series=String(unbox(row?.series_division??row?.series)??"F1").toUpperCase();
    if(series&&series!=="F1")continue;
    const did=driverIdOf(row);
    if(!did)continue;
    const tid=teamIdOf(row);
    const starts=num(row?.starts??row?.races,0);
    const rec=driverMap.get(did)||{
      id:did,
      driver_id:did,
      name:str(row?.driver_name??row?.name)||driverNameFor(driverDb,did,did),
      driver_name:str(row?.driver_name??row?.name)||driverNameFor(driverDb,did,did),
      points:0,
      races:0,
      wins:0,
      podiums:0,
      fastestLaps:0,
      poles:0,
      dnfs:0,
      bestFinish:null,
      finishWeighted:0,
      finishWeight:0,
      _teams:[],
    };
    rec.points+=num(row?.points,0);
    rec.races+=num(row?.races??row?.starts,0);
    rec.wins+=num(row?.wins,0);
    rec.podiums+=num(row?.podiums,0);
    rec.fastestLaps+=num(row?.fastest_laps,0);
    rec.poles+=num(row?.poles,0);
    rec.dnfs+=num(row?.dnf??row?.dnfs,0);
    const best=Number(unbox(row?.best_finish));
    if(Number.isFinite(best)&&best>0)rec.bestFinish=rec.bestFinish==null?best:Math.min(rec.bestFinish,best);
    const avg=Number(unbox(row?.average_finish));
    const finishWeight=num(row?.classified_finishes,row?.races??row?.starts??0);
    if(Number.isFinite(avg)&&finishWeight>0){
      rec.finishWeighted+=avg*finishWeight;
      rec.finishWeight+=finishWeight;
    }
    if(tid){
      rec._teams.push({
        id:tid,
        name:str(row?.team_name)||teamNameFor(teamMap,tid,tid),
        starts,
        points:num(row?.points,0),
      });
    }
    driverMap.set(did,rec);
  }

  return [...driverMap.values()]
    .map((rec)=>{
      const preferred=preferredTeam(rec._teams);
      const {_teams,finishWeighted,finishWeight,...rest}=rec;
      return {
        ...rest,
        team_id:preferred?.id||"",
        team_name:preferred?.name||"—",
        averageFinish:finishWeight?Number((finishWeighted/finishWeight).toFixed(2)):null,
        pointsPerRace:rec.races?Number((rec.points/rec.races).toFixed(2)):0,
        source:"historical_results",
      };
    })
    .sort((a,b)=>
      b.points-a.points||
      b.wins-a.wins||
      b.podiums-a.podiums||
      b.poles-a.poles||
      a.name.localeCompare(b.name)
    )
    .map((row,index)=>({...row,position:index+1}));
}

export function aggregateHistoricalConstructors(history,year,teamsById=[]){
  const teamMap=new Map();
  for(const row of rows(history)){
    if(Number(unbox(row?.year))!==Number(year))continue;
    const series=String(unbox(row?.series_division??row?.series)??"F1").toUpperCase();
    if(series&&series!=="F1")continue;
    const teamId=teamIdOf(row);
    if(!teamId)continue;
    const rec=teamMap.get(teamId)||{
      id:teamId,
      name:str(row?.team_name)||teamNameFor(teamsById,teamId,teamId),
      points:0,
      wins:0,
      podiums:0,
      fastestLaps:0,
      poles:0,
      dnfs:0,
      races:0,
    };
    rec.points+=num(row?.points,0);
    rec.wins+=num(row?.wins,0);
    rec.podiums+=num(row?.podiums,0);
    rec.fastestLaps+=num(row?.fastest_laps,0);
    rec.poles+=num(row?.poles,0);
    rec.dnfs+=num(row?.dnf??row?.dnfs,0);
    rec.races=Math.max(rec.races,num(row?.races??row?.starts,0));
    teamMap.set(teamId,rec);
  }

  return [...teamMap.values()]
    .map((row)=>({
      ...row,
      pointsPerRace:row.races?Number((row.points/row.races).toFixed(2)):0,
    }))
    .sort((a,b)=>
      b.points-a.points||
      b.wins-a.wins||
      b.podiums-a.podiums||
      a.name.localeCompare(b.name)
    )
    .map((row,index)=>({...row,position:index+1}));
}

function normalizeStandingDrivers(gs,standingRows,year,source){
  const teamMap=teamsById(gs);
  const driverMap=driversById(gs);
  return rows(standingRows)
    .map((row,index)=>{
      const did=driverIdOf(row);
      const tid=teamIdOf(row);
      return {
        id:did,
        driver_id:did,
        name:str(row?.driver_name??row?.name)||driverNameFor(driverMap,did,did),
        driver_name:str(row?.driver_name??row?.name)||driverNameFor(driverMap,did,did),
        team_id:tid,
        team_name:str(row?.team_name)||teamNameFor(teamMap,tid,tid||"—"),
        position:num(row?.position??row?.pos,index+1),
        points:num(row?.points,0),
        wins:num(row?.wins,0),
        podiums:num(row?.podiums,0),
        poles:num(row?.poles,0),
        source,
        year:Number(year),
      };
    })
    .filter((row)=>row.driver_id)
    .sort((a,b)=>a.position-b.position||b.points-a.points||b.wins-a.wins||a.name.localeCompare(b.name))
    .map((row,index)=>({...row,position:Number.isFinite(Number(row.position))?Number(row.position):index+1}));
}

function aggregateSaveWorldResults(gs,year){
  const teamMap=teamsById(gs);
  const driverMap=driversById(gs);
  const map=new Map();

  for(const race of rows(gs?.results)){
    const raceYear=Number(race?.year??race?.season_year??String(race?.dateISO??race?.date??"").slice(0,4));
    if(raceYear!==Number(year))continue;
    for(const [index,row] of rows(race?.classification).entries()){
      const did=driverIdOf(row);
      if(!did)continue;
      const tid=teamIdOf(row);
      const position=num(row?.position??row?.pos,index+1);
      const status=String(row?.status??"").toUpperCase();
      const retired=Boolean(row?.retired)||status==="DNF";
      const rec=map.get(did)||{
        id:did,
        driver_id:did,
        name:driverNameFor(driverMap,did,did),
        driver_name:driverNameFor(driverMap,did,did),
        points:0,
        wins:0,
        podiums:0,
        races:0,
        _teams:[],
      };
      rec.points+=num(row?.points,0);
      rec.races+=1;
      if(!retired&&position===1)rec.wins+=1;
      if(!retired&&position>=1&&position<=3)rec.podiums+=1;
      if(tid)rec._teams.push({
        id:tid,
        name:str(row?.team_name)||teamNameFor(teamMap,tid,tid),
        starts:1,
        points:num(row?.points,0),
      });
      map.set(did,rec);
    }
  }

  return [...map.values()]
    .map((rec)=>{
      const preferred=preferredTeam(rec._teams);
      const {_teams,...rest}=rec;
      return {
        ...rest,
        team_id:preferred?.id||"",
        team_name:preferred?.name||"—",
        source:"save_world_results",
        year:Number(year),
      };
    })
    .sort((a,b)=>b.points-a.points||b.wins-a.wins||b.podiums-a.podiums||a.name.localeCompare(b.name))
    .map((row,index)=>({...row,position:index+1}));
}

function achievementFallbackStandings(gs,year){
  return rows(gs?.dbAchievements)
    .filter((row)=>
      Number(unbox(row?.year))===Number(year)&&
      Number.isFinite(Number(unbox(row?.driver_championship)))
    )
    .map((row)=>({
      id:driverIdOf(row),
      driver_id:driverIdOf(row),
      name:str(row?.driver_name??row?.name),
      driver_name:str(row?.driver_name??row?.name),
      team_id:teamIdOf(row),
      team_name:str(row?.team_name??row?.team),
      position:Number(unbox(row?.driver_championship)),
      points:null,
      wins:num(row?.wins,0),
      podiums:num(row?.podiums,0),
      source:"historical_achievements_fallback",
      year:Number(year),
    }))
    .filter((row)=>row.driver_id&&row.position>0)
    .sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name));
}

export function driverStandingsForYear(gs,year){
  const y=Number(year);
  if(!Number.isFinite(y))return [];
  const sourceSeason=careerSourceSeason(gs);

  if(y<sourceSeason){
    // dbDriverHistory is the complete generated cache from historical race
    // results. driverHistory is season-pack scoped, so it is fallback only.
    const history=rows(gs?.dbDriverHistory).length?rows(gs?.dbDriverHistory):rows(gs?.driverHistory);
    const standings=aggregateHistoricalDrivers(history,y,driversById(gs),teamsById(gs));
    return standings.length?standings:achievementFallbackStandings(gs,y);
  }

  const archive=rows(gs?.historySeasons).find((row)=>Number(row?.year)===y);
  const archived=normalizeStandingDrivers(gs,archive?.standings?.drivers,y,"save_world_archive");
  if(archived.length)return archived;

  if(y===Number(gs?.activeYear)){
    const live=normalizeStandingDrivers(gs,gs?.standings?.drivers,y,"live_save_world");
    if(live.length)return live;
  }

  // Save World results are authoritative if a played season has not yet been
  // archived (e.g. older saves or transitional season-boundary states).
  return aggregateSaveWorldResults(gs,y);
}

function driverMatches(row,{driverId="",driverName=""}={}){
  const id=String(driverId??"");
  if(id&&driverIdOf(row)===id)return true;
  const wantedName=normalizeName(driverName);
  const rowName=normalizeName(row?.driver_name??row?.name);
  return Boolean(wantedName&&rowName&&wantedName===rowName);
}

export function driverChampionshipResults(gs,{driverId="",driverName=""}={}){
  const sourceSeason=careerSourceSeason(gs);
  const years=new Set();

  const historical=rows(gs?.dbDriverHistory).length?rows(gs?.dbDriverHistory):rows(gs?.driverHistory);
  for(const row of historical){
    const y=Number(unbox(row?.year));
    const series=String(unbox(row?.series_division??row?.series)??"F1").toUpperCase();
    if(Number.isFinite(y)&&y<sourceSeason&&(!series||series==="F1"))years.add(y);
  }
  for(const archive of rows(gs?.historySeasons)){
    const y=Number(archive?.year);
    if(Number.isFinite(y)&&y>=sourceSeason)years.add(y);
  }
  for(const race of rows(gs?.results)){
    const y=Number(race?.year??race?.season_year??String(race?.dateISO??race?.date??"").slice(0,4));
    if(Number.isFinite(y)&&y>=sourceSeason)years.add(y);
  }
  const active=Number(gs?.activeYear);
  if(Number.isFinite(active)&&active>=sourceSeason)years.add(active);

  const output=[];
  for(const year of [...years].sort((a,b)=>a-b)){
    const row=driverStandingsForYear(gs,year).find((candidate)=>driverMatches(candidate,{driverId,driverName}));
    if(row)output.push({...row,year:Number(year)});
  }
  return output;
}

export function driverChampionshipResult(gs,year,{driverId="",driverName=""}={}){
  return driverStandingsForYear(gs,year)
    .find((row)=>driverMatches(row,{driverId,driverName}))||null;
}

function archivedConstructorChampion(gs,year){
  const archive=rows(gs?.historySeasons).find((row)=>Number(row?.year)===Number(year));
  if(!archive)return null;
  const sorted=rows(archive?.standings?.teams??archive?.standings?.constructors)
    .slice()
    .sort((a,b)=>
      num(a?.position,999)-num(b?.position,999)||
      num(b?.points,0)-num(a?.points,0)
    );
  const row=sorted[0];
  if(!row)return null;
  const id=teamIdOf(row);
  return id?{
    year:Number(year),
    team_id:id,
    team_name:str(row?.team_name??row?.name)||teamNameFor(teamsById(gs),id,id),
    source:"save_world",
  }:null;
}

export function constructorChampionForYear(gs,year){
  const y=Number(year);
  if(!Number.isFinite(y))return null;

  const archived=archivedConstructorChampion(gs,y);
  if(archived)return archived;

  if(y>=careerSourceSeason(gs))return null;

  const history=rows(gs?.dbDriverHistory).length?rows(gs?.dbDriverHistory):rows(gs?.driverHistory);
  const standings=aggregateHistoricalConstructors(history,y,teamsById(gs));
  const champion=standings[0];
  return champion?{
    year:y,
    team_id:champion.id,
    team_name:champion.name,
    points:champion.points,
    source:"historical_standings",
  }:null;
}

export function constructorChampionshipHistory(gs){
  const sourceSeason=careerSourceSeason(gs);
  const years=new Set();

  const history=rows(gs?.dbDriverHistory).length?rows(gs?.dbDriverHistory):rows(gs?.driverHistory);
  for(const row of history){
    const year=Number(unbox(row?.year));
    const series=String(unbox(row?.series_division??row?.series)??"F1").toUpperCase();
    if(Number.isFinite(year)&&year<sourceSeason&&(!series||series==="F1"))years.add(year);
  }
  for(const archive of rows(gs?.historySeasons)){
    const year=Number(archive?.year);
    if(Number.isFinite(year))years.add(year);
  }

  return [...years]
    .sort((a,b)=>a-b)
    .map((year)=>constructorChampionForYear(gs,year))
    .filter(Boolean);
}

export function driverChampionshipHistory(gs){
  const sourceSeason=careerSourceSeason(gs);
  const years=new Set();
  const history=rows(gs?.dbDriverHistory).length?rows(gs?.dbDriverHistory):rows(gs?.driverHistory);

  for(const row of history){
    const year=Number(unbox(row?.year));
    const series=String(unbox(row?.series_division??row?.series)??"F1").toUpperCase();
    if(Number.isFinite(year)&&year<sourceSeason&&(!series||series==="F1"))years.add(year);
  }
  for(const archive of rows(gs?.historySeasons)){
    const year=Number(archive?.year);
    if(Number.isFinite(year)&&year>=sourceSeason)years.add(year);
  }
  for(const race of rows(gs?.results)){
    const year=Number(race?.year??race?.season_year??String(race?.dateISO??race?.date??"").slice(0,4));
    if(Number.isFinite(year)&&year>=sourceSeason)years.add(year);
  }

  const output=[];
  for(const year of [...years].sort((a,b)=>a-b)){
    const champion=driverStandingsForYear(gs,year)[0];
    if(champion)output.push({...champion,year:Number(year)});
  }
  return output;
}

export function driverConstructorChampionships(gs,careerRows=[]){
  const teamsBySeason=new Map();
  for(const row of rows(careerRows)){
    const year=Number(unbox(row?.year));
    const series=String(unbox(row?.series_division??row?.series)??"F1").toUpperCase();
    if(!Number.isFinite(year)||series!=="F1")continue;
    const teamId=teamIdOf(row);
    if(!teamId)continue;
    if(!teamsBySeason.has(year))teamsBySeason.set(year,new Set());
    teamsBySeason.get(year).add(teamId);
  }

  return constructorChampionshipHistory(gs).filter((champion)=>
    teamsBySeason.get(Number(champion?.year))?.has(String(champion?.team_id))
  );
}

export function teamChampionshipSummary(gs,teamId){
  const id=String(teamId??"");
  const constructorTitles=constructorChampionshipHistory(gs).filter((row)=>String(row.team_id)===id);
  const driverTitles=driverChampionshipHistory(gs).filter((row)=>String(row.team_id)===id);
  return {
    constructors:constructorTitles.length,
    driversTitles:driverTitles.length,
    constructorTitles,
    driverTitles,
  };
}
