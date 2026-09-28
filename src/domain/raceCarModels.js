// src/domain/raceCarModels.js
// Cars 4.1A — historical chassis timeline for Race View.
// Source index: StatsF1 1980 model and individual model/GP pages.
// This is presentation data only; it never changes race performance or physics.

export const RACE_CAR_ROUNDS_1980=Object.freeze([
  {round:1,gp:"Argentina"},
  {round:2,gp:"Brazil"},
  {round:3,gp:"South Africa"},
  {round:4,gp:"USA West"},
  {round:5,gp:"Belgium"},
  {round:6,gp:"Monaco"},
  {round:7,gp:"France"},
  {round:8,gp:"Great Britain"},
  {round:9,gp:"Germany"},
  {round:10,gp:"Austria"},
  {round:11,gp:"Netherlands"},
  {round:12,gp:"Italy"},
  {round:13,gp:"Canada"},
  {round:14,gp:"USA"},
]);

const TIMELINES_1980=Object.freeze({
  t_0001:Object.freeze([{model:"FW07B",from_round:1,to_round:14}]),
  t_0002:Object.freeze([{model:"JS11/15",from_round:1,to_round:14}]),
  t_0003:Object.freeze([{model:"BT49",from_round:1,to_round:14}]),
  t_0004:Object.freeze([{model:"RE20",from_round:1,to_round:14}]),
  t_0005:Object.freeze([{model:"81",from_round:1,to_round:14}]),
  t_0006:Object.freeze([
    {model:"009",from_round:1,to_round:2},
    {model:"010",from_round:3,to_round:14},
  ]),
  t_0007:Object.freeze([{model:"A3",from_round:1,to_round:14}]),
  t_0008:Object.freeze([
    {model:"F7",from_round:1,to_round:8},
    {model:"F8",from_round:9,to_round:14},
  ]),
  t_0009:Object.freeze([{model:"M29",from_round:1,to_round:14}]),
  t_0010:Object.freeze([{model:"312T5",from_round:1,to_round:14}]),
  t_0011:Object.freeze([{model:"179",from_round:1,to_round:14}]),
  t_0012:Object.freeze([
    {model:"D3",from_round:1,to_round:2},
    {model:"D4",from_round:3,to_round:14},
  ]),
  t_0013:Object.freeze([{model:"N180",from_round:1,to_round:14}]),
  t_0014:Object.freeze([{model:"FA1",from_round:1,to_round:14}]),
  // Shadow's last verified 1980 chassis is retained after its final 1980 entry
  // so a simulated full season always has a deterministic visual model.
  t_0015:Object.freeze([
    {model:"DN11",from_round:1,to_round:6},
    {model:"DN12",from_round:7,to_round:14},
  ]),
});

// Some 1980 transitions were not team-wide. These entry overrides preserve
// mixed-chassis weekends while keeping the common case as team+round data.
const ENTRY_OVERRIDES_1980=Object.freeze([
  {team_id:"t_0001",model:"FW07",from_round:1,to_round:1,driver_number:27,driver_name:"Alan Jones"},
  {team_id:"t_0005",model:"81B",from_round:10,to_round:12,driver_number:43,driver_name:"Nigel Mansell"},
  {team_id:"t_0008",model:"F8",from_round:8,to_round:8,driver_number:20,driver_name:"Emerson Fittipaldi"},
  {team_id:"t_0009",model:"M30",from_round:11,to_round:14,driver_number:8,driver_name:"Alain Prost"},
  // At South Africa StatsF1 records Lammers in the D3 and Surer in the D4
  // with the same number, so driver name is the only safe discriminator.
  {team_id:"t_0012",model:"D3",from_round:3,to_round:3,driver_name:"Jan Lammers"},
  {team_id:"t_0015",model:"DN12",from_round:5,to_round:6,driver_number:17,driver_name:"Geoff Lees"},
]);

function normaliseName(value){
  return String(value||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .trim();
}

function inRoundRange(row,round){
  return round>=Number(row.from_round)&&round<=Number(row.to_round);
}

function overrideMatchesIdentity(row,{driverNumber,driverName}){
  const expectedName=normaliseName(row.driver_name);
  const actualName=normaliseName(driverName);
  if(expectedName&&actualName&&expectedName===actualName)return true;
  if(row.driver_number!=null&&driverNumber!=null&&String(row.driver_number)===String(driverNumber))return true;
  return !expectedName&&row.driver_number==null;
}

export function historicalRaceCarModel({
  year,
  teamId,
  round,
  driverNumber=null,
  driverName="",
}={}){
  if(Number(year)!==1980)return null;
  const targetRound=Number(round);
  if(!Number.isInteger(targetRound)||targetRound<1||targetRound>14)return null;
  const team_id=String(teamId||"");
  if(!team_id)return null;

  const override=ENTRY_OVERRIDES_1980.find((row)=>(
    row.team_id===team_id
    &&inRoundRange(row,targetRound)
    &&overrideMatchesIdentity(row,{driverNumber,driverName})
  ));
  if(override){
    return {
      year:1980,
      team_id,
      round:targetRound,
      model:override.model,
      from_round:override.from_round,
      to_round:override.to_round,
      resolution:"entry_override",
    };
  }

  const segment=(TIMELINES_1980[team_id]||[]).find((row)=>inRoundRange(row,targetRound));
  if(!segment)return null;
  return {
    year:1980,
    team_id,
    round:targetRound,
    ...segment,
    resolution:"team_timeline",
  };
}

export function historicalRaceCarModelTimelineForYear(year){
  if(Number(year)!==1980)return [];
  return Object.entries(TIMELINES_1980).flatMap(([team_id,segments])=>(
    segments.map((segment)=>({year:1980,team_id,...segment}))
  ));
}

export function historicalRaceCarModelOverridesForYear(year){
  if(Number(year)!==1980)return [];
  return ENTRY_OVERRIDES_1980.map((row)=>({year:1980,...row}));
}
