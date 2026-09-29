// src/engine/StaffNegotiationEngine.js
// Player-facing Staff contract negotiations.
// AI recruitment continues to use StaffMarketEngine, while both engines share
// eligibility, salary and willingness rules from domain/staffMarket.js.

import { rngFor } from "../core/random.js";
import { activeStaffContracts, teamIdOfContract } from "../domain/liveContracts.js";
import { managerGameplayEffects } from "../domain/managerProfile.js";
import {
  staffCoreFor,
  staffExpectedSalary,
  staffNegotiationEligibility,
  staffRoleIncumbent,
  staffSalaryAffordable,
  staffTeamBudget,
  staffTeamReputation,
  staffTerminationCost,
} from "../domain/staffMarket.js";
import {
  resolveStaffId,
  staffRoleLabel,
} from "../domain/staffRoles.js";
import {
  staffRatingForYear,
  staffReputation,
  staffRoleRating,
} from "../domain/staffPerformance.js";
import { applyStaffTransferSettlement, canAffordStaffTransfer } from "../domain/staffTransfers.js";

const ACTIVE_STATUSES=new Set(["submitted","countered"]);
const CLOSED_STATUSES=new Set(["accepted","rejected","withdrawn","signed_elsewhere"]);

const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number(value)||0));
const text=(value)=>String(value??"");
const dateOnly=(value)=>text(value).slice(0,10);

function addDaysISO(value,days){
  const base=Date.parse(dateOnly(value)+"T00:00:00Z");
  if(!Number.isFinite(base))return dateOnly(value);
  return new Date(base+Number(days||0)*86400000).toISOString().slice(0,10);
}
function staffNameFor(gs,staffId){
  const row=staffCoreFor(gs,staffId);
  return text(row?.staff_name??row?.display_name??row?.name??staffId);
}
function teamNameFor(gs,teamId){
  const id=text(teamId);
  if(id===text(gs?.team?.team_id??gs?.team?.id)){
    return text(gs?.team?.team_name??gs?.team?.name??id);
  }
  const rows=Array.isArray(gs?.teams)&&gs.teams.length?gs.teams:(gs?.dbTeams||[]);
  const row=rows.find((team)=>text(team?.team_id??team?.id??team?.constructor_id)===id);
  return text(row?.team_name??row?.name??row?.short_name??id);
}

export function staffNegotiations(gs){
  return Array.isArray(gs?.staffNegotiations)?gs.staffNegotiations:[];
}
export function isStaffNegotiationActive(negotiation){
  return ACTIVE_STATUSES.has(text(negotiation?.status).toLowerCase());
}
export function staffNegotiationStatusBuckets(input){
  const rows=Array.isArray(input)?input:[];
  return {
    active:rows.filter(isStaffNegotiationActive),
    history:rows.filter((row)=>CLOSED_STATUSES.has(text(row?.status).toLowerCase())),
  };
}
export function staffContractDecision(gs,{staffId,teamId,offer}={}){
  const role=text(offer?.role);
  const expected=Math.max(1,staffExpectedSalary(gs,staffId,role));
  const salary=Math.max(0,Number(offer?.salary||0));
  const years=Math.max(1,Math.min(5,Number(offer?.years||1)));
  const rating=staffRatingForYear(gs,staffId);
  const reputation=staffReputation(rating);
  const roleScore=staffRoleRating(rating,role).score??50;
  const teamRep=staffTeamReputation(gs,teamId);
  const salaryRatio=salary/expected;
  const managerDelta=managerGameplayEffects(gs,{teamId}).contractAcceptanceDelta;

  let chance=0.48;
  chance+=clamp((salaryRatio-0.80)*0.80,-0.28,0.34);
  chance+=clamp((teamRep-reputation)*0.006,-0.22,0.20);
  chance+=clamp((roleScore-60)*0.0025,-0.08,0.10);
  chance+=Math.min(0.08,(years-1)*0.025);
  chance+=Number(managerDelta||0);
  chance=clamp(chance,0.05,0.95);

  return {
    acceptance_probability:Number(chance.toFixed(3)),
    expected_salary:expected,
    salary_ratio:Number(salaryRatio.toFixed(3)),
    role_score:roleScore,
    staff_reputation:reputation,
    team_reputation:teamRep,
    manager_contract_delta:Number(managerDelta||0),
  };
}

