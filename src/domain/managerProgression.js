// src/domain/managerProgression.js
// Canonical Team Principal career progression derived only from official Save World
// race results and championship standings. The race simulation remains the source
// of truth; this module consumes its archived output and is fully idempotent.

import { deriveManagerAttributes } from "./managerProfile.js";

const ATTRIBUTE_KEYS=[
  "leadership",
  "personnel",
  "negotiation",
  "technical",
  "commercial",
  "race_management",
];

const text=(value)=>String(value??"").trim();
const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,num(value,min)));
const dateOnly=(value)=>text(value).slice(0,10);
const yearOf=(row)=>{
  const explicit=Number(row?.year??row?.season_year);
  if(Number.isFinite(explicit))return explicit;
  const match=dateOnly(row?.dateISO??row?.date).match(/^(\d{4})/);
  return match?Number(match[1]):null;
};
const teamIdOf=(row)=>text(row?.team_id??row?.constructor_id??row?.team);
const raceKey=(row,index=0)=>{
  const key=text(row?.key);
  if(key)return key;
  return [
    yearOf(row)??"season",
    Number(row?.round??row?.round_number??index+1),
    text(row?.gp_id??row?.id??row?.name??"gp"),
  ].join("_");
};

function managerCareerRows(manager){
  const rows=Array.isArray(manager?.career_history)?manager.career_history.filter(Boolean):[];
  const job=manager?.current_job&&typeof manager.current_job==="object"?manager.current_job:null;
  const currentTeam=text(job?.team_id??manager?.current_team_id);
  if(currentTeam&&!rows.some((row)=>
    text(row?.team_id)===currentTeam&&
    row?.end_year==null&&
    text(row?.status||"active").toLowerCase()==="active"
  )){
    rows.push({
      ...job,
      team_id:currentTeam,
      team_name:job?.team_name??manager?.current_team_name??currentTeam,
      start_year:job?.start_year??manager?.career_start_year,
      joined_at:job?.joined_at,
      end_year:null,
      status:"active",
    });
  }
  return rows;
}

function rowCoversResult(row,result){
  const teamId=text(row?.team_id);
  if(!teamId)return false;
  const resultYear=yearOf(result);
  const resultDate=dateOnly(result?.dateISO??result?.date);
  const joined=dateOnly(row?.joined_at);
  const ended=dateOnly(row?.ended_at);
  if(resultDate&&/^\d{4}-\d{2}-\d{2}$/.test(resultDate)){
    if(joined&&/^\d{4}-\d{2}-\d{2}$/.test(joined)&&resultDate<joined)return false;
    if(ended&&/^\d{4}-\d{2}-\d{2}$/.test(ended)&&resultDate>ended)return false;
  }
  const start=Number(row?.start_year??String(joined).slice(0,4));
  const end=row?.end_year==null
    ?Infinity
    :Number(row?.end_year);
  if(Number.isFinite(resultYear)){
    if(Number.isFinite(start)&&resultYear<start)return false;
    if(Number.isFinite(end)&&resultYear>end)return false;
  }
  return true;
}

export function managerTeamForResult(manager,result){
  const candidates=managerCareerRows(manager)
    .filter((row)=>rowCoversResult(row,result))
    .sort((a,b)=>{
      const dateCompare=dateOnly(b?.joined_at).localeCompare(dateOnly(a?.joined_at));
      if(dateCompare)return dateCompare;
      return num(b?.start_year,-Infinity)-num(a?.start_year,-Infinity);
    });
  if(!candidates.length)return null;

  const classifiedTeams=new Set(
    (Array.isArray(result?.classification)?result.classification:[])
      .map(teamIdOf)
      .filter(Boolean)
  );
  const matching=candidates.find((row)=>classifiedTeams.has(text(row?.team_id)));
  return text((matching??candidates[0])?.team_id)||null;
}

function raceOutcome(result,teamId){
  const rows=(Array.isArray(result?.classification)?result.classification:[])
    .filter((row)=>teamIdOf(row)===text(teamId));
  if(!rows.length)return null;
  const classified=rows.filter((row)=>{
    const status=text(row?.status).toUpperCase();
    return !row?.retired&&status!=="DNF";
  });
  const positions=classified
    .map((row,index)=>num(row?.position??row?.pos,index+1))
    .filter((value)=>value>0);
  const points=rows.reduce((sum,row)=>{
    const constructorPoints=Number(row?.constructor_points);
    const racePoints=Number(row?.points);
    return sum+(Number.isFinite(constructorPoints)?constructorPoints:(Number.isFinite(racePoints)?racePoints:0));
  },0);
  const best=positions.length?Math.min(...positions):null;
  return {
    points,
    scoredPoints:points>0,
    podium:best!=null&&best<=3,
    win:best===1,
  };
}

