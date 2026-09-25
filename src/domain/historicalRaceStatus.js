const RESULT_CODE_INFO = Object.freeze({
  R: Object.freeze({ code:"R", key:"dnf", display:"DNF", label:"Retired", started:true, isDnf:true }),
  D: Object.freeze({ code:"D", key:"dsq", display:"DSQ", label:"Disqualified", started:true, isDnf:false }),
  E: Object.freeze({ code:"E", key:"excluded", display:"EXC", label:"Excluded", started:true, isDnf:false }),
  F: Object.freeze({ code:"F", key:"dnq", display:"DNQ", label:"Failed to qualify", started:false, isDnf:false }),
  N: Object.freeze({ code:"N", key:"nc", display:"NC", label:"Not classified", started:true, isDnf:false }),
  W: Object.freeze({ code:"W", key:"withdrawn", display:"WD", label:"Withdrew", started:false, isDnf:false }),
});

const pick=(row,keys,fb="")=>{
  for(const key of keys){
    const value=row?.[key];
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fb;
};

export function historicalResultCode(row){
  const direct=String(pick(row,["result_code","positionText","position_text"],"")).trim().toUpperCase();
  return RESULT_CODE_INFO[direct]?direct:"";
}

function statusText(row){
  return String(pick(row,["status","statusText","status_text","result_status","retirement_reason"],"")).trim();
}

function inferredCodeFromStatus(row){
  const status=statusText(row).toLowerCase();
  if(!status)return "";
  if(row?.retired===true || status==="dnf" || /(retir|accident|collision|engine|gearbox|transmission|electrical|hydraulic|suspension|brakes|puncture|fire|oil|fuel|overheat|spun|damage|mechanical|did not finish)/.test(status))return "R";
  if(/disqual/.test(status))return "D";
  if(/exclud/.test(status))return "E";
  if(/failed to qualify|did not qualify|dnq/.test(status))return "F";
  if(/not classified|\bnc\b/.test(status))return "N";
  if(/withdrew|withdrawn|\bwd\b/.test(status))return "W";
  return "";
}

export function historicalResultInfo(row){
  const code=historicalResultCode(row)||inferredCodeFromStatus(row);
  if(code&&RESULT_CODE_INFO[code])return RESULT_CODE_INFO[code];

  const status=statusText(row);
  return Object.freeze({
    code:"",
    key:"finished",
    display:null,
    label:status || "Finished",
    started:true,
    isDnf:false,
  });
}

export function historicalStatusLabel(row){
  return historicalResultInfo(row).label;
}

export function historicalResultDisplay(row){
  const info=historicalResultInfo(row);
  if(info.display)return info.display;
  const position=Number(row?.position ?? row?.pos ?? row?.finish_position);
  return Number.isFinite(position)&&position>0?String(position):"—";
}

export function historicalRaceStarted(row){
  return historicalResultInfo(row).started;
}

export function historicalIsDnf(row){
  return historicalResultInfo(row).isDnf;
}

export function historicalStatusCountKey(row){
  return historicalResultInfo(row).key;
}
