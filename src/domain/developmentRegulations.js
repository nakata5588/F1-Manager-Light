// src/domain/developmentRegulations.js
// Stage 6.1 — Era-aware development regulations.
//
// Historical anchors:
// - Late-1970s F1 aerodynamic development used physical wind tunnels (Lotus 78/79).
// - CFD was still an experimental research tool in F1 in 1990.
// - FIA-policed aerodynamic testing restrictions entered the Sporting Regulations in 2014.
// - 2021 introduced the ATR sliding scale.
// - 2021-2026 reference ATR allowance at C=100%:
//   320 RWTT runs, 80h wind-on, 400h occupancy, 2000 RATGs and 6 MAUh CFD per ATP.
// - 2021 coefficient: P1 90% ... P10/new 112.5%.
// - 2022+ coefficient: P1 70% ... P10/new 115%.
// - 2026 gearbox design is homologated, with reliability exceptions.
// - 2026-2030 PU elements are homologated and their upgrades follow the PU regulations.
//
// We intentionally do NOT invent exact 2015-2020 yearly quotas here. Those years are
// marked as FIA-restricted, but no hard game allowance is enforced until the canonical
// historical rules table contains exact year-specific limits.

import { carComponentDefinition } from "./carComponents.js";

const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const str=(v)=>String(v??"");
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));

const PU_HOMOLOGATED_2026_2030=new Set([
  "turbocharger",
  "ers_mgu_k",
  "battery_pack",
  "exhaust_system",
]);

const AERO_TEST_SLOTS=new Set([
  "aero_front",
  "aero_rear",
  "sidepods",
  "underfloor",
  "suspension",
]);

const C_2021=[90,92.5,95,97.5,100,102.5,105,107.5,110,112.5];
const C_2022_PLUS=[70,75,80,85,90,95,100,105,110,115];

function parseISO(value){
  const [y,m,d]=str(value).slice(0,10).split("-").map(Number);
  return new Date(Date.UTC(y||1970,(m||1)-1,d||1));
}
function iso(date){return date.toISOString().slice(0,10);}
function addDays(date,days){
  const next=new Date(date.getTime());
  next.setUTCDate(next.getUTCDate()+days);
  return next;
}
function yearOf(gs){
  return Number(gs?.activeYear)||Number(str(gs?.currentDateISO).slice(0,4))||1980;
}
function teamIdOf(row){
  return str(row?.team_id??row?.team??row?.constructor_id??row?.constructor);
}
function positionFromRows(rows,teamId){
  const list=Array.isArray(rows)?rows:[];
  const row=list.find((item)=>teamIdOf(item)===str(teamId));
  if(!row)return null;
  const explicit=Number(row?.position??row?.pos??row?.rank);
  if(Number.isFinite(explicit)&&explicit>0)return explicit;
  const sorted=[...list].sort((a,b)=>num(b?.points,0)-num(a?.points,0));
  const index=sorted.findIndex((item)=>teamIdOf(item)===str(teamId));
  return index>=0?index+1:null;
}
function previousSeasonPosition(gs,teamId,year){
  const archive=(gs?.historySeasons||[]).find((row)=>Number(row?.year)===Number(year)-1);
  return positionFromRows(archive?.standings?.teams,teamId);
}
function currentPosition(gs,teamId){
  return positionFromRows(gs?.standings?.teams,teamId)
    ??positionFromRows(gs?.lastRace?.teamStandings,teamId);
}
function coefficientForPosition(year,position){
  const table=Number(year)===2021?C_2021:C_2022_PLUS;
  const index=clamp((Number(position)||10)-1,0,9);
  return Number(table[index]||table[9]);
}
function isoWeekOneMonday(year){
  const jan4=new Date(Date.UTC(year,0,4));
  const day=jan4.getUTCDay()||7;
  return addDays(jan4,1-day);
}
export function aerodynamicTestingPeriods(year){
  const y=Number(year)||2021;
  const jan1=new Date(Date.UTC(y,0,1));
  const dec31=new Date(Date.UTC(y,11,31));
  const week1=isoWeekOneMonday(y);
  const p1End=addDays(week1,9*7-1);
  const p2Start=addDays(p1End,1),p2End=addDays(p2Start,8*7-1);
  const p3Start=addDays(p2End,1),p3End=addDays(p3Start,8*7-1);
  const p4Start=addDays(p3End,1),p4End=addDays(p4Start,10*7-1);
  const p5Start=addDays(p4End,1),p5End=addDays(p5Start,8*7-1);
  const p6Start=addDays(p5End,1);
  return [
    {number:1,start:iso(jan1),end:iso(p1End)},
    {number:2,start:iso(p2Start),end:iso(p2End)},
    {number:3,start:iso(p3Start),end:iso(p3End)},
    {number:4,start:iso(p4Start),end:iso(p4End)},
    {number:5,start:iso(p5Start),end:iso(p5End)},
    {number:6,start:iso(p6Start),end:iso(dec31)},
  ];
}
function periodForDate(year,dateISO){
  const date=str(dateISO||`${year}-01-01`).slice(0,10);
  return aerodynamicTestingPeriods(year).find((period)=>date>=period.start&&date<=period.end)
    ||aerodynamicTestingPeriods(year).at(-1);
}
function previousOrCurrentPosition(gs,teamId,year,periodNumber){
  if(periodNumber<=3){
    return previousSeasonPosition(gs,teamId,year)
      ??currentPosition(gs,teamId)
      ??10;
  }
  return currentPosition(gs,teamId)
    ??previousSeasonPosition(gs,teamId,year)
    ??10;
}