function normalizedDevelopment(manager){
  const source=manager?.development&&typeof manager.development==="object"?manager.development:{};
  return {
    xp:Math.max(0,num(source.xp,0)),
    level:Math.max(1,Math.floor(num(source.level,1))),
    last_progression_at:source.last_progression_at??null,
    processed_result_keys:[...new Set(
      (Array.isArray(source.processed_result_keys)?source.processed_result_keys:[])
        .map(text)
        .filter(Boolean)
    )],
    processed_seasons:[...new Set(
      (Array.isArray(source.processed_seasons)?source.processed_seasons:[])
        .map(Number)
        .filter(Number.isFinite)
    )],
    races_managed:Math.max(0,Math.floor(num(source.races_managed,0))),
    points_races:Math.max(0,Math.floor(num(source.points_races,0))),
    podiums:Math.max(0,Math.floor(num(source.podiums,0))),
    wins:Math.max(0,Math.floor(num(source.wins,0))),
    constructor_titles:Math.max(0,Math.floor(num(source.constructor_titles,0))),
    driver_titles:Math.max(0,Math.floor(num(source.driver_titles,0))),
    last_regression_key:text(source.last_regression_key)||null,
    last_regression_at:source.last_regression_at??null,
    last_regression_reason:text(source.last_regression_reason)||null,
    attribute_regressions:Math.max(0,num(source.attribute_regressions,0)),
    reputation_lost:Math.max(0,num(source.reputation_lost,0)),
  };
}

function managerGrowthCeilings(manager){
  const baseline=deriveManagerAttributes({
    background:manager?.background,
    experience:manager?.experience_level,
  });
  const average=ATTRIBUTE_KEYS.reduce((sum,key)=>sum+num(baseline?.[key],50),0)/ATTRIBUTE_KEYS.length;
  const allowance=Math.max(0,clamp(manager?.potential,1,99)-average);
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((key)=>[
      key,
      Math.min(99,Math.round(num(baseline?.[key],50)+allowance)),
    ])
  );
}

function applyLevelGrowth(manager,development,nextXp){
  const previousLevel=Math.max(1,Math.floor(num(development?.level,1)));
  const earnedLevel=1+Math.floor(Math.max(0,nextXp)/100);
  const nextLevel=Math.max(previousLevel,earnedLevel);
  let points=Math.max(0,nextLevel-previousLevel);
  const attributes={...(manager?.attributes||{})};
  const ceilings=managerGrowthCeilings(manager);
  const gains={};

  while(points>0){
    const candidates=ATTRIBUTE_KEYS
      .map((key,index)=>({
        key,
        index,
        current:clamp(attributes?.[key],1,99),
        headroom:Math.max(0,num(ceilings?.[key],99)-clamp(attributes?.[key],1,99)),
      }))
      .filter((row)=>row.headroom>0)
      .sort((a,b)=>b.headroom-a.headroom||a.index-b.index);
    if(!candidates.length)break;
    const selected=candidates[0];
    attributes[selected.key]=Math.min(99,selected.current+1);
    gains[selected.key]=(gains[selected.key]||0)+1;
    points-=1;
  }

  return {attributes,level:nextLevel,gains};
}

function managerRegressionFloors(manager){
  const baseline=deriveManagerAttributes({
    background:manager?.background,
    experience:manager?.experience_level,
  });
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((key)=>[
      key,
      Math.max(25,Math.round(num(baseline?.[key],50)-15)),
    ])
  );
}

function regressionReason(status){
  return status==="critical"
    ?"Sustained critical performance against Board expectations"
    :"Sustained performance below Board expectations";
}

