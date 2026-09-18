// src/domain/contractEngine.js
//
// Pure driver employment/negotiation rules shared by UI, player actions and AI.

const unwrap=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??null):v;
const pick=(o,keys,fb=undefined)=>{
  for(const k of keys){
    const v=unwrap(o?.[k]);
    if(v!==undefined&&v!==null&&v!=="")return v;
  }
  return fb;
};
const num=(v,fb=NaN)=>{const n=Number(unwrap(v));return Number.isFinite(n)?n:fb;};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
const roundMoney=(v,step=5000)=>Math.max(0,Math.round(Number(v||0)/step)*step);

export const driverIdOf=(o)=>String(pick(o,["driver_id","person_id","id"],""));
export const teamIdOf=(o)=>String(pick(o,["team_id","constructor_id","team","constructor"],""));

export function isDriverContract(row){
  const role=String(pick(row,["role","position","contract_role","type"],"driver")).toLowerCase();
  return !role || /driver|main|second|reserve|test/.test(role);
}
export function activeDriverContracts(gs,{teamId=null,year=null}={}){
  const y=Number(year??gs?.activeYear);
  return (gs?.contracts||[]).filter((c)=>{
    if(!isDriverContract(c))return false;
    if(teamId!=null&&teamIdOf(c)!==String(teamId))return false;
    const status=String(c?.status||"active").toLowerCase();
    if(["terminated","expired","rejected"].includes(status))return false;
    const start=num(pick(c,["contract_start_year","start_year","year"],y),y);
    const end=num(pick(c,["contract_until_year","end_year","year"],y),y);
    return start<=y&&end>=y;
  });
}
export function driverContract(gs,driverId){
  const id=String(driverId);
  return activeDriverContracts(gs).find((c)=>driverIdOf(c)===id)||null;
}
export function teamDriverContracts(gs,teamId){
  return activeDriverContracts(gs,{teamId});
}

export function contractRuleForYear(gs,yearInput=gs?.activeYear){
  const year=Number(yearInput);
  const rules=gs?.dbContractRules||gs?.contractRules||[];
  const exact=(rules||[]).find((r)=>{
    const from=num(pick(r,["year_from","from","start_year"],NaN),NaN);
    const to=num(pick(r,["year_to","to","end_year"],Infinity),Infinity);
    return Number.isFinite(from)&&year>=from&&year<=to;
  });
  if(exact)return exact;
  const previous=(rules||[])
    .filter((r)=>num(pick(r,["year_from","from","start_year"],NaN),NaN)<=year)
    .sort((a,b)=>num(pick(b,["year_from","from","start_year"],0),0)-num(pick(a,["year_from","from","start_year"],0),0))[0];
  return previous||{
    min_length_y:1,max_length_y:3,max_drivers_contracts:3,buyout_allowed:"TRUE",
    clauses:{buyout_fee_min:50_000,buyout_fee_max:2_000_000},
  };
}
function booleanish(v,fb=false){
  if(v===true||v===1)return true;
  if(v===false||v===0)return false;
  const s=String(v??"").toLowerCase();
  if(["true","yes","1","y"].includes(s))return true;
  if(["false","no","0","n"].includes(s))return false;
  return fb;
}
export function ruleLimits(gs,year=gs?.activeYear){
  const rule=contractRuleForYear(gs,year);
  let clauses=rule?.clauses||{};
  if(typeof clauses==="string"){try{clauses=JSON.parse(clauses);}catch{clauses={};}}
  return {
    minYears:Math.max(1,num(pick(rule,["min_length_y"],1),1)),
    maxYears:Math.max(1,num(pick(rule,["max_length_y"],3),3)),
    maxDriverContracts:Math.max(2,num(pick(rule,["max_drivers_contracts"],3),3)),
    buyoutAllowed:booleanish(pick(rule,["buyout_allowed"],true),true),
    buyoutMin:Math.max(0,num(clauses?.buyout_fee_min,50_000)),
    buyoutMax:Math.max(0,num(clauses?.buyout_fee_max,2_000_000)),
    options:Array.isArray(rule?.options_allowed)
      ? rule.options_allowed
      : String(rule?.options_allowed_csv||"").split(",").map(s=>s.trim()).filter(Boolean),
  };
}

