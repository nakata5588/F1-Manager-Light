import React from "react";
import { normaliseRaceCarDamage, raceCarEraForYear } from "../../domain/raceCarVisual.js";

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));

function HistoricTyre({x,y,w,h,angle=0,damaged=false}){
  const transform=`translate(${x} ${y}) rotate(${angle})`;
  return <g transform={transform}>
    <rect x={-w/2} y={-h/2} width={w} height={h} rx={Math.min(2.1,h*.34)} fill="#05070a" stroke="#111827" strokeWidth=".75"/>
    <line x1={-w*.28} y1={-h*.42} x2={-w*.28} y2={h*.42} stroke="#334155" strokeWidth=".45" opacity=".7"/>
    <line x1={w*.24} y1={-h*.42} x2={w*.24} y2={h*.42} stroke="#334155" strokeWidth=".45" opacity=".55"/>
    {damaged?<path d={`M ${-w*.2} ${-h*.47} L ${w*.34} ${h*.47}`} stroke="#fb7185" strokeWidth=".75" opacity=".9"/>:null}
  </g>;
}

function Wing1980({x,primary,secondary,accent,damage=0,rear=false}){
  const pct=clamp(damage);
  const half=rear?9.7:9.2;
  const thickness=rear?2.8:1.8;
  const broken=pct>=30;
  const major=pct>=60;
  const critical=pct>=85;
  const topStart=critical?-3.2:-half;
  const topHeight=critical?2.2:major?4.7:broken?6.3:half-1.7;
  const bottomStart=1.7;
  const bottomHeight=critical?2.4:major?5.0:broken?6.5:half-1.7;
  const bodyColor=pct>=90?"#7f1d1d":primary;
  return <g>
    <rect x={x} y="-2.1" width={thickness} height="4.2" rx=".45" fill={secondary} stroke="#020617" strokeWidth=".65"/>
    <rect x={x} y={topStart} width={thickness} height={Math.max(1,topHeight)} rx=".45" fill={bodyColor} stroke="#020617" strokeWidth=".65"/>
    <rect x={x} y={bottomStart} width={thickness} height={Math.max(1,bottomHeight)} rx=".45" fill={bodyColor} stroke="#020617" strokeWidth=".65"/>
    {!critical?<rect x={x+.35} y={-half+.65} width={Math.max(.6,thickness-.7)} height="1.25" rx=".3" fill={accent} opacity=".92"/>:null}
    {!critical?<rect x={x+.35} y={half-1.9} width={Math.max(.6,thickness-.7)} height="1.25" rx=".3" fill={accent} opacity=".92"/>:null}
    {broken?<path d={`M ${x-.2} ${-2.6} l ${thickness+1.0} -1.4 M ${x-.2} 2.6 l ${thickness+1.0} 1.4`} stroke="#fda4af" strokeWidth=".7" opacity=".9"/>:null}
  </g>;
}

