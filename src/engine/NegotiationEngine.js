// src/engine/NegotiationEngine.js
import { rngFor } from "../core/random.js";
import {
  activeDriverContract,
  contractAcceptanceChance,
  contractEndYear,
  driverIdOf,
  expectedDriverSalary,
  extendDriverContract,
  makeDriverContract,
  teamIdOf,
} from "../domain/driverContracts.js";
import {
  isRaceDriverContract,
  isReserveDriverContract,
  isTestDriverContract,
  normalizedContractRole,
} from "../domain/contractRoles.js";
import { driverMarketEvaluation } from "../domain/driverMarketEvaluation.js";

const ACTIVE_NEGOTIATION_STATUSES=new Set(["submitted","countered"]);
const CLOSED_NEGOTIATION_STATUSES=new Set(["accepted","rejected","withdrawn","signed_elsewhere"]);

function rows(value){
  return Array.isArray(value)?value:[];
}
function dateOnly(value){return String(value||"").slice(0,10);}
function addDaysISO(iso,days){
  const [y,m,d]=dateOnly(iso).split("-").map(Number);
  const dt=new Date(Date.UTC(y||1970,(m||1)-1,d||1));
  dt.setUTCDate(dt.getUTCDate()+Number(days||0));
  return dt.toISOString().slice(0,10);
}
function teamNameFor(gs,teamId){
  const team=(gs?.teams||[]).find((t)=>String(t?.team_id??t?.id??"")===String(teamId));
  if(String(gs?.team?.team_id??gs?.team?.id??"")===String(teamId)){
    return gs?.team?.team_name||gs?.team?.name||gs?.team?.short_name||String(teamId);
  }
  return team?.team_name||team?.name||team?.short_name||String(teamId);
}
function driverFor(gs,driverId){
  return (gs?.drivers||[]).find((d)=>driverIdOf(d)===String(driverId))
    ||(gs?.dbDrivers||[]).find((d)=>driverIdOf(d)===String(driverId))
    ||null;
}
function driverNameFor(gs,driverId){
  const driver=driverFor(gs,driverId);
  return driver?.display_name||driver?.name||String(driverId);
}
function isContractActive(contract,year){
  const status=String(contract?.status||"active").toLowerCase();
  if(["terminated","expired","released","inactive","void"].includes(status))return false;
  const direct=Number(contract?.year??contract?.season_year??NaN);
  const start=Number(contract?.contract_start_year??contract?.start_year??NaN);
  const end=Number(contract?.contract_until_year??contract?.end_year??NaN);
  if(Number.isFinite(start)||Number.isFinite(end)){
    const lo=Number.isFinite(start)?start:(Number.isFinite(direct)?direct:-Infinity);
    const hi=Number.isFinite(end)?end:(Number.isFinite(direct)?direct:Infinity);
    return !Number.isFinite(year)||(year>=lo&&year<=hi);
  }
  return !Number.isFinite(year)||!Number.isFinite(direct)||direct===year;
}
function slotKeyForRole(role){
  const normalized=String(role||"").toLowerCase().replace(/[\s-]+/g,"_");
  if(/reserve/.test(normalized))return "reserve";
  if(/test|tester/.test(normalized))return "test";
  if(/second|driver_?2/.test(normalized))return "second";
  return "main";
}
function normalizedRoleLabel(role){
  const key=slotKeyForRole(role);
  if(key==="second")return "Second Driver";
  if(key==="reserve")return "Reserve Driver";
  if(key==="test")return "Test Driver";
  return "Main Driver";
}
function roleAttractiveness(role){
  const key=slotKeyForRole(role);
  if(key==="main")return 0.12;
  if(key==="second")return 0.08;
  if(key==="reserve")return 0.02;
  return 0;
}
function offerQuality(gs,negotiation){
  const expected=Math.max(1,Number(negotiation?.expected_salary||expectedDriverSalary(gs,negotiation.driver_id)));
  const salary=Math.max(0,Number(negotiation?.offer?.salary||0));
  const years=Math.max(1,Number(negotiation?.offer?.years||1));
  return salary/expected+roleAttractiveness(negotiation?.offer?.role)+Math.min(0.08,(years-1)*0.025);
}