function ratingFor(gs,driverId){
  return (gs?.driverRatings||[]).find((r)=>driverIdOf(r)===String(driverId))||{};
}
function driverFor(gs,driverId){
  return (gs?.drivers||[]).find((d)=>driverIdOf(d)===String(driverId))||{};
}
function teamFor(gs,teamId){
  return (gs?.teams||[]).find((t)=>teamIdOf(t)===String(teamId))||{};
}
function standingsTeamPosition(gs,teamId){
  const row=(gs?.standings?.teams||[]).find((t)=>teamIdOf(t)===String(teamId));
  return num(row?.position,NaN);
}
function teamAttractiveness(gs,teamId){
  const teams=Math.max(1,(gs?.teams||[]).length);
  const pos=standingsTeamPosition(gs,teamId);
  const performance=Number.isFinite(pos)?100-(pos-1)*(60/Math.max(1,teams-1)):55;
  const brand=(gs?.teamBrands||[]).find((b)=>teamIdOf(b)===String(teamId))||{};
  const rep=num(pick(brand,["reputation","prestige"],NaN),NaN);
  return clamp(Number.isFinite(rep)?performance*0.55+rep*0.45:performance,20,100);
}

export function driverContractDemand(gs,driverId,{teamId=null,role="Second Driver"}={}){
  const id=String(driverId);
  const rating=ratingFor(gs,id);
  const existing=driverContract(gs,id);
  const ability=num(pick(rating,["current_ability","overall","pace"],60),60);
  const potential=num(pick(rating,["potential_ability"],ability),ability);
  const reputation=num(pick(rating,["reputation"],ability),ability);
  const marketValue=num(pick(rating,["market_value"],NaN),NaN);
  const existingSalary=num(pick(existing||{},["salary","salary_yearly"],NaN),NaN);

  let salary;
  if(Number.isFinite(existingSalary)&&existingSalary>0){
    const age=Number(driverFor(gs,id)?.age);
    const growthPremium=potential>ability+8&&(!Number.isFinite(age)||age<27)?1.08:1;
    salary=existingSalary*growthPremium;
  }else if(Number.isFinite(marketValue)&&marketValue>0){
    salary=Math.max(75_000,marketValue*0.28);
  }else{
    salary=Math.max(60_000,45_000+(ability-45)*22_000+(reputation-50)*5_000);
  }

  const roleLower=String(role||"").toLowerCase();
  if(/main|lead|first/.test(roleLower))salary*=0.96;
  if(/reserve|test/.test(roleLower))salary*=0.68;
  if(teamId){
    const attractiveness=teamAttractiveness(gs,teamId);
    salary*=1+(65-attractiveness)*0.0035;
  }

  salary=roundMoney(Math.max(50_000,salary));
  return {
    salary,
    signingBonus:roundMoney(salary*0.14),
    bonusWin:roundMoney(Math.max(5_000,salary*0.055),1000),
    bonusPodium:roundMoney(Math.max(2_500,salary*0.0275),1000),
    bonusChampionship:roundMoney(Math.max(20_000,salary*0.22),5000),
    ability,potential,reputation,
  };
}

export function calculateBuyout(gs,driverId){
  const contract=driverContract(gs,driverId);
  if(!contract)return 0;
  const currentTeam=teamIdOf(contract);
  const userTeam=String(gs?.team?.team_id??gs?.team?.id??"");
  if(!currentTeam||currentTeam===userTeam)return 0;
  const limits=ruleLimits(gs);
  if(!limits.buyoutAllowed)return Infinity;
  const year=Number(gs?.activeYear);
  const until=num(pick(contract,["contract_until_year","end_year","year"],year),year);
  const remaining=Math.max(1,until-year+1);
  const salary=num(pick(contract,["salary","salary_yearly"],0),0);
  const rating=ratingFor(gs,driverId);
  const mv=num(pick(rating,["market_value"],0),0);
  const explicit=num(pick(contract,["buyout_fee","release_clause"],NaN),NaN);
  if(Number.isFinite(explicit))return roundMoney(explicit);
  const raw=Math.max(limits.buyoutMin,salary*0.45*remaining,mv*0.10);
  return roundMoney(clamp(raw,limits.buyoutMin,Math.max(limits.buyoutMin,limits.buyoutMax)));
}