export function usesAerodynamicTesting(gs,slot){
  const key=str(slot);
  if(AERO_TEST_SLOTS.has(key))return true;
  return str(carComponentDefinition(gs,key)?.impact_area)==="aero";
}

export function developmentRegulationProfile(gs,teamId,{dateISO=null}={}){
  const year=yearOf(gs);
  const date=str(dateISO||gs?.currentDateISO||`${year}-01-01`).slice(0,10);

  if(year<1990){
    return {
      year,date,scheme:"pre_cfd_open",
      label:"Open development · physical aero testing",
      cfd_available:false,
      cfd_unit:null,
      wind_tunnel_available:true,
      wind_tunnel_unit:"hours",
      regulated_aero_testing:false,
      hard_quota:false,
      period:null,
      coefficient:null,
      limits:null,
      note:"No FIA aerodynamic-testing quota is modelled for this era. Wind-tunnel use is limited by team facilities and project capacity; CFD is unavailable.",
    };
  }

  if(year<2014){
    return {
      year,date,scheme:"internal_cfd_open",
      label:"Open development · internal aero resources",
      cfd_available:true,
      cfd_unit:"compute hours",
      wind_tunnel_available:true,
      wind_tunnel_unit:"hours",
      regulated_aero_testing:false,
      hard_quota:false,
      period:null,
      coefficient:null,
      limits:null,
      note:"Wind tunnel and CFD are internal team resources in this era; no FIA ATR quota is enforced by the game.",
    };
  }

  if(year<2021){
    return {
      year,date,scheme:"fia_restricted_unmodelled",
      label:"FIA-restricted aerodynamic testing",
      cfd_available:true,
      cfd_unit:"allocation",
      wind_tunnel_available:true,
      wind_tunnel_unit:"hours",
      regulated_aero_testing:true,
      hard_quota:false,
      period:null,
      coefficient:null,
      limits:null,
      note:"FIA-policed aero-testing restrictions apply. Exact year-specific 2014-2020 limits are not hard-coded until their historical rules are digitised.",
    };
  }

  const period=periodForDate(year,date);
  const position=previousOrCurrentPosition(gs,teamId,year,period.number);
  const coefficient=coefficientForPosition(year,position);
  const multiplier=coefficient/100;
  return {
    year,date,
    scheme:"fia_atr",
    label:"FIA Aerodynamic Testing Restrictions (ATR)",
    cfd_available:true,
    cfd_unit:"MAUh",
    wind_tunnel_available:true,
    wind_tunnel_unit:"wind-on hours",
    regulated_aero_testing:true,
    hard_quota:true,
    period:{...period,id:`${year}-ATP${period.number}`},
    championship_position:position,
    coefficient,
    limits:{
      wind_tunnel_runs:Math.ceil(320*multiplier),
      wind_tunnel_hours:Number((80*multiplier).toFixed(2)),
      wind_tunnel_occupancy_hours:Number((400*multiplier).toFixed(2)),
      cfd_ratgs:Math.ceil(2000*multiplier),
      cfd_mauh:Number((6*multiplier).toFixed(3)),
    },
    note:`ATP ${period.number}/6 · ATR coefficient ${coefficient}% from Constructors' Championship position P${position}.`,
  };
}

export function componentDevelopmentRule(gs,teamId,slot){
  const year=yearOf(gs);
  const key=str(slot);

  if(year===2026&&key==="gearbox"){
    return {
      rule:"homologated_reliability",
      label:"Homologated · reliability changes only",
      can_start_project:true,
      allowed_objectives:["reliability"],
      reason:"2026 gearbox design is homologated. In-season modification is limited to permitted exceptions such as resolving reliability problems.",
    };
  }

  if(year>=2026&&year<=2030&&PU_HOMOLOGATED_2026_2030.has(key)){
    return {
      rule:"pu_homologated",
      label:"PU homologated · manufacturer programme",
      can_start_project:false,
      allowed_objectives:[],
      reason:"2026-2030 Power Unit elements are governed by PU-manufacturer homologation and scheduled/ADUO upgrade rules, not normal team current-car development.",
    };
  }

  return {
    rule:"free",
    label:"Free in-season development",
    can_start_project:true,
    allowed_objectives:null,
    reason:"This component may be redesigned during the season, subject to era eligibility, budget, facilities and project capacity.",
  };
}

