// src/race2/presentation/RaceEventPresenter.js
// RW10B: presentation-only mapping for canonical RaceState events.
//
// RaceState owns structured facts. This module turns those facts into human
// readable labels/text for UI surfaces without changing or recalculating race
// state, classification, timing or consequences.

export const RACE_EVENT_PRESENTATION_VERSION=1;

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(value??"").trim();

function humanize(value){
  const raw=text(value).replaceAll("_"," ").replace(/\s+/g," ");
  if(!raw)return "Race update";
  return raw.charAt(0).toUpperCase()+raw.slice(1);
}

function rows(value){
  return Array.isArray(value)?value:[];
}

function driverId(row){
  return text(row?.driver_id??row?.driverId??row?.id);
}

function driverName(context,id){
  const wanted=text(id);
  const row=rows(context?.drivers).find((driver)=>driverId(driver)===wanted);
  const explicit=text(row?.display_name??row?.name);
  const composed=`${row?.first_name??""} ${row?.last_name??""}`.trim();
  return explicit||composed||wanted||"Unknown driver";
}

function tyreName(context,id){
  const wanted=text(id);
  if(!wanted)return null;
  const row=rows(context?.tyres).find((tyre)=>
    text(tyre?.tyre_id??tyre?.id)===wanted
  );
  return text(
    row?.compound_name
    ??row?.compound
    ??row?.name
    ??wanted
  )||null;
}

function eventDriverIds(event){
  const ids=Array.isArray(event?.driverIds)
    ?event.driverIds
    :Array.isArray(event?.driver_ids)
      ?event.driver_ids
      :[];
  const explicit=text(event?.driver_id);
  return [...new Set([
    ...ids.map(text).filter(Boolean),
    explicit,
  ].filter(Boolean))];
}

function primaryDriverName(event,context){
  return driverName(context,eventDriverIds(event)[0]);
}

function pairNames(event,context){
  const ids=eventDriverIds(event);
  return [
    driverName(context,ids[0]),
    driverName(context,ids[1]),
  ];
}

function controlName(value){
  const key=text(value).toUpperCase();
  return {
    GREEN:"Green flag",
    LOCAL_YELLOW:"Yellow flag",
    VSC:"Virtual Safety Car",
    SAFETY_CAR:"Safety Car",
    RED_FLAG:"Red flag",
  }[key]??humanize(key);
}

function controlChangedText(payload={}){
  const from=text(payload?.from).toUpperCase();
  const to=text(payload?.to).toUpperCase();
  const source=text(payload?.source).toLowerCase();

  if(to==="GREEN"){
    if(from==="RED_FLAG"||source==="restart")return "Race restarted under green flag";
    return "Green flag — racing resumes";
  }
  if(to==="LOCAL_YELLOW")return "Yellow flag deployed";
  if(to==="VSC")return "Virtual Safety Car deployed";
  if(to==="SAFETY_CAR")return "Safety Car deployed";
  if(to==="RED_FLAG")return "Red flag — race suspended";
  return `${controlName(from)} → ${controlName(to)}`;
}

function weatherReportText(payload={}){
  const kind=text(payload?.kind).toLowerCase();
  const band=humanize(payload?.rainBand||"rain").toLowerCase();
  const intensity=finite(payload?.rainIntensity,null);
  if(kind==="rain_started")return "Rain has started";
  if(kind==="rain_stopped")return "The rain has stopped";
  if(kind==="rain_rising"){
    return intensity!=null
      ?`Rain intensity is rising — ${Math.round(intensity*100)}% now`
      :`Rain intensity is rising — ${band} rain now`;
  }
  if(kind==="rain_easing"){
    return intensity!=null
      ?`Rain is easing — ${Math.round(intensity*100)}% now`
      :`Rain is easing — ${band} rain now`;
  }
  if(kind==="standing_water")return "Standing water is building on the circuit";
  if(kind==="visibility")return "Visibility is deteriorating in the spray";
  if(kind==="drying_track")return "The racing line is drying quickly";
  return "Weather conditions are changing";
}

