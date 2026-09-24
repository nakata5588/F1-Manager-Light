// src/domain/driverTeammateDynamics.js
import { applyTeammateRelationshipPair } from "./relationshipEvents.js";

const text=(value)=>String(value??"").trim();
const num=(value,fb=null)=>{
  const n=Number(value);
  return Number.isFinite(n)?n:fb;
};

function mechanicalRetirement(row){
  if(!row?.retired&&String(row?.status||"").toUpperCase()!=="DNF")return false;
  const reason=text(row?.retirement_reason).toLowerCase();
  return /engine|gearbox|transmission|electrical|hydraulic|suspension|brake|fuel|oil|fire|overheat|mechanical|reliability/.test(reason);
}

function sportingComparable(row){
  if(!row)return false;
  if(!row?.retired&&String(row?.status||"").toUpperCase()!=="DNF")return true;
  return !mechanicalRetirement(row);
}

function rowBeats(a,b){
  if(!a||!b)return null;
  const aRetired=Boolean(a?.retired)||String(a?.status||"").toUpperCase()==="DNF";
  const bRetired=Boolean(b?.retired)||String(b?.status||"").toUpperCase()==="DNF";
  if(aRetired!==bRetired)return !aRetired;
  const aPos=num(a?.position);
  const bPos=num(b?.position);
  if(aPos===null||bPos===null||aPos===bPos)return null;
  return aPos<bPos;
}

function qualificationByDriver(resultEntry){
  return new Map((resultEntry?.qualifying||[]).map((row,index)=>[
    text(row?.driver_id??row?.driver?.driver_id),
    num(row?.position,index+1),
  ]));
}

function teammateCollision(a,b){
  const aid=text(a?.driver_id),bid=text(b?.driver_id);
  if(!aid||!bid)return false;
  const aOther=text(a?.incident_with_driver_id);
  const bOther=text(b?.incident_with_driver_id);
  const aReason=text(a?.retirement_reason??a?.incident_reason).toLowerCase();
  const bReason=text(b?.retirement_reason??b?.incident_reason).toLowerCase();
  return (aOther===bid&&/collision|contact|accident/.test(aReason))
    ||(bOther===aid&&/collision|contact|accident/.test(bReason));
}

