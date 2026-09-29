// src/domain/managerTeamControl.js
// Canonical handoff between player-controlled and AI-controlled teams.
//
// A manager changes employer; team assets do not move with the manager.
// Player-only technical/operational slices are archived into the AI world when
// control is relinquished and materialized back when a team becomes controlled.

import { normalizeAITechnicalWorld } from "../engine/AITechnicalEngine.js";
import { syncGarageState } from "./garage.js";

const text=(value)=>String(value??"");
const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clone=(value)=>{
  if(value==null)return value;
  try{return structuredClone(value);}catch{
    try{return JSON.parse(JSON.stringify(value));}catch{return value;}
  }
};
const teamIdOf=(row)=>text(row?.team_id??row?.id??row?.constructor_id);

function teamRows(gs){
  const live=Array.isArray(gs?.teams)?gs.teams:[];
  return live.length?live:(Array.isArray(gs?.dbTeams)?gs.dbTeams:[]);
}
function teamRow(gs,teamId){
  const id=text(teamId);
  return teamRows(gs).find((row)=>teamIdOf(row)===id)||null;
}
function stripPlayerTechnologyProjects(development){
  const next={...(clone(development)||{})};
  delete next.technologyProjects;
  return next;
}
function defaultGarage(){
  return {cars:[],serviceJobs:[],baseComponentStock:{},reserveCarBuilt:false};
}
function defaultDevelopment(){
  return {
    projects:[],parts:[],partUnits:[],manufacturing:[],research:[],
    aeroTestingUsage:[],technicalKnowledge:null,technicalStrategy:null,
    nextSeasonCar:null,technologyProjects:[],
  };
}
function defaultHQ(){
  return {facilityLevels:{},upgrades:[]};
}
function defaultAcademy(){
  return {drivers:[]};
}
function defaultScouting(){
  return {assignments:[],shortlist:[]};
}
function teamMetaSnapshot(meta){
  const source=meta&&typeof meta==="object"?meta:{};
  const out={};
  if(source.team&&typeof source.team==="object")out.team=clone(source.team);
  if(source?.popularity?.team!=null){
    out.popularity={team:source.popularity.team};
  }
  return out;
}
function clearTeamMeta(meta){
  const next=clone(meta&&typeof meta==="object"?meta:{})||{};
  delete next.team;
  if(next.popularity&&typeof next.popularity==="object"){
    const popularity={...next.popularity};
    delete popularity.team;
    if(Object.keys(popularity).length)next.popularity=popularity;
    else delete next.popularity;
  }
  return next;
}
function mergeTeamMeta(globalMeta,teamMeta){
  const base=clone(globalMeta&&typeof globalMeta==="object"?globalMeta:{})||{};
  const team=teamMeta&&typeof teamMeta==="object"?teamMeta:{};
  if(team.team&&typeof team.team==="object")base.team=clone(team.team);
  if(team?.popularity?.team!=null){
    base.popularity={...(base.popularity||{}),team:team.popularity.team};
  }
  return base;
}

export function managerControlTeamId(gs){
  return text(gs?.team?.team_id??gs?.team?.id);
}

export function managerTeamSwitchBlocked(gs){
  const phase=text(gs?.raceWeekendState?.phase).toLowerCase();
  return ["practice","qualifying","race"].includes(phase);
}

export function archiveControlledTeamForAI(gs){
  if(!gs)return gs;
  const teamId=managerControlTeamId(gs);
  if(!teamId)return gs;

  const existing=gs?.aiTechnicalWorld?.teams?.[teamId]||{};
  const budget=num(gs?.finances?.balance??gs?.team?.budget??existing?.budget,0);
  const development=clone(gs?.development)||defaultDevelopment();
  const technologyProjects=Array.isArray(development?.technologyProjects)
    ?clone(development.technologyProjects)
    :(Array.isArray(existing?.technology_projects)?clone(existing.technology_projects):[]);
  const technologyUnlocks=clone(gs?.technicalUnlocks?.[teamId]??existing?.technology_unlocks??{});

  const state={
    ...existing,
    team_id:teamId,
    budget,
    initial_budget:num(existing?.initial_budget,budget),
    garage:clone(gs?.garage)||defaultGarage(),
    development:stripPlayerTechnologyProjects(development),
    hq:clone(gs?.hq)||defaultHQ(),
    academy:clone(gs?.academy)||defaultAcademy(),
    scouting:clone(gs?.scouting)||defaultScouting(),
    board:clone(gs?.board)||{},
    legacy_runtime:{
      commercialScore:clone(gs?.commercialScore)??null,
      ops:clone(gs?.ops)||{},
      rdProjectsActive:Array.isArray(gs?.rdProjectsActive)?clone(gs.rdProjectsActive):[],
      meta:teamMetaSnapshot(gs?.meta),
      selectedDrivers:Array.isArray(gs?.selectedDrivers)?clone(gs.selectedDrivers):[],
      financeFlags:clone(gs?.financeFlags)||{},
    },
    finance_summary:{
      ...(clone(existing?.finance_summary)||{}),
      ...(clone(gs?.finances)||{}),
      balance:budget,
      budget,
    },
    finance_log:clone(gs?.financeLog)||[],
    componentServiceLog:clone(gs?.componentServiceLog)||[],
    componentWearLog:clone(gs?.componentWearLog)||[],
    technology_projects:technologyProjects,
    technology_unlocks:technologyUnlocks,
    last_player_controlled_at:text(gs?.currentDateISO).slice(0,10)||null,
  };

  const archive={
    ...(gs?.managerControlArchive||{}),
    [teamId]:{
      team_id:teamId,
      archived_at:text(gs?.currentDateISO).slice(0,10)||null,
      hq:clone(state.hq),
      academy:clone(state.academy),
      scouting:clone(state.scouting),
      board:clone(state.board),
      legacy_runtime:clone(state.legacy_runtime)||{},
    },
  };

  return {
    ...gs,
    teams:Array.isArray(gs?.teams)
      ?gs.teams.map((row)=>teamIdOf(row)===teamId?{...row,budget}:row)
      :gs?.teams,
    aiTechnicalWorld:{
      ...(gs?.aiTechnicalWorld||{}),
      version:1,
      teams:{...(gs?.aiTechnicalWorld?.teams||{}),[teamId]:state},
    },
    managerControlArchive:archive,
  };
}