function tyreWeatherFeedbackText(driver,payload={}){
  const have=text(payload?.tyreCategory).toLowerCase();
  const wanted=text(payload?.recommendedCategory).toLowerCase();
  let message="These tyres don't feel right for the conditions.";

  if(have==="dry"&&wanted==="intermediate"){
    message="It's getting slippery. Intermediates are becoming an option.";
  }else if(have==="dry"&&wanted==="wet"){
    message="I'm really struggling for grip — it's too wet for slicks.";
  }else if(have==="intermediate"&&wanted==="wet"){
    message="There's too much standing water for the intermediates.";
  }else if(have==="intermediate"&&wanted==="dry"){
    message="The track is drying — the intermediates are overheating.";
  }else if(have==="wet"&&wanted==="dry"){
    message="The track is too dry for the wets; they're overheating.";
  }else if(have==="wet"&&wanted==="intermediate"){
    message="The wets are starting to overheat; intermediates may be quicker now.";
  }

  return `${driver}: "${message}"`;
}

function lossText(ms){
  const value=finite(ms,null);
  return value==null?"":` — ${(value/1000).toFixed(1)}s lost`;
}

function presentation(label,message,iconKey="update",priority="normal"){
  return {
    version:RACE_EVENT_PRESENTATION_VERSION,
    label,
    text:message,
    iconKey,
    priority,
  };
}

export function canonicalRaceFlagNotice(view){
  const status=text(view?.status).toLowerCase();
  if(status==="finished"){
    return {
      type:"CHEQUERED",
      label:"CHEQUERED FLAG",
      subtitle:"RACE FINISHED",
      reason:"Race distance complete",
    };
  }

  const current=text(view?.current_control||"GREEN").toUpperCase();
  if(current==="GREEN"){
    return {
      type:"GREEN",
      label:"GREEN FLAG",
      subtitle:"TRACK CLEAR",
      reason:"Racing conditions",
    };
  }

  const controlState=view?.race_control_state||{};
  const events=rows(view?.events);
  const latestChange=events.slice().reverse().find((event)=>
    text(event?.type).toLowerCase()==="race_control_changed"&&
    text(event?.payload?.to).toUpperCase()===current
  );
  const source=text(controlState?.source||latestChange?.payload?.source).toLowerCase();
  const label={
    LOCAL_YELLOW:"YELLOW FLAG",
    SAFETY_CAR:"SAFETY CAR",
    VSC:"VIRTUAL SAFETY CAR",
    RED_FLAG:"RED FLAG",
  }[current]||humanize(current).toUpperCase();
  const subtitle={
    LOCAL_YELLOW:"CAUTION",
    SAFETY_CAR:"DEPLOYED",
    VSC:"VIRTUAL SAFETY CAR",
    RED_FLAG:"SESSION STOPPED",
  }[current]||"RACE CONTROL";
  const reason=source==="weather"
    ?"Weather conditions"
    :source==="incident"
      ?"Incident on track"
      :source==="restart"
        ?"Race restart procedure"
        :"Race control intervention";

  return {type:current,label,subtitle,reason};
}

export function canonicalRaceEventRequiresPause(event,{playerDriverIds=[]}={}){
  const type=text(event?.type).toLowerCase();
  const payload=event?.payload&&typeof event.payload==="object"?event.payload:{};
  const playerDrivers=new Set(rows(playerDriverIds).map(text).filter(Boolean));
  const involvesPlayer=eventDriverIds(event).some((id)=>playerDrivers.has(id));

  if(type==="race_control_changed"){
    return ["VSC","SAFETY_CAR","RED_FLAG"].includes(text(payload?.to).toUpperCase());
  }
  if(type==="weather_report"){
    return ["rain_started","rain_stopped","standing_water","visibility"].includes(
      text(payload?.kind).toLowerCase()
    );
  }
  if(type==="driver_feedback")return involvesPlayer;
  if(["mechanical_failure","retirement","accident","contact"].includes(type))return true;
  if(type==="damage")return text(payload?.source).toLowerCase()==="contact"||involvesPlayer;
  if(type==="pit_service_completed")return involvesPlayer||Boolean(payload?.crewError);
  if(type==="command_ignored")return involvesPlayer;
  return false;
}

