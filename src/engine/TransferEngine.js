// src/engine/TransferEngine.js
import { rngFor } from "../core/random.js";
import { activeDriverContract, driverIdOf, teamIdOf } from "../domain/driverContracts.js";
import { canAffordTransfer, driverBuyoutQuote } from "../domain/driverTransfers.js";

const ACTIVE_STATUSES=new Set(["submitted","countered"]);
const CLOSED_STATUSES=new Set(["rejected","withdrawn","completed"]);

const rows=(value)=>Array.isArray(value)?value:[];
const dateOnly=(value)=>String(value||"").slice(0,10);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const roundFee=(value)=>Math.max(0,Math.round(Number(value||0)/5_000)*5_000);

function addDaysISO(iso,days){
  const [y,m,d]=dateOnly(iso).split("-").map(Number);
  const dt=new Date(Date.UTC(y||1970,(m||1)-1,d||1));
  dt.setUTCDate(dt.getUTCDate()+Number(days||0));
  return dt.toISOString().slice(0,10);
}
function teamNameFor(gs,teamId){
  const team=(gs?.teams||[]).find((row)=>String(row?.team_id??row?.id??"")===String(teamId));
  if(String(gs?.team?.team_id??gs?.team?.id??"")===String(teamId)){
    return gs?.team?.team_name||gs?.team?.name||gs?.team?.short_name||String(teamId);
  }
  return team?.team_name||team?.name||team?.short_name||String(teamId);
}
function driverNameFor(gs,driverId){
  const driver=(gs?.drivers||[]).find((row)=>driverIdOf(row)===String(driverId))
    ||(gs?.dbDrivers||[]).find((row)=>driverIdOf(row)===String(driverId));
  return driver?.display_name||driver?.name||String(driverId);
}
function approachId(gs,{driverId,buyerTeamId}){
  const date=dateOnly(gs?.currentDateISO)||"date";
  return ["club_transfer",date,String(buyerTeamId),String(driverId),transferApproaches(gs).length+1].join("_");
}
function playerBuyer(gs,approach){
  return String(approach?.buyer_team_id||"")===String(gs?.team?.team_id??gs?.team?.id??"");
}

export function transferApproaches(gs){
  return rows(gs?.transferApproaches);
}
export function isClubTransferApproachActive(approach){
  return ACTIVE_STATUSES.has(String(approach?.status||"").toLowerCase());
}
export function isClubTransferApproachClosed(approach){
  return CLOSED_STATUSES.has(String(approach?.status||"").toLowerCase());
}
export function clubTransferApproachById(gs,approachId){
  return transferApproaches(gs).find((row)=>String(row?.id||"")===String(approachId||""))||null;
}
export function activeClubTransferApproach(gs,{driverId,buyerTeamId}={}){
  const year=Number(gs?.activeYear);
  return transferApproaches(gs).find((row)=>
    String(row?.driver_id||"")===String(driverId||"") &&
    String(row?.buyer_team_id||"")===String(buyerTeamId||"") &&
    (!Number.isFinite(year)||Number(row?.season_year??year)===year) &&
    isClubTransferApproachActive(row)
  )||null;
}
export function acceptedClubTransferApproach(gs,{driverId,buyerTeamId}={}){
  const year=Number(gs?.activeYear);
  return transferApproaches(gs).find((row)=>
    String(row?.driver_id||"")===String(driverId||"") &&
    String(row?.buyer_team_id||"")===String(buyerTeamId||"") &&
    (!Number.isFinite(year)||Number(row?.season_year??year)===year) &&
    String(row?.status||"").toLowerCase()==="accepted"
  )||null;
}
export function transferApproachStatusBuckets(value){
  const list=Array.isArray(value)?value:transferApproaches(value);
  return {
    active:list.filter((row)=>isClubTransferApproachActive(row)||String(row?.status||"").toLowerCase()==="accepted"),
    history:list.filter((row)=>isClubTransferApproachClosed(row)),
  };
}

