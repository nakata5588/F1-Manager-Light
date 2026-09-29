// src/engine/ManagerCareerEngine.js
// Player Team Principal employment lifecycle: Board pressure, dismissal,
// unemployment, job applications/offers and safe team-control transfer.

import { rngFor } from "../core/random.js";
import { runRaceWeekend } from "./GPEngine.js";
import {
  applyPlayerManagerTeamPrincipalAppointment,
  managerEmploymentAssessment,
  playerManagerIsActiveTeamPrincipal,
  playerManagerTeamId,
} from "../domain/managerEmployment.js";
import {
  activeManagerJobApplications,
  managerJobApplications,
  managerJobOpportunity,
} from "../domain/managerJobMarket.js";
import {
  archiveControlledTeamForAI,
  clearPlayerTeamControl,
  managerTeamSwitchBlocked,
  materializeTeamForPlayer,
} from "../domain/managerTeamControl.js";
import { applyManagerCareerProgression } from "../domain/managerProgression.js";

const text=(value)=>String(value??"");
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number(value)||0));
const dateOnly=(value)=>text(value).slice(0,10);

function addDaysISO(value,days){
  const base=Date.parse(dateOnly(value)+"T00:00:00Z");
  if(!Number.isFinite(base))return dateOnly(value);
  return new Date(base+Number(days||0)*86_400_000).toISOString().slice(0,10);
}
function teamNameFor(gs,teamId){
  const id=text(teamId);
  const rows=Array.isArray(gs?.teams)&&gs.teams.length?gs.teams:(gs?.dbTeams||[]);
  const row=rows.find((team)=>text(team?.team_id??team?.id??team?.constructor_id)===id);
  return text(row?.team_name??row?.name??row?.short_name??id);
}
function closeActiveCareerHistory(manager,{teamId,endYear,endDate,status,reason}){
  const rows=Array.isArray(manager?.career_history)?manager.career_history:[];
  let closed=false;
  return rows.map((row)=>{
    if(closed)return row;
    const same=text(row?.team_id)===text(teamId);
    const active=row?.end_year==null&&text(row?.status||"active").toLowerCase()==="active";
    if(!same||!active)return row;
    closed=true;
    return {
      ...row,
      end_year:endYear,
      ended_at:endDate,
      status,
      end_reason:reason,
    };
  });
}
function hash(value){
  let h=2166136261;
  for(const ch of String(value||"")){
    h^=ch.charCodeAt(0);
    h=Math.imul(h,16777619);
  }
  return h>>>0;
}
function employmentNews(gs,{subject,body,tag="Career"}){
  return {
    id:"manager_career_"+dateOnly(gs?.currentDateISO)+"_"+Math.abs(hash(subject+body)),
    date:dateOnly(gs?.currentDateISO),
    unread:true,
    type:"BOARD",
    from:"Board",
    tag,
    subject,
    body,
    actions:[{label:"Open Manager Profile",route:"/ManagerProfile"}],
  };
}

