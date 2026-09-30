// src/domain/staffPerformance.js
// Canonical Staff rating/capability model.
//
// Staff Role Rating answers: "how good is this person in this role?"
// Team Staff Capability answers: "how strong is this team's support for this system?"
// Reputation is intentionally excluded from skill/role ratings and only belongs
// to market/contract valuation.

import { activeStaffContracts, collectionRows } from "./liveContracts.js";
import {
  canonicalStaffRole,
  resolveStaffId,
  staffContractRole,
} from "./staffRoles.js";

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const round=(value,digits=1)=>Number(Number(value||0).toFixed(digits));
const num=(value,fallback=50)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

export const STAFF_SKILL_ATTRIBUTES=Object.freeze([
  "leadership",
  "technical",
  "strategy",
  "motivation",
  "communication",
  "pitstop_management",
  "reliability_focus",
  "data_analysis",
  "innovation",
  "budget_management",
  "driver_development",
  "conflict_management",
  "negotiation",
]);

export const STAFF_MARKET_ATTRIBUTES=Object.freeze(["reputation"]);

export const STAFF_ROLE_WEIGHTS=Object.freeze({
  team_principal:Object.freeze({
    leadership:25,
    conflict_management:15,
    negotiation:15,
    budget_management:15,
    motivation:10,
    communication:10,
    strategy:5,
    technical:5,
  }),
  technical_director:Object.freeze({
    technical:25,
    innovation:20,
    data_analysis:15,
    reliability_focus:15,
    communication:10,
    budget_management:10,
    leadership:5,
  }),
  chief_designer:Object.freeze({
    innovation:30,
    technical:25,
    data_analysis:15,
    reliability_focus:10,
    budget_management:10,
    communication:5,
    leadership:5,
  }),
  chief_engineer:Object.freeze({
    technical:25,
    reliability_focus:20,
    data_analysis:20,
    communication:15,
    pitstop_management:10,
    strategy:5,
    leadership:5,
  }),
  race_engineer:Object.freeze({
    communication:25,
    technical:20,
    data_analysis:20,
    strategy:15,
    motivation:10,
    reliability_focus:5,
    conflict_management:5,
  }),
  chief_strategist:Object.freeze({
    strategy:35,
    data_analysis:25,
    communication:15,
    technical:10,
    leadership:5,
    conflict_management:5,
    reliability_focus:5,
  }),
  owner:Object.freeze({
    budget_management:25,
    leadership:25,
    negotiation:20,
    conflict_management:15,
    motivation:10,
    communication:5,
  }),
  // Sponsor Backer is a legacy staff role. Reputation is still excluded from
  // the rating; external prestige is handled separately by market logic.
  sponsor_backer:Object.freeze({
    negotiation:35,
    budget_management:25,
    communication:20,
    leadership:10,
    motivation:10,
  }),
  staff:Object.freeze({
    communication:25,
    technical:20,
    data_analysis:20,
    motivation:15,
    leadership:10,
    conflict_management:10,
  }),
});

const CAPABILITIES=Object.freeze({
  technical_program:Object.freeze({
    attributes:Object.freeze({
      technical:35,innovation:25,data_analysis:18,reliability_focus:12,communication:10,
    }),
    roleRelevance:Object.freeze({
      technical_director:1,chief_designer:0.95,chief_engineer:0.85,
      race_engineer:0.35,chief_strategist:0.25,team_principal:0.20,owner:0.10,
    }),
  }),
  setup:Object.freeze({
    attributes:Object.freeze({
      communication:28,technical:26,data_analysis:24,strategy:12,reliability_focus:10,
    }),
    roleRelevance:Object.freeze({
      race_engineer:1,chief_engineer:0.65,technical_director:0.45,
      chief_strategist:0.35,chief_designer:0.20,team_principal:0.15,
    }),
  }),
  strategy:Object.freeze({
    attributes:Object.freeze({
      strategy:42,data_analysis:28,communication:18,technical:12,
    }),
    roleRelevance:Object.freeze({
      chief_strategist:1,race_engineer:0.55,team_principal:0.30,
      chief_engineer:0.25,technical_director:0.20,
    }),
  }),
  weather:Object.freeze({
    attributes:Object.freeze({
      data_analysis:46,strategy:26,communication:18,technical:10,
    }),
    roleRelevance:Object.freeze({
      chief_strategist:1,race_engineer:0.65,chief_engineer:0.40,
      technical_director:0.35,team_principal:0.20,
    }),
  }),
  pit_operations:Object.freeze({
    attributes:Object.freeze({
      pitstop_management:55,leadership:15,communication:15,motivation:10,reliability_focus:5,
    }),
    roleRelevance:Object.freeze({
      chief_engineer:1,team_principal:0.35,race_engineer:0.30,
      technical_director:0.20,owner:0.10,
    }),
  }),
  reliability_development:Object.freeze({
    attributes:Object.freeze({
      reliability_focus:45,technical:25,data_analysis:15,innovation:10,communication:5,
    }),
    roleRelevance:Object.freeze({
      technical_director:1,chief_engineer:0.95,chief_designer:0.70,
      race_engineer:0.35,team_principal:0.15,
    }),
  }),
  driver_development:Object.freeze({
    attributes:Object.freeze({
      driver_development:55,motivation:18,communication:15,leadership:7,conflict_management:5,
    }),
    roleRelevance:Object.freeze({
      race_engineer:1,team_principal:0.70,chief_engineer:0.45,
      technical_director:0.35,owner:0.20,chief_strategist:0.20,
    }),
  }),
  team_environment:Object.freeze({
    attributes:Object.freeze({
      leadership:35,motivation:25,conflict_management:22,communication:18,
    }),
    roleRelevance:Object.freeze({
      team_principal:1,owner:0.55,race_engineer:0.35,
      chief_engineer:0.30,technical_director:0.30,chief_strategist:0.25,chief_designer:0.20,
    }),
  }),
  cost_efficiency:Object.freeze({
    attributes:Object.freeze({
      budget_management:50,negotiation:20,leadership:15,technical:15,
    }),
    roleRelevance:Object.freeze({
      team_principal:1,owner:0.85,technical_director:0.65,
      chief_designer:0.50,chief_engineer:0.45,chief_strategist:0.20,
    }),
  }),
});