export function driverNegotiations(gs){
  return rows(gs?.driverNegotiations);
}
export function isNegotiationActive(negotiation){
  return ACTIVE_NEGOTIATION_STATUSES.has(String(negotiation?.status||"").toLowerCase());
}
export function hasActiveNegotiationForDriver(gs,driverId){
  return driverNegotiations(gs).some((n)=>isNegotiationActive(n)&&String(n.driver_id)===String(driverId));
}
export function hasActiveNegotiationForTeamRole(gs,teamId,role){
  const target=slotKeyForRole(role);
  return driverNegotiations(gs).some((n)=>
    isNegotiationActive(n)&&
    String(n.team_id)===String(teamId)&&
    slotKeyForRole(n?.offer?.role)===target
  );
}

export function availableContractRoles(gs,teamId){
  const year=Number(gs?.activeYear);
  const teamContracts=(gs?.contracts||[]).filter((c)=>
    teamIdOf(c)===String(teamId)&&
    isContractActive(c,year)
  );

  let main=false;
  let second=false;
  let reserve=false;
  let test=false;
  const race=[];

  for(const contract of teamContracts){
    if(isReserveDriverContract(contract)){reserve=true;continue;}
    if(isTestDriverContract(contract)){test=true;continue;}
    if(isRaceDriverContract(contract)){
      race.push(contract);
      const role=normalizedContractRole(contract);
      if(/second|driver_?2/.test(role))second=true;
      else main=true;
    }
  }
  if(race.length>=2){main=true;second=true;}
  else if(race.length===1){
    if(!main&&!second)main=true;
  }

  const roles=[];
  if(!main&&!hasActiveNegotiationForTeamRole(gs,teamId,"Main Driver"))roles.push("Main Driver");
  if(!second&&!hasActiveNegotiationForTeamRole(gs,teamId,"Second Driver"))roles.push("Second Driver");
  if(!reserve&&!hasActiveNegotiationForTeamRole(gs,teamId,"Reserve Driver"))roles.push("Reserve Driver");
  if(!test&&!hasActiveNegotiationForTeamRole(gs,teamId,"Test Driver"))roles.push("Test Driver");
  return roles;
}

function negotiationId(gs,{driverId,teamId,role,origin}){
  const date=dateOnly(gs?.currentDateISO)||"date";
  const seq=driverNegotiations(gs).length+1;
  return ["neg",origin||"player",date,String(teamId),String(driverId),slotKeyForRole(role),seq].join("_");
}

export function startDriverNegotiation(gs,{
  driverId,
  teamId,
  teamName,
  offer,
  origin="player",
  renewal=false,
}={}){
  if(!gs)return gs;
  const did=String(driverId||"");
  const tid=String(teamId||"");
  const driver=driverFor(gs,did);
  if(!did||!tid||!driver)return gs;
  const existingContract=activeDriverContract(gs,did);
  if(renewal){
    if(!existingContract||teamIdOf(existingContract)!==tid)return gs;
  }else if(existingContract){
    return gs;
  }

  const role=normalizedRoleLabel(offer?.role||existingContract?.role||"Reserve Driver");
  if(!renewal){
    const allowed=availableContractRoles(gs,tid);
    if(!allowed.includes(role))return gs;
  }

  const duplicate=driverNegotiations(gs).some((n)=>
    isNegotiationActive(n)&&
    String(n.driver_id)===did&&
    String(n.team_id)===tid&&
    String(n.kind||"new_contract")===(renewal?"renewal":"new_contract")
  );
  if(duplicate)return gs;

  const expected=expectedDriverSalary(gs,did);
  const salary=Math.max(50_000,Math.round(Number(offer?.salary||expected)));
  const years=Math.max(1,Math.min(5,Math.round(Number(offer?.years||1))));
  const id=negotiationId(gs,{driverId:did,teamId:tid,role,origin});
  const rng=rngFor(gs,"negotiation-delay:"+id);
  const responseDays=rng.int(1,3);
  const submitted=dateOnly(gs?.currentDateISO);
  const negotiation={
    id,
    origin,
    kind:renewal?"renewal":"new_contract",
    driver_id:did,
    driver_name:driverNameFor(gs,did),
    team_id:tid,
    team_name:teamName||teamNameFor(gs,tid),
    status:"submitted",
    round:1,
    submitted_at:submitted,
    response_date:addDaysISO(submitted,responseDays),
    expected_salary:expected,
    offer:{salary,years,role},
    existing_contract_end:renewal?contractEndYear(existingContract,Number(gs?.activeYear)):null,
    market_evaluation:driverMarketEvaluation(gs,driver),
  };

  const messages=[];
  if(origin==="player"){
    messages.push({
      id:"neg_submit_"+id,
      date:submitted,
      unread:true,
      type:"STAFF",
      from:"Driver Management",
      tag:"Contracts",
      subject:(renewal?"Renewal offer submitted — ":"Contract offer submitted — ")+negotiation.driver_name,
      body:renewal
        ?("A "+years+"-year extension worth $"+salary.toLocaleString("en-US")+" per season has been offered. A response is expected within "+responseDays+" day(s).")
        :("A "+years+"-year offer worth $"+salary.toLocaleString("en-US")+" per season has been submitted for the "+role+" role. A response is expected within "+responseDays+" day(s)."),
      driver_id:did,
      negotiation_id:id,
      actions:[{label:"View negotiations",route:renewal?"/MyDrivers":"/Drivers"}],
    });
  }

  return {
    ...gs,
    driverNegotiations:[...driverNegotiations(gs),negotiation],
    inbox:[...messages,...(gs?.inbox||[])],
  };
}

