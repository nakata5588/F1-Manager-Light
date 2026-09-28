// src/domain/teamHistoricalStrength.js
// T3.2 — Historical Team Strength.
//
// Historical Starting Conditions -> Dynamic Alternative Future:
// - Strength is a January opening-state seed derived only from seasons BEFORE
//   the selected New Game year.
// - It is deliberately separate from current Car Performance and mutable Team
//   Reputation. Future Facilities/Finance/Car systems may consume the relevant
//   dimensions without creating a circular dependency.
// - Team identity is canonical and temporal. By default history is inherited
//   only from the same managerial Team ID; optional explicit lineage links may
//   extend that evidence when a future curated source can prove continuity.

const rows=(value)=>Array.isArray(value)?value:[];
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const round1=(value)=>Math.round(Number(value||0)*10)/10;

const unwrap=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unwrap(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unwrap(value.value);
    if(value.text!==undefined&&value.text!==null&&value.text!=="")return unwrap(value.text);
  }
  return value;
};
const text=(value)=>String(unwrap(value)??"").trim();
const num=(value,fallback=null)=>{
  const parsed=Number(unwrap(value));
  return Number.isFinite(parsed)?parsed:fallback;
};
const yearOf=(row)=>num(row?.year??row?.season_year,null);
const teamIdOf=(row)=>text(
  row?.team_id??
  row?.constructor_id??
  row?.entrant_id??
  row?.managerial_team_id??
  row?.id
);

function explicitLineageIds(teamId,lineageRows=[],year){
  const target=String(teamId||"");
  const ids=new Set(target?[target]:[]);
  const accepted=[];

  for(const row of rows(lineageRows)){
    const successor=text(row?.successor_team_id??row?.team_id??row?.to_team_id);
    const predecessor=text(row?.predecessor_team_id??row?.from_team_id);
    const start=num(row?.effective_from_year??row?.year_from??row?.year,null);
    const end=num(row?.effective_to_year??row?.year_to,null);
    const confidence=String(row?.confidence??"").toUpperCase();
    const explicit=Boolean(row?.explicit??row?.verified??false);
    if(successor!==target||!predecessor)continue;
    if(Number.isFinite(start)&&Number(start)>Number(year))continue;
    if(Number.isFinite(end)&&Number(end)<Number(year))continue;
    if(!explicit&&!["HIGH","VERIFIED"].includes(confidence))continue;
    ids.add(predecessor);
    accepted.push({
      predecessor_team_id:predecessor,
      successor_team_id:successor,
      confidence:confidence||"VERIFIED",
      source:text(row?.source)||"explicit_lineage",
    });
  }
  return {ids,accepted};
}

function participationYears(teamIds,teamSeasons=[],driverHistory=[],year){
  const years=new Set();
  const target=Number(year);
  for(const row of rows(teamSeasons)){
    const y=yearOf(row);
    if(!Number.isFinite(y)||y>=target||!teamIds.has(teamIdOf(row)))continue;
    years.add(y);
  }
  // Compatibility fallback for seasons whose generated Team cache is sparse.
  for(const row of rows(driverHistory)){
    const y=yearOf(row);
    const series=String(unwrap(row?.series_division??row?.series)??"F1").toUpperCase();
    if(series&&series!=="F1")continue;
    if(!Number.isFinite(y)||y>=target||!teamIds.has(teamIdOf(row)))continue;
    years.add(y);
  }
  return [...years].sort((a,b)=>a-b);
}

function aggregateRaceAchievements(teamIds,driverHistory=[],year){
  const target=Number(year);
  let wins=0;
  let podiums=0;
  let starts=0;
  for(const row of rows(driverHistory)){
    const y=yearOf(row);
    const series=String(unwrap(row?.series_division??row?.series)??"F1").toUpperCase();
    if(series&&series!=="F1")continue;
    if(!Number.isFinite(y)||y>=target||!teamIds.has(teamIdOf(row)))continue;
    wins+=Math.max(0,num(row?.wins,0));
    podiums+=Math.max(0,num(row?.podiums,0));
    starts+=Math.max(0,num(row?.starts??row?.races,0));
  }
  return {wins,podiums,starts};
}

