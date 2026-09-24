// src/domain/relationshipEvents.js
// Low-level Save World relationship mutations. Kept dependency-light so
// contracts, race systems and UI can record relationship events without cycles.

const text=(value)=>String(value??"").trim();
const clamp100=(value)=>Math.max(0,Math.min(100,Number(value)||0));
const SCORE_FIELDS=["trust","respect","affinity","satisfaction"];

export function relationshipEventKey(driverId,targetType,targetId){
  return [text(driverId),text(targetType),text(targetId)].join("|");
}

export function relationshipStatus(score){
  const value=Number(score);
  if(!Number.isFinite(value))return "unknown";
  if(value>=80)return "excellent";
  if(value>=65)return "positive";
  if(value>=45)return "neutral";
  if(value>=30)return "strained";
  return "poor";
}

export function relationshipRivalryBand(value){
  const rivalry=Number(value);
  if(!Number.isFinite(rivalry)||rivalry<15)return "low";
  if(rivalry<35)return "competitive";
  if(rivalry<60)return "rivalry";
  if(rivalry<80)return "intense";
  return "hostile";
}

function scoreOf(record){
  const values=SCORE_FIELDS.map((field)=>Number(record?.[field])).filter(Number.isFinite);
  if(!values.length)return 50;
  return Math.round(values.reduce((sum,value)=>sum+value,0)/values.length*10)/10;
}

function baseRecord({driverId,targetType,targetId,teamId,dateISO,active=true}){
  const record={
    driver_id:text(driverId),
    target_type:text(targetType),
    target_id:text(targetId),
    team_id:teamId?text(teamId):null,
    trust:50,
    respect:50,
    affinity:50,
    satisfaction:50,
    rivalry:0,
    active:Boolean(active),
    source:"relationship_event",
    created_at:dateISO||null,
    updated_at:dateISO||null,
  };
  record.score=scoreOf(record);
  record.status=relationshipStatus(record.score);
  record.rivalry_status=relationshipRivalryBand(record.rivalry);
  return record;
}

export function applyDriverRelationshipChange(gs,{
  driverId,
  targetType,
  targetId,
  teamId=null,
  deltas={},
  source="relationship_event",
  reason="Relationship changed",
  meta=null,
  patch={},
  active=true,
}={}){
  if(!gs||typeof gs!=="object")return gs;
  const did=text(driverId),type=text(targetType),tid=text(targetId);
  if(!did||!type||!tid)return gs;

  const dateISO=text(gs?.currentDateISO).slice(0,10)||null;
  const container=gs?.driverRelationships&&typeof gs.driverRelationships==="object"&&!Array.isArray(gs.driverRelationships)
    ?gs.driverRelationships
    :{version:2,relations:{},log:[]};
  const relations=container?.relations&&typeof container.relations==="object"&&!Array.isArray(container.relations)
    ?{...container.relations}
    :{};
  const key=relationshipEventKey(did,type,tid);
  const before=relations[key]||baseRecord({driverId:did,targetType:type,targetId:tid,teamId,dateISO,active});
  const safePatch=patch&&typeof patch==="object"&&!Array.isArray(patch)?patch:{};
  const next={
    ...before,
    ...safePatch,
    team_id:teamId?text(teamId):before?.team_id??null,
    active:active===undefined?before?.active!==false:Boolean(active),
    source,
    updated_at:dateISO,
  };
  const changes=[];

  for(const field of [...SCORE_FIELDS,"rivalry"]){
    if(deltas?.[field]===undefined||deltas?.[field]===null)continue;
    const delta=Number(deltas[field]);
    if(!Number.isFinite(delta)||Math.abs(delta)<0.0001)continue;
    const prior=Number.isFinite(Number(before?.[field]))?Number(before[field]):(field==="rivalry"?0:50);
    const after=clamp100(prior+delta);
    next[field]=Number(after.toFixed(2));
    changes.push({field,delta:Number((after-prior).toFixed(2)),before:prior,after:Number(after.toFixed(2))});
  }

  const patchChanged=Object.keys(safePatch).some((field)=>before?.[field]!==safePatch[field]);
  const activeChanged=Boolean(before?.active)!==Boolean(next?.active);
  if(!changes.length&&!patchChanged&&!activeChanged&&relations[key])return gs;
  next.score=scoreOf(next);
  next.status=relationshipStatus(next.score);
  next.rivalry_status=relationshipRivalryBand(next.rivalry);
  relations[key]=next;

  const priorLog=Array.isArray(container?.log)?container.log:[];
  const logEntry={
    id:[
      "rel",
      dateISO||"date",
      did,
      type,
      tid,
      source,
      priorLog.length+1,
    ].join(":"),
    dateISO,
    driver_id:did,
    target_type:type,
    target_id:tid,
    team_id:next.team_id,
    source,
    reason,
    changes,
    meta:meta&&typeof meta==="object"?{...meta}:null,
  };
  const log=[logEntry,...priorLog].slice(0,400);

  return {
    ...gs,
    driverRelationships:{
      ...container,
      version:Math.max(2,Number(container?.version)||0),
      relations,
      log,
    },
  };
}