export function dismissPlayerManager(gs,{
  reason="board_dismissal",
  message=null,
  force=false,
}={}){
  if(!gs||!playerManagerIsActiveTeamPrincipal(gs))return gs;
  if(managerTeamSwitchBlocked(gs)&&!force){
    return {
      ...gs,
      managerEmploymentState:{
        ...(gs?.managerEmploymentState||{}),
        pending_dismissal:{reason,message,requested_at:dateOnly(gs?.currentDateISO)},
      },
    };
  }

  const teamId=playerManagerTeamId(gs);
  const teamName=teamNameFor(gs,teamId);
  const date=dateOnly(gs?.currentDateISO);
  const year=Number(gs?.activeYear);
  const manager=gs.manager;
  const repPenalty=reason==="contract_not_renewed"?1:3;

  let next=archiveControlledTeamForAI(gs);
  const careerHistory=closeActiveCareerHistory(manager,{
    teamId,endYear:year,endDate:date,status:reason==="contract_not_renewed"?"contract_ended":"fired",reason,
  });
  const updatedManager={
    ...manager,
    reputation:Math.max(1,Number(manager?.reputation||35)-repPenalty),
    current_team_id:null,
    current_team_name:null,
    current_job:{
      ...(manager?.current_job||{}),
      team_id:null,
      team_name:null,
      role:"Team Principal",
      status:reason==="contract_not_renewed"?"contract_ended":"fired",
      ended_at:date,
      end_year:year,
      end_reason:reason,
      former_team_id:teamId,
      former_team_name:teamName,
    },
    career_history:careerHistory,
  };
  const closeTeamTalks=(rows=[])=>rows.map((row)=>{
    const status=text(row?.status).toLowerCase();
    const active=["submitted","countered"].includes(status);
    const belongsToFormerTeam=
      text(row?.team_id??row?.buyer_team_id)===teamId&&
      text(row?.origin||"player")==="player";
    if(!active||!belongsToFormerTeam)return row;
    return {
      ...row,
      status:"withdrawn",
      resolved_at:date,
      resolution_note:"Team Principal departure ended the pending negotiation.",
      resolution_reason:"manager_departure",
    };
  });
  next={
    ...next,
    manager:updatedManager,
    driverNegotiations:closeTeamTalks(next?.driverNegotiations||[]),
    driverTransferApproaches:closeTeamTalks(next?.driverTransferApproaches||[]),
    staffNegotiations:closeTeamTalks(next?.staffNegotiations||[]),
    managerEmploymentState:{
      ...(next?.managerEmploymentState||{}),
      status:"unemployed",
      former_team_id:teamId,
      former_team_name:teamName,
      unemployed_since:date,
      dismissed_at:reason==="contract_not_renewed"?null:date,
      dismissal_reason:reason,
      pending_dismissal:null,
      last_status:"unemployed",
      critical_streak:0,
      pressure_streak:0,
    },
  };
  next=clearPlayerTeamControl(next);
  const body=message||(
    reason==="contract_not_renewed"
      ?"Your contract with "+teamName+" has ended and the Board will not renew it. You are now available for Team Principal opportunities elsewhere in the paddock."
      :teamName+" has ended your appointment as Team Principal. Your career continues: you can now apply for Team Principal opportunities with other teams."
  );
  return {
    ...next,
    inbox:[
      employmentNews(next,{
        subject:reason==="contract_not_renewed"
          ?"Contract ends — "+teamName
          :"Board decision — "+teamName,
        body,
        tag:"Employment",
      }),
      ...(next?.inbox||[]),
    ],
  };
}

function renewManagerContract(gs,{years=2}={}){
  const manager=gs?.manager;
  if(!manager||!playerManagerIsActiveTeamPrincipal(gs))return gs;
  const currentYear=Number(gs?.activeYear);
  const until=currentYear+Math.max(1,Number(years)||2)-1;
  const teamName=manager?.current_team_name||teamNameFor(gs,playerManagerTeamId(gs));
  const nextManager={
    ...manager,
    current_job:{
      ...(manager?.current_job||{}),
      contract_until_year:until,
      status:"active",
      renewed_at:dateOnly(gs?.currentDateISO),
    },
    career_history:(manager?.career_history||[]).map((row)=>
      row?.end_year==null&&text(row?.team_id)===playerManagerTeamId(gs)
        ?{...row,status:"active",contract_until_year:until}
        :row
    ),
  };
  return {
    ...gs,
    manager:nextManager,
    inbox:[
      employmentNews(gs,{
        subject:"Contract renewed — "+teamName,
        body:"The Board has renewed your Team Principal contract through the "+until+" season.",
        tag:"Employment",
      }),
      ...(gs?.inbox||[]),
    ],
  };
}