export function startStaffNegotiation(gs,{
  staffId,
  teamId,
  teamName=null,
  offer,
  origin="player",
}={}){
  if(!gs)return gs;
  const id=text(staffId);
  const tid=text(teamId);
  const eligibility=staffNegotiationEligibility(gs,{staffId:id,teamId:tid,role:offer?.role});
  if(!eligibility.canNegotiate)return gs;
  const existing=staffNegotiations(gs).find((row)=>
    isStaffNegotiationActive(row)&&
    text(row.staff_id)===id&&
    text(row.team_id)===tid
  );
  if(existing)return gs;

  const role=text(offer?.role||eligibility.role||eligibility.roles?.[0]);
  const expected=staffExpectedSalary(gs,id,role);
  const salary=Math.max(20_000,Math.round(Number(offer?.salary||expected)/5_000)*5_000);
  const years=Math.max(1,Math.min(5,Math.round(Number(offer?.years||1))));
  const today=dateOnly(gs?.currentDateISO);
  const sequence=staffNegotiations(gs).length+1;
  const negotiation={
    id:["staffneg",today||"date",tid,id,sequence].join("_"),
    kind:eligibility.kind||"new_staff_contract",
    staff_id:id,
    staff_name:staffNameFor(gs,id),
    team_id:tid,
    team_name:teamName||teamNameFor(gs,tid),
    role,
    role_label:staffRoleLabel(role),
    offer:{salary,years,role},
    expected_salary:expected,
    seller_team_id:eligibility.kind==="transfer"?text(eligibility.sellerTeamId||eligibility?.buyout?.sellerTeamId):null,
    seller_team_name:eligibility.kind==="transfer"?teamNameFor(gs,eligibility.sellerTeamId||eligibility?.buyout?.sellerTeamId):null,
    buyout_fee:eligibility.kind==="transfer"?Number(eligibility?.buyout?.fee||0):0,
    buyout_type:eligibility.kind==="transfer"?text(eligibility?.buyout?.type||"compensation"):null,
    replacement_staff_id:eligibility.incumbent?resolveStaffId(gs,eligibility.incumbent):null,
    replacement_cost:Number(eligibility.replacementCost||0),
    status:"submitted",
    origin,
    round:1,
    submitted_at:today,
    response_date:addDaysISO(today,1),
  };
  return {...gs,staffNegotiations:[...staffNegotiations(gs),negotiation]};
}