export function aeroTestingUsageForPeriod(development,profile){
  if(!profile?.period?.id)return {
    period_id:null,wind_tunnel_hours:0,cfd_mauh:0,wind_tunnel_runs:0,cfd_ratgs:0,
  };
  const rows=Array.isArray(development?.aeroTestingUsage)?development.aeroTestingUsage:[];
  const row=rows.find((item)=>str(item?.period_id)===profile.period.id)||{};
  return {
    period_id:profile.period.id,
    wind_tunnel_hours:num(row?.wind_tunnel_hours,0),
    cfd_mauh:num(row?.cfd_mauh,0),
    wind_tunnel_runs:num(row?.wind_tunnel_runs,0),
    cfd_ratgs:num(row?.cfd_ratgs,0),
  };
}

export function aeroTestingRemaining(development,profile){
  const usage=aeroTestingUsageForPeriod(development,profile);
  if(!profile?.hard_quota||!profile?.limits){
    return {
      ...usage,
      limited:false,
      wind_tunnel_hours_remaining:null,
      cfd_mauh_remaining:null,
      wind_tunnel_runs_remaining:null,
      cfd_ratgs_remaining:null,
    };
  }
  return {
    ...usage,
    limited:true,
    wind_tunnel_hours_remaining:Math.max(0,profile.limits.wind_tunnel_hours-usage.wind_tunnel_hours),
    cfd_mauh_remaining:Math.max(0,profile.limits.cfd_mauh-usage.cfd_mauh),
    wind_tunnel_runs_remaining:Math.max(0,profile.limits.wind_tunnel_runs-usage.wind_tunnel_runs),
    cfd_ratgs_remaining:Math.max(0,profile.limits.cfd_ratgs-usage.cfd_ratgs),
  };
}

export function normalizedAeroAllocation(gs,teamId,slot,{windTunnel=0,cfd=0}={},development=null){
  const profile=developmentRegulationProfile(gs,teamId);
  const aeroRelevant=usesAerodynamicTesting(gs,slot);
  if(!aeroRelevant){
    return {
      profile,aero_relevant:false,wind_tunnel:0,cfd:0,allowed:true,reason:"not_aero_relevant",
      remaining:aeroTestingRemaining(development,profile),
    };
  }

  const wind=Math.max(0,num(windTunnel,0));
  const compute=profile.cfd_available?Math.max(0,num(cfd,0)):0;
  const remaining=aeroTestingRemaining(development,profile);
  if(profile.hard_quota){
    if(wind>num(remaining.wind_tunnel_hours_remaining,0)+1e-9){
      return {profile,aero_relevant:true,wind_tunnel:wind,cfd:compute,allowed:false,reason:"wind_tunnel_quota",remaining};
    }
    if(compute>num(remaining.cfd_mauh_remaining,0)+1e-9){
      return {profile,aero_relevant:true,wind_tunnel:wind,cfd:compute,allowed:false,reason:"cfd_quota",remaining};
    }
  }
  return {profile,aero_relevant:true,wind_tunnel:wind,cfd:compute,allowed:true,reason:"allowed",remaining};
}

export function recordAeroTestingUsage(development,profile,{windTunnel=0,cfd=0}={}){
  if(!profile?.hard_quota||!profile?.period?.id)return development;
  const rows=Array.isArray(development?.aeroTestingUsage)?development.aeroTestingUsage:[];
  const existing=rows.find((row)=>str(row?.period_id)===profile.period.id)||null;
  const next={
    ...(existing||{}),
    period_id:profile.period.id,
    year:profile.year,
    atp:profile.period.number,
    start:profile.period.start,
    end:profile.period.end,
    coefficient:profile.coefficient,
    wind_tunnel_hours:Number((num(existing?.wind_tunnel_hours,0)+num(windTunnel,0)).toFixed(3)),
    cfd_mauh:Number((num(existing?.cfd_mauh,0)+num(cfd,0)).toFixed(4)),
  };
  return {
    ...(development||{}),
    aeroTestingUsage:[
      ...rows.filter((row)=>str(row?.period_id)!==profile.period.id),
      next,
    ].sort((a,b)=>str(a?.period_id).localeCompare(str(b?.period_id))).slice(-18),
  };
}

export function defaultAeroAllocation(gs,teamId,slot,development=null){
  const profile=developmentRegulationProfile(gs,teamId);
  if(!usesAerodynamicTesting(gs,slot))return {windTunnel:0,cfd:0};
  const remaining=aeroTestingRemaining(development,profile);
  if(profile.scheme==="fia_atr"){
    return {
      windTunnel:Number(Math.min(10,num(remaining.wind_tunnel_hours_remaining,10)).toFixed(1)),
      cfd:Number(Math.min(0.75,num(remaining.cfd_mauh_remaining,0.75)).toFixed(2)),
    };
  }
  return {
    windTunnel:10,
    cfd:profile.cfd_available?20:0,
  };
}