function closeOtherNegotiations(negotiations,winner){
  return negotiations.map((n)=>{
    if(n.id===winner.id)return n;
    if(!isNegotiationActive(n)||String(n.driver_id)!==String(winner.driver_id))return n;
    return {
      ...n,
      status:"signed_elsewhere",
      resolved_at:winner.resolved_at,
      resolution_note:winner.driver_name+" signed with "+winner.team_name+".",
    };
  });
}

function finalizeAccepted(gs,negotiation,{fromCounter=false}={}){
  const renewal=String(negotiation?.kind||"")==="renewal";
  const currentContract=activeDriverContract(gs,negotiation.driver_id);
  if(!renewal&&currentContract){
    return {
      ...gs,
      driverNegotiations:driverNegotiations(gs).map((n)=>
        n.id===negotiation.id?{...n,status:"signed_elsewhere",resolved_at:dateOnly(gs.currentDateISO)}:n
      ),
    };
  }
  if(renewal&&(!currentContract||teamIdOf(currentContract)!==String(negotiation.team_id))){
    return {
      ...gs,
      driverNegotiations:driverNegotiations(gs).map((n)=>
        n.id===negotiation.id?{...n,status:"rejected",resolved_at:dateOnly(gs.currentDateISO),resolution_note:"Existing contract is no longer active."}:n
      ),
    };
  }
  const driver=driverFor(gs,negotiation.driver_id);
  if(!driver)return gs;
  const resolvedAt=dateOnly(gs?.currentDateISO);
  const accepted={
    ...negotiation,
    status:"accepted",
    resolved_at:resolvedAt,
    accepted_counter:Boolean(fromCounter),
  };
  let nextState=gs;
  let contract=null;
  if(renewal){
    nextState=extendDriverContract(gs,negotiation.driver_id,negotiation.offer);
    contract=activeDriverContract(nextState,negotiation.driver_id);
    if(contract){
      nextState={
        ...nextState,
        contracts:(nextState.contracts||[]).map((row)=>row===contract?{
          ...row,
          renewal_negotiation_id:negotiation.id,
          renewal_source:negotiation.origin==="player"?"player_renewal":"ai_renewal",
        }:row),
      };
      contract=activeDriverContract(nextState,negotiation.driver_id);
    }
  }else{
    contract=makeDriverContract({
      gs,
      driver,
      teamId:negotiation.team_id,
      teamName:negotiation.team_name,
      offer:negotiation.offer,
      source:negotiation.origin==="player"?"player_negotiation":"ai_negotiation",
    });
    contract.negotiation_id=negotiation.id;
    contract.market_evaluation=negotiation.market_evaluation||driverMarketEvaluation(gs,driver);
    nextState={...gs,contracts:[...(gs?.contracts||[]),contract]};
  }

  let negotiations=driverNegotiations(gs).map((n)=>n.id===negotiation.id?accepted:n);
  if(!renewal)negotiations=closeOtherNegotiations(negotiations,accepted);

  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const playerInvolved=String(negotiation.team_id)===userTeamId;
  const renewedUntil=renewal?contractEndYear(contract,Number(gs?.activeYear)):null;
  const messages=[{
    id:(renewal?"contract_renewed_":"contract_signed_")+negotiation.id,
    date:resolvedAt,
    unread:true,
    type:playerInvolved?"STAFF":"PR",
    from:playerInvolved?"Driver Management":"Paddock Reporter",
    tag:"Contracts",
    subject:renewal
      ?(negotiation.driver_name+" renews with "+negotiation.team_name)
      :(negotiation.driver_name+" signs with "+negotiation.team_name),
    body:renewal
      ?(negotiation.driver_name+" has agreed a "+negotiation.offer.years+"-year extension through "+renewedUntil+" on $"+Number(negotiation.offer.salary).toLocaleString("en-US")+" per season.")
      :(negotiation.driver_name+" has agreed a "+negotiation.offer.years+"-year contract as "+negotiation.offer.role+" on $"+Number(negotiation.offer.salary).toLocaleString("en-US")+" per season."),
    driver_id:negotiation.driver_id,
    team_id:negotiation.team_id,
  }];

  for(const other of negotiations){
    if(other.status!=="signed_elsewhere"||other.resolution_notified)continue;
    if(other.origin==="player"){
      messages.push({
        id:"neg_lost_"+other.id,
        date:resolvedAt,
        unread:true,
        type:"STAFF",
        from:"Driver Management",
        tag:"Contracts",
        subject:"Negotiation ended — "+other.driver_name,
        body:other.driver_name+" has signed for "+negotiation.team_name+" and is no longer available.",
        driver_id:other.driver_id,
      });
      other.resolution_notified=true;
    }
  }

  return {
    ...nextState,
    driverNegotiations:negotiations,
    inbox:[...messages,...(nextState?.inbox||[])],
  };
}