function championshipRowBelongsToTeamIds(row,teamIds,teamSeasons=[]){
  const direct=teamIdOf(row);
  if(teamIds.has(direct))return true;
  const y=yearOf(row);
  if(!Number.isFinite(y)||!direct)return false;

  // historical_championships stores technical Constructor identity. Resolve
  // it back through the Results-derived Team/Entrant season bridge before
  // assigning sporting history to a managerial Team.
  return rows(teamSeasons).some((season)=>{
    if(Number(yearOf(season))!==Number(y)||!teamIds.has(teamIdOf(season)))return false;
    const technicalIds=[
      ...(Array.isArray(season?.exact_constructor_ids)?season.exact_constructor_ids:[]),
      ...(Array.isArray(season?.constructor_ids)?season.constructor_ids:[]),
    ].map(String);
    return technicalIds.includes(String(direct));
  });
}

function titleEvidence(teamIds,historicalChampionships,teamSeasons,year){
  const target=Number(year);
  const constructors=rows(historicalChampionships?.constructors).filter((row)=>
    Number(yearOf(row))<target&&
    championshipRowBelongsToTeamIds(row,teamIds,teamSeasons)&&
    Number(num(row?.position,999))===1
  );
  const drivers=rows(historicalChampionships?.drivers).filter((row)=>
    Number(yearOf(row))<target&&
    championshipRowBelongsToTeamIds(row,teamIds,teamSeasons)&&
    Number(num(row?.position,999))===1
  );
  return {
    constructors:constructors.length,
    drivers:drivers.length,
    last_constructor_title_year:constructors.length?Math.max(...constructors.map(yearOf)):null,
    last_driver_title_year:drivers.length?Math.max(...drivers.map(yearOf)):null,
  };
}

function constructorRankScore(position,fieldSize){
  const pos=Number(position);
  const field=Number(fieldSize);
  if(!Number.isFinite(pos)||pos<1)return null;
  if(!Number.isFinite(field)||field<=1)return pos===1?100:50;
  return clamp(100*(field-pos)/(field-1));
}

function recentConstructorEvidence(teamIds,historicalChampionships,driverHistory,teamSeasons,year,{window=5}={}){
  const target=Number(year);
  const start=Math.max(1950,target-Math.max(1,Number(window)||5));
  const constructorRows=rows(historicalChampionships?.constructors);
  const driverRows=rows(driverHistory);
  const samples=[];

  for(let y=target-1;y>=start;y-=1){
    const seasonConstructors=constructorRows.filter((row)=>Number(yearOf(row))===y);
    const own=seasonConstructors
      .filter((row)=>championshipRowBelongsToTeamIds(row,teamIds,teamSeasons))
      .sort((a,b)=>num(a?.position,999)-num(b?.position,999))[0]||null;

    let score=null;
    let position=null;
    let fieldSize=null;
    let source="";

    if(own){
      position=num(own?.position,null);
      fieldSize=seasonConstructors.length;
      score=constructorRankScore(position,fieldSize);
      source="constructors_championship";
    }else{
      // 1950-1957 and any sparse constructor season: rank managerial Teams by
      // their precomputed historical points. This keeps the signal era-relative.
      const pointsByTeam=new Map();
      for(const row of driverRows){
        if(Number(yearOf(row))!==y)continue;
        const series=String(unwrap(row?.series_division??row?.series)??"F1").toUpperCase();
        if(series&&series!=="F1")continue;
        const id=teamIdOf(row);
        if(!id)continue;
        pointsByTeam.set(id,(pointsByTeam.get(id)||0)+Math.max(0,num(row?.points,0)));
      }
      const ranked=[...pointsByTeam.entries()]
        .map(([id,points])=>({id,points}))
        .sort((a,b)=>b.points-a.points||a.id.localeCompare(b.id));
      const index=ranked.findIndex((row)=>teamIds.has(row.id));
      if(index>=0){
        position=index+1;
        fieldSize=ranked.length;
        score=constructorRankScore(position,fieldSize);
        source="team_points_fallback";
      }
    }

    if(Number.isFinite(score)){
      const yearsAgo=(target-1)-y;
      const weight=Math.pow(0.72,yearsAgo);
      samples.push({year:y,position,field_size:fieldSize,score:round1(score),weight:round1(weight),source});
    }
  }

  if(!samples.length)return {score:null,samples:[]};
  const weightTotal=samples.reduce((sum,row)=>sum+row.weight,0);
  const weighted=samples.reduce((sum,row)=>sum+row.score*row.weight,0)/Math.max(0.0001,weightTotal);
  // Last place is still an active F1 organisation; reserve the bottom 20
  // points for newcomers / teams with no historical competitive evidence.
  return {score:round1(20+0.8*weighted),samples};
}