export function submitManagerJobApplication(gs,teamId){
  if(!gs?.manager||playerManagerIsActiveTeamPrincipal(gs))return gs;
  if(managerTeamSwitchBlocked(gs))return gs;
  const opportunity=managerJobOpportunity(gs,teamId);
  if(!opportunity?.available)return gs;
  const duplicate=activeManagerJobApplications(gs).find((row)=>text(row?.team_id)===text(teamId));
  if(duplicate)return gs;

  const date=dateOnly(gs?.currentDateISO);
  const sequence=managerJobApplications(gs).length+1;
  const application={
    id:["managerjob",date||"date",teamId,sequence].join("_"),
    team_id:text(teamId),
    team_name:opportunity.team_name,
    status:"submitted",
    submitted_at:date,
    response_date:addDaysISO(date,2),
    interest_at_submission:opportunity.interest,
    vacancy_at_submission:opportunity.vacancy,
    replace_incumbent_at_submission:opportunity.replace_incumbent,
  };
  return {
    ...gs,
    managerJobApplications:[...managerJobApplications(gs),application],
  };
}

function rejectApplication(gs,application,reason){
  const date=dateOnly(gs?.currentDateISO);
  return {
    ...gs,
    managerJobApplications:managerJobApplications(gs).map((row)=>row.id===application.id?{
      ...row,status:"rejected",resolved_at:date,resolution_note:reason,
    }:row),
    inbox:[
      employmentNews(gs,{
        subject:"Application update — "+application.team_name,
        body:application.team_name+" will not proceed with your Team Principal application at this time.",
        tag:"Job Market",
      }),
      ...(gs?.inbox||[]),
    ],
  };
}
function offerApplication(gs,application,opportunity){
  const date=dateOnly(gs?.currentDateISO);
  const years=opportunity.interest>=75?3:2;
  return {
    ...gs,
    managerJobApplications:managerJobApplications(gs).map((row)=>row.id===application.id?{
      ...row,
      status:"offer",
      resolved_at:date,
      offer:{
        role:"Team Principal",
        contract_years:years,
        contract_until_year:Number(gs?.activeYear)+years-1,
        interest:opportunity.interest,
      },
      offer_expires:addDaysISO(date,7),
    }:row),
    inbox:[
      employmentNews(gs,{
        subject:"Team Principal offer — "+application.team_name,
        body:application.team_name+" has offered you a "+years+"-year contract as Team Principal. Review the offer in your Manager Profile.",
        tag:"Job Market",
      }),
      ...(gs?.inbox||[]),
    ],
  };
}

export function processManagerJobApplications(gs,{forceOutcomeById={}}={}){
  if(!gs||playerManagerIsActiveTeamPrincipal(gs))return gs;
  const today=dateOnly(gs?.currentDateISO);
  let next=gs;

  next={
    ...next,
    managerJobApplications:managerJobApplications(next).map((row)=>{
      if(row?.status!=="offer"||!row?.offer_expires||row.offer_expires>=today)return row;
      return {...row,status:"expired",resolved_at:today,resolution_note:"Offer expired."};
    }),
  };

  const due=managerJobApplications(next)
    .filter((row)=>row?.status==="submitted"&&dateOnly(row?.response_date)<=today)
    .sort((a,b)=>text(a?.team_id).localeCompare(text(b?.team_id))||text(a?.id).localeCompare(text(b?.id)));

  for(const original of due){
    const application=managerJobApplications(next).find((row)=>row.id===original.id);
    if(!application||application.status!=="submitted")continue;
    const opportunity=managerJobOpportunity(next,application.team_id);
    if(!opportunity?.available){
      next=rejectApplication(next,application,"The vacancy or Board interest is no longer available.");
      continue;
    }
    const negotiation=Number(next?.manager?.attributes?.negotiation??50);
    const chance=clamp(
      0.30+(opportunity.interest-45)*0.014+(negotiation-50)*0.003,
      0.12,0.92
    );
    const forced=forceOutcomeById?.[application.id];
    const accepted=forced
      ?forced==="offer"
      :rngFor(next,"manager-job-application:"+application.id).next()<chance;
    next=accepted
      ?offerApplication(next,application,opportunity)
      :rejectApplication(next,application,"The Board selected another candidate.");
  }
  return next;
}