function counterOffer(gs,negotiation){
  const expected=Math.max(1,Number(negotiation.expected_salary||expectedDriverSalary(gs,negotiation.driver_id)));
  const current=Math.max(0,Number(negotiation.offer?.salary||0));
  const rng=rngFor(gs,"negotiation-counter:"+negotiation.id+":"+negotiation.round);
  const counterSalary=Math.round(Math.max(expected*0.95,current*(1.06+rng.next()*0.08))/5_000)*5_000;
  const counterYears=Math.max(1,Number(negotiation.offer?.years||1));
  const today=dateOnly(gs?.currentDateISO);
  const updated={
    ...negotiation,
    status:"countered",
    counter_offer:{
      salary:counterSalary,
      years:counterYears,
      role:negotiation.offer.role,
    },
    responded_at:today,
  };
  const message={
    id:"neg_counter_"+negotiation.id+"_"+negotiation.round,
    date:today,
    unread:true,
    type:"STAFF",
    from:"Driver Agent",
    tag:"Contracts",
    subject:"Counter-offer — "+negotiation.driver_name,
    body:negotiation.driver_name+"'s representatives are willing to continue talks, but want $"+counterSalary.toLocaleString("en-US")+" per season for "+counterYears+" year(s) as "+negotiation.offer.role+".",
    driver_id:negotiation.driver_id,
    negotiation_id:negotiation.id,
    actions:[{label:"Review counter-offer",route:"/Drivers"}],
  };
  return {
    ...gs,
    driverNegotiations:driverNegotiations(gs).map((n)=>n.id===negotiation.id?updated:n),
    inbox:[message,...(gs?.inbox||[])],
  };
}

function rejectNegotiation(gs,negotiation,reason="Offer rejected"){
  const today=dateOnly(gs?.currentDateISO);
  const rejected={...negotiation,status:"rejected",resolved_at:today,resolution_note:reason};
  const messages=negotiation.origin==="player"?[{
    id:"neg_reject_"+negotiation.id,
    date:today,
    unread:true,
    type:"STAFF",
    from:"Driver Agent",
    tag:"Contracts",
    subject:"Offer rejected — "+negotiation.driver_name,
    body:negotiation.driver_name+"'s representatives have rejected the current proposal.",
    driver_id:negotiation.driver_id,
  }]:[];
  return {
    ...gs,
    driverNegotiations:driverNegotiations(gs).map((n)=>n.id===negotiation.id?rejected:n),
    inbox:[...messages,...(gs?.inbox||[])],
  };
}

export function acceptCounterOffer(gs,negotiationId){
  const negotiation=driverNegotiations(gs).find((n)=>n.id===negotiationId);
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
    driverNegotiations:driverNegotiations(gs).map((n)=>n.id===next.id?next:n),
  };
  return finalizeAccepted(patched,next,{fromCounter:true});
}