export function applyManagerPerformanceRegression(gs,{
  assessment=null,
  criticalStreak=0,
  pressureStreak=0,
}={}){
  if(!gs?.manager||!assessment)return gs;
  const status=text(assessment?.status).toLowerCase();
  if(!["under_pressure","critical"].includes(status))return gs;

  const races=Math.max(0,Math.floor(num(assessment?.races,0)));
  if(races<=0)return gs;
  const year=Number(gs?.activeYear)||yearOf((Array.isArray(gs?.results)?gs.results:[]).at(-1))||0;
  const regressionKey=`${year}:${races}`;
  const development=normalizedDevelopment(gs.manager);
  if(development.last_regression_key===regressionKey)return gs;

  const attributes={...(gs.manager?.attributes||{})};
  const floors=managerRegressionFloors(gs.manager);
  const losses={};
  const lose=(key,amount=1)=>{
    const current=Math.round(clamp(attributes?.[key],1,99));
    const floor=Math.round(clamp(floors?.[key],1,99));
    const after=Math.max(floor,current-Math.max(0,Math.round(amount)));
    if(after>=current)return;
    attributes[key]=after;
    losses[key]=current-after;
  };

  // Employment assessment already contains the canonical Board/objective
  // interpretation. Attribute regression therefore reacts to sustained
  // underperformance, never to a raw finishing position in isolation.
  if(status==="critical"){
    if(Number(criticalStreak)===1)lose("race_management",1);
    else if(Number(criticalStreak)===2)lose("leadership",1);
  }else{
    const streak=Math.max(0,Math.floor(num(pressureStreak,0)));
    if(streak>0&&streak%6===3)lose("race_management",1);
    else if(streak>0&&streak%6===0)lose("leadership",1);
  }

  const reputationBefore=clamp(gs.manager?.reputation??35);
  const reputationLoss=status==="critical"?0.35:0.15;
  const reputationAfter=Number(clamp(reputationBefore-reputationLoss).toFixed(2));
  const attributeRegression=Object.values(losses).reduce((sum,value)=>sum+Number(value||0),0);

  return {
    ...gs,
    manager:{
      ...gs.manager,
      attributes,
      reputation:reputationAfter,
      development:{
        ...development,
        last_regression_key:regressionKey,
        last_regression_at:dateOnly(gs?.currentDateISO)||null,
        last_regression_reason:regressionReason(status),
        attribute_regressions:Number((development.attribute_regressions+attributeRegression).toFixed(2)),
        reputation_lost:Number((development.reputation_lost+(reputationBefore-reputationAfter)).toFixed(2)),
      },
    },
  };
}

function achievement(manager,id,payload){
  const existing=Array.isArray(manager?.achievements)?manager.achievements:[];
  if(existing.some((row)=>text(row?.id)===id))return null;
  return {id,source:"manager_career",...payload};
}

function sortedStandings(rows){
  return (Array.isArray(rows)?rows:[])
    .slice()
    .sort((a,b)=>
      num(a?.position,999)-num(b?.position,999)
      ||num(b?.points,0)-num(a?.points,0)
    );
}

function completedSeasonStandings(gs,year){
  const archive=(Array.isArray(gs?.historySeasons)?gs.historySeasons:[])
    .find((row)=>Number(row?.year)===Number(year));
  if(archive?.standings)return archive.standings;

  if(Number(gs?.activeYear)!==Number(year))return null;
  const seasonResults=(Array.isArray(gs?.results)?gs.results:[])
    .filter((row)=>yearOf(row)===Number(year));
  const calendarLength=Array.isArray(gs?.calendar)?gs.calendar.length:0;
  const maxRound=seasonResults.reduce((max,row)=>Math.max(max,num(row?.round??row?.round_number,0)),0);
  const complete=
    Number(gs?._seasonFinishedAt)===Number(year)
    ||(calendarLength>0&&maxRound>=calendarLength);
  return complete?(gs?.standings||null):null;
}

function managedTeamAtSeasonFinish(manager,results,year){
  const races=(Array.isArray(results)?results:[])
    .filter((row)=>yearOf(row)===Number(year))
    .slice()
    .sort((a,b)=>
      num(a?.round??a?.round_number,0)-num(b?.round??b?.round_number,0)
      ||dateOnly(a?.dateISO??a?.date).localeCompare(dateOnly(b?.dateISO??b?.date))
    );
  const finalRace=races.at(-1)||null;
  if(!finalRace)return null;
  const teamId=managerTeamForResult(manager,finalRace);
  return teamId?{teamId,result:finalRace}:null;
}