export function startClubTransferApproach(gs,{
  driverId,
  buyerTeamId,
  buyerTeamName,
  offerFee,
  origin="player",
}={}){
  if(!gs)return gs;
  const did=String(driverId||"");
  const buyer=String(buyerTeamId||"");
  const contract=activeDriverContract(gs,did);
  if(!did||!buyer||!contract)return gs;

  const seller=teamIdOf(contract);
  if(!seller||seller===buyer)return gs;
  if(activeClubTransferApproach(gs,{driverId:did,buyerTeamId:buyer}))return gs;
  if(acceptedClubTransferApproach(gs,{driverId:did,buyerTeamId:buyer}))return gs;

  const quote=driverBuyoutQuote(gs,contract,{driverId:did});
  if(!quote.allowed||quote.type==="fixed_clause")return gs;

  const fee=roundFee(offerFee??quote.fee);
  if(fee<=0||!canAffordTransfer(gs,buyer,fee))return gs;

  const id=approachId(gs,{driverId:did,buyerTeamId:buyer});
  const rng=rngFor(gs,"club-transfer-delay:"+id);
  const responseDays=rng.int(1,3);
  const submitted=dateOnly(gs?.currentDateISO);
  const approach={
    id,
    origin,
    driver_id:did,
    driver_name:driverNameFor(gs,did),
    buyer_team_id:buyer,
    buyer_team_name:buyerTeamName||teamNameFor(gs,buyer),
    seller_team_id:seller,
    seller_team_name:teamNameFor(gs,seller),
    status:"submitted",
    season_year:Number(gs?.activeYear)||null,
    submitted_at:submitted,
    response_date:addDaysISO(submitted,responseDays),
    offer_fee:fee,
    valuation_fee:roundFee(quote.fee),
    quote_type:quote.type,
  };

  const messages=origin==="player"?[{
    id:"club_transfer_submit_"+id,
    date:submitted,
    unread:true,
    type:"STAFF",
    from:"Team Management",
    tag:"Transfers",
    subject:"Transfer offer submitted — "+approach.driver_name,
    body:"An offer of $"+fee.toLocaleString("en-US")+" has been sent to "+approach.seller_team_name+" for permission to negotiate with "+approach.driver_name+".",
    driver_id:did,
    transfer_approach_id:id,
    actions:[{label:"View driver market",route:"/Drivers"}],
  }]:[];

  return {
    ...gs,
    transferApproaches:[...transferApproaches(gs),approach],
    inbox:[...messages,...(gs?.inbox||[])],
  };
}

function resolveApproach(gs,approach,outcome){
  const today=dateOnly(gs?.currentDateISO);
  const valuation=Math.max(5_000,Number(approach?.valuation_fee||approach?.offer_fee||5_000));
  const rng=rngFor(gs,"club-transfer-response:"+approach.id);
  let updated={...approach,status:outcome,responded_at:today};
  let messageBody="";

  if(outcome==="accepted"){
    updated={...updated,agreed_fee:roundFee(approach.offer_fee),resolved_at:today};
    messageBody=approach.seller_team_name+" accepted the transfer fee. You may now negotiate personal terms with "+approach.driver_name+".";
  }else if(outcome==="countered"){
    const ask=Math.max(
      Number(approach.offer_fee||0)*1.05,
      valuation*(1.00+rng.next()*0.12)
    );
    const counterFee=roundFee(ask);
    updated={...updated,counter_fee:counterFee};
    messageBody=approach.seller_team_name+" is willing to negotiate, but wants $"+counterFee.toLocaleString("en-US")+" for "+approach.driver_name+".";
  }else{
    updated={...updated,resolved_at:today};
    messageBody=approach.seller_team_name+" rejected the transfer offer for "+approach.driver_name+".";
  }

  const messages=playerBuyer(gs,approach)?[{
    id:"club_transfer_response_"+approach.id+"_"+today,
    date:today,
    unread:true,
    type:"STAFF",
    from:"Team Management",
    tag:"Transfers",
    subject:(outcome==="accepted"?"Transfer fee accepted — ":outcome==="countered"?"Transfer counter-offer — ":"Transfer offer rejected — ")+approach.driver_name,
    body:messageBody,
    driver_id:approach.driver_id,
    transfer_approach_id:approach.id,
    actions:[{label:"Review transfer",route:"/Drivers"}],
  }]:[];

  return {
    ...gs,
    transferApproaches:transferApproaches(gs).map((row)=>row.id===approach.id?updated:row),
    inbox:[...messages,...(gs?.inbox||[])],
  };
}

