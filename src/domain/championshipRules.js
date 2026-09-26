// src/domain/championshipRules.js
// Canonical Formula 1 championship scoring rules by season.
//
// Historical Database principle:
// - race results remain factual source events;
// - these rules determine which event scores count towards championships;
// - Save World uses the same rules for alternative-history seasons.
//
// Sources/calibration cover the World Championship era from 1950 onward.
// Exceptional sporting sanctions remain result-data concerns rather than generic
// points-system rules.

const freeze=(value)=>Object.freeze(value);
const ALL=freeze({type:"all"});

const driverCountingByYear=(year)=>{
  if(year>=1991)return ALL;
  if(year>=1981)return freeze({type:"best",count:11});
  if(year===1980)return freeze({type:"split",segments:[{from:1,to:7,count:5},{from:8,to:14,count:5}]});
  if(year===1979)return freeze({type:"split",segments:[{from:1,to:7,count:4},{from:8,to:15,count:4}]});
  if(year===1978)return freeze({type:"split",segments:[{from:1,to:8,count:7},{from:9,to:16,count:7}]});
  if(year===1977)return freeze({type:"split",segments:[{from:1,to:9,count:8},{from:10,to:17,count:7}]});
  if(year===1976)return freeze({type:"split",segments:[{from:1,to:8,count:7},{from:9,to:16,count:7}]});
  if(year===1975)return freeze({type:"split",segments:[{from:1,to:7,count:6},{from:8,to:14,count:6}]});
  if(year===1974||year===1973)return freeze({type:"split",segments:[{from:1,to:8,count:7},{from:9,to:15,count:6}]});
  if(year===1972)return freeze({type:"split",segments:[{from:1,to:6,count:5},{from:7,to:12,count:5}]});
  if(year===1971)return freeze({type:"split",segments:[{from:1,to:6,count:5},{from:7,to:11,count:4}]});
  if(year===1970)return freeze({type:"split",segments:[{from:1,to:7,count:6},{from:8,to:13,count:5}]});
  if(year===1969)return freeze({type:"split",segments:[{from:1,to:6,count:5},{from:7,to:11,count:4}]});
  if(year===1968)return freeze({type:"split",segments:[{from:1,to:6,count:5},{from:7,to:12,count:5}]});
  if(year===1967)return freeze({type:"split",segments:[{from:1,to:6,count:5},{from:7,to:11,count:4}]});
  if(year===1966)return freeze({type:"best",count:5});
  if(year>=1963)return freeze({type:"best",count:6});
  if(year>=1961)return freeze({type:"best",count:5});
  if(year===1960)return freeze({type:"best",count:6});
  if(year===1959)return freeze({type:"best",count:5});
  if(year===1958)return freeze({type:"best",count:6});
  if(year>=1954)return freeze({type:"best",count:5});
  if(year>=1950)return freeze({type:"best",count:4});
  return ALL;
};

const constructorCountingByYear=(year)=>{
  if(year<1958)return freeze({type:"none"});
  if(year>=1979)return ALL;
  return driverCountingByYear(year);
};

const racePointsByYear=(year,{constructor=false}={})=>{
  if(year<=1959)return [8,6,4,3,2];
  if(year===1960)return [8,6,4,3,2,1];
  if(year===1961&&constructor)return [8,6,4,3,2,1];
  if(year<=1990)return [9,6,4,3,2,1];
  if(year<=2002)return [10,6,4,3,2,1];
  if(year<=2009)return [10,8,6,5,4,3,2,1];
  return [25,18,15,12,10,8,6,4,2,1];
};

const shortenedRaceRule=(year)=>{
  if(year>=2022){
    return freeze({
      type:"graduated",
      minimumGreenLaps:2,
      bands:[
        {maxFraction:0.25,table:[6,4,3,2,1]},
        {maxFraction:0.50,table:[13,10,8,6,5,4,3,2,1]},
        {maxFraction:0.75,table:[19,14,12,10,8,6,4,3,2,1]},
        {maxFraction:1.01,table:null},
      ],
    });
  }
  if(year>=1980)return freeze({type:"half",minimumLaps:2,fullFromFraction:0.75});
  if(year>=1975)return freeze({type:"half",noneBelowFraction:0.30,fullFromFraction:0.60});
  return freeze({type:"full"});
};

export function championshipRuleForYear(yearInput){
  const year=Number(yearInput);
  if(!Number.isFinite(year))throw new TypeError("Championship year must be numeric.");

  const fastestLap=
    year>=1950&&year<=1959
      ?freeze({points:1,eligibility:"any_classified",constructors:false})
      :year>=2019&&year<=2024
        ?freeze({points:1,eligibility:"top_10",constructors:true})
        :freeze({points:0,eligibility:"none",constructors:false});

  const sprintPoints=
    year===2021?[3,2,1]:
    year>=2022?[8,7,6,5,4,3,2,1]:
    [];

  return freeze({
    year,
    racePoints:freeze(racePointsByYear(year)),
    constructorRacePoints:freeze(racePointsByYear(year,{constructor:true})),
    fastestLap,
    sprintPoints:freeze(sprintPoints),
    driverCounting:driverCountingByYear(year),
    constructorCounting:constructorCountingByYear(year),
    constructorChampionship:year>=1958,
    constructorCarsScoring:year>=1979?"all":"best_one",
    sharedDrivePoints:year<=1957?"split":year>=1958?"none":"not_applicable",
    finalRaceMultiplier:year===2014?2:1,
    shortenedRace:shortenedRaceRule(year),
  });
}

