// src/domain/technologyAdoption.js
// Stage 5 validation: technology discovery/adoption.
// Seeing another TEAM use an era-legal technology creates an R&D opportunity;
// it never grants the technology or a physical part for free.

import {
  componentEligibility,
  componentLabel,
  SPECIAL_TECH_SLOTS,
  teamTechnologyUnlocked,
} from "./carComponents.js";
import { standardBuildQuote } from "./componentService.js";

const str=(v)=>String(v??"");
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};

function yearOf(gs){
  return Number(gs?.activeYear)||Number(str(gs?.currentDateISO).slice(0,4))||1980;
}
function dateOnly(value){
  const raw=str(value).slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:"";
}
function parseISO(value){
  const [y,m,d]=dateOnly(value).split("-").map(Number);
  return new Date(Date.UTC(y||1970,(m||1)-1,d||1));
}
function addDaysISO(value,days){
  const d=parseISO(value);
  d.setUTCDate(d.getUTCDate()+Math.max(0,Math.floor(Number(days)||0)));
  return d.toISOString().slice(0,10);
}
function teamIdOf(row){
  return str(row?.team_id??row?.constructor_id??row?.team??row?.constructor??row?.id);
}
function teamName(gs,teamId){
  const row=(gs?.teams||gs?.dbTeams||[]).find((team)=>teamIdOf(team)===str(teamId));
  return str(row?.team_name??row?.name??row?.short_name??teamId);
}
function activeTeamIds(gs){
  const year=yearOf(gs);
  const ids=new Set();
  for(const rows of [gs?.carStats,gs?.teamEngines]){
    for(const row of rows||[]){
      const ry=Number(row?.year??row?.season_year);
      if(Number.isFinite(ry)&&ry!==year)continue;
      const id=teamIdOf(row);
      if(id)ids.add(id);
    }
  }
  if(!ids.size){
    for(const row of gs?.teams||[]){
      const id=teamIdOf(row);
      if(id)ids.add(id);
    }
  }
  return [...ids].sort();
}

function technicalScopedState(gs,teamId){
  const tid=str(teamId);
  const player=str(gs?.team?.team_id??gs?.team?.id);
  if(tid===player)return gs;
  const ai=gs?.aiTechnicalWorld?.teams?.[tid]||{};
  return {
    ...gs,
    team:{team_id:tid,budget:num(ai?.budget,0)},
    finances:{balance:num(ai?.budget,0),budget:num(ai?.budget,0)},
    hq:{facilityLevels:{},upgrades:[]},
    garage:ai?.garage||{cars:[],serviceJobs:[],baseComponentStock:{}},
    development:ai?.development||{projects:[],parts:[],partUnits:[],manufacturing:[],research:[]},
  };
}

export function technologySourceTeams(gs,teamId,slot){
  const tid=str(teamId);
  return activeTeamIds(gs)
    .filter((candidate)=>candidate!==tid)
    .filter((candidate)=>componentEligibility(gs,candidate,slot).available)
    .map((candidate)=>({team_id:candidate,name:teamName(gs,candidate)}));
}

export function discoverableCarTechnologies(gs,teamId){
  const tid=str(teamId);
  return SPECIAL_TECH_SLOTS
    .map((slot)=>{
      const own=componentEligibility(gs,tid,slot);
      if(own.available||own.reason!=="technology_not_fitted")return null;
      const sources=technologySourceTeams(gs,tid,slot);
      if(!sources.length)return null;
      return {
        slot,
        label:componentLabel(gs,slot),
        sources,
        source_team_ids:sources.map((row)=>row.team_id),
      };
    })
    .filter(Boolean);
}

export function technologyAdoptionQuote(gs,teamId,slot){
  const scoped=technicalScopedState(gs,teamId);
  const base=standardBuildQuote(scoped,slot);
  const sources=technologySourceTeams(gs,teamId,slot);
  const sourceFactor=sources.length>=3?0.88:sources.length===2?0.94:1;
  return {
    kind:"technology_adoption",
    slot:str(slot),
    cost:Math.round(Math.max(300_000,num(base?.cost,100_000)*3.2)*sourceFactor/10_000)*10_000,
    days:Math.max(28,Math.round(num(base?.days,10)*3.2*sourceFactor)),
    sources,
  };
}

export function technologyProjectsForTeam(gs,teamId){
  const tid=str(teamId);
  const player=str(gs?.team?.team_id??gs?.team?.id);
  if(tid===player){
    return Array.isArray(gs?.development?.technologyProjects)?gs.development.technologyProjects:[];
  }
  return Array.isArray(gs?.aiTechnicalWorld?.teams?.[tid]?.technology_projects)
    ?gs.aiTechnicalWorld.teams[tid].technology_projects
    :[];
}