export function batchCanonicalRaceAttentionEvents(events,context={}){
  const important=rows(events).filter((event)=>canonicalRaceEventRequiresPause(event,context));
  if(!important.length)return null;

  const latestTick=Math.max(...important.map((event)=>finite(event?.tick,-1)));
  const sameTick=important.filter((event)=>finite(event?.tick,-1)===latestTick);
  if(sameTick.length===1)return sameTick[0];

  const sequence=Math.max(...sameTick.map((event)=>finite(event?.sequence,0)));
  const lapValues=sameTick.map((event)=>finite(event?.lap,null)).filter((value)=>value!=null);
  const sectorValues=sameTick.map((event)=>finite(event?.sector,null)).filter((value)=>value!=null);
  const ids=sameTick.map((event)=>text(event?.id||event?.key||event?.sequence)).filter(Boolean);

  return {
    type:"event_batch",
    tick:latestTick,
    sequence,
    lap:lapValues.length?Math.max(...lapValues):null,
    sector:sectorValues.length&&new Set(sectorValues).size===1?sectorValues[0]:null,
    events:sameTick,
    event_key:`rw2_event_batch:${latestTick}:${ids.join("|")}`,
    display_label:`${sameTick.length} race updates`,
    display_icon_key:sameTick[0]?.display_icon_key??"update",
    display_priority:"critical",
  };
}