export function championshipPointsSystem(year,seed=null){
  const rule=championshipRuleForYear(year);
  const base=seed&&typeof seed==="object"?seed:{};
  return {
    ...base,
    points_system_id:base.points_system_id||`canonical_${rule.year}`,
    year_from:rule.year,
    year_to:rule.year,
    table:[...rule.racePoints],
    places_csv:rule.racePoints.join(","),
    fastest_lap_bonus:rule.fastestLap.points,
    pole_bonus:0,
    championship_rules:rule,
    source:"canonical_championship_rules",
  };
}

export function pointsForPosition(table,position){
  const pos=Number(position);
  if(!Number.isInteger(pos)||pos<1)return 0;
  return Number((Array.isArray(table)?table:[])[pos-1]||0);
}

export function racePointsForResult({
  year,
  position,
  fastestLap=false,
  classified=true,
  isFinalRound=false,
  constructor=false,
}={}){
  const rule=championshipRuleForYear(year);
  if(!classified)return 0;
  const table=constructor?rule.constructorRacePoints:rule.racePoints;
  let points=pointsForPosition(table,position);

  if(!constructor&&fastestLap&&rule.fastestLap.points>0){
    const eligible=
      rule.fastestLap.eligibility==="any_classified"||
      (rule.fastestLap.eligibility==="top_10"&&Number(position)<=10);
    if(eligible)points+=rule.fastestLap.points;
  }
  if(constructor&&fastestLap&&rule.fastestLap.constructors){
    const eligible=rule.fastestLap.eligibility==="top_10"&&Number(position)<=10;
    if(eligible)points+=rule.fastestLap.points;
  }
  if(isFinalRound&&rule.finalRaceMultiplier!==1)points*=rule.finalRaceMultiplier;
  return Number(points);
}

function eventRound(event,index){
  const round=Number(event?.round);
  return Number.isFinite(round)?round:index+1;
}

function eventPoints(event){
  const value=Number(event?.points);
  return Number.isFinite(value)?value:0;
}

function chooseBest(events,count){
  if(!Number.isFinite(Number(count)))return events.slice();
  return events
    .map((event,index)=>({event,index,points:eventPoints(event),round:eventRound(event,index)}))
    .sort((a,b)=>b.points-a.points||a.round-b.round||a.index-b.index)
    .slice(0,Math.max(0,Number(count)))
    .map((entry)=>entry.event);
}

export function countedChampionshipEvents(eventsInput,countingRule){
  const events=(Array.isArray(eventsInput)?eventsInput:[]).slice();
  const rule=countingRule||ALL;
  if(rule.type==="none")return [];
  if(rule.type==="all")return events;
  if(rule.type==="best")return chooseBest(events,rule.count);
  if(rule.type==="split"){
    const selected=[];
    const covered=new Set();
    for(const segment of rule.segments||[]){
      const candidates=events.filter((event,index)=>{
        const round=eventRound(event,index);
        return round>=Number(segment.from)&&round<=Number(segment.to);
      });
      for(const event of chooseBest(candidates,segment.count)){
        if(!covered.has(event)){
          covered.add(event);
          selected.push(event);
        }
      }
    }
    return selected;
  }
  return events;
}

export function countChampionshipPoints(events,countingRule){
  return Number(countedChampionshipEvents(events,countingRule)
    .reduce((sum,event)=>sum+eventPoints(event),0)
    .toFixed(3));
}

export function constructorRacePoints(rowsInput,yearInput){
  const rule=championshipRuleForYear(yearInput);
  if(!rule.constructorChampionship)return new Map();
  const byConstructor=new Map();
  for(const row of Array.isArray(rowsInput)?rowsInput:[]){
    const id=String(row?.constructor_id??row?.team_id??"");
    if(!id)continue;
    const points=Number(row?.constructor_points??row?.points??0)||0;
    if(rule.constructorCarsScoring==="best_one"){
      byConstructor.set(id,Math.max(byConstructor.get(id)||0,points));
    }else{
      byConstructor.set(id,(byConstructor.get(id)||0)+points);
    }
  }
  return byConstructor;
}

export function shortenedRacePointsTable(year,{fraction=1,greenLaps=Infinity,totalLaps=null}={}){
  const rule=championshipRuleForYear(year);
  const base=[...rule.racePoints];
  const short=rule.shortenedRace;
  const completed=Number(fraction);
  const laps=Number(greenLaps);
  if(short.type==="full")return base;
  if(short.type==="graduated"){
    if(laps<Number(short.minimumGreenLaps||0))return [];
    for(const band of short.bands||[]){
      if(completed<Number(band.maxFraction)){
        return band.table?[...band.table]:base;
      }
    }
    return base;
  }
  if(short.type==="half"){
    if(short.minimumLaps!=null&&Number(totalLaps)!=null&&Number(totalLaps)<Number(short.minimumLaps))return [];
    if(short.noneBelowFraction!=null&&completed<Number(short.noneBelowFraction))return [];
    if(completed<Number(short.fullFromFraction))return base.map((value)=>value/2);
    return base;
  }
  return base;
}