function activeTechnologyProject(gs,teamId,slot){
  return technologyProjectsForTeam(gs,teamId).find((project)=>
    str(project?.slot)===str(slot)&&project?.status==="active"
  )||null;
}

export function startTechnologyAdoption(gs,teamId,slot,{origin="player"}={}){
  const tid=str(teamId);
  const key=str(slot);
  const today=dateOnly(gs?.currentDateISO);
  if(!tid||!key||!today)return gs;
  if(teamTechnologyUnlocked(gs,tid,key))return gs;
  if(activeTechnologyProject(gs,tid,key))return gs;

  const opportunity=discoverableCarTechnologies(gs,tid).find((row)=>row.slot===key);
  if(!opportunity)return gs;
  const quote=technologyAdoptionQuote(gs,tid,key);
  const player=str(gs?.team?.team_id??gs?.team?.id);
  const project={
    id:`tech_${tid.replace(/[^a-zA-Z0-9_-]+/g,"_")}_${key}_${yearOf(gs)}`,
    team_id:tid,
    slot:key,
    label:componentLabel(gs,key),
    status:"active",
    origin,
    started_at:today,
    finishes_at:addDaysISO(today,quote.days),
    duration_days:quote.days,
    cost:quote.cost,
    source_team_ids:opportunity.source_team_ids,
  };

  if(tid===player){
    const budget=num(gs?.team?.budget,gs?.finances?.balance);
    if(budget<quote.cost)return gs;
    return {
      ...gs,
      team:{...(gs?.team||{}),budget:budget-quote.cost},
      finances:{
        ...(gs?.finances||{}),
        budget:budget-quote.cost,
        balance:num(gs?.finances?.balance,budget)-quote.cost,
        season_spend:num(gs?.finances?.season_spend,0)+quote.cost,
      },
      financeLog:[
        ...(gs?.financeLog||[]),
        {
          id:`tx_${project.id}`,
          dateISO:today,
          type:"expense",
          category:"Technology R&D",
          amount:-quote.cost,
          desc:`${project.label} adoption programme`,
        },
      ],
      development:{
        ...(gs?.development||{}),
        technologyProjects:[...technologyProjectsForTeam(gs,tid),project],
      },
      inbox:[
        {
          id:`technology_started_${project.id}`,
          date:today,
          unread:true,
          type:"DEV",
          from:"Technical Department",
          tag:"Technology",
          subject:`${project.label} R&D programme started`,
          body:`We have committed to a ${quote.days}-day technology adoption programme. Completing the research will unlock ${project.label} as a development area; it will not create a race-ready part automatically.`,
          actions:[{label:"Open R&D",route:"/Car?view=development&tab=research"}],
        },
        ...(gs?.inbox||[]),
      ].slice(0,300),
    };
  }

  const state=gs?.aiTechnicalWorld?.teams?.[tid];
  if(!state||num(state?.budget,0)<quote.cost)return gs;
  const nextState={
    ...state,
    budget:num(state.budget,0)-quote.cost,
    technology_projects:[...(state?.technology_projects||[]),project],
    finance_log:[
      ...(state?.finance_log||[]),
      {
        id:`ai_tx_${project.id}`,
        dateISO:today,
        type:"expense",
        category:"Technology R&D",
        amount:-quote.cost,
        desc:`${project.label} adoption programme`,
      },
    ].slice(-500),
  };
  return {
    ...gs,
    aiTechnicalWorld:{
      ...(gs?.aiTechnicalWorld||{}),
      teams:{...(gs?.aiTechnicalWorld?.teams||{}),[tid]:nextState},
    },
    inbox:[
      {
        id:`ai_technology_started_${project.id}`,
        date:today,
        unread:true,
        type:"DEV",
        from:"Paddock Technical Watch",
        tag:"Technology",
        subject:`${teamName(gs,tid)} begins ${project.label} technology programme`,
        body:`${teamName(gs,tid)} has committed budget and engineering time to adopt ${project.label}. The programme is expected to take around ${quote.days} days before that TEAM can design race components around the technology.`,
        actions:[{label:"Compare cars",route:"/Car?view=analysis"}],
      },
      ...(gs?.inbox||[]),
    ].slice(0,300),
  };
}