function Historic1980Body({
  color,
  secondary,
  accent,
  selected=false,
  retired=false,
  lod="overview",
  damageState=null,
  driverNumber=null,
  sponsorLabel=null,
}){
  const damage=normaliseRaceCarDamage(damageState);
  const suspensionDamage=damage.suspension;
  const wheelToe=suspensionDamage>=30?Math.min(18,4+suspensionDamage*.13):0;
  const wheelShift=suspensionDamage>=60?1.15:0;
  const close=lod==="close";
  const detailed=lod==="close"||lod==="medium";
  const bodyColor=retired?"#7f1d1d":color;
  const number=driverNumber==null||driverNumber===""?null:String(driverNumber).slice(0,3);
  const sponsor=sponsorLabel?String(sponsorLabel).slice(0,8).toUpperCase():null;

  return <g data-car-body="true" opacity={retired?0.62:1}>
    <ellipse cx="-1.3" cy="1.9" rx="22.5" ry="8.6" fill="#020617" opacity=".28"/>

    <path d="M -14.8 -5.6 L 7.6 -5.3 L 15.8 -2.2 L 20.0 -1.25 L 20.0 1.25 L 15.8 2.2 L 7.6 5.3 L -14.8 5.6 Z" fill="#0b1017" stroke="#020617" strokeWidth=".7"/>
    {damage.floor>=30?<path d="M -10.4 5.45 L -4.8 6.25 L 1.1 5.4 L 5.4 6.0" fill="none" stroke="#fb7185" strokeWidth={damage.floor>=60?"1.05":".7"} strokeDasharray="1.7 1.2" opacity=".92"/>:null}

    <g stroke={suspensionDamage>=60?"#fb7185":"#111827"} strokeWidth=".82" opacity=".95">
      <line x1="-9.6" y1="-4.7" x2="-10.7" y2="-8.6"/>
      <line x1="-4.8" y1="-5.2" x2="-10.7" y2="-8.6"/>
      <line x1="-9.6" y1="4.7" x2="-10.7" y2="8.6"/>
      <line x1="-4.8" y1="5.2" x2="-10.7" y2="8.6"/>
      <line x1="10.0" y1="-3.0" x2="12.7" y2="-7.35"/>
      <line x1="6.8" y1="-4.1" x2="12.7" y2="-7.35"/>
      <line x1="10.0" y1="3.0" x2="12.7" y2="7.35"/>
      <line x1="6.8" y1="4.1" x2="12.7" y2="7.35"/>
    </g>

    <HistoricTyre x={-10.9} y={-8.65} w={8.4} h={5.15} damaged={suspensionDamage>=85}/>
    <HistoricTyre x={-10.9} y={8.65} w={8.4} h={5.15}/>
    <HistoricTyre x={12.8+wheelShift} y={-7.45} w={6.8} h={4.05} angle={wheelToe} damaged={suspensionDamage>=60}/>
    <HistoricTyre x={12.8} y={7.45} w={6.8} h={4.05} angle={-wheelToe*.35}/>

    <Wing1980 x={-19.3} primary={bodyColor} secondary={secondary} accent={accent} damage={damage.rear_wing} rear/>
    <Wing1980 x={18.7} primary={bodyColor} secondary={secondary} accent={accent} damage={damage.front_wing}/>

    <path
      d="M -14.2 -5.2 L -6.5 -6.1 L 4.9 -5.65 L 7.9 -4.5 L 8.7 -2.85 L 15.2 -1.8 L 20.1 0 L 15.2 1.8 L 8.7 2.85 L 7.9 4.5 L 4.9 5.65 L -6.5 6.1 L -14.2 5.2 Z"
      fill={bodyColor}
      stroke={selected?"#f8fafc":"#0b0f16"}
      strokeWidth={selected?1.15:.8}
    />

    <path d="M -12.2 -4.2 L -3.5 -4.8 L 4.8 -4.35 L 6.9 -3.1 L 6.9 3.1 L 4.8 4.35 L -3.5 4.8 L -12.2 4.2 Z" fill={secondary} opacity=".96"/>
    <path d="M -13.5 -1.45 L 7.3 -1.28 L 15.8 -.72 L 18.9 0 L 15.8 .72 L 7.3 1.28 L -13.5 1.45 Z" fill={accent} opacity=".9"/>

    <path d="M -8.4 -3.45 L -1.8 -3.75 L 1.2 -2.75 L 1.2 2.75 L -1.8 3.75 L -8.4 3.45 Z" fill={bodyColor} opacity=".98"/>
    <path d="M -7.8 -1.9 L -3.1 -2.35 L -1.0 -1.55 L -1.0 1.55 L -3.1 2.35 L -7.8 1.9 Z" fill="#111827" stroke="#64748b" strokeWidth=".55"/>
    <ellipse cx="-3.4" cy="0" rx="1.7" ry="2.0" fill={accent} stroke="#e2e8f0" strokeWidth=".45"/>

    <path d="M -12.2 -2.2 L -15.0 -1.7 L -15.0 1.7 L -12.2 2.2 Z" fill={secondary} stroke="#0b0f16" strokeWidth=".55"/>

    {detailed?<>
      <g stroke="#020617" strokeWidth=".65" opacity=".85">
        <line x1="-4.6" y1="-4.85" x2="-4.6" y2="-2.8"/>
        <line x1="-2.9" y1="-4.95" x2="-2.9" y2="-2.85"/>
        <line x1="-1.2" y1="-4.96" x2="-1.2" y2="-2.82"/>
        <line x1="-4.6" y1="4.85" x2="-4.6" y2="2.8"/>
        <line x1="-2.9" y1="4.95" x2="-2.9" y2="2.85"/>
        <line x1="-1.2" y1="4.96" x2="-1.2" y2="2.82"/>
      </g>
      {number?<text x="11.6" y="1.35" textAnchor="middle" fontSize="3.6" fontWeight="900" fill={secondary} stroke="#020617" strokeWidth=".2">{number}</text>:null}
    </>:null}

    {close&&sponsor?<>
      <text x="1.1" y="-3.15" textAnchor="middle" fontSize="2.1" fontWeight="900" letterSpacing=".12" fill={bodyColor}>{sponsor}</text>
      <text x="1.1" y="4.15" textAnchor="middle" fontSize="2.1" fontWeight="900" letterSpacing=".12" fill={bodyColor}>{sponsor}</text>
    </>:null}

    {damage.cooling>=30?<g opacity={Math.min(.95,.45+damage.cooling/180)}>
      <path d="M -1.1 -5.0 L 2.8 -4.7 M -.4 -4.25 L 3.4 -3.95" stroke="#fb923c" strokeWidth=".78"/>
      <path d="M -1.1 5.0 L 2.8 4.7 M -.4 4.25 L 3.4 3.95" stroke="#fb923c" strokeWidth=".78"/>
    </g>:null}

    {damage.brakes>=30?<>
      <circle cx={12.8+wheelShift} cy="-7.45" r="1.35" fill="#ef4444" opacity={Math.min(.9,.25+damage.brakes/120)}/>
      <circle cx="12.8" cy="7.45" r="1.1" fill="#f97316" opacity={Math.min(.75,.2+damage.brakes/150)}/>
    </>:null}

    {damage.front_wing>=60?<path d="M 17.7 -3.8 L 20.3 -5.0 M 17.9 3.5 L 20.1 4.7" stroke="#fecdd3" strokeWidth=".75" opacity=".9"/>:null}
    {damage.rear_wing>=60?<path d="M -20.0 -3.8 L -17.8 -5.0 M -20.0 3.8 L -17.8 5.0" stroke="#fecdd3" strokeWidth=".75" opacity=".9"/>:null}
  </g>;
}