export const STAFF_CAPABILITY_IDS=Object.freeze(Object.keys(CAPABILITIES));

function ratingRows(gs){
  const live=collectionRows(gs?.staffRatings);
  if(live.length)return live;
  return collectionRows(gs?.dbStaffRatings);
}

export function staffRatingForYear(gs,staffId,year=Number(gs?.activeYear)){
  const id=String(staffId??"");
  const rows=ratingRows(gs).filter((row)=>String(row?.staff_id??row?.person_id??row?.id??"")===id);
  if(!rows.length)return {};
  const exact=rows.find((row)=>Number(row?.year??row?.season_year)===Number(year));
  if(exact)return exact;
  const historical=rows
    .filter((row)=>Number(row?.year??row?.season_year??-Infinity)<=Number(year))
    .sort((a,b)=>Number(b?.year??b?.season_year??0)-Number(a?.year??a?.season_year??0));
  return historical[0]||{};
}

function weightedScore(rating,weights){
  const entries=Object.entries(weights||{});
  const total=entries.reduce((sum,[,weight])=>sum+Number(weight||0),0);
  if(!total)return null;
  return entries.reduce((sum,[key,weight])=>sum+clamp(num(rating?.[key],50))*Number(weight||0),0)/total;
}

export function staffRoleRating(staffRatings,role){
  const canonicalRole=canonicalStaffRole(role);
  const weights=STAFF_ROLE_WEIGHTS[canonicalRole]||STAFF_ROLE_WEIGHTS.staff;
  const score=weightedScore(staffRatings,weights);
  const relevantAttributes=Object.entries(weights).map(([key,weight])=>({
    key,
    value:round(clamp(num(staffRatings?.[key],50))),
    weight:Number(weight),
  }));
  const sorted=[...relevantAttributes].sort((a,b)=>b.value-a.value||b.weight-a.weight||a.key.localeCompare(b.key));
  return {
    role:canonicalRole,
    score:score==null?null:round(score),
    relevant_attributes:relevantAttributes,
    relevantAttributes,
    weights:{...weights},
    strengths:sorted.slice(0,3),
    weaknesses:[...sorted].reverse().slice(0,3),
  };
}

export function staffRoleRatingForStaff(gs,staffId,role,{year=Number(gs?.activeYear)}={}){
  return staffRoleRating(staffRatingForYear(gs,staffId,year),role);
}

export function staffReputation(rating){
  return round(clamp(num(rating?.reputation,50)));
}

export function staffCapabilityScore(rating,capability){
  const definition=CAPABILITIES[String(capability||"")];
  if(!definition)return 50;
  return round(weightedScore(rating,definition.attributes)??50);
}

export function teamStaffCapability(gs,teamId,capability){
  const definition=CAPABILITIES[String(capability||"")];
  if(!definition)return 50;
  const contracts=activeStaffContracts(gs,{teamId:String(teamId??"")});
  const scored=contracts.map((contract)=>{
    const role=staffContractRole(contract);
    const relevance=Number(definition.roleRelevance?.[role]??0.08);
    const staffId=resolveStaffId(gs,contract);
    const rating=staffRatingForYear(gs,staffId);
    const quality=staffCapabilityScore(rating,capability);
    return {staff_id:staffId,role,relevance,quality,weighted:quality*relevance};
  }).filter((row)=>row.staff_id&&row.relevance>0)
    .sort((a,b)=>b.weighted-a.weighted)
    .slice(0,3);

  if(!scored.length)return 50;
  const weight=scored.reduce((sum,row)=>sum+row.relevance,0);
  return round(weight?scored.reduce((sum,row)=>sum+row.quality*row.relevance,0)/weight:50);
}

export function teamStaffCapabilityBreakdown(gs,teamId){
  return Object.fromEntries(STAFF_CAPABILITY_IDS.map((id)=>[id,teamStaffCapability(gs,teamId,id)]));
}

export function staffTeamEnvironmentModifiers(gs,teamId){
  const capability=teamStaffCapability(gs,teamId,"team_environment");
  const delta=capability-50;
  return {
    capability,
    positive_morale_multiplier:round(clamp(1+delta*0.002,0.90,1.10),3),
    negative_morale_multiplier:round(clamp(1-delta*0.0036,0.82,1.18),3),
  };
}

export function staffStrategyDecisionDelta(gs,teamId){
  const capability=teamStaffCapability(gs,teamId,"strategy");
  return round(clamp((capability-50)*0.003,-0.12,0.12),3);
}

export function staffPitTrainingMultiplier(gs,teamId){
  const capability=teamStaffCapability(gs,teamId,"pit_operations");
  return round(clamp(0.90+capability*0.002,0.90,1.10),3);
}

export function staffCostEfficiencyMultiplier(gs,teamId){
  const capability=teamStaffCapability(gs,teamId,"cost_efficiency");
  // Better financial/organisational staff reduce project cost without creating pace.
  return round(clamp(1.08-(capability/100)*0.16,0.92,1.08),3);
}

export function staffMarketScore(gs,staffId,role){
  const rating=staffRatingForYear(gs,staffId);
  const roleScore=staffRoleRating(rating,role).score??50;
  const reputation=staffReputation(rating);
  return round(roleScore*0.90+reputation*0.10);
}