function completionNews(gs,teamId,project){
  return {
    id:`technology_complete_${project.id}`,
    date:dateOnly(gs?.currentDateISO),
    unread:true,
    type:"DEV",
    from:str(teamId)===str(gs?.team?.team_id??gs?.team?.id)?"Technical Department":"Paddock Technical Watch",
    tag:"Technology",
    subject:`${teamName(gs,teamId)} completes ${project.label} technology R&D`,
    body:str(teamId)===str(gs?.team?.team_id??gs?.team?.id)
      ?`${project.label} is now understood by our technical department. You can start component development in this area; a physical race part still needs to be designed and manufactured.`
      :`${teamName(gs,teamId)} has completed its ${project.label} adoption programme and can now begin developing race components around the technology.`,
    actions:[{label:"Open Development",route:"/Car?view=development&tab=projects"}],
  };
}

export function processTechnologyAdoption(gs){
  if(!gs)return gs;
  const today=dateOnly(gs?.currentDateISO);
  if(!today)return gs;
  let next=gs;
  const player=str(next?.team?.team_id??next?.team?.id);

  const playerProjects=technologyProjectsForTeam(next,player);
  let playerCompleted=[];
  const updatedPlayer=playerProjects.map((project)=>{
    if(project?.status!=="active"||!project?.finishes_at||project.finishes_at>today)return project;
    playerCompleted.push(project);
    return {...project,status:"completed",completed_at:today};
  });
  if(playerCompleted.length){
    const unlocks={...(next?.technicalUnlocks||{})};
    unlocks[player]={...(unlocks[player]||{})};
    for(const project of playerCompleted){
      unlocks[player][project.slot]={unlocked_at:today,source_project_id:project.id};
    }
    next={
      ...next,
      technicalUnlocks:unlocks,
      development:{...(next?.development||{}),technologyProjects:updatedPlayer},
      inbox:[
        ...playerCompleted.map((project)=>completionNews(next,player,project)),
        ...(next?.inbox||[]),
      ].slice(0,300),
    };
  }

  let teams={...(next?.aiTechnicalWorld?.teams||{})};
  let changed=false;
  const news=[];
  for(const [teamId,state] of Object.entries(teams)){
    const projects=Array.isArray(state?.technology_projects)?state.technology_projects:[];
    const completed=[];
    const updated=projects.map((project)=>{
      if(project?.status!=="active"||!project?.finishes_at||project.finishes_at>today)return project;
      completed.push(project);
      return {...project,status:"completed",completed_at:today};
    });
    if(!completed.length)continue;
    changed=true;
    const unlocks={...(state?.technology_unlocks||{})};
    for(const project of completed){
      unlocks[project.slot]={unlocked_at:today,source_project_id:project.id};
      news.push(completionNews(next,teamId,project));
    }
    teams[teamId]={...state,technology_projects:updated,technology_unlocks:unlocks};
  }
  if(changed){
    next={
      ...next,
      aiTechnicalWorld:{...(next?.aiTechnicalWorld||{}),teams},
      inbox:[...news,...(next?.inbox||[])].slice(0,300),
    };
  }
  return next;
}

export function processTechnologyDiscoveryNews(gs){
  if(!gs)return gs;
  const player=str(gs?.team?.team_id??gs?.team?.id);
  if(!player)return gs;
  const opportunities=discoverableCarTechnologies(gs,player);
  if(!opportunities.length)return gs;

  const seen={...(gs?.technologyDiscoverySeen||{})};
  const newRows=opportunities.filter((row)=>!seen[`${player}::${row.slot}`]);
  if(!newRows.length)return gs;

  const today=dateOnly(gs?.currentDateISO);
  const news=newRows.map((row)=>{
    const sourceNames=row.sources.map((source)=>source.name).join(", ");
    seen[`${player}::${row.slot}`]={seen_at:today,source_team_ids:row.source_team_ids};
    const quote=technologyAdoptionQuote(gs,player,row.slot);
    return {
      id:`technology_opportunity_${player}_${row.slot}_${yearOf(gs)}`,
      date:today,
      unread:true,
      type:"DEV",
      from:"Paddock Technical Watch",
      tag:"Technology",
      subject:`${row.label} technology draws paddock attention`,
      body:`${sourceNames} ${row.sources.length===1?"is":"are"} already running ${row.label} technology. Our engineers believe we can attempt an independent adoption programme for approximately ${quote.days} days of R&D. This only unlocks the technology; a competitive component would still need to be designed and manufactured afterwards.`,
      actions:[{label:"Review technology",route:"/Car?view=development&tab=research"}],
    };
  });

  return {
    ...gs,
    technologyDiscoverySeen:seen,
    inbox:[...news,...(gs?.inbox||[])].slice(0,300),
  };
}