function rejectNegotiation(gs,negotiation,reason="Offer rejected"){
  const today=dateOnly(gs?.currentDateISO);
  const rejected={...negotiation,status:"rejected",resolved_at:today,resolution_note:reason};
  const messages=negotiation.origin==="player"?[{
    id:"staff_neg_reject_"+negotiation.id,
    date:today,
    unread:true,
    type:"STAFF",
    from:"Staff Management",
    tag:"Contracts",
    subject:"Offer rejected — "+negotiation.staff_name,
    body:negotiation.staff_name+"'s representatives have rejected the current proposal.",
    staff_id:negotiation.staff_id,
  }]:[];
  return {
    ...gs,
    staffNegotiations:staffNegotiations(gs).map((row)=>row.id===negotiation.id?rejected:row),
    inbox:[...messages,...(gs?.inbox||[])],
  };
}
function counterOffer(gs,negotiation){
  const expected=Math.max(1,Number(negotiation.expected_salary||staffExpectedSalary(gs,negotiation.staff_id,negotiation.role)));
  const current=Math.max(0,Number(negotiation.offer?.salary||0));
  const rng=rngFor(gs,"staff-negotiation-counter:"+negotiation.id+":"+negotiation.round);
  const salary=Math.round(Math.max(expected*0.96,current*(1.06+rng.next()*0.08))/5_000)*5_000;
  const updated={
    ...negotiation,
    status:"countered",
    counter_offer:{
      salary,
      years:Math.max(1,Number(negotiation.offer?.years||1)),
      role:negotiation.role,
    },
    responded_at:dateOnly(gs?.currentDateISO),
  };
  return {
    ...gs,
    staffNegotiations:staffNegotiations(gs).map((row)=>row.id===updated.id?updated:row),
    inbox:[{
      id:"staff_neg_counter_"+negotiation.id+"_"+negotiation.round,
      date:dateOnly(gs?.currentDateISO),
      unread:true,
      type:"STAFF",
      from:"Staff Agent",
      tag:"Contracts",
      subject:"Counter-offer — "+negotiation.staff_name,
      body:negotiation.staff_name+"'s representatives want $"+salary.toLocaleString("en-US")+" per season.",
      staff_id:negotiation.staff_id,
      negotiation_id:negotiation.id,
      actions:[{label:"Review counter-offer",route:"/Staff"}],
    },...(gs?.inbox||[])],
  };
}
function applyIncumbentRelease(gs,incumbent,negotiation){
  if(!incumbent)return {state:gs,cost:0};
  const cost=staffTerminationCost(gs,incumbent);
  const playerTeamId=text(gs?.team?.team_id??gs?.team?.id);
  const buyerTeamId=text(negotiation.team_id);
  const available=staffTeamBudget(gs,buyerTeamId);
  if(buyerTeamId===playerTeamId&&Number.isFinite(available)&&cost>available){
    return {state:null,cost,reason:"Insufficient funds to terminate the incumbent Staff contract."};
  }

  const today=dateOnly(gs?.currentDateISO);
  const incumbentId=resolveStaffId(gs,incumbent);
  let next={
    ...gs,
    staffContracts:(gs?.staffContracts||[]).map((row)=>row===incumbent?{
      ...row,
      status:"released",
      released_at:today,
      release_reason:"player_staff_replacement",
      termination_cost:cost,
    }:row),
  };
  if(buyerTeamId===playerTeamId&&cost>0){
    const resolvedBudget=staffTeamBudget(next,buyerTeamId);
    const oldBalance=Number.isFinite(resolvedBudget)?resolvedBudget:0;
    const sig="staff-release:"+incumbentId+":"+today;
    const log=Array.isArray(next?.financeLog)?next.financeLog:[];
    const tx=log.some((row)=>row?.sig===sig)?[]:[{
      id:"tx_"+sig,
      dateISO:today,
      type:"expense",
      category:"Staff",
      desc:"Contract termination — "+staffNameFor(gs,incumbentId),
      amount:-cost,
      sig,
    }];
    next={
      ...next,
      team:{...(next?.team||{}),budget:oldBalance-cost},
      finances:{
        ...(next?.finances||{}),
        balance:oldBalance-cost,
        budget:oldBalance-cost,
        season_spend:Number(next?.finances?.season_spend||0)+cost,
      },
      financeLog:[...tx,...log],
    };
  }
  return {state:next,cost};
}
function finalizeAccepted(gs,negotiation,{fromCounter=false}={}){
  const transfer=negotiation.kind==="transfer";
  const active=staffActiveContractSafe(gs,negotiation.staff_id);
  if(transfer){
    const seller=text(negotiation.seller_team_id);
    if(!active||teamIdOfContract(active)!==seller){
      return {
        ...gs,
        staffNegotiations:staffNegotiations(gs).map((row)=>row.id===negotiation.id?{
          ...row,
          status:"signed_elsewhere",
          resolved_at:dateOnly(gs?.currentDateISO),
          resolution_note:"The Staff member is no longer under the contract covered by this transfer.",
        }:row),
      };
    }
    if(!canAffordStaffTransfer(gs,negotiation.team_id,negotiation.buyout_fee)){
      return rejectNegotiation(gs,negotiation,"The team can no longer afford the Staff transfer compensation.");
    }
  }else if(active){
    return {
      ...gs,
      staffNegotiations:staffNegotiations(gs).map((row)=>row.id===negotiation.id?{
        ...row,
        status:"signed_elsewhere",
        resolved_at:dateOnly(gs?.currentDateISO),
        resolution_note:"Staff member is no longer available.",
      }:row),
    };
  }
  if(!staffSalaryAffordable(gs,negotiation.team_id,negotiation.offer?.salary)){
    return rejectNegotiation(gs,negotiation,"The team cannot support the offered annual salary.");
  }

  const today=dateOnly(gs?.currentDateISO);
  let transferFee=0;
  let prepared=gs;
  if(transfer){
    transferFee=Math.max(0,Number(negotiation.buyout_fee||0));
    const buyerTeamId=text(negotiation.team_id);
    const playerTeamId=text(gs?.team?.team_id??gs?.team?.id);
    const preIncumbent=staffRoleIncumbent(gs,buyerTeamId,negotiation.role);
    const replacementCost=buyerTeamId===playerTeamId?staffTerminationCost(gs,preIncumbent):0;
    const available=staffTeamBudget(gs,buyerTeamId);
    if(Number.isFinite(available)&&transferFee+replacementCost>available){
      return rejectNegotiation(gs,negotiation,"The team cannot afford the combined Staff transfer and replacement costs.");
    }
    const settled=applyStaffTransferSettlement(prepared,{
      staffId:negotiation.staff_id,
      buyerTeamId:negotiation.team_id,
      sellerTeamId:negotiation.seller_team_id,
      fee:transferFee,
    });
    if(!settled){
      return rejectNegotiation(gs,negotiation,"The team can no longer afford the Staff transfer compensation.");
    }
    prepared={
      ...settled,
      staffContracts:(settled?.staffContracts||[]).map((row)=>row===active?{
        ...row,
        status:"bought_out",
        bought_out_at:today,
        bought_out_by_team_id:text(negotiation.team_id),
        transfer_fee:transferFee,
      }:row),
    };
  }

  const incumbent=staffRoleIncumbent(prepared,negotiation.team_id,negotiation.role);
  const released=applyIncumbentRelease(prepared,incumbent,negotiation);
  if(!released.state)return rejectNegotiation(gs,negotiation,released.reason);

  const base=released.state;
  const year=Number(base?.activeYear);
  const years=Math.max(1,Math.min(5,Number(negotiation.offer?.years||1)));
  const contract={
    year,
    team_id:text(negotiation.team_id),
    team_name:negotiation.team_name||teamNameFor(base,negotiation.team_id),
    staff_id:text(negotiation.staff_id),
    staff_name:negotiation.staff_name||staffNameFor(base,negotiation.staff_id),
    role:text(negotiation.role),
    contract_start_year:year,
    contract_start:year,
    contract_until_year:year+years-1,
    contract_until:year+years-1,
    salary:Math.round(Number(negotiation.offer?.salary||0)),
    status:"active",
    source:transfer
      ?(negotiation.origin==="player"?"player_staff_transfer":"ai_staff_transfer")
      :(negotiation.origin==="player"?"player_staff_negotiation":"staff_negotiation"),
    negotiation_id:negotiation.id,
    signed_at:today,
    transfer_from_team_id:transfer?text(negotiation.seller_team_id):null,
    transfer_fee:transfer?transferFee:0,
  };
  const accepted={
    ...negotiation,
    status:"accepted",
    resolved_at:today,
    accepted_counter:Boolean(fromCounter),
    replacement_cost:Number(released.cost||0),
    transfer_fee_paid:transferFee,
  };
  const negotiations=staffNegotiations(base).map((row)=>{
    if(row.id===accepted.id)return accepted;
    if(!isStaffNegotiationActive(row)||text(row.staff_id)!==text(accepted.staff_id))return row;
    return {...row,status:"signed_elsewhere",resolved_at:today,resolution_note:accepted.staff_name+" signed with "+accepted.team_name+"."};
  });
  const details=[
    negotiation.staff_name+" has agreed a "+years+"-year contract as "+staffRoleLabel(negotiation.role)+" on $"+Number(negotiation.offer?.salary||0).toLocaleString("en-US")+" per season.",
    transferFee>0?"Transfer compensation of $"+transferFee.toLocaleString("en-US")+" was paid to "+text(negotiation.seller_team_name||negotiation.seller_team_id)+".":"",
    released.cost>0?"Replacing the incumbent cost $"+Number(released.cost).toLocaleString("en-US")+".":"",
  ].filter(Boolean).join(" ");
  return {
    ...base,
    staffContracts:[...(base?.staffContracts||[]),contract],
    staffNegotiations:negotiations,
    inbox:[{
      id:"staff_contract_signed_"+negotiation.id,
      date:today,
      unread:true,
      type:"STAFF",
      from:"Staff Management",
      tag:"Contracts",
      subject:negotiation.staff_name+" joins "+negotiation.team_name,
      body:details,
      staff_id:negotiation.staff_id,
      team_id:negotiation.team_id,
    },...(base?.inbox||[])],
  };
}
function staffActiveContractSafe(gs,staffId){
  const id=text(staffId);
  return activeStaffContracts(gs).find((contract)=>resolveStaffId(gs,contract)===id)||null;
}