export function acceptManagerJobOffer(gs,applicationId){
  if(!gs?.manager||playerManagerIsActiveTeamPrincipal(gs))return gs;
  if(managerTeamSwitchBlocked(gs))return gs;
  const application=managerJobApplications(gs).find((row)=>row.id===applicationId);
  if(!application||application.status!=="offer")return gs;
  const today=dateOnly(gs?.currentDateISO);
  if(application.offer_expires&&application.offer_expires<today)return gs;

  const opportunity=managerJobOpportunity(gs,application.team_id);
  if(!opportunity?.available)return rejectApplication(gs,application,"The position is no longer available.");

  let next=materializeTeamForPlayer(gs,application.team_id);
  if(text(next?.team?.team_id??next?.team?.id)!==text(application.team_id))return gs;

  const year=Number(next?.activeYear);
  const teamName=application.team_name||teamNameFor(next,application.team_id);
  const years=Math.max(1,Number(application?.offer?.contract_years||2));
  const manager=next.manager;
  const newHistory=[
    ...(Array.isArray(manager?.career_history)?manager.career_history:[]),
    {
      team_id:text(application.team_id),
      team_name:teamName,
      role:"Team Principal",
      joined_at:today,
      start_year:year,
      end_year:null,
      status:"active",
      contract_until_year:year+years-1,
    },
  ];
  next={
    ...next,
    manager:{
      ...manager,
      current_team_id:text(application.team_id),
      current_team_name:teamName,
      current_job:{
        team_id:text(application.team_id),
        team_name:teamName,
        role:"Team Principal",
        joined_at:today,
        start_year:year,
        contract_until_year:year+years-1,
        status:"active",
      },
      career_history:newHistory,
    },
    managerJobApplications:managerJobApplications(next).map((row)=>{
      if(row.id===application.id)return {...row,status:"accepted",accepted_at:today};
      if(["submitted","offer"].includes(text(row?.status).toLowerCase())){
        return {...row,status:"withdrawn",resolved_at:today,resolution_note:"Manager accepted another Team Principal role."};
      }
      return row;
    }),
    managerEmploymentState:{
      status:"active",
      last_evaluated_races:0,
      critical_streak:0,
      pressure_streak:0,
      last_status:"evaluating",
      last_security:null,
      former_team_id:gs?.managerEmploymentState?.former_team_id??null,
      former_team_name:gs?.managerEmploymentState?.former_team_name??null,
      unemployed_since:null,
      dismissed_at:null,
      dismissal_reason:null,
      pending_dismissal:null,
    },
  };
  next=applyPlayerManagerTeamPrincipalAppointment(next);
  return {
    ...next,
    inbox:[
      employmentNews(next,{
        subject:"Welcome to "+teamName,
        body:"You have joined "+teamName+" as Team Principal on a "+years+"-year contract. The team, car, facilities, Staff and finances are now under your control.",
        tag:"Employment",
      }),
      ...(next?.inbox||[]),
    ],
  };
}

function gpDateISO(gp){
  return dateOnly(gp?.dateISO??gp?.date??gp?.race_date??gp?.start_date??gp?.end_date??gp?.raceDate);
}

export async function autosimUnemployedRaceIfDue(gs){
  if(!gs?.manager||playerManagerIsActiveTeamPrincipal(gs))return gs;
  const roundIndex=Math.max(0,Number(gs?.currentRound||0));
  const gp=gs?.calendar?.[roundIndex]||null;
  if(!gp)return gs;
  const raceDate=gpDateISO(gp);
  const today=dateOnly(gs?.currentDateISO);
  if(!raceDate||!today||today<raceDate)return gs;

  const year=Number(gs?.activeYear);
  const round=roundIndex+1;
  const gpId=text(gp?.gp_id??gp?.id??gp?.track_id??"round_"+round);
  const already=(Array.isArray(gs?.results)?gs.results:[]).some((row)=>
    Number(row?.year??row?.season_year)===year&&
    Number(row?.round??row?.round_number)===round&&
    text(row?.gp_id??row?.track_id??"")===gpId
  );
  if(already){
    return {...gs,currentRound:Math.min(roundIndex+1,Math.max(0,(gs?.calendar?.length||1)-1))};
  }

  const simulated=await runRaceWeekend({
    ...gs,
    raceWeekendState:null,
    raceEntryState:null,
  },{roundIndex,gp});
  return {
    ...simulated,
    raceWeekendState:null,
    raceEntryState:null,
    currentRound:Math.min(roundIndex+1,Math.max(0,(gs?.calendar?.length||1)-1)),
  };
}