export function applyRaceTeammateDynamics(gs,resultEntry){
  if(!gs||!resultEntry)return gs;
  const rows=Array.isArray(resultEntry?.classification)?resultEntry.classification:[];
  const byTeam=new Map();
  for(const row of rows){
    const teamId=text(row?.team_id);
    const driverId=text(row?.driver_id);
    if(!teamId||!driverId)continue;
    if(!byTeam.has(teamId))byTeam.set(teamId,[]);
    byTeam.get(teamId).push(row);
  }
  const qualifying=qualificationByDriver(resultEntry);
  let next=gs;

  for(const [teamId,teamRows] of byTeam){
    const ordered=teamRows.slice().sort((a,b)=>num(a?.position,999)-num(b?.position,999));
    if(ordered.length<2)continue;

    // A normal F1 team has two race cars. Temporary/replacement states may
    // generate more rows in unusual saves, so process unique pairs safely.
    for(let i=0;i<ordered.length;i++){
      for(let j=i+1;j<ordered.length;j++){
        const a=ordered[i],b=ordered[j];
        const aid=text(a?.driver_id),bid=text(b?.driver_id);
        if(!aid||!bid)continue;

        if(teammateCollision(a,b)){
          next=applyTeammateRelationshipPair(next,{
            driverA:aid,driverB:bid,teamId,
            deltasA:{trust:-6,respect:-2,affinity:-5,satisfaction:-3,rivalry:8},
            deltasB:{trust:-6,respect:-2,affinity:-5,satisfaction:-3,rivalry:8},
            source:"teammate_collision",
            reason:"Collision with team-mate",
            meta:{gp_id:resultEntry?.gp_id??null,round:resultEntry?.round??null},
          });
          continue;
        }

        const aComparable=sportingComparable(a),bComparable=sportingComparable(b);
        const comparable=aComparable&&bComparable;
        const aBeat=rowBeats(a,b);
        let deltasA={},deltasB={};

        if(comparable&&aBeat!==null){
          const winnerDeltas={respect:0.35,satisfaction:0.55,rivalry:0.8};
          const loserDeltas={respect:0.2,affinity:-0.25,satisfaction:-0.55,rivalry:1.05};
          deltasA=aBeat?winnerDeltas:loserDeltas;
          deltasB=aBeat?loserDeltas:winnerDeltas;

          const aPos=num(a?.position),bPos=num(b?.position);
          if(aPos!==null&&bPos!==null){
            const gap=Math.abs(aPos-bPos);
            if(gap<=2){
              deltasA={...deltasA,rivalry:num(deltasA.rivalry,0)+0.55};
              deltasB={...deltasB,rivalry:num(deltasB.rivalry,0)+0.55};
            }else if(gap>=6){
              const losingA=!aBeat;
              if(losingA)deltasA={...deltasA,satisfaction:num(deltasA.satisfaction,0)-0.3,rivalry:num(deltasA.rivalry,0)+0.35};
              else deltasB={...deltasB,satisfaction:num(deltasB.satisfaction,0)-0.3,rivalry:num(deltasB.rivalry,0)+0.35};
            }
          }
        }

        const aq=qualifying.get(aid),bq=qualifying.get(bid);
        if(aq!==null&&aq!==undefined&&bq!==null&&bq!==undefined&&aq!==bq){
          if(aq<bq){
            deltasA={...deltasA,rivalry:num(deltasA.rivalry,0)+0.2};
            deltasB={...deltasB,respect:num(deltasB.respect,0)+0.1,rivalry:num(deltasB.rivalry,0)+0.3};
          }else{
            deltasB={...deltasB,rivalry:num(deltasB.rivalry,0)+0.2};
            deltasA={...deltasA,respect:num(deltasA.respect,0)+0.1,rivalry:num(deltasA.rivalry,0)+0.3};
          }
        }

        if(Object.keys(deltasA).length||Object.keys(deltasB).length){
          next=applyTeammateRelationshipPair(next,{
            driverA:aid,driverB:bid,teamId,deltasA,deltasB,
            source:"teammate_race",
            reason:"Race weekend against team-mate",
            meta:{
              gp_id:resultEntry?.gp_id??null,
              round:resultEntry?.round??null,
              a_position:a?.position??null,
              b_position:b?.position??null,
              a_qualifying:aq??null,
              b_qualifying:bq??null,
              a_mechanical_dnf:mechanicalRetirement(a),
              b_mechanical_dnf:mechanicalRetirement(b),
            },
          });
        }
      }
    }
  }
  // Applied team orders are persisted in each driver's strategy decisions.
  // Cancelled/future commands never reach this list, so they do not alter relationships.
  for(const [driverId,strategy] of Object.entries(resultEntry?.raceStrategy?.strategies||{})){
    for(const decision of strategy?.strategy_decisions||[]){
      if(decision?.action!=="team_order"||decision?.order!=="yield"||!decision?.teammate_id)continue;
      const row=rows.find((item)=>text(item?.driver_id)===text(driverId));
      next=applyTeammateTeamOrder(next,{
        yieldingDriverId:driverId,
        beneficiaryDriverId:decision.teammate_id,
        teamId:row?.team_id??null,
        lap:decision?.lap??null,
      });
    }
  }

  return next;
}

export function applyTeammateTeamOrder(gs,{
  yieldingDriverId,
  beneficiaryDriverId,
  teamId,
  lap=null,
  source="team_order_yield",
}={}){
  return applyTeammateRelationshipPair(gs,{
    driverA:yieldingDriverId,
    driverB:beneficiaryDriverId,
    teamId,
    deltasA:{trust:-0.5,affinity:-0.9,satisfaction:-1.4,rivalry:1.6},
    deltasB:{respect:1.1,affinity:0.8,satisfaction:0.35,rivalry:0.45},
    source,
    reason:"Team order — let team-mate through",
    meta:{lap},
  });
}

export function applyTeammateRoleStatusChange(gs,{
  driverId,
  teammateId,
  teamId,
  fromSlot,
  toSlot,
}={}){
  if(!driverId||!teammateId||String(driverId)===String(teammateId))return gs;
  const rank={main:0,second:1,reserve:2,test:3};
  const from=rank[String(fromSlot)]??9;
  const to=rank[String(toSlot)]??9;
  if(from===to)return gs;

  if(to<from){
    return applyTeammateRelationshipPair(gs,{
      driverA:driverId,driverB:teammateId,teamId,
      deltasA:{respect:0.35,satisfaction:0.45,rivalry:1.4},
      deltasB:{affinity:-0.5,satisfaction:-0.8,rivalry:1.8},
      source:"role_promotion",
      reason:"Driver hierarchy changed",
      meta:{from_slot:fromSlot,to_slot:toSlot},
    });
  }
  return applyTeammateRelationshipPair(gs,{
    driverA:driverId,driverB:teammateId,teamId,
    deltasA:{trust:-0.6,affinity:-1.2,satisfaction:-1.8,rivalry:2.6},
    deltasB:{respect:0.25,rivalry:1.0},
    source:"role_demotion",
    reason:"Driver hierarchy changed",
    meta:{from_slot:fromSlot,to_slot:toSlot},
  });
}
