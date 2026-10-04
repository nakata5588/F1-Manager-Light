// src/domain/raceCarPresentation.js
// Presentation-only physical calibration for top-down race-car sprites.
//
// This does NOT define race physics or historical database facts. It keeps
// rendered car dimensions in a credible relationship with the rendered track.
// Track-specific physical width can override the fallback when data exists.

import { historicalRaceCarGeometry } from "./raceCarGeometry.js";

// RW31: the previous 14 SVG / 10 m fallback made the usable asphalt look
// narrower than the already-approved car scale once kerbs/margins were drawn.
// Widen both presentation asphalt and nominal physical track together so the
// car footprint remains almost unchanged while two-car battles read naturally.
export const RACE_VIEW_ASPHALT_WIDTH_SVG=17.5;
export const RACE_VIEW_NOMINAL_TRACK_WIDTH_M=12.5;

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));

export function raceCarNominalWidthM(yearInput){
  const year=Number(yearInput);
  if(!Number.isFinite(year))return 1.9;
  if(year<=1967)return 1.6;
  if(year<=1992)return 2.1;
  if(year<=1997)return 2.0;
  if(year<=2016)return 1.8;
  if(year<=2025)return 2.0;
  return 1.9;
}

export function raceCarNativeFootprint({year,model}={}){
  const geometry=historicalRaceCarGeometry({year,model});
  if(geometry){
    const halfWidth=Math.max(
      Number(geometry.rearWingHalfWidth)||0,
      Number(geometry.frontWingHalfWidth)||0,
      (Number(geometry.rearTrackY)||0)+(Number(geometry.rearTyreWidth)||0)/2,
      (Number(geometry.frontTrackY)||0)+(Number(geometry.frontTyreWidth)||0)/2,
      Number(geometry.sidepodRearHalfWidth)||0,
      Number(geometry.sidepodFrontHalfWidth)||0
    );
    const minX=Math.min(
      Number(geometry.rearWingX)||0,
      (Number(geometry.rearAxleX)||0)-(Number(geometry.rearTyreLength)||0)/2,
      Number(geometry.rearBodyX)||0
    );
    const maxX=Math.max(
      Number(geometry.frontWingX)||0,
      (Number(geometry.frontAxleX)||0)+(Number(geometry.frontTyreLength)||0)/2,
      Number(geometry.noseTipX)||0
    );
    return {
      nativeWidth:Math.max(1,halfWidth*2),
      nativeLength:Math.max(1,maxX-minX),
      source:"historical_geometry",
    };
  }

  // GenericBody extents in RaceCarVisual.jsx.
  return {
    nativeWidth:14.4,
    nativeLength:28,
    source:"generic_sprite",
  };
}

export function raceViewLateralUnitsPerMeter({
  trackWidthM=RACE_VIEW_NOMINAL_TRACK_WIDTH_M,
  asphaltWidthSvg=RACE_VIEW_ASPHALT_WIDTH_SVG,
}={}){
  const physicalTrackWidth=clamp(trackWidthM,7,18);
  const renderedAsphaltWidth=Math.max(1,Number(asphaltWidthSvg)||RACE_VIEW_ASPHALT_WIDTH_SVG);
  return Number((renderedAsphaltWidth/physicalTrackWidth).toFixed(6));
}

export function raceCarPresentationScale({
  year,
  model,
  trackWidthM=RACE_VIEW_NOMINAL_TRACK_WIDTH_M,
  asphaltWidthSvg=RACE_VIEW_ASPHALT_WIDTH_SVG,
}={}){
  const physicalTrackWidth=clamp(trackWidthM,7,18);
  const carWidth=raceCarNominalWidthM(year);
  const targetWidthSvg=asphaltWidthSvg*(carWidth/physicalTrackWidth);
  const footprint=raceCarNativeFootprint({year,model});
  const scale=targetWidthSvg/footprint.nativeWidth;

  return {
    scale:Number(scale.toFixed(6)),
    carWidthM:carWidth,
    trackWidthM:physicalTrackWidth,
    targetWidthSvg:Number(targetWidthSvg.toFixed(6)),
    targetLengthSvg:Number((footprint.nativeLength*scale).toFixed(6)),
    widthRatio:Number((carWidth/physicalTrackWidth).toFixed(6)),
    nativeWidth:footprint.nativeWidth,
    nativeLength:footprint.nativeLength,
    source:footprint.source,
  };
}