function progressionInbox(gs,{levelsGained,achievements,attributeGains}){
  if(levelsGained<=0&&!achievements.length)return null;
  const level=gs?.manager?.development?.level??1;
  const gainText=Object.entries(attributeGains||{})
    .map(([key,value])=>`${key.replaceAll("_"," ")} +${value}`)
    .join(", ");
  const parts=[];
  if(levelsGained>0)parts.push(`Manager Level ${level} reached${gainText?` (${gainText})`:""}.`);
  if(achievements.length)parts.push(`Achievement${achievements.length===1?"":"s"}: ${achievements.map((row)=>row.title).join(", ")}.`);
  return {
    id:`manager_progression_${dateOnly(gs?.currentDateISO)||"date"}_${level}_${achievements.length}`,
    date:dateOnly(gs?.currentDateISO),
    unread:true,
    type:"CAREER",
    from:"Career",
    tag:"Manager",
    subject:levelsGained>0?"Team Principal progression":"Career achievement",
    body:parts.join(" "),
    actions:[{label:"Open Manager Profile",route:"/ManagerProfile"}],
  };
}

export function applyManagerCareerProgression(gs){
  if(!gs?.manager)return gs;
  const originalManager=gs.manager;
  let manager={
    ...originalManager,
    attributes:{...(originalManager?.attributes||{})},
    achievements:Array.isArray(originalManager?.achievements)?[...originalManager.achievements]:[],
    development:normalizedDevelopment(originalManager),
  };
  const processed=new Set(manager.development.processed_result_keys);
  const processedSeasons=new Set(manager.development.processed_seasons);
  const newAchievements=[];
  const startingLevel=manager.development.level;
  let attributeGains={};

  const results=(Array.isArray(gs?.results)?gs.results:[])
    .map((row,index)=>({row,index,key:raceKey(row,index)}))
    .sort((a,b)=>
      num(yearOf(a.row),0)-num(yearOf(b.row),0)
      ||num(a.row?.round??a.row?.round_number,a.index+1)-num(b.row?.round??b.row?.round_number,b.index+1)
      ||a.key.localeCompare(b.key)
    );

  for(const entry of results){
    if(processed.has(entry.key))continue;
    processed.add(entry.key);
    const teamId=managerTeamForResult(manager,entry.row);
    if(!teamId)continue;
    const outcome=raceOutcome(entry.row,teamId);
    if(!outcome)continue;

    let xpGain=5;
    if(outcome.scoredPoints)xpGain+=2;
    if(outcome.podium)xpGain+=4;
    if(outcome.win)xpGain+=6;
    const nextXp=manager.development.xp+xpGain;
    const growth=applyLevelGrowth(manager,manager.development,nextXp);
    attributeGains={...attributeGains};
    for(const [key,value] of Object.entries(growth.gains)){
      attributeGains[key]=(attributeGains[key]||0)+value;
    }
    manager={
      ...manager,
      attributes:growth.attributes,
      reputation:Number(clamp(
        num(manager?.reputation,35)
        +(outcome.scoredPoints?0.03:0)
        +(outcome.podium?0.08:0)
        +(outcome.win?0.14:0)
      ).toFixed(2)),
      development:{
        ...manager.development,
        xp:nextXp,
        level:growth.level,
        last_progression_at:dateOnly(entry.row?.dateISO??entry.row?.date) || dateOnly(gs?.currentDateISO),
        races_managed:manager.development.races_managed+1,
        points_races:manager.development.points_races+(outcome.scoredPoints?1:0),
        podiums:manager.development.podiums+(outcome.podium?1:0),
        wins:manager.development.wins+(outcome.win?1:0),
      },
    };

    const teamName=text(
      (Array.isArray(gs?.teams)?gs.teams:[])
        .find((row)=>text(row?.team_id??row?.id??row?.constructor_id)===teamId)
        ?.team_name
    )||teamId;
    const season=yearOf(entry.row);
    const date=dateOnly(entry.row?.dateISO??entry.row?.date)||null;
    const milestones=[
      outcome.scoredPoints?achievement(manager,"manager_first_points",{
        type:"first_points",title:"First F1 Points",season,date,team_id:teamId,team_name:teamName,
      }):null,
      outcome.podium?achievement(manager,"manager_first_podium",{
        type:"first_podium",title:"First F1 Podium",season,date,team_id:teamId,team_name:teamName,
      }):null,
      outcome.win?achievement(manager,"manager_first_win",{
        type:"first_win",title:"First Grand Prix Victory",season,date,team_id:teamId,team_name:teamName,
      }):null,
    ].filter(Boolean);
    if(milestones.length){
      manager={...manager,achievements:[...manager.achievements,...milestones]};
      newAchievements.push(...milestones);
    }
  }

  const candidateYears=new Set([
    ...(Array.isArray(gs?.historySeasons)?gs.historySeasons:[]).map((row)=>Number(row?.year)).filter(Number.isFinite),
    ...results.map((entry)=>yearOf(entry.row)).filter(Number.isFinite),
  ]);
  for(const year of [...candidateYears].sort((a,b)=>a-b)){
    if(processedSeasons.has(year))continue;
    const standings=completedSeasonStandings(gs,year);
    if(!standings)continue;
    processedSeasons.add(year);
    const managed=managedTeamAtSeasonFinish(manager,gs?.results,year);
    if(!managed?.teamId)continue;

    const teamId=managed.teamId;
    const teams=sortedStandings(standings?.teams??standings?.constructors);
    const drivers=sortedStandings(standings?.drivers);
    const constructorChampion=year>=1958?teams[0]??null:null;
    const driverChampion=drivers[0]??null;
    const wonConstructors=constructorChampion&&teamIdOf(constructorChampion)===teamId;
    const wonDrivers=driverChampion&&teamIdOf(driverChampion)===teamId;
    if(!wonConstructors&&!wonDrivers)continue;

    let xpGain=0;
    let repGain=0;
    const titles=[];
    const date=dateOnly(managed.result?.dateISO??managed.result?.date)||`${year}-12-31`;
    const teamName=text(
      constructorChampion?.team_name
      ??driverChampion?.team_name
      ??(Array.isArray(gs?.teams)?gs.teams:[]).find((row)=>text(row?.team_id??row?.id)===teamId)?.team_name
      ??teamId
    );

    if(wonConstructors){
      xpGain+=60;
      repGain+=1.5;
      const item=achievement(manager,`manager_constructor_title_${year}_${teamId}`,{
        type:"constructor_champion",
        title:`Constructors' Champion — ${year}`,
        season:year,date,team_id:teamId,team_name:teamName,
      });
      if(item)titles.push(item);
      manager.development.constructor_titles+=1;
    }
    if(wonDrivers){
      xpGain+=40;
      repGain+=1;
      const driverId=text(driverChampion?.driver_id??driverChampion?.id);
      const item=achievement(manager,`manager_driver_title_${year}_${driverId||teamId}`,{
        type:"driver_champion",
        title:`Drivers' Champion Team — ${year}`,
        season:year,date,team_id:teamId,team_name:teamName,driver_id:driverId||null,
      });
      if(item)titles.push(item);
      manager.development.driver_titles+=1;
    }

    const nextXp=manager.development.xp+xpGain;
    const growth=applyLevelGrowth(manager,manager.development,nextXp);
    for(const [key,value] of Object.entries(growth.gains)){
      attributeGains[key]=(attributeGains[key]||0)+value;
    }
    manager={
      ...manager,
      attributes:growth.attributes,
      reputation:Number(clamp(num(manager?.reputation,35)+repGain).toFixed(2)),
      achievements:[...manager.achievements,...titles],
      development:{
        ...manager.development,
        xp:nextXp,
        level:growth.level,
        last_progression_at:date,
      },
    };
    newAchievements.push(...titles);
  }

  manager={
    ...manager,
    development:{
      ...manager.development,
      processed_result_keys:[...processed],
      processed_seasons:[...processedSeasons].sort((a,b)=>a-b),
    },
  };
  const levelsGained=Math.max(0,manager.development.level-startingLevel);
  const changed=
    processed.size!==normalizedDevelopment(originalManager).processed_result_keys.length
    ||processedSeasons.size!==normalizedDevelopment(originalManager).processed_seasons.length
    ||manager.development.xp!==normalizedDevelopment(originalManager).xp
    ||newAchievements.length>0;
  if(!changed)return gs;

  const next={...gs,manager};
  const notice=progressionInbox(next,{levelsGained,achievements:newAchievements,attributeGains});
  return notice?{...next,inbox:[notice,...(Array.isArray(gs?.inbox)?gs.inbox:[])]}:next;
}
