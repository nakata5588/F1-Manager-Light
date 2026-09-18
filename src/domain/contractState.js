// src/domain/contractState.js
import {
  calculateBuyout,
  contractTerminationCost,
  deterministicOfferAccepted,
  driverContract,
  driverContractDemand,
  makeDriverContract,
  ruleLimits,
  teamDriverContracts,
} from "./contractEngine.js";

const rawId=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)) return String(value.result??value.value??"");
  return String(value??"");
};
const driverIdOfRow=(row)=>rawId(row?.driver_id??row?.person_id??row?.id);
const userTeamIdOf=(gs)=>String(gs?.team?.team_id??gs?.team?.id??"");
const driverById=(gs,id)=>(gs?.drivers||[]).find((d)=>String(d?.driver_id??d?.id??"")===String(id))||{};
const driverName=(gs,id)=>{
  const d=driverById(gs,id);
  return d.display_name||d.name||String(id);
};
const money=(v)=>"$"+Number(v||0).toLocaleString();

function chargeState(gs,amount){
  const charge=Math.max(0,Number(amount||0));
  const balance=Number(gs?.finances?.balance??gs?.team?.budget??0);
  const nextBalance=Math.max(0,balance-charge);
  return {
    balance,
    nextBalance,
    finances:{...(gs?.finances||{}),balance:nextBalance,budget:nextBalance},
    team:{...(gs?.team||{}),budget:nextBalance},
  };
}

export function approachDriverAgentState(gs,driverId){
  const id=String(driverId||"");
  const userTeamId=userTeamIdOf(gs);
  if(!id)return {state:gs,result:{ok:false,error:"invalid_driver"}};
  if(!userTeamId)return {state:gs,result:{ok:false,error:"no_user_team"}};

  const current=driverContract(gs,id);
  const own=Boolean(current&&String(current?.team_id??current?.team??"")===userTeamId);
  const role=own?String(current?.role||"Main Driver"):"Second Driver";
  const demand=driverContractDemand(gs,id,{teamId:userTeamId,role});
  const buyout=calculateBuyout(gs,id);
  const limits=ruleLimits(gs);
  const negotiation={
    driverId:id,status:"open",intent:own?"renew":"sign",round:1,role,demand,
    buyout:Number.isFinite(buyout)?buyout:null,
    buyoutBlocked:buyout===Infinity,
    limits,openedAt:gs.currentDateISO,lastOffer:null,counter:null,
  };
  const state={
    ...gs,
    driverNegotiations:{...(gs?.driverNegotiations||{}),[id]:negotiation},
  };
  return {state,result:{ok:true,negotiation}};
}