function heritageScore(seasons){
  const count=Math.max(0,Number(seasons)||0);
  if(!count)return 25;
  return round1(clamp(25+75*(1-Math.exp(-count/10))));
}

function sportingScore({wins=0,podiums=0,constructorTitles=0,driverTitles=0}={}){
  const titleSignal=Math.min(45,Math.max(0,constructorTitles)*15+Math.max(0,driverTitles)*10);
  const winSignal=Math.min(20,Math.log2(1+Math.max(0,wins))*4.5);
  const podiumSignal=Math.min(10,Math.log2(1+Math.max(0,podiums))*2);
  return round1(clamp(25+titleSignal+winSignal+podiumSignal));
}

export function teamHistoricalStrength({
  teamId,
  year,
  teamSeasons=[],
  driverHistory=[],
  historicalChampionships={drivers:[],constructors:[]},
  lineageRows=[],
}={}){
  const id=String(teamId||"");
  const target=Number(year);
  if(!id||!Number.isInteger(target))return null;

  const lineage=explicitLineageIds(id,lineageRows,target);
  const seasons=participationYears(lineage.ids,teamSeasons,driverHistory,target);
  const achievements=aggregateRaceAchievements(lineage.ids,driverHistory,target);
  const titles=titleEvidence(lineage.ids,historicalChampionships,teamSeasons,target);
  const recent=recentConstructorEvidence(
    lineage.ids,
    historicalChampionships,
    driverHistory,
    teamSeasons,
    target
  );

  const heritage=heritageScore(seasons.length);
  const sporting=sportingScore({
    wins:achievements.wins,
    podiums:achievements.podiums,
    constructorTitles:titles.constructors,
    driverTitles:titles.drivers,
  });
  const recentCompetitiveness=Number.isFinite(recent.score)
    ?recent.score
    :(seasons.length?35:25);

  // Structural strength intentionally excludes current/recent car pace.
  // Facilities/HQ may consume this later without circularly deriving the car
  // from the car itself.
  const structural=round1(clamp(heritage*0.55+sporting*0.45));
  const competitive=round1(clamp(sporting*0.45+recentCompetitiveness*0.55));
  const overall=round1(clamp(
    heritage*0.35+
    sporting*0.35+
    recentCompetitiveness*0.30
  ));

  return {
    year:target,
    team_id:id,
    evidence_through_year:target-1,
    source:"historical_preseason_strength_v1",
    lineage_basis:lineage.accepted.length?"explicit_verified_lineage":"direct_managerial_identity",
    inherited_team_ids:[...lineage.ids].filter((value)=>value!==id).sort(),
    lineage_evidence:lineage.accepted,
    first_historical_season:seasons[0]??null,
    latest_historical_season:seasons.at(-1)??null,
    seasons_before_start:seasons.length,
    historical_starts:achievements.starts,
    historical_wins:achievements.wins,
    historical_podiums:achievements.podiums,
    constructors_titles:titles.constructors,
    drivers_titles:titles.drivers,
    last_constructor_title_year:titles.last_constructor_title_year,
    last_driver_title_year:titles.last_driver_title_year,
    recent_seasons:recent.samples,
    heritage_strength:heritage,
    sporting_strength:sporting,
    recent_competitiveness:recentCompetitiveness,
    structural_strength:structural,
    competitive_strength:competitive,
    overall,
  };
}

export function materializeHistoricalTeamStrengths({
  teamIds=[],
  year,
  teamSeasons=[],
  driverHistory=[],
  historicalChampionships={drivers:[],constructors:[]},
  lineageRows=[],
}={}){
  return [...new Set(rows(teamIds).map((value)=>String(value||"")).filter(Boolean))]
    .map((teamId)=>teamHistoricalStrength({
      teamId,
      year,
      teamSeasons,
      driverHistory,
      historicalChampionships,
      lineageRows,
    }))
    .filter(Boolean)
    .sort((a,b)=>b.overall-a.overall||a.team_id.localeCompare(b.team_id));
}