function GenericBody({color,secondary,selected=false,retired=false}){
  return <g data-car-body="true" opacity={retired?0.6:1}>
    <ellipse cx="-1.5" cy="2.2" rx="13.8" ry="5.2" fill="#020617" opacity=".3"/>
    <rect x="-8.5" y="-7.2" width="5.4" height="4.2" rx="1" fill="#05070a"/>
    <rect x="-8.5" y="3" width="5.4" height="4.2" rx="1" fill="#05070a"/>
    <rect x="5.1" y="-6.6" width="5.2" height="3.8" rx="1" fill="#05070a"/>
    <rect x="5.1" y="2.8" width="5.2" height="3.8" rx="1" fill="#05070a"/>
    <rect x="-12" y="-5.6" width="3.4" height="11.2" rx=".7" fill={secondary} stroke="#020617" strokeWidth=".8"/>
    <path d="M -9 -3.9 L -5.3 -5.1 L 2.8 -4.3 L 7.4 -2.5 L 13.8 -1.4 L 16 0 L 13.8 1.4 L 7.4 2.5 L 2.8 4.3 L -5.3 5.1 L -9 3.9 Z" fill={retired?"#7f1d1d":color} stroke={selected?"#fff":"#0b0f16"} strokeWidth={selected?1.5:1}/>
    <path d="M -6.8 -2.8 L -1.5 -3.3 L 2.6 -2.4 L 2.6 2.4 L -1.5 3.3 L -6.8 2.8 Z" fill={secondary} opacity=".9"/>
    <ellipse cx="1.1" cy="0" rx="2.8" ry="2.25" fill="#111827" stroke="#cbd5e1" strokeWidth=".65"/>
  </g>;
}

export default function RaceCarVisual({
  year,
  color="#94a3b8",
  secondary="#e2e8f0",
  accent=null,
  selected=false,
  retired=false,
  lod="overview",
  damageState=null,
  driverNumber=null,
  sponsorLabel=null,
}){
  const era=raceCarEraForYear(year);
  if(era==="ground_effect_1980"){
    return <Historic1980Body
      color={color}
      secondary={secondary}
      accent={accent||secondary}
      selected={selected}
      retired={retired}
      lod={lod}
      damageState={damageState}
      driverNumber={driverNumber}
      sponsorLabel={sponsorLabel}
    />;
  }
  return <GenericBody color={color} secondary={secondary} selected={selected} retired={retired}/>;
}