export function submitDriverContractOfferState(gs,driverId,offer){
  const id=String(driverId||"");
  const userTeamId=userTeamIdOf(gs);
  if(!id||!userTeamId)return {state:gs,result:{ok:false,error:"invalid_context"}};

  const current=driverContract(gs,id);
  const own=Boolean(current&&String(current?.team_id??current?.team??"")===userTeamId);
  const limits=ruleLimits(gs);
  const existingTeamContracts=teamDriverContracts(gs,userTeamId);
  if(!own&&existingTeamContracts.length>=limits.maxDriverContracts){
    return {state:gs,result:{ok:false,error:"driver_contract_limit",limit:limits.maxDriverContracts}};
  }

  const negotiation=gs?.driverNegotiations?.[id]||{};
  const round=Math.max(1,Number(negotiation.round||1));
  const evaluation=deterministicOfferAccepted(gs,id,offer,round);
  if(evaluation.buyout===Infinity){
    return {state:gs,result:{ok:false,error:"buyout_not_allowed",evaluation}};
  }

  const signingBonus=Math.max(0,Number(offer?.signingBonus||0));
  const buyout=Math.max(0,Number(evaluation.buyout||0));
  const upFront=signingBonus+buyout;
  const balance=Number(gs?.finances?.balance??gs?.team?.budget??0);
  if(upFront>balance){
    return {state:gs,result:{ok:false,error:"insufficient_funds",required:upFront,balance,evaluation}};
  }

  const name=driverName(gs,id);
  if(!evaluation.accepted){
    const nextNegotiation={
      ...negotiation,driverId:id,status:"counter",intent:own?"renew":"sign",
      round:round+1,lastOffer:{...offer},counter:evaluation.counter,
      demand:evaluation.demand,buyout:Number.isFinite(evaluation.buyout)?evaluation.buyout:null,
      lastChance:evaluation.chance,lastRoll:evaluation.roll,updatedAt:gs.currentDateISO,
    };
    const state={
      ...gs,
      driverNegotiations:{...(gs?.driverNegotiations||{}),[id]:nextNegotiation},
      inbox:[{
        id:"agent_counter_"+id+"_"+Date.now(),date:gs.currentDateISO,
        from:name+"'s Agent",type:"CONTRACT",tag:"Drivers",
        subject:"Counter-offer — "+name,
        body:"Your offer was not accepted. The agent has returned revised terms for round "+(round+1)+".",
        unread:true,
      },...(gs?.inbox||[])],
    };
    return {state,result:{ok:true,accepted:false,evaluation,negotiation:nextNegotiation}};
  }

  const newContract=makeDriverContract(gs,id,offer,{source:own?"player_renewal":"player_signing"});
  const oldTeamId=current?String(current?.team_id??current?.team??""):"";
  const contracts=(gs?.contracts||[]).filter((row)=>{
    const rid=driverIdOfRow(row);
    if(rid!==id)return true;
    const status=String(row?.status||"active").toLowerCase();
    return ["terminated","expired"].includes(status);
  });
  contracts.push(newContract);

  const financeLog=[...(gs?.financeLog||[])];
  if(signingBonus>0)financeLog.unshift({
    id:"tx_driver_signing_"+id+"_"+Date.now(),dateISO:gs.currentDateISO,
    type:"expense",category:"Driver Contract",desc:name+" — signing bonus",
    amount:-signingBonus,sig:"driverSigning:"+id+":"+gs.activeYear+":"+round,
  });
  if(buyout>0)financeLog.unshift({
    id:"tx_driver_buyout_"+id+"_"+Date.now(),dateISO:gs.currentDateISO,
    type:"expense",category:"Driver Buyout",
    desc:name+" — contract buyout from "+(oldTeamId||"previous team"),
    amount:-buyout,sig:"driverBuyout:"+id+":"+gs.activeYear+":"+round,
  });

  const charged=chargeState(gs,upFront);
  const state={
    ...gs,contracts,finances:charged.finances,team:charged.team,financeLog,
    driverNegotiations:{
      ...(gs?.driverNegotiations||{}),
      [id]:{...negotiation,status:"accepted",round,lastOffer:{...offer},acceptedAt:gs.currentDateISO,contract:newContract},
    },
    inbox:[{
      id:"contract_signed_"+id+"_"+Date.now(),date:gs.currentDateISO,
      from:"Team Management",type:"CONTRACT",tag:"Drivers",
      subject:(own?"Contract renewed":"Driver signed")+" — "+name,
      body:name+" has agreed a "+Number(offer?.years||1)+"-year deal as "+String(offer?.role||"Driver")+
        " for "+money(offer?.salary)+" per season."+(buyout?" Buyout paid: "+money(buyout)+".":""),
      unread:true,
    },...(gs?.inbox||[])],
  };
  return {state,result:{ok:true,accepted:true,evaluation,contract:newContract}};
}

export function terminateDriverContractState(gs,driverId){
  const id=String(driverId||"");
  const userTeamId=userTeamIdOf(gs);
  const current=driverContract(gs,id);
  if(!current||String(current?.team_id??current?.team??"")!==userTeamId){
    return {state:gs,result:{ok:false,error:"not_your_driver"}};
  }

  const cost=contractTerminationCost(gs,id);
  const balance=Number(gs?.finances?.balance??gs?.team?.budget??0);
  if(cost>balance)return {state:gs,result:{ok:false,error:"insufficient_funds",required:cost,balance}};

  const contracts=(gs?.contracts||[]).filter((row)=>driverIdOfRow(row)!==id);
  const name=driverName(gs,id);
  const charged=chargeState(gs,cost);
  const financeLog=[...(gs?.financeLog||[])];
  if(cost>0)financeLog.unshift({
    id:"tx_driver_termination_"+id+"_"+Date.now(),dateISO:gs.currentDateISO,
    type:"expense",category:"Contract Termination",desc:name+" — termination settlement",
    amount:-cost,sig:"driverTermination:"+id+":"+gs.currentDateISO,
  });

  const state={
    ...gs,contracts,finances:charged.finances,team:charged.team,financeLog,
    driverNegotiations:{...(gs?.driverNegotiations||{}),[id]:{status:"terminated",driverId:id,date:gs.currentDateISO}},
    inbox:[{
      id:"contract_terminated_"+id+"_"+Date.now(),date:gs.currentDateISO,
      from:"Team Management",type:"CONTRACT",tag:"Drivers",
      subject:"Contract terminated — "+name,
      body:name+"'s contract has been terminated. Settlement cost: "+money(cost)+". The driver is now available to the market.",
      unread:true,
    },...(gs?.inbox||[])],
  };
  return {state,result:{ok:true,cost}};
}