export function withdrawNegotiation(gs,negotiationId){
  const today=dateOnly(gs?.currentDateISO);
  return {
    ...gs,
    driverNegotiations:driverNegotiations(gs).map((n)=>
      n.id===negotiationId&&isNegotiationActive(n)
        ?{...n,status:"withdrawn",resolved_at:today}
        :n
    ),
  };
}

export function processDriverNegotiations(gs,{forceOutcomeById={}}={}){
  if(!gs)return gs;
  const today=dateOnly(gs?.currentDateISO);
  let next=gs;
  const due=driverNegotiations(gs)
    .filter((n)=>n.status==="submitted"&&dateOnly(n.response_date)<=today)
    .sort((a,b)=>{
      if(String(a.driver_id)===String(b.driver_id)){
        return offerQuality(gs,b)-offerQuality(gs,a);
      }
      return String(a.driver_id).localeCompare(String(b.driver_id));
    });

  for(const original of due){
    const negotiation=driverNegotiations(next).find((n)=>n.id===original.id);
    if(!negotiation||negotiation.status!=="submitted")continue;

    const contract=activeDriverContract(next,negotiation.driver_id);
    const renewal=String(negotiation?.kind||"")==="renewal";
    if(contract&&!renewal){
      const signedElsewhere={
        ...negotiation,
        status:"signed_elsewhere",
        resolved_at:today,
        resolution_note:"Driver is no longer available.",
      };
      next={
        ...next,
        driverNegotiations:driverNegotiations(next).map((n)=>n.id===negotiation.id?signedElsewhere:n),
      };
      if(negotiation.origin==="player"){
        next={
          ...next,
          inbox:[{
            id:"neg_unavailable_"+negotiation.id,
            date:today,
            unread:true,
            type:"STAFF",
            from:"Driver Management",
            tag:"Contracts",
            subject:"Negotiation ended — "+negotiation.driver_name,
            body:negotiation.driver_name+" is no longer available after agreeing terms elsewhere.",
            driver_id:negotiation.driver_id,
          },...(next?.inbox||[])],
        };
      }
      continue;
    }

    const forced=forceOutcomeById?.[negotiation.id];
    const chance=contractAcceptanceChance(next,negotiation.driver_id,negotiation.offer,{renewal});
    const rng=rngFor(next,"negotiation-response:"+negotiation.id+":"+negotiation.round);
    const roll=rng.next();
    let outcome=forced||null;
    if(!outcome){
      if(roll<chance)outcome="accepted";
      else if(negotiation.origin==="player"&&roll<Math.min(0.97,chance+0.32))outcome="countered";
      else if(negotiation.origin==="ai"&&Number(negotiation.round||1)<2&&roll<Math.min(0.95,chance+0.20))outcome="ai_retry";
      else outcome="rejected";
    }

    if(outcome==="accepted"){
      next=finalizeAccepted(next,negotiation);
    }else if(outcome==="countered"){
      next=counterOffer(next,negotiation);
    }else if(outcome==="ai_retry"){
      const improved={
        ...negotiation,
        status:"submitted",
        round:Number(negotiation.round||1)+1,
        offer:{
          ...negotiation.offer,
          salary:Math.round(Number(negotiation.offer.salary||0)*1.10/5_000)*5_000,
        },
        response_date:addDaysISO(today,1),
      };
      next={
        ...next,
        driverNegotiations:driverNegotiations(next).map((n)=>n.id===improved.id?improved:n),
      };
    }else{
      next=rejectNegotiation(next,negotiation);
    }
  }

  return next;
}

export function negotiationSummary(gs,teamId){
  const tid=String(teamId||"");
  return driverNegotiations(gs).filter((n)=>
    String(n.team_id)===tid&&!CLOSED_NEGOTIATION_STATUSES.has(String(n.status||"").toLowerCase())
  );
}


export function startDriverRenewal(gs,{
  driverId,
  teamId,
  teamName,
  offer,
  origin="player",
}={}){
  const contract=activeDriverContract(gs,driverId);
  if(!contract)return gs;
  return startDriverNegotiation(gs,{
    driverId,
    teamId:teamId||teamIdOf(contract),
    teamName,
    offer:{...offer,role:offer?.role||contract?.role},
    origin,
    renewal:true,
  });
}
