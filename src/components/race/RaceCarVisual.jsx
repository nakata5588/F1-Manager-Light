import React from "react";
import { normaliseRaceCarDamage, raceCarEraForYear } from "../../domain/raceCarVisual.js";
import { historicalRaceCarGeometry } from "../../domain/raceCarGeometry.js";

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

function Wing1980({x,primary,secondary,accent,damage=0,rear=false,half=null,thickness=null}){
  const pct=clamp(damage);
  const span=Number.isFinite(Number(half))?Number(half):(rear?9.7:9.2);
  const chord=Number.isFinite(Number(thickness))?Number(thickness):(rear?2.8:1.8);
  const broken=pct>=30;
  const major=pct>=60;
  const critical=pct>=85;
  const topStart=critical?-3.2:-span;
  const topHeight=critical?2.2:major?Math.min(4.7,span*.52):broken?Math.min(6.3,span*.69):span-1.7;
  const bottomStart=1.7;
  const bottomHeight=critical?2.4:major?Math.min(5.0,span*.55):broken?Math.min(6.5,span*.71):span-1.7;
  const bodyColor=pct>=90?"#7f1d1d":primary;
  return <g>
    <rect x={x} y="-2.1" width={chord} height="4.2" rx=".45" fill={secondary} stroke="#020617" strokeWidth=".65"/>
    <rect x={x} y={topStart} width={chord} height={Math.max(1,topHeight)} rx=".45" fill={bodyColor} stroke="#020617" strokeWidth=".65"/>
    <rect x={x} y={bottomStart} width={chord} height={Math.max(1,bottomHeight)} rx=".45" fill={bodyColor} stroke="#020617" strokeWidth=".65"/>
    {!critical?<rect x={x+.35} y={-span+.65} width={Math.max(.6,chord-.7)} height="1.25" rx=".3" fill={accent} opacity=".92"/>:null}
    {!critical?<rect x={x+.35} y={span-1.9} width={Math.max(.6,chord-.7)} height="1.25" rx=".3" fill={accent} opacity=".92"/>:null}
    {broken?<path d={`M ${x-.2} -2.6 l ${chord+1.0} -1.4 M ${x-.2} 2.6 l ${chord+1.0} 1.4`} stroke="#fda4af" strokeWidth=".7" opacity=".9"/>:null}
  </g>;
}

function mirroredPath(points){
  if(!Array.isArray(points)||!points.length)return "";
  const top=points.map(([x,y])=>[x,-Math.abs(y)]);
  const bottom=points.slice(0,-1).reverse().map(([x,y])=>[x,Math.abs(y)]);
  return [...top,...bottom].map(([x,y],index)=>`${index?"L":"M"} ${x} ${y}`).join(" ")+" Z";
}

function historicBodyPath(g){
  return mirroredPath([
    [g.rearBodyX,g.rearBodyHalfWidth],
    [g.sidepodRearX,g.sidepodRearHalfWidth],
    [g.sidepodFrontX,g.sidepodFrontHalfWidth],
    [g.shoulderX,g.shoulderHalfWidth],
    [g.noseBaseX,g.noseBaseHalfWidth],
    [g.noseShoulderX,g.noseShoulderHalfWidth],
    [g.noseTipX,0],
  ]);
}

function historicSidepodPath(g){
  const rearX=g.rearBodyX+1.9;
  const rearHalf=Math.min(g.rearBodyHalfWidth*.82,g.sidepodRearHalfWidth*.76);
  const middleHalf=g.sidepodRearHalfWidth*.8;
  const frontHalf=g.sidepodFrontHalfWidth*.78;
  const endX=Math.min(g.shoulderX-.25,g.sidepodFrontX+2.1);
  const endHalf=Math.min(g.shoulderHalfWidth*.7,frontHalf*.92);
  return mirroredPath([
    [rearX,rearHalf],
    [g.sidepodRearX,middleHalf],
    [g.sidepodFrontX,frontHalf],
    [endX,endHalf],
  ]);
}

