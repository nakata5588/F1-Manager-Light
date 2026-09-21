// src/domain/contractRoles.js
// Canonical contract-role classification shared by season materialization,
// market logic and race-entry systems.

const unwrap=(v)=>{
  if(v&&typeof v==="object"&&!Array.isArray(v)){
    if(v.result!==undefined&&v.result!==null&&v.result!=="")return unwrap(v.result);
    if(v.value!==undefined&&v.value!==null&&v.value!=="")return unwrap(v.value);
  }
  return v;
};

function roleValue(contract){
  if(typeof contract==="string")return contract;
  for(const key of ["role","position","contract_role","type"]){
    const v=unwrap(contract?.[key]);
    if(v!==undefined&&v!==null&&v!=="")return v;
  }
  return "driver";
}

export function normalizedContractRole(contract){
  return String(roleValue(contract)||"driver")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g,"_");
}

export function isTestDriverContract(contract){
  const role=normalizedContractRole(contract);
  return /(^|_)(test|tester)(_|$)/.test(role);
}

export function isReserveDriverContract(contract){
  const role=normalizedContractRole(contract);
  return /(^|_)(reserve|reserva)(_|$)/.test(role);
}

export function isNonRaceDriverContract(contract){
  return isReserveDriverContract(contract)||isTestDriverContract(contract);
}

export function isDriverContract(contract){
  const role=normalizedContractRole(contract);
  return /driver|main|second|race|lead|first|test|tester|reserve|reserva/.test(role);
}

export function isRaceDriverContract(contract){
  if(!isDriverContract(contract)||isNonRaceDriverContract(contract))return false;
  const role=normalizedContractRole(contract);
  return /driver|main|second|race|lead|first/.test(role);
}

export function contractRoleLabel(contract){
  const role=normalizedContractRole(contract);
  if(/(^|_)(reserve|reserva)(_|$)/.test(role))return "Reserve Driver";
  if(/(^|_)(test|tester)(_|$)/.test(role))return "Test Driver";
  if(/second|driver_?2/.test(role))return "Second Driver";
  if(/main|first|lead|driver_?1/.test(role))return "Main Driver";
  if(isRaceDriverContract(contract))return "Race Driver";
  return String(roleValue(contract)||"Driver").replace(/_/g," ").replace(/\b\w/g,(m)=>m.toUpperCase());
}
