// src/domain/partUnits.js
// Physical part-unit model.
// development.parts stores reusable designs/specifications.
// development.partUnits stores manufactured physical copies with independent wear.
// garage.cars[*].installedParts stores physical unit ids (legacy saves may still
// store design ids and are migrated deterministically).

const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));
const str=(v)=>String(v??"");

function safeId(value){
  return str(value).replace(/[^a-zA-Z0-9_-]+/g,"_");
}

export function partDesignIdOfUnit(unit){
  return str(unit?.design_id??unit?.part_id??"");
}

export function partUnits(gs){
  return Array.isArray(gs?.development?.partUnits)?gs.development.partUnits:[];
}

export function partUnitById(gs,unitId){
  const id=str(unitId);
  if(!id)return null;
  return partUnits(gs).find((unit)=>str(unit?.id)===id)||null;
}

export function partDesignById(gs,designId){
  const id=str(designId);
  if(!id)return null;
  return (gs?.development?.parts||[]).find((part)=>str(part?.id)===id)||null;
}

export function designForUnit(gs,unitOrId){
  const unit=typeof unitOrId==="object"&&unitOrId
    ?unitOrId
    :partUnitById(gs,unitOrId);
  return unit?partDesignById(gs,partDesignIdOfUnit(unit)):null;
}

export function installedPartUnitIds(gs){
  const ids=new Set();
  for(const car of gs?.garage?.cars||[]){
    for(const ref of Object.values(car?.installedParts||{})){
      if(ref!=null&&ref!=="")ids.add(str(ref));
    }
  }
  return ids;
}

export function partUnitsForDesign(gs,designId){
  const id=str(designId);
  return partUnits(gs).filter((unit)=>partDesignIdOfUnit(unit)===id);
}

export function warehousePartUnitsForDesign(gs,designId){
  const installed=installedPartUnitIds(gs);
  const workshopUnits=new Set(
    (gs?.garage?.serviceJobs||[])
      .filter((job)=>job?.status==="active"&&job?.unit_id)
      .map((job)=>str(job.unit_id))
  );
  return partUnitsForDesign(gs,designId)
    .filter((unit)=>!installed.has(str(unit?.id))&&!workshopUnits.has(str(unit?.id)))
    .slice()
    .sort((a,b)=>
      Number(b?.condition??100)-Number(a?.condition??100) ||
      str(a?.id).localeCompare(str(b?.id))
    );
}

export function inventoryCountForDesign(gs,designId){
  return warehousePartUnitsForDesign(gs,designId).length;
}

export function physicalUnitLocation(gs,unitId){
  const id=str(unitId);
  for(const car of gs?.garage?.cars||[]){
    for(const [slot,ref] of Object.entries(car?.installedParts||{})){
      if(str(ref)===id)return {kind:"car",car_id:car?.id||null,car_label:car?.label||car?.id||"Car",slot};
    }
  }
  return {kind:"warehouse",car_id:null,car_label:"Warehouse",slot:null};
}

function legacyUnitId(designId,kind,suffix){
  return `unit_${safeId(designId)}_legacy_${safeId(kind)}_${safeId(suffix)}`;
}

function uniqueUnitId(base,used){
  let id=base;
  let index=2;
  while(used.has(id)){
    id=`${base}_${index}`;
    index+=1;
  }
  used.add(id);
  return id;
}

function normalizeUnit(unit){
  return {
    ...unit,
    id:str(unit?.id),
    design_id:partDesignIdOfUnit(unit),
    slot:str(unit?.slot||""),
    condition:Number(clamp(unit?.condition??100).toFixed(1)),
  };
}

function deriveDesignInventories(parts,units,cars){
  const installed=new Set();
  for(const car of cars||[]){
    for(const ref of Object.values(car?.installedParts||{})){
      if(ref!=null&&ref!=="")installed.add(str(ref));
    }
  }
  const counts=new Map();
  for(const unit of units){
    if(installed.has(str(unit?.id)))continue;
    const did=partDesignIdOfUnit(unit);
    counts.set(did,(counts.get(did)||0)+1);
  }
  return (parts||[]).map((part)=>({
    ...part,
    inv:Number(counts.get(str(part?.id))||0),
  }));
}