export function presentCanonicalRaceEvent(event,context={}){
  const type=text(event?.type).toLowerCase();
  const payload=event?.payload&&typeof event.payload==="object"?event.payload:{};
  const driver=primaryDriverName(event,context);
  const [first,second]=pairNames(event,context);

  if(type==="weather_report"){
    const kind=text(payload?.kind).toLowerCase();
    const priority=["rain_started","rain_stopped","standing_water","visibility"].includes(kind)
      ?"important"
      :"info";
    return presentation(
      "Weather",
      weatherReportText(payload),
      "weather",
      priority
    );
  }

  if(type==="driver_feedback"){
    if(text(payload?.kind).toLowerCase()==="tyre_weather_mismatch"){
      return presentation(
        "Driver feedback",
        tyreWeatherFeedbackText(driver,payload),
        "feedback",
        "important"
      );
    }
    return presentation(
      "Driver feedback",
      `${driver}: "${humanize(payload?.kind||"race update")}"`,
      "feedback",
      "normal"
    );
  }

  if(type==="race_control_changed"){
    const to=text(payload?.to).toUpperCase();
    return presentation(
      "Race Control",
      controlChangedText(payload),
      "race_control",
      to==="RED_FLAG"?"critical":"important"
    );
  }

  if(type==="race_control_extended"){
    const mode=controlName(payload?.mode);
    return presentation(
      "Race Control",
      `${mode} period extended`,
      "race_control",
      "important"
    );
  }

  if(type==="race_control_assessment"){
    const action=controlName(payload?.action);
    const source=text(payload?.source);
    return presentation(
      "Race Control assessment",
      source
        ?`${action} recommended after ${humanize(source).toLowerCase()}`
        :`${action} recommended`,
      "race_control",
      "info"
    );
  }

  if(type==="pit_entry"){
    const reason=text(payload?.reason);
    return presentation(
      "Pit entry",
      reason
        ?`${driver} enters the pits — ${humanize(reason).toLowerCase()}`
        :`${driver} enters the pits`,
      "pit",
      "normal"
    );
  }

  if(type==="pit_service_completed"){
    const compound=tyreName(context,payload?.tyreTo);
    const tyreAction=compound&&payload?.tyreChanged===true
      ?`changes to ${compound} tyres`
      :compound
        ?`completes pit service on ${compound} tyres`
        :null;
    const actions=[
      tyreAction,
      payload?.refuelled?"refuels":null,
    ].filter(Boolean);
    return presentation(
      "Pit service",
      actions.length
        ?`${driver} ${actions.join(" and ")}`
        :`${driver} completes pit service`,
      "pit",
      "normal"
    );
  }

  if(type==="pit_exit"){
    return presentation(
      "Pit exit",
      `${driver} exits the pits${lossText(payload?.lossMs)}`,
      "pit",
      "normal"
    );
  }

  if(type==="mechanical_failure"){
    const reason=humanize(payload?.reason||"mechanical problem");
    return presentation(
      "Mechanical problem",
      `${driver} — ${reason}`,
      "failure",
      "critical"
    );
  }

  if(type==="retirement"){
    const reason=text(payload?.reason);
    return presentation(
      "Retirement",
      reason
        ?`${driver} retires — ${humanize(reason)}`
        :`${driver} retires`,
      "retirement",
      "critical"
    );
  }

  if(type==="accident"){
    const severity=text(payload?.severity);
    return presentation(
      "Race incident",
      severity
        ?`${driver} has a ${humanize(severity).toLowerCase()} accident`
        :`${driver} has an accident`,
      "incident",
      payload?.retirement?"critical":"important"
    );
  }

  if(type==="damage"){
    const severity=text(payload?.severity);
    const source=text(payload?.source);
    const detail=severity?`${humanize(severity).toLowerCase()} damage`:"damage";
    return presentation(
      "Car damage",
      source==="contact"
        ?`${driver} suffers ${detail} after contact`
        :`${driver} suffers ${detail}`,
      "damage",
      "important"
    );
  }

  if(type==="contact"){
    return presentation(
      "Contact",
      second?`Contact between ${first} and ${second}`:`Contact involving ${first}`,
      "incident",
      "important"
    );
  }

  if(type==="overtake_started"){
    return presentation(
      "Battle",
      second?`${first} attacks ${second}`:`${first} starts an overtaking attempt`,
      "battle",
      "normal"
    );
  }

  if(type==="overtake_completed"){
    return presentation(
      "Overtake",
      second?`${first} passes ${second}`:`${first} completes the overtake`,
      "battle",
      "normal"
    );
  }

  if(type==="overtake_failed"){
    return presentation(
      "Battle",
      second?`${second} holds off ${first}`:`${first}'s overtaking attempt fails`,
      "battle",
      "normal"
    );
  }

  if(type==="overtake_aborted"){
    return presentation(
      "Battle",
      second
        ?`Overtaking attempt between ${first} and ${second} is aborted`
        :`${first}'s overtaking attempt is aborted`,
      "battle",
      "info"
    );
  }

  if(type==="command_applied"){
    const command=text(payload?.commandType).toLowerCase();
    if(command==="pace"){
      return presentation(
        "Team radio",
        `${driver}: pace set to ${humanize(payload?.paceMode).toLowerCase()}`,
        "command",
        "normal"
      );
    }
    if(command==="pit"){
      const compound=tyreName(context,payload?.tyreId);
      const details=[
        compound?`${compound} tyres`:null,
        payload?.refuel?"refuel":null,
      ].filter(Boolean);
      return presentation(
        "Team radio",
        `${driver} is called to pit${details.length?` for ${details.join(" + ")}`:""}`,
        "command",
        "normal"
      );
    }
    return presentation(
      "Team radio",
      `${driver}: ${humanize(command||"command")} applied`,
      "command",
      "normal"
    );
  }

  if(type==="command_ignored"){
    return presentation(
      "Team radio",
      `${driver}: command could not be applied`,
      "command",
      "info"
    );
  }

  return presentation(
    humanize(type||"race update"),
    eventDriverIds(event).length
      ?`${driver} — ${humanize(type||"race update")}`
      :humanize(type||"race update"),
    "update",
    "info"
  );
}
