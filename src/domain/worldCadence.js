// src/domain/worldCadence.js
// Cheap scheduling predicates for Save-World systems. The calendar advances
// daily; expensive systems should only wake when their cadence or event is due.

const text=(value)=>String(value??"");
const num=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};

function dateOnly(value){
  const raw=text(value).slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:"";
}
function yearOf(row){
  const direct=Number(row?.year??row?.season_year??row?.season);
  if(Number.isFinite(direct))return direct;
  const raw=dateOnly(row?.dateISO??row?.date??row?.race_date);
  return raw?Number(raw.slice(0,4)):NaN;
}
function gpDate(gp){
  return dateOnly(gp?.race_date??gp?.date??gp?.dateISO??gp?.start_date??gp?.end_date??gp?.raceDate);
}
function daysBetween(fromISO,toISO){
  const a=Date.parse(dateOnly(fromISO)+"T00:00:00Z");
  const b=Date.parse(dateOnly(toISO)+"T00:00:00Z");
  if(!Number.isFinite(a)||!Number.isFinite(b))return Infinity;
  return Math.round((b-a)/86_400_000);
}
export function activeSeasonOfficialRaceCount(gs){
  const year=Number(gs?.activeYear);
  return (Array.isArray(gs?.results)?gs.results:[])
    .filter((row)=>yearOf(row)===year)
    .length;
}

export function currentWorldCadence(gs){
  const today=dateOnly(gs?.currentDateISO);
  const day=Number(today.slice(8,10));
  const monthKey=today.slice(0,7);
  const activeRaceCount=activeSeasonOfficialRaceCount(gs);
  const stored=gs?._worldCadence&&typeof gs._worldCadence==="object"?gs._worldCadence:{};

  const storedRaceCount=Number(stored?.official_race_count);
  // Older saves have no cadence marker. Treat their active-season Results as
  // one catch-up post-GP event, then stamp the count so it cannot repeat.
  const baselineRaceCount=Number.isFinite(storedRaceCount)?storedRaceCount:0;
  const postGrandPrix=activeRaceCount>baselineRaceCount;

  const roundIndex=Math.max(0,Number(gs?.currentRound||0));
  const currentGp=Array.isArray(gs?.calendar)?gs.calendar[roundIndex]||null:null;
  const raceDate=gpDate(currentGp);
  const preGrandPrix=Boolean(today&&raceDate&&daysBetween(today,raceDate)===1);

  return {
    today,
    monthKey,
    firstOfMonth:Boolean(today&&day===1),
    postGrandPrix,
    preGrandPrix,
    officialRaceCount:activeRaceCount,
    seasonFinished:Number(gs?._seasonFinishedAt)===Number(gs?.activeYear),
  };
}

export function stampWorldCadence(gs,cadence=currentWorldCadence(gs)){
  if(!gs||!cadence)return gs;
  const previous=gs?._worldCadence&&typeof gs._worldCadence==="object"?gs._worldCadence:{};
  return {
    ...gs,
    _worldCadence:{
      ...previous,
      official_race_count:num(cadence.officialRaceCount,0),
      last_month_key:cadence.monthKey||previous.last_month_key||null,
      last_processed_date:cadence.today||previous.last_processed_date||null,
    },
  };
}