function LiveryPattern1980({pattern,primary,secondary,accent,detailed=false}){
  if(!pattern)return null;
  switch(pattern){
    case "saudia_stripes":
      return <g opacity=".96">
        <path d="M -11.5 -3.65 L 5.2 -3.85 L 8.0 -3.0" fill="none" stroke={secondary} strokeWidth="1.25"/>
        <path d="M -11.5 3.65 L 5.2 3.85 L 8.0 3.0" fill="none" stroke={accent} strokeWidth="1.0"/>
        {detailed?<path d="M 8.2 -1.85 L 15.7 -.9 M 8.2 1.85 L 15.7 .9" stroke={secondary} strokeWidth=".7"/>:null}
      </g>;
    case "parmalat_navy":
      return <g>
        <path d="M -13.0 -2.7 L 7.0 -2.45 L 14.9 -1.1 L 18.3 0 L 14.9 1.1 L 7.0 2.45 L -13.0 2.7 Z" fill={secondary} opacity=".97"/>
        <path d="M -12.5 -3.15 L 5.8 -3.15 M -12.5 3.15 L 5.8 3.15" stroke={accent} strokeWidth=".75"/>
      </g>;
    case "renault_yellow":
      return <g>
        <path d="M -11.2 -4.15 L 4.7 -4.35 L 7.0 -3.15 L 7.0 3.15 L 4.7 4.35 L -11.2 4.15 Z" fill={secondary} opacity=".96"/>
        <path d="M 7.0 -2.2 L 15.5 -.95 L 18.7 0 L 15.5 .95 L 7.0 2.2 Z" fill={primary}/>
        <path d="M -10.2 -1.0 L 12.5 -.75 L 17.1 0 L 12.5 .75 L -10.2 1.0 Z" fill={accent} opacity=".82"/>
      </g>;
    case "essex_stripes":
      return <g>
        <path d="M -12.5 -3.8 L 4.8 -4.0 L 7.1 -3.0" fill="none" stroke={secondary} strokeWidth="1.1"/>
        <path d="M -12.5 3.8 L 4.8 4.0 L 7.1 3.0" fill="none" stroke={secondary} strokeWidth="1.1"/>
        <path d="M -12.3 -2.7 L 7.8 -2.45 M -12.3 2.7 L 7.8 2.45" stroke={accent} strokeWidth=".9"/>
      </g>;
    case "marlboro_chevron":
      return <g>
        <path d="M -9.0 -4.35 L 3.9 -4.6 L 8.0 -3.25 L 4.4 0 L 8.0 3.25 L 3.9 4.6 L -9.0 4.35 L -4.8 0 Z" fill={secondary} opacity=".98"/>
        <path d="M 8.0 -1.55 L 16.0 -.78 L 18.8 0 L 16.0 .78 L 8.0 1.55 Z" fill={primary}/>
      </g>;
    case "gitanes_blue":
      return <g>
        <path d="M -11.6 -4.0 L 4.6 -4.2 L 7.2 -3.1 L 7.2 3.1 L 4.6 4.2 L -11.6 4.0 Z" fill={primary}/>
        <path d="M -11.0 -1.0 L 13.8 -.75 L 18.3 0 L 13.8 .75 L -11.0 1.0 Z" fill={secondary} opacity=".98"/>
        <path d="M -9.5 -3.35 L 4.3 -3.55 M -9.5 3.35 L 4.3 3.55" stroke={accent} strokeWidth=".65"/>
      </g>;
    case "warsteiner_gold":
      return <g>
        <path d="M -12.5 -3.8 L 4.2 -4.0 L 7.0 -2.85 L 7.0 2.85 L 4.2 4.0 L -12.5 3.8 Z" fill={primary}/>
        <path d="M -11.8 -1.3 L 13.0 -.85 L 18.2 0 L 13.0 .85 L -11.8 1.3 Z" fill={secondary}/>
      </g>;
    case "skol_yellow":
      return <g>
        <path d="M -12.0 -3.9 L 5.0 -4.05 L 7.2 -3.0 L 7.2 3.0 L 5.0 4.05 L -12.0 3.9 Z" fill={primary}/>
        <path d="M -11.5 -1.35 L 12.9 -.9 L 18.1 0 L 12.9 .9 L -11.5 1.35 Z" fill={secondary}/>
        <path d="M -10.5 -2.7 L 5.0 -2.85 M -10.5 2.7 L 5.0 2.85" stroke={accent} strokeWidth=".8"/>
      </g>;
    case "ferrari_red":
    case "alfa_red":
      return <g>
        <path d="M 8.0 -1.85 L 15.8 -.85 L 18.5 0 L 15.8 .85 L 8.0 1.85 Z" fill={secondary} opacity=".96"/>
        {detailed?<path d="M -8.0 -4.2 L -1.8 -4.45 M -8.0 4.2 L -1.8 4.45" stroke={accent} strokeWidth=".75"/>:null}
      </g>;
    case "tyrrell_blue":
    case "osella_blue":
      return <g>
        <path d="M -11.8 -3.8 L 4.7 -4.0 L 7.2 -3.0 L 7.2 3.0 L 4.7 4.0 L -11.8 3.8 Z" fill={primary}/>
        <path d="M -10.8 -1.15 L 14.2 -.78 L 18.6 0 L 14.2 .78 L -10.8 1.15 Z" fill={secondary}/>
        <path d="M -9.5 -3.1 L 4.0 -3.2 M -9.5 3.1 L 4.0 3.2" stroke={accent} strokeWidth=".65"/>
      </g>;
    case "ats_yellow":
      return <g>
        <path d="M -12.0 -4.0 L 5.0 -4.15 L 7.2 -3.0 L 7.2 3.0 L 5.0 4.15 L -12.0 4.0 Z" fill={primary}/>
        <path d="M -11.2 -1.25 L 14.0 -.8 L 18.4 0 L 14.0 .8 L -11.2 1.25 Z" fill={secondary}/>
      </g>;
    case "ensign_dark":
    case "shadow_black":
      return <g>
        <path d="M -12.0 -3.9 L 4.8 -4.05 L 7.2 -3.0 L 7.2 3.0 L 4.8 4.05 L -12.0 3.9 Z" fill={primary}/>
        <path d="M -11.2 -1.2 L 13.6 -.82 L 18.2 0 L 13.6 .82 L -11.2 1.2 Z" fill={secondary}/>
        {detailed?<path d="M -8.5 -3.2 L 3.8 -3.35 M -8.5 3.2 L 3.8 3.35" stroke={accent} strokeWidth=".7"/>:null}
      </g>;
    default:
      return null;
  }
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
  liveryPattern=null,
  historicalModel=null,
  geometry=null,
}){
  const damage=normaliseRaceCarDamage(damageState);
  const g=geometry||historicalRaceCarGeometry({year:1980,model:historicalModel});
  const suspensionDamage=damage.suspension;
  const wheelToe=suspensionDamage>=30?Math.min(18,4+suspensionDamage*.13):0;
  const wheelShift=suspensionDamage>=60?1.15:0;
  const close=lod==="close";
  const detailed=lod==="close"||lod==="medium";
  const bodyColor=retired?"#7f1d1d":color;
  const number=driverNumber==null||driverNumber===""?null:String(driverNumber).slice(0,3);
  const sponsor=sponsorLabel?String(sponsorLabel).slice(0,10).toUpperCase():null;
  const bodyPath=historicBodyPath(g);
  const sidepodPath=historicSidepodPath(g);
  const rearAttachX=g.rearAxleX+2.0;
  const frontAttachX=g.frontAxleX-2.7;
  const cockpitRear=g.cockpitX-(g.cockpitLength*.5);
  const cockpitFront=g.cockpitX+(g.cockpitLength*.5);
  const cockpitTop=g.cockpitHalfWidth;
  const floorDamageY=g.sidepodRearHalfWidth*.93;

  return <g
    data-car-body="true"
    data-geometry-family={g.geometry_family}
    data-historical-model={g.model}
    opacity={retired?0.62:1}
  >
    <ellipse cx="-1.3" cy="1.9" rx={Math.max(21.8,(g.noseTipX-g.rearBodyX)*.64)} ry={Math.max(8.2,g.frontTrackY+1.0)} fill="#020617" opacity=".28"/>

    <path d={bodyPath} fill="#0b1017" stroke="#020617" strokeWidth=".7" transform="scale(1.018 1.035)"/>
    {damage.floor>=30?<path
      d={`M ${g.sidepodRearX-3.8} ${floorDamageY} L ${g.sidepodRearX+1.8} ${floorDamageY+.8} L ${g.sidepodFrontX-2.8} ${floorDamageY-.05} L ${g.sidepodFrontX+1.2} ${floorDamageY+.55}`}
      fill="none"
      stroke="#fb7185"
      strokeWidth={damage.floor>=60?"1.05":".7"}
      strokeDasharray="1.7 1.2"
      opacity=".92"
    />:null}

    <g stroke={suspensionDamage>=60?"#fb7185":"#111827"} strokeWidth=".82" opacity=".95">
      <line x1={rearAttachX-1.0} y1={-g.rearBodyHalfWidth*.86} x2={g.rearAxleX} y2={-g.rearTrackY}/>
      <line x1={rearAttachX+3.6} y1={-g.sidepodRearHalfWidth*.82} x2={g.rearAxleX} y2={-g.rearTrackY}/>
      <line x1={rearAttachX-1.0} y1={g.rearBodyHalfWidth*.86} x2={g.rearAxleX} y2={g.rearTrackY}/>
      <line x1={rearAttachX+3.6} y1={g.sidepodRearHalfWidth*.82} x2={g.rearAxleX} y2={g.rearTrackY}/>
      <line x1={frontAttachX} y1={-g.noseBaseHalfWidth} x2={g.frontAxleX} y2={-g.frontTrackY}/>
      <line x1={frontAttachX-3.0} y1={-g.shoulderHalfWidth*.82} x2={g.frontAxleX} y2={-g.frontTrackY}/>
      <line x1={frontAttachX} y1={g.noseBaseHalfWidth} x2={g.frontAxleX} y2={g.frontTrackY}/>
      <line x1={frontAttachX-3.0} y1={g.shoulderHalfWidth*.82} x2={g.frontAxleX} y2={g.frontTrackY}/>
    </g>

    <HistoricTyre x={g.rearAxleX} y={-g.rearTrackY} w={g.rearTyreLength} h={g.rearTyreWidth} damaged={suspensionDamage>=85}/>
    <HistoricTyre x={g.rearAxleX} y={g.rearTrackY} w={g.rearTyreLength} h={g.rearTyreWidth}/>
    <HistoricTyre x={g.frontAxleX+wheelShift} y={-g.frontTrackY} w={g.frontTyreLength} h={g.frontTyreWidth} angle={wheelToe} damaged={suspensionDamage>=60}/>
    <HistoricTyre x={g.frontAxleX} y={g.frontTrackY} w={g.frontTyreLength} h={g.frontTyreWidth} angle={-wheelToe*.35}/>

    <Wing1980
      x={g.rearWingX}
      half={g.rearWingHalfWidth}
      thickness={g.rearWingThickness}
      primary={bodyColor}
      secondary={secondary}
      accent={accent}
      damage={damage.rear_wing}
      rear
    />
    <Wing1980
      x={g.frontWingX}
      half={g.frontWingHalfWidth}
      thickness={g.frontWingThickness}
      primary={bodyColor}
      secondary={secondary}
      accent={accent}
      damage={damage.front_wing}
    />

    <path
      d={bodyPath}
      fill={bodyColor}
      stroke={selected?"#f8fafc":"#0b0f16"}
      strokeWidth={selected?1.15:.8}
    />

    <path d={sidepodPath} fill={secondary} opacity=".96"/>
    <path
      d={`M ${g.rearBodyX+.7} -1.45 L ${g.shoulderX-.5} -1.28 L ${g.noseShoulderX+.6} -.72 L ${g.noseTipX-1.15} 0 L ${g.noseShoulderX+.6} .72 L ${g.shoulderX-.5} 1.28 L ${g.rearBodyX+.7} 1.45 Z`}
      fill={accent}
      opacity=".9"
    />

    <LiveryPattern1980 pattern={liveryPattern} primary={bodyColor} secondary={secondary} accent={accent} detailed={detailed}/>

    <path
      d={`M ${cockpitRear-1.4} -3.45 L ${cockpitFront-1.0} -3.75 L ${cockpitFront+1.9} -2.75 L ${cockpitFront+1.9} 2.75 L ${cockpitFront-1.0} 3.75 L ${cockpitRear-1.4} 3.45 Z`}
      fill={bodyColor}
      opacity=".98"
    />
    <path
      d={`M ${cockpitRear} ${-cockpitTop} L ${g.cockpitX+.7} ${-cockpitTop*1.2} L ${cockpitFront} ${-cockpitTop*.8} L ${cockpitFront} ${cockpitTop*.8} L ${g.cockpitX+.7} ${cockpitTop*1.2} L ${cockpitRear} ${cockpitTop} Z`}
      fill="#111827"
      stroke="#64748b"
      strokeWidth=".55"
    />
    <ellipse cx={g.cockpitX+.35} cy="0" rx="1.7" ry="2.0" fill={accent} stroke="#e2e8f0" strokeWidth=".45"/>

    <path
      d={`M ${g.rearBodyX+2.0} -2.2 L ${g.rearBodyX-.8} -1.7 L ${g.rearBodyX-.8} 1.7 L ${g.rearBodyX+2.0} 2.2 Z`}
      fill={secondary}
      stroke="#0b0f16"
      strokeWidth=".55"
    />

    {detailed?<>
      <g stroke="#020617" strokeWidth=".65" opacity=".85">
        <line x1={g.cockpitX-1.2} y1={-g.sidepodRearHalfWidth*.8} x2={g.cockpitX-1.2} y2={-g.sidepodRearHalfWidth*.45}/>
        <line x1={g.cockpitX+.5} y1={-g.sidepodRearHalfWidth*.82} x2={g.cockpitX+.5} y2={-g.sidepodRearHalfWidth*.47}/>
        <line x1={g.cockpitX+2.2} y1={-g.sidepodFrontHalfWidth*.86} x2={g.cockpitX+2.2} y2={-g.sidepodFrontHalfWidth*.5}/>
        <line x1={g.cockpitX-1.2} y1={g.sidepodRearHalfWidth*.8} x2={g.cockpitX-1.2} y2={g.sidepodRearHalfWidth*.45}/>
        <line x1={g.cockpitX+.5} y1={g.sidepodRearHalfWidth*.82} x2={g.cockpitX+.5} y2={g.sidepodRearHalfWidth*.47}/>
        <line x1={g.cockpitX+2.2} y1={g.sidepodFrontHalfWidth*.86} x2={g.cockpitX+2.2} y2={g.sidepodFrontHalfWidth*.5}/>
      </g>
      {number?<text x={g.frontAxleX-1.2} y="1.35" textAnchor="middle" fontSize="3.6" fontWeight="900" fill={secondary} stroke="#020617" strokeWidth=".2">{number}</text>:null}
    </>:null}

    {close&&sponsor?<>
      <text x={g.cockpitX+4.5} y="-3.15" textAnchor="middle" fontSize="2.0" fontWeight="900" letterSpacing=".08" fill={bodyColor}>{sponsor}</text>
      <text x={g.cockpitX+4.5} y="4.15" textAnchor="middle" fontSize="2.0" fontWeight="900" letterSpacing=".08" fill={bodyColor}>{sponsor}</text>
      {historicalModel?<text x={g.rearWingX+4.4} y=".95" textAnchor="middle" fontSize="1.55" fontWeight="800" fill={secondary} opacity=".85">{String(historicalModel).slice(0,9)}</text>:null}
    </>:null}

    {damage.cooling>=30?<g opacity={Math.min(.95,.45+damage.cooling/180)}>
      <path d={`M ${g.sidepodFrontX-5.8} ${-g.sidepodFrontHalfWidth*.88} L ${g.sidepodFrontX-1.9} ${-g.sidepodFrontHalfWidth*.82} M ${g.sidepodFrontX-5.1} ${-g.sidepodFrontHalfWidth*.72} L ${g.sidepodFrontX-1.3} ${-g.sidepodFrontHalfWidth*.67}`} stroke="#fb923c" strokeWidth=".78"/>
      <path d={`M ${g.sidepodFrontX-5.8} ${g.sidepodFrontHalfWidth*.88} L ${g.sidepodFrontX-1.9} ${g.sidepodFrontHalfWidth*.82} M ${g.sidepodFrontX-5.1} ${g.sidepodFrontHalfWidth*.72} L ${g.sidepodFrontX-1.3} ${g.sidepodFrontHalfWidth*.67}`} stroke="#fb923c" strokeWidth=".78"/>
    </g>:null}

    {damage.brakes>=30?<>
      <circle cx={g.frontAxleX+wheelShift} cy={-g.frontTrackY} r="1.35" fill="#ef4444" opacity={Math.min(.9,.25+damage.brakes/120)}/>
      <circle cx={g.frontAxleX} cy={g.frontTrackY} r="1.1" fill="#f97316" opacity={Math.min(.75,.2+damage.brakes/150)}/>
    </>:null}

    {damage.front_wing>=60?<path
      d={`M ${g.frontWingX-1.0} -3.8 L ${g.frontWingX+1.6} -5.0 M ${g.frontWingX-.8} 3.5 L ${g.frontWingX+1.4} 4.7`}
      stroke="#fecdd3"
      strokeWidth=".75"
      opacity=".9"
    />:null}
    {damage.rear_wing>=60?<path
      d={`M ${g.rearWingX-.7} -3.8 L ${g.rearWingX+1.5} -5.0 M ${g.rearWingX-.7} 3.8 L ${g.rearWingX+1.5} 5.0`}
      stroke="#fecdd3"
      strokeWidth=".75"
      opacity=".9"
    />:null}
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
  liveryPattern=null,
  historicalModel=null,
}){
  const era=raceCarEraForYear(year);
  if(era==="ground_effect_1980"){
    const geometry=historicalRaceCarGeometry({year,model:historicalModel});
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
      liveryPattern={liveryPattern}
      historicalModel={historicalModel}
      geometry={geometry}
    />;
  }
  return <GenericBody color={color} secondary={secondary} selected={selected} retired={retired}/>;
}