export function processClubTransferApproaches(gs,{forceOutcomeById={}}={}){
  if(!gs)return gs;
  const today=dateOnly(gs?.currentDateISO);
  let next=gs;
  const year=Number(gs?.activeYear);
  const due=transferApproaches(gs)
    .filter((row)=>
      String(row?.status||"")==="submitted" &&
      (!Number.isFinite(year)||Number(row?.season_year??year)===year) &&
      dateOnly(row.response_date)<=today
    );

  for(const original of due){
    const approach=transferApproaches(next).find((row)=>row.id===original.id);
    if(!approach||approach.status!=="submitted")continue;

    const contract=activeDriverContract(next,approach.driver_id);
    if(!contract||teamIdOf(contract)!==String(approach.seller_team_id||"")){
      next=resolveApproach(next,approach,"rejected");
      continue;
    }

    const forced=forceOutcomeById?.[approach.id];
    let outcome=["accepted","countered","rejected"].includes(forced)?forced:null;
    if(!outcome){
      const valuation=Math.max(1,Number(approach.valuation_fee||1));
      const ratio=Number(approach.offer_fee||0)/valuation;
      if(ratio>=1.05)outcome="accepted";
      else if(ratio<0.55)outcome="rejected";
      else{
        const rng=rngFor(next,"club-transfer-decision:"+approach.id);
        const acceptChance=clamp(0.10+(ratio-0.55)*0.95,0.08,0.72);
        outcome=rng.next()<acceptChance?"accepted":"countered";
      }
    }
    next=resolveApproach(next,approach,outcome);
  }
  return next;
}

export function acceptClubTransferCounter(gs,approachId){
  const approach=transferApproaches(gs).find((row)=>row.id===approachId);
  if(!approach||approach.status!=="countered"||!Number(approach.counter_fee))return gs;
  if(!canAffordTransfer(gs,approach.buyer_team_id,approach.counter_fee))return gs;
  const today=dateOnly(gs?.currentDateISO);
  const accepted={
    ...approach,
    status:"accepted",
    agreed_fee:roundFee(approach.counter_fee),
    resolved_at:today,
    counter_accepted:true,
  };
  const messages=playerBuyer(gs,approach)?[{
    id:"club_transfer_counter_accept_"+approach.id,
    date:today,
    unread:true,
    type:"STAFF",
    from:"Team Management",
    tag:"Transfers",
    subject:"Transfer fee agreed — "+approach.driver_name,
    body:"A fee of $"+accepted.agreed_fee.toLocaleString("en-US")+" has been agreed with "+approach.seller_team_name+". You may now negotiate personal terms.",
    driver_id:approach.driver_id,
    transfer_approach_id:approach.id,
    actions:[{label:"Negotiate driver terms",route:"/Drivers"}],
  }]:[];

  return {
    ...gs,
    transferApproaches:transferApproaches(gs).map((row)=>row.id===approach.id?accepted:row),
    inbox:[...messages,...(gs?.inbox||[])],
  };
}

export function withdrawClubTransferApproach(gs,approachId){
  const approach=transferApproaches(gs).find((row)=>row.id===approachId);
  if(!approach||!["submitted","countered","accepted"].includes(String(approach.status||"")))return gs;
  const today=dateOnly(gs?.currentDateISO);
  return {
    ...gs,
    transferApproaches:transferApproaches(gs).map((row)=>
      row.id===approachId
        ?{...row,status:"withdrawn",resolved_at:today}
        :row
    ),
  };
}

export function completeClubTransferApproach(gs,{approachId,driverNegotiationId=null}={}){
  if(!approachId)return gs;
  const today=dateOnly(gs?.currentDateISO);
  return {
    ...gs,
    transferApproaches:transferApproaches(gs).map((row)=>
      row.id===approachId&&String(row.status)==="accepted"
        ?{
            ...row,
            status:"completed",
            completed_at:today,
            resolved_at:today,
            driver_negotiation_id:driverNegotiationId||row.driver_negotiation_id||null,
          }
        :row
    ),
  };
}
