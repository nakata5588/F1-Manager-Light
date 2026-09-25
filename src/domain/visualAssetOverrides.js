// src/domain/visualAssetOverrides.js
// Save World overrides for driver portraits, staff portraits and team logos.

const TYPE_BUCKETS=Object.freeze({
  driver:"drivers",
  drivers:"drivers",
  staff:"staff",
  team:"teams",
  teams:"teams",
  logo:"teams",
  logos:"teams",
});

export function visualAssetBucket(type){
  return TYPE_BUCKETS[String(type??"").toLowerCase()]||String(type??"").toLowerCase();
}

function normalizedKey(value){
  return String(value??"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"");
}

export function visualAssetOverrideSet(overrides,type,entityId){
  const bucket=overrides?.[visualAssetBucket(type)]||{};
  const raw=String(entityId??"").trim();
  if(!raw)return null;
  return bucket[raw]||bucket[raw.toLowerCase()]||bucket[normalizedKey(raw)]||null;
}

export function withVisualAssetOverride(overrides,input={}){
  const type=visualAssetBucket(input.type);
  const entityId=String(input.entityId??"").trim();
  const year=Number(input.year);
  const path=String(input.path??input.dataUrl??"").trim();
  if(!type||!entityId||!Number.isInteger(year)||!path)return overrides||{};

  const root=overrides&&typeof overrides==="object"?overrides:{};
  const bucket=root[type]&&typeof root[type]==="object"?root[type]:{};
  const previous=bucket[entityId]&&typeof bucket[entityId]==="object"
    ?bucket[entityId]
    :{default:"",history:[]};
  const history=(Array.isArray(previous.history)?previous.history:[])
    .filter((row)=>Number(row?.year)!==year)
    .concat([{year,path}])
    .sort((a,b)=>Number(a.year)-Number(b.year));

  return {
    ...root,
    [type]:{
      ...bucket,
      [entityId]:{
        ...previous,
        history,
      },
    },
  };
}

export function withoutVisualAssetOverride(overrides,input={}){
  const type=visualAssetBucket(input.type);
  const entityId=String(input.entityId??"").trim();
  const year=Number(input.year);
  if(!type||!entityId||!Number.isInteger(year))return overrides||{};

  const root=overrides&&typeof overrides==="object"?overrides:{};
  const bucket=root[type]&&typeof root[type]==="object"?root[type]:{};
  const previous=bucket[entityId];
  if(!previous)return root;

  const history=(Array.isArray(previous.history)?previous.history:[])
    .filter((row)=>Number(row?.year)!==year);
  const nextBucket={...bucket};
  if(!history.length&&!previous.default){
    delete nextBucket[entityId];
  }else{
    nextBucket[entityId]={...previous,history};
  }

  return {
    ...root,
    [type]:nextBucket,
  };
}