export function applyTeammateRelationshipPair(gs,{
  driverA,
  driverB,
  teamId=null,
  deltasA={},
  deltasB={},
  source="teammate_dynamics",
  reason="Teammate dynamic",
  meta=null,
}={}){
  if(!driverA||!driverB||String(driverA)===String(driverB))return gs;
  let next=applyDriverRelationshipChange(gs,{
    driverId:driverA,targetType:"teammate",targetId:driverB,teamId,
    deltas:deltasA,source,reason,meta,active:true,
  });
  next=applyDriverRelationshipChange(next,{
    driverId:driverB,targetType:"teammate",targetId:driverA,teamId,
    deltas:deltasB,source,reason,meta,active:true,
  });
  return next;
}

export function synchronizeTeamTeammateRelationships(gs,{teamId,driverIds=[]}={}){
  if(!gs||typeof gs!=="object")return gs;
  const tid=text(teamId);
  const ids=[...new Set((driverIds||[]).map(text).filter(Boolean))];
  if(!tid)return gs;

  const container=gs?.driverRelationships&&typeof gs.driverRelationships==="object"&&!Array.isArray(gs.driverRelationships)
    ?gs.driverRelationships
    :{version:2,relations:{},log:[]};
  const relations=container?.relations&&typeof container.relations==="object"&&!Array.isArray(container.relations)
    ?{...container.relations}
    :{};
  const current=new Set(ids);
  let changed=false;

  for(const [key,record] of Object.entries(relations)){
    if(record?.target_type!=="teammate"||text(record?.team_id)!==tid)continue;
    const shouldBeActive=current.has(text(record?.driver_id))&&current.has(text(record?.target_id));
    if(Boolean(record?.active)!==shouldBeActive){
      relations[key]={...record,active:shouldBeActive};
      changed=true;
    }
  }

  const dateISO=text(gs?.currentDateISO).slice(0,10)||null;
  for(const driverId of ids){
    for(const teammateId of ids){
      if(driverId===teammateId)continue;
      const key=relationshipEventKey(driverId,"teammate",teammateId);
      if(relations[key]){
        if(relations[key].active!==true){
          relations[key]={...relations[key],active:true,team_id:tid};
          changed=true;
        }
        continue;
      }
      relations[key]=baseRecord({
        driverId,targetType:"teammate",targetId:teammateId,teamId:tid,dateISO,active:true,
      });
      relations[key].source="lineup_sync";
      changed=true;
    }
  }

  if(!changed)return gs;
  return {
    ...gs,
    driverRelationships:{
      ...container,
      version:Math.max(2,Number(container?.version)||0),
      relations,
      log:Array.isArray(container?.log)?container.log:[],
    },
  };
}