export function acceptStaffCounterOffer(gs,negotiationId){
  const negotiation=staffNegotiations(gs).find((row)=>row.id===negotiationId);
  if(!negotiation||negotiation.status!=="countered"||!negotiation.counter_offer)return gs;
  const next={
    ...negotiation,
    offer:{...negotiation.counter_offer},
    counter_offer:null,
    status:"submitted",
    round:Number(negotiation.round||1)+1,
  };
  const patched={
    ...gs,
    staffNegotiations:staffNegotiations(gs).map((row)=>row.id===next.id?next:row),
  };
  return finalizeAccepted(patched,next,{fromCounter:true});
}
export function withdrawStaffNegotiation(gs,negotiationId){
  const today=dateOnly(gs?.currentDateISO);
  return {
    ...gs,
    staffNegotiations:staffNegotiations(gs).map((row)=>
      row.id===negotiationId&&isStaffNegotiationActive(row)
        ?{...row,status:"withdrawn",resolved_at:today}
        :row
    ),
  };
}
export function processStaffNegotiations(gs,{forceOutcomeById={}}={}){
  if(!gs)return gs;
  const today=dateOnly(gs?.currentDateISO);
  let next=gs;
  const due=staffNegotiations(next)
    .filter((row)=>row.status==="submitted"&&dateOnly(row.response_date)<=today)
    .sort((a,b)=>text(a.staff_id).localeCompare(text(b.staff_id))||text(a.id).localeCompare(text(b.id)));

  for(const original of due){
    const negotiation=staffNegotiations(next).find((row)=>row.id===original.id);
    if(!negotiation||negotiation.status!=="submitted")continue;
    const currentContract=staffActiveContractSafe(next,negotiation.staff_id);
    const transferValid=negotiation.kind==="transfer"
      &&currentContract
      &&teamIdOfContract(currentContract)===text(negotiation.seller_team_id);
    if((negotiation.kind==="transfer"&&!transferValid)||(negotiation.kind!=="transfer"&&currentContract)){
      next={
        ...next,
        staffNegotiations:staffNegotiations(next).map((row)=>row.id===negotiation.id?{
          ...row,
          status:"signed_elsewhere",
          resolved_at:today,
          resolution_note:negotiation.kind==="transfer"
            ?"The Staff member's current contract changed before the transfer completed."
            :"Staff member is no longer available.",
        }:row),
      };
      continue;
    }
    const decision=staffContractDecision(next,{
      staffId:negotiation.staff_id,
      teamId:negotiation.team_id,
      offer:negotiation.offer,
    });
    const evaluated={...negotiation,staff_decision:decision};
    const forced=forceOutcomeById?.[negotiation.id];
    const rng=rngFor(next,"staff-negotiation-response:"+negotiation.id+":"+negotiation.round);
    const roll=rng.next();
    let outcome=forced||null;
    if(!outcome){
      if(roll<decision.acceptance_probability)outcome="accepted";
      else if(negotiation.origin==="player"&&roll<Math.min(0.97,decision.acceptance_probability+0.30))outcome="countered";
      else outcome="rejected";
    }
    if(outcome==="accepted")next=finalizeAccepted(next,evaluated);
    else if(outcome==="countered")next=counterOffer(next,evaluated);
    else next=rejectNegotiation(next,evaluated);
  }
  return next;
}
