// src/domain/driverEligibility.js
// Career-time driver eligibility. Historical debut dates describe what happened
// in reality; once a career begins they must not hard-lock an alternate future.

const num=(value,fallback=NaN)=>{
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
};

function yearFromDate(value){
  const match=String(value||"").match(/^(\d{4})/);
  return match?Number(match[1]):NaN;
}

export function driverAgeForYear(driver,year){
  const born=yearFromDate(driver?.dob??driver?.birthdate??driver?.date_of_birth);
  if(Number.isFinite(born))return Math.max(0,Number(year)-born);
  return Number.isFinite(Number(driver?.age))?Number(driver.age):null;
}

export function minimumF1ContractAge(gs,year=gs?.activeYear){
  // Data-driven hook for later eras. No dedicated field exists in the current
  // DB yet, so 18 is the conservative default.
  const rows=Array.isArray(gs?.dbContractRules)?gs.dbContractRules:[];
  const y=Number(year);
  const rule=rows.find((row)=>{
    const from=num(row?.year_from,-Infinity);
    const to=num(row?.year_to,Infinity);
    return y>=from&&y<=to;
  });
  const explicit=num(rule?.min_driver_age,NaN);
  return Number.isFinite(explicit)?explicit:18;
}

export function f1HireEligibility(gs,driver,year=gs?.activeYear){
  if(!driver)return {eligible:false,reason:"missing_driver",age:null,minAge:minimumF1ContractAge(gs,year)};
  const status=String(driver?.status||"").toLowerCase();
  const age=driverAgeForYear(driver,year);
  const minAge=minimumF1ContractAge(gs,year);

  if(["deceased","retired","hidden"].includes(status)){
    return {eligible:false,reason:status,age,minAge};
  }

  const lowerSeriesLike=["lower_series","junior_only"].includes(status)||driver?.active_lower_series===true;
  if(lowerSeriesLike&&!Number.isFinite(age)){
    return {eligible:false,reason:"age_unknown",age,minAge};
  }
  if(Number.isFinite(age)&&age<minAge){
    return {eligible:false,reason:"too_young",age,minAge};
  }

  // Once a driver is visible in the career world (eligible/lower-series/youth),
  // age is the gating rule. Historical F1 debut is calibration, not destiny.
  const visible=["eligible","lower_series","junior_only"].includes(status)
    || driver?.active_lower_series===true
    || driver?.canHireF1===true;

  if(!visible){
    return {eligible:false,reason:"not_visible",age,minAge};
  }

  return {
    eligible:true,
    reason:status==="eligible"?"f1_ready":"alternate_history_opportunity",
    age,
    minAge,
  };
}

export function normalizeCareerMarketStatus(gs,driver,year=gs?.activeYear){
  const eligibility=f1HireEligibility(gs,driver,year);
  const age=eligibility.age;
  const youthMax=19;

  if(["deceased","retired","hidden"].includes(String(driver?.status||"").toLowerCase())){
    return {...driver,canHireF1:false};
  }

  if(driver?.active_lower_series){
    const youth=Number.isFinite(age)&&age<=youthMax;
    return {
      ...driver,
      status:youth?"junior_only":"lower_series",
      youth_eligible:youth,
      canHireAcademy:youth,
      canHireF1:eligibility.eligible,
    };
  }

  return {
    ...driver,
    canHireF1:eligibility.eligible,
  };
}
