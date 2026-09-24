// src/components/entity/GrandPrixFlag.jsx
import React from "react";
import { CountryFlag } from "./EntityVisuals.jsx";

const text=(value)=>String(value??"").trim();
const yearOf=(row)=>Number(row?.year??row?.season_year??String(row?.dateISO??row?.date??row?.race_date??"").slice(0,4));

function sameGrandPrix(candidate,record){
  if(!candidate||!record)return false;
  const idsA=[candidate?.gp_id,candidate?.id,candidate?.event_id,candidate?.track_id].map(text).filter(Boolean);
  const idsB=[record?.gp_id,record?.id,record?.event_id,record?.track_id].map(text).filter(Boolean);
  if(idsA.some((value)=>idsB.includes(value)))return true;

  const roundA=Number(candidate?.round);
  const roundB=Number(record?.round);
  const yearA=yearOf(candidate);
  const yearB=yearOf(record);
  if(Number.isFinite(roundA)&&Number.isFinite(roundB)&&roundA===roundB){
    if(!Number.isFinite(yearA)||!Number.isFinite(yearB)||yearA===yearB)return true;
  }

  const nameA=text(candidate?.gp_name??candidate?.name).toLowerCase();
  const nameB=text(record?.gp_name??record?.name).toLowerCase();
  return Boolean(nameA&&nameB&&nameA===nameB&&(!Number.isFinite(yearA)||!Number.isFinite(yearB)||yearA===yearB));
}

export function resolveGrandPrixRecord(gameState,record){
  if(!record)return null;
  const nested=record?.meta?.gp;
  if(nested)return nested;
  const country=text(record?.country??record?.country_name??record?.Country??record?.host_country??record?.nation);
  const code=text(record?.country_code??record?.countryCode??record?.country_iso2??record?.iso2);
  if(country||code)return record;

  const candidates=[
    ...(Array.isArray(gameState?.calendar)?gameState.calendar:[]),
    ...(Array.isArray(gameState?.dbCalendar)?gameState.dbCalendar:[]),
  ];
  return candidates.find((candidate)=>sameGrandPrix(candidate,record))||record;
}

export function GrandPrixFlag({gameState=null,gp=null,record=null,size="sm",className=""}){
  const resolved=resolveGrandPrixRecord(gameState,gp||record);
  const country=text(resolved?.country??resolved?.country_name??resolved?.Country??resolved?.host_country??resolved?.nation);
  const code=text(resolved?.country_code??resolved?.countryCode??resolved?.country_iso2??resolved?.iso2);
  if(!country&&!code)return null;
  return <CountryFlag country={country} code={code} size={size} className={className} title={country||code}/>;
}