export function clearPlayerTeamControl(gs){
  if(!gs)return gs;
  return {
    ...gs,
    team:null,
    finances:null,
    financeLog:[],
    garage:defaultGarage(),
    development:defaultDevelopment(),
    hq:defaultHQ(),
    academy:defaultAcademy(),
    scouting:defaultScouting(),
    board:{},
    commercialScore:null,
    ops:{},
    rdProjectsActive:[],
    meta:clearTeamMeta(gs?.meta),
    selectedDrivers:[],
    financeFlags:{},
    eventsQueue:(Array.isArray(gs?.eventsQueue)?gs.eventsQueue:[]).map((event)=>
      event?.done
        ?event
        :{
          ...event,
          done:true,
          cancelled:true,
          cancelled_at:text(gs?.currentDateISO).slice(0,10)||null,
          cancel_reason:"manager_departure",
        }
    ),
    componentServiceLog:[],
    componentWearLog:[],
    raceEntryState:null,
    raceWeekendState:null,
  };
}

export function materializeTeamForPlayer(gs,teamId){
  if(!gs)return gs;
  const targetId=text(teamId);
  if(!targetId)return gs;
  if(managerTeamSwitchBlocked(gs))return gs;

  const normalized=normalizeAITechnicalWorld(gs);
  const state=normalized?.aiTechnicalWorld?.teams?.[targetId];
  if(!state)return gs;

  const row=teamRow(normalized,targetId)||{team_id:targetId,team_name:targetId};
  const budget=num(state?.budget,row?.budget);
  const archive=normalized?.managerControlArchive?.[targetId]||{};
  const development={
    ...defaultDevelopment(),
    ...(clone(state?.development)||{}),
    technologyProjects:Array.isArray(state?.technology_projects)?clone(state.technology_projects):[],
  };
  const finances={
    ...(clone(state?.finance_summary)||{}),
    balance:budget,
    budget,
    season_spend:num(state?.finance_summary?.season_spend,0),
    season_income:num(state?.finance_summary?.season_income,0),
  };
  const hq=clone(state?.hq??archive?.hq)||defaultHQ();
  const academy=clone(state?.academy??archive?.academy)||defaultAcademy();
  const scouting=clone(state?.scouting??archive?.scouting)||defaultScouting();
  const board=clone(state?.board??archive?.board)||{};
  const legacyRuntime=clone(state?.legacy_runtime??archive?.legacy_runtime)||{};
  const teams={...(normalized?.aiTechnicalWorld?.teams||{})};
  delete teams[targetId];

  const unlocks={...(normalized?.technicalUnlocks||{})};
  unlocks[targetId]=clone(state?.technology_unlocks)||unlocks[targetId]||{};

  let next={
    ...normalized,
    team:{...row,budget},
    teams:Array.isArray(normalized?.teams)
      ?normalized.teams.map((team)=>teamIdOf(team)===targetId?{...team,budget}:team)
      :normalized?.teams,
    finances,
    financeLog:clone(state?.finance_log)||[],
    garage:clone(state?.garage)||defaultGarage(),
    development,
    hq,
    academy,
    scouting,
    board,
    commercialScore:legacyRuntime?.commercialScore??null,
    ops:legacyRuntime?.ops&&typeof legacyRuntime.ops==="object"?legacyRuntime.ops:{},
    rdProjectsActive:Array.isArray(legacyRuntime?.rdProjectsActive)?legacyRuntime.rdProjectsActive:[],
    meta:mergeTeamMeta(normalized?.meta,legacyRuntime?.meta),
    selectedDrivers:Array.isArray(legacyRuntime?.selectedDrivers)?legacyRuntime.selectedDrivers:[],
    financeFlags:legacyRuntime?.financeFlags&&typeof legacyRuntime.financeFlags==="object"?legacyRuntime.financeFlags:{},
    eventsQueue:[],
    componentServiceLog:clone(state?.componentServiceLog)||[],
    componentWearLog:clone(state?.componentWearLog)||[],
    technicalUnlocks:unlocks,
    aiTechnicalWorld:{
      ...(normalized?.aiTechnicalWorld||{}),
      version:1,
      teams,
    },
    raceEntryState:null,
    raceWeekendState:null,
  };
  next={...next,garage:syncGarageState(next,next.garage)};
  return next;
}

export function transferPlayerControl(gs,targetTeamId){
  if(!gs||managerTeamSwitchBlocked(gs))return gs;
  const current=managerControlTeamId(gs);
  const target=text(targetTeamId);
  if(!target||target===current)return gs;
  let next=gs;
  if(current)next=archiveControlledTeamForAI(next);
  next=clearPlayerTeamControl(next);
  return materializeTeamForPlayer(next,target);
}