function roleScore(role,currentContract){
  const r=String(role||"").toLowerCase();
  const current=String(pick(currentContract||{},["role","position"],"")).toLowerCase();
  if(/main/.test(r))return 1.08;
  if(/second/.test(r))return /main/.test(current)?0.82:1;
  if(/reserve|test/.test(r))return /main|second/.test(current)?0.58:0.90;
  return 0.95;
}
export function evaluateDriverOffer(gs,driverId,offer){
  const id=String(driverId);
  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const current=driverContract(gs,id);
  const demand=driverContractDemand(gs,id,{teamId:userTeamId,role:offer?.role});
  const limits=ruleLimits(gs);
  const years=clamp(Math.round(num(offer?.years,limits.minYears)),limits.minYears,limits.maxYears);
  const salary=Math.max(0,num(offer?.salary,0));
  const signing=Math.max(0,num(offer?.signingBonus,0));
  const win=Math.max(0,num(offer?.bonusWin,0));
  const podium=Math.max(0,num(offer?.bonusPodium,0));
  const title=Math.max(0,num(offer?.bonusChampionship,0));

  const salaryRatio=salary/Math.max(1,demand.salary);
  const signingRatio=signing/Math.max(1,demand.signingBonus);
  const bonusRatio=(
    win/Math.max(1,demand.bonusWin)+
    podium/Math.max(1,demand.bonusPodium)+
    title/Math.max(1,demand.bonusChampionship)
  )/3;

  let score=0.54;
  score+=(salaryRatio-1)*0.55;
  score+=(signingRatio-1)*0.12;
  score+=(bonusRatio-1)*0.08;
  score+=(roleScore(offer?.role,current)-1)*0.35;
  score+=(years-2)*0.025;

  const attraction=teamAttractiveness(gs,userTeamId);
  score+=(attraction-60)*0.0035;

  const own=current&&teamIdOf(current)===userTeamId;
  if(own)score+=0.08;
  else if(current)score-=0.04;

  const chance=clamp(score,0.03,0.97);
  const counter={
    salary:roundMoney(Math.max(salary,demand.salary*(1.02+Math.max(0,0.70-salaryRatio)*0.18))),
    signingBonus:roundMoney(Math.max(signing,demand.signingBonus)),
    bonusWin:roundMoney(Math.max(win,demand.bonusWin),1000),
    bonusPodium:roundMoney(Math.max(podium,demand.bonusPodium),1000),
    bonusChampionship:roundMoney(Math.max(title,demand.bonusChampionship),5000),
    years,
    role:offer?.role||"Second Driver",
  };
  return {chance,demand,counter,limits,buyout:calculateBuyout(gs,id)};
}

export function makeDriverContract(gs,driverId,offer,{source="player_negotiation"}={}){
  const driver=driverFor(gs,driverId);
  const teamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const team=teamFor(gs,teamId);
  const year=Number(gs?.activeYear);
  const years=Math.max(1,Math.round(num(offer?.years,1)));
  return {
    year,
    season_year:year,
    team_id:teamId,
    team_name:team?.team_name||team?.name||teamId,
    driver_id:String(driverId),
    driver_name:driver?.display_name||driver?.name||String(driverId),
    role:String(offer?.role||"Second Driver"),
    salary:roundMoney(offer?.salary),
    signing_bonus:roundMoney(offer?.signingBonus),
    bonus_win:roundMoney(offer?.bonusWin,1000),
    bonus_podium:roundMoney(offer?.bonusPodium,1000),
    bonus_championship:roundMoney(offer?.bonusChampionship,5000),
    contract_start_year:year,
    contract_until_year:year+years-1,
    contract_end_sort:`${year+years-1}-12-31`,
    status:"active",
    source,
  };
}