export function normalizePhysicalPartState(input){
  if(!input||typeof input!=="object")return input;
  const dev=input.development||{};
  const designs=Array.isArray(dev.parts)?dev.parts:[];
  const cars=Array.isArray(input?.garage?.cars)?input.garage.cars:[];
  const hasLegacyRefs=cars.some((car)=>Object.values(car?.installedParts||{}).some((ref)=>
    designs.some((part)=>str(part?.id)===str(ref))
  ));
  const hasPartUnitsField=Array.isArray(dev.partUnits);
  const hasAnyPhysicalData=hasPartUnitsField||designs.length||hasLegacyRefs;
  if(!hasAnyPhysicalData)return input;

  const units=(hasPartUnitsField?dev.partUnits:[]).map(normalizeUnit).filter((unit)=>unit.id&&unit.design_id);
  const byId=new Map(units.map((unit)=>[str(unit.id),unit]));
  const used=new Set(byId.keys());
  const designById=new Map(designs.map((part)=>[str(part?.id),part]));
  const nextCars=cars.map((car)=>({
    ...car,
    installedParts:{...(car?.installedParts||{})},
  }));

  // Convert legacy car mappings that point to a design id into stable unit ids.
  for(const car of nextCars){
    for(const [slot,rawRef] of Object.entries(car?.installedParts||{})){
      const ref=str(rawRef);
      if(!ref)continue;
      if(byId.has(ref))continue;
      const design=designById.get(ref);
      if(!design)continue;
      const base=legacyUnitId(design.id,car?.id||"car",slot);
      const id=uniqueUnitId(base,used);
      const unit=normalizeUnit({
        id,
        design_id:design.id,
        slot:design.slot||slot,
        condition:design.condition??100,
        manufactured_at:null,
        source:"legacy_installed_design",
      });
      units.push(unit);
      byId.set(id,unit);
      car.installedParts[slot]=id;
    }
  }

  // Only old saves without a partUnits array use design.inv as physical stock.
  // Once the field exists, inventory is derived exclusively from physical units.
  if(!hasPartUnitsField){
    for(const design of designs){
      const count=Math.max(0,Math.floor(Number(design?.inv||0)));
      for(let i=0;i<count;i+=1){
        const base=legacyUnitId(design.id,"stock",String(i+1).padStart(2,"0"));
        const id=uniqueUnitId(base,used);
        const unit=normalizeUnit({
          id,
          design_id:design.id,
          slot:design.slot||"",
          condition:design.condition??100,
          manufactured_at:null,
          source:"legacy_inventory",
        });
        units.push(unit);
        byId.set(id,unit);
      }
    }
  }

  const nextParts=deriveDesignInventories(designs,units,nextCars);
  return {
    ...input,
    garage:input.garage?{...input.garage,cars:nextCars}:input.garage,
    development:{
      ...dev,
      parts:nextParts,
      partUnits:units,
    },
  };
}

export function createManufacturedPartUnits(gs,{designId,qty=1,batchId=null,manufacturedAt=null}={}){
  const normalized=normalizePhysicalPartState(gs);
  const design=partDesignById(normalized,designId);
  if(!design)return normalized;

  const existing=partUnits(normalized).map((unit)=>({...unit}));
  const used=new Set(existing.map((unit)=>str(unit?.id)));
  const requested=Math.max(0,Math.floor(Number(qty||0)));
  const existingFromBatch=batchId
    ?existing.filter((unit)=>partDesignIdOfUnit(unit)===str(design.id)&&str(unit?.batch_id)===str(batchId)).length
    :0;
  const count=Math.max(0,requested-existingFromBatch);
  const prefix=`unit_${safeId(design.id)}_${safeId(batchId||"batch")}`;
  for(let i=0;i<count;i+=1){
    const ordinal=existingFromBatch+i+1;
    const id=uniqueUnitId(`${prefix}_${String(ordinal).padStart(2,"0")}`,used);
    existing.push({
      id,
      design_id:design.id,
      slot:design.slot||"",
      condition:100,
      manufactured_at:manufacturedAt||null,
      source:"manufactured",
      batch_id:batchId||null,
    });
  }

  const next={
    ...normalized,
    development:{
      ...(normalized.development||{}),
      partUnits:existing,
    },
  };
  return normalizePhysicalPartState(next);
}

export function fitPhysicalPartUnit(gs,{carId,slot,designId,unitId=null}={}){
  const normalized=normalizePhysicalPartState(gs);
  const car=(normalized?.garage?.cars||[]).find((row)=>str(row?.id)===str(carId));
  if(!car)return normalized;

  let unit=unitId?partUnitById(normalized,unitId):null;
  if(!unit&&designId)unit=warehousePartUnitsForDesign(normalized,designId)[0]||null;
  if(!unit)return normalized;
  if(str(unit?.slot)!==str(slot))return normalized;

  // A unit can only be fitted to one car at a time.
  const location=physicalUnitLocation(normalized,unit.id);
  if(location.kind==="car"&&str(location.car_id)!==str(carId))return normalized;

  const cars=(normalized.garage?.cars||[]).map((row)=>str(row?.id)===str(carId)
    ?{...row,installedParts:{...(row?.installedParts||{}),[slot]:unit.id}}
    :row
  );
  return normalizePhysicalPartState({
    ...normalized,
    garage:{...(normalized.garage||{}),cars},
  });
}

export function removePhysicalPartUnit(gs,{carId,slot}={}){
  const normalized=normalizePhysicalPartState(gs);
  const cars=(normalized.garage?.cars||[]).map((row)=>{
    if(str(row?.id)!==str(carId))return row;
    const installed={...(row?.installedParts||{})};
    delete installed[slot];
    return {...row,installedParts:installed};
  });
  return normalizePhysicalPartState({
    ...normalized,
    garage:{...(normalized.garage||{}),cars},
  });
}

export function updatePhysicalPartUnitCondition(gs,unitId,condition,extra={}){
  const normalized=normalizePhysicalPartState(gs);
  const id=str(unitId);
  const units=partUnits(normalized).map((unit)=>str(unit?.id)===id
    ?{...unit,...extra,condition:Number(clamp(condition).toFixed(1))}
    :unit
  );
  return normalizePhysicalPartState({
    ...normalized,
    development:{...(normalized.development||{}),partUnits:units},
  });
}
