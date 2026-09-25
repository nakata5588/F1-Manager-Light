function stableHash(value){
  let hash=2166136261;
  for(const ch of String(value??"")){
    hash^=ch.charCodeAt(0);
    hash=Math.imul(hash,16777619)>>>0;
  }
  return hash>>>0;
}

function unit(hash,shift=0){
  return (((hash>>>shift)&1023)/1023)-0.5;
}

export function liveSectorShares(driverId,lap=1){
  const profileHash=stableHash(`sector-profile:${driverId}`);
  const lapHash=stableHash(`sector-lap:${driverId}:${Math.max(1,Number(lap)||1)}`);

  // Keep each driver's sector character mostly stable across the race.
  // The previous model regenerated large +/-1.3% lap-share swings every lap,
  // which could manufacture several temporary overtakes inside one sector.
  const profile1=unit(profileHash,0)*0.0024;
  const profile2=unit(profileHash,10)*0.0024;
  const lapJitter1=unit(lapHash,0)*0.0008;
  const lapJitter2=unit(lapHash,10)*0.0008;

  const sector1=0.327+profile1+lapJitter1;
  const sector2=0.337+profile2+lapJitter2;
  const sector3=1-sector1-sector2;

  return {
    sector_1_share:sector1,
    sector_2_share:sector2,
    sector_3_share:sector3,
  };
}

export function liveSectorTimesForLap(lapMs,driverId,lap=1){
  const total=Number(lapMs);
  if(!Number.isFinite(total)||total<=0){
    return {sector_1_ms:null,sector_2_ms:null,sector_3_ms:null};
  }
  const shares=liveSectorShares(driverId,lap);
  const s1=Math.max(1,Math.round(total*shares.sector_1_share));
  const s2=Math.max(1,Math.round(total*shares.sector_2_share));
  const s3=Math.max(1,total-s1-s2);
  return {sector_1_ms:s1,sector_2_ms:s2,sector_3_ms:s3};
}