export function processManagerCareerTick(gs,{forceDismiss=false}={}){
  if(!gs?.manager)return gs;

  // Career progression consumes only already-archived official race results.
  // Run it before employment decisions so the final GP of a tenure is credited
  // even if the Board dismisses the manager on the same daily tick.
  gs=applyManagerCareerProgression(gs);

  if(!playerManagerIsActiveTeamPrincipal(gs)){
    return processManagerJobApplications(gs);
  }

  const state={...(gs?.managerEmploymentState||{})};
  if(state?.pending_dismissal&&!managerTeamSwitchBlocked(gs)){
    return dismissPlayerManager(gs,{
      reason:state.pending_dismissal.reason,
      message:state.pending_dismissal.message,
    });
  }

  const job=gs?.manager?.current_job||{};
  const currentYear=Number(gs?.activeYear);
  const until=Number(job?.contract_until_year);
  if(Number.isFinite(until)&&currentYear>until){
    const priorSecurity=Number(state?.last_security);
    if(Number.isFinite(priorSecurity)&&priorSecurity>=45){
      return renewManagerContract(gs,{years:2});
    }
    return dismissPlayerManager(gs,{reason:"contract_not_renewed"});
  }

  const assessment=managerEmploymentAssessment(gs);
  if(assessment.status==="unavailable"||assessment.status==="unemployed")return gs;
  const previousRaces=Number(state?.last_evaluated_races??-1);
  if(assessment.races<=previousRaces&&!forceDismiss)return gs;

  const criticalStreak=assessment.status==="critical"
    ?Number(state?.critical_streak||0)+1
    :0;
  const pressureStreak=["critical","under_pressure"].includes(assessment.status)
    ?Number(state?.pressure_streak||0)+1
    :0;

  let next={
    ...gs,
    managerEmploymentState:{
      ...state,
      status:"active",
      last_evaluated_races:assessment.races,
      last_security:assessment.jobSecurity,
      last_status:assessment.status,
      last_evaluated_at:dateOnly(gs?.currentDateISO),
      critical_streak:criticalStreak,
      pressure_streak:pressureStreak,
      last_warning:["critical","under_pressure"].includes(assessment.status)?state?.last_warning??null:null,
    },
  };

  const warningKey=assessment.status==="critical"?"critical":assessment.status==="under_pressure"?"pressure":null;
  if(warningKey&&state?.last_warning!==warningKey){
    const teamName=next?.manager?.current_team_name||teamNameFor(next,playerManagerTeamId(next));
    next={
      ...next,
      managerEmploymentState:{...next.managerEmploymentState,last_warning:warningKey},
      inbox:[
        employmentNews(next,{
          subject:warningKey==="critical"?"Board ultimatum":"Board pressure increasing",
          body:warningKey==="critical"
            ?"The "+teamName+" Board considers your position as Team Principal at serious risk. Immediate improvement against season objectives is required."
            :"The "+teamName+" Board is concerned by current performance. Job Security has fallen to "+assessment.jobSecurity+"%.",
          tag:"Employment",
        }),
        ...(next?.inbox||[]),
      ],
    };
  }

  const shouldDismiss=assessment.canBeDismissed&&(
    forceDismiss||
    assessment.jobSecurity<=12||
    criticalStreak>=2
  );
  if(shouldDismiss){
    return dismissPlayerManager(next,{
      reason:"board_dismissal",
      message:"The Board has dismissed you after Job Security fell to "+assessment.jobSecurity+"%. You remain in the same Save World and can seek another Team Principal role.",
    });
  }
  return next;
}