export function contractTerminationCost(gs,driverId){
  const c=driverContract(gs,driverId);
  if(!c)return 0;
  const year=Number(gs?.activeYear);
  const end=num(pick(c,["contract_until_year","end_year","year"],year),year);
  const remaining=Math.max(1,end-year+1);
  const salary=num(pick(c,["salary","salary_yearly"],0),0);
  return roundMoney(Math.max(0,salary*0.25*remaining));
}

function stableHash(text){
  let h=2166136261;
  for(const ch of String(text||"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return Math.abs(h>>>0);
}
export function deterministicOfferAccepted(gs,driverId,offer,round=1){
  const evaluation=evaluateDriverOffer(gs,driverId,offer);
  const date=String(gs?.currentDateISO||"");
  const roll=(stableHash(`${date}:${driverId}:${round}:${JSON.stringify(offer)}`)%10000)/10000;
  return {...evaluation,roll,accepted:roll<evaluation.chance};
}

function availableDrivers(gs,excluded=new Set()){
  return (gs?.drivers||[])
    .filter((d)=>{
      const id=driverIdOf(d);
      if(!id||excluded.has(id))return false;
      const st=String(d?.status||"eligible").toLowerCase();
      return !["hidden","deceased","retired","junior_only"].includes(st);
    })
    .map((d)=>{
      const r=ratingFor(gs,driverIdOf(d));
      return {d,r,score:num(r.current_ability,55)*0.70+num(r.potential_ability,num(r.current_ability,55))*0.20+num(r.reputation,50)*0.10};
    })
    .sort((a,b)=>b.score-a.score||driverIdOf(a.d).localeCompare(driverIdOf(b.d)));
}
function aiOfferFor(gs,driverId,teamId,role){
  const demand=driverContractDemand(gs,driverId,{teamId,role});
  const limits=ruleLimits(gs);
  return {
    role,
    years:Math.min(limits.maxYears,Math.max(limits.minYears,2)),
    salary:roundMoney(demand.salary*0.98),
    signingBonus:roundMoney(demand.signingBonus),
    bonusWin:demand.bonusWin,
    bonusPodium:demand.bonusPodium,
    bonusChampionship:demand.bonusChampionship,
  };
}
function aiContract(gs,driverId,teamId,role){
  const driver=driverFor(gs,driverId);
  const team=teamFor(gs,teamId);
  const year=Number(gs?.activeYear);
  const offer=aiOfferFor(gs,driverId,teamId,role);
  return {
    year,season_year:year,team_id:String(teamId),team_name:team?.team_name||team?.name||String(teamId),
    driver_id:String(driverId),driver_name:driver?.display_name||driver?.name||String(driverId),
    role, salary:offer.salary, signing_bonus:offer.signingBonus, bonus_win:offer.bonusWin,
    bonus_podium:offer.bonusPodium, bonus_championship:offer.bonusChampionship,
    contract_start_year:year,contract_until_year:year+offer.years-1,
    contract_end_sort:`${year+offer.years-1}-12-31`,status:"active",source:"ai_market",
  };
}

export function ensureAIDriverLineups(gs,{minimumRaceDrivers=2}={}){
  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  let contracts=[...(gs?.contracts||[])];
  const assigned=new Set(activeDriverContracts({...gs,contracts}).map(driverIdOf).filter(Boolean));
  const signings=[];

  for(const team of gs?.teams||[]){
    const tid=teamIdOf(team);
    if(!tid||tid===userTeamId)continue;
    let active=activeDriverContracts({...gs,contracts},{teamId:tid});
    while(active.filter(c=>!/reserve|test/i.test(String(c.role||""))).length<minimumRaceDrivers){
      const pool=availableDrivers({...gs,contracts},assigned);
      const target=pool[0]?.d;
      if(!target)break;
      const role=active.filter(c=>!/reserve|test/i.test(String(c.role||""))).length===0?"Main Driver":"Second Driver";
      const c=aiContract({...gs,contracts},driverIdOf(target),tid,role);
      contracts.push(c);
      assigned.add(driverIdOf(target));
      signings.push(c);
      active=activeDriverContracts({...gs,contracts},{teamId:tid});
    }
  }
  return {contracts,signings};
}
