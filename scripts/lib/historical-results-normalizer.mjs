// Shared build-time interpretation of historical Results scalar fields and driver IDs.
// Team/Entrant identity is handled separately by the canonical constructor bridge.
// Keep this module out of race-time code: it belongs to Season Pack preparation.
export function historicalScalar(value){
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    for(const field of ["result","value","text"]){
      if(value[field]!==undefined&&value[field]!==null&&value[field]!=="")
        return historicalScalar(value[field]);
    }
  }
  return value;
}
export function historicalFirst(row,keys,fallback=undefined){
  for(const key of keys){
    const value=historicalScalar(row?.[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fallback;
}
export function historicalText(value){
  return String(historicalScalar(value)??"").trim();
}
export function historicalNameKey(value){
  return historicalText(value).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"");
}
export function historicalResultYear(row){
  return Number(historicalFirst(row,["year","season_year"],NaN));
}
function historicalArchiveId(value){
  const raw=historicalScalar(value);
  return raw==null||raw===""||!Number.isFinite(Number(raw))?null:Number(raw);
}
export function createHistoricalDriverResolver(drivers=[]){
  const known=new Set(),byArchive=new Map(),byName=new Map();
  for(const driver of drivers){
    const did=historicalText(historicalFirst(driver,["driver_id","id"],""));
    if(!did)continue;
    known.add(did);
    const archiveId=historicalArchiveId(historicalFirst(driver,["driverID_arch","driverId_arch","driverId"]));
    if(archiveId!=null)byArchive.set(archiveId,did);
    for(const value of [driver.display_name,driver.driver_name,driver.name,driver.full_name]){
      const key=historicalNameKey(value);
      if(key&&!byName.has(key))byName.set(key,did);
    }
  }
  // Team Seasons keeps unknown direct IDs for its separately marked fallback
  // evidence. Cars deliberately reject any pilot not in the Drivers master.
  return function resolveDriver(row,{allowUnknownDirect=false}={}){
    const direct=historicalText(historicalFirst(row,["driver_id","person_id"],""));
    if(direct&&known.has(direct))return direct;
    const archiveId=historicalArchiveId(historicalFirst(row,["driverId","driverID"]));
    if(archiveId!=null&&byArchive.has(archiveId))return byArchive.get(archiveId);
    const name=historicalFirst(row,["driver_name","display_name","driverName","name"],"");
    return byName.get(historicalNameKey(name))||(allowUnknownDirect?direct:"");
  };
}
