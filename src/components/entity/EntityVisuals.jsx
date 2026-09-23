import React from "react";

const ISO3_TO_2 = Object.freeze({
  ARG:"AR", AUS:"AU", AUT:"AT", BEL:"BE", BRA:"BR", CAN:"CA", CHI:"CL", CHL:"CL",
  CHN:"CN", COL:"CO", CZE:"CZ", DEN:"DK", DNK:"DK", ESP:"ES", FIN:"FI", FRA:"FR",
  GBR:"GB", GDR:"DE", GER:"DE", DEU:"DE", HUN:"HU", INA:"ID", IND:"IN", IRL:"IE",
  ITA:"IT", JPN:"JP", LIE:"LI", MAS:"MY", MYS:"MY", MEX:"MX", MON:"MC", MCO:"MC",
  NED:"NL", NLD:"NL", NZL:"NZ", POL:"PL", POR:"PT", PRT:"PT", RHO:"RH", RSA:"ZA",
  ZAF:"ZA", RUS:"RU", SUI:"CH", CHE:"CH", SWE:"SE", THA:"TH", URU:"UY", USA:"US",
  VEN:"VE", HKG:"HK",
});

const NAME_TO_2 = Object.freeze({
  "argentina":"AR","argentinian":"AR","argentine":"AR",
  "australia":"AU","australian":"AU","austria":"AT","austrian":"AT",
  "belgium":"BE","belgian":"BE","brazil":"BR","brazilian":"BR",
  "canada":"CA","canadian":"CA","chile":"CL","chilean":"CL","china":"CN","chinese":"CN",
  "colombia":"CO","colombian":"CO","czech republic":"CZ","czechia":"CZ","czech":"CZ",
  "denmark":"DK","danish":"DK","finland":"FI","finnish":"FI","france":"FR","french":"FR",
  "germany":"DE","german":"DE","east germany":"DE","hungary":"HU","hungarian":"HU",
  "india":"IN","indian":"IN","indonesia":"ID","indonesian":"ID",
  "ireland":"IE","irish":"IE","republic of ireland":"IE",
  "italy":"IT","italian":"IT","japan":"JP","japanese":"JP",
  "liechtenstein":"LI","malaysia":"MY","malaysian":"MY","mexico":"MX","mexican":"MX",
  "monaco":"MC","netherlands":"NL","dutch":"NL","new zealand":"NZ",
  "poland":"PL","polish":"PL","portugal":"PT","portuguese":"PT",
  "rhodesia":"RH","rhodesia (historic)":"RH","russia":"RU","russian":"RU",
  "south africa":"ZA","south african":"ZA","spain":"ES","spanish":"ES",
  "sweden":"SE","swedish":"SE","switzerland":"CH","swiss":"CH",
  "thailand":"TH","thai":"TH","united kingdom":"GB","great britain":"GB","british":"GB",
  "england":"GB","english":"GB","scotland":"GB","scottish":"GB",
  "united states":"US","united states of america":"US","usa":"US","american":"US",
  "uruguay":"UY","uruguayan":"UY","venezuela":"VE","venezuelan":"VE","hong kong":"HK",
});

const COUNTRY_NAME_BY_2 = Object.freeze({
  AR:"Argentina", AU:"Australia", AT:"Austria", BE:"Belgium", BR:"Brazil", CA:"Canada",
  CL:"Chile", CN:"China", CO:"Colombia", CZ:"Czech Republic", DK:"Denmark", ES:"Spain",
  FI:"Finland", FR:"France", GB:"United Kingdom", DE:"Germany", HU:"Hungary", ID:"Indonesia",
  IN:"India", IE:"Ireland", IT:"Italy", JP:"Japan", LI:"Liechtenstein", MY:"Malaysia",
  MX:"Mexico", MC:"Monaco", NL:"Netherlands", NZ:"New Zealand", PL:"Poland", PT:"Portugal",
  RH:"Rhodesia (historic)", RU:"Russia", ZA:"South Africa", SE:"Sweden", CH:"Switzerland",
  TH:"Thailand", UY:"Uruguay", US:"United States", VE:"Venezuela", HK:"Hong Kong",
});

export function countryNameFor(country = "", code = "") {
  const raw=String(country||"").trim();
  if(raw&&raw!=="—"&&raw!=="#N/A")return raw;
  const cc=countryCodeFor(raw,code);
  return COUNTRY_NAME_BY_2[cc]||"";
}


export function countryCodeFor(country = "", code = "") {
  let cc=String(code||"").trim().toUpperCase().replace(/[^A-Z]/g,"");
  if(cc.length===3)cc=ISO3_TO_2[cc]||"";
  if(cc.length===2)return cc;

  const raw=String(country||"").trim();
  const mapped=NAME_TO_2[raw.toLowerCase()];
  if(mapped)return mapped;

  const cleaned=raw.toUpperCase().replace(/[^A-Z]/g,"");
  if(cleaned.length===3)return ISO3_TO_2[cleaned]||"";
  if(cleaned.length===2)return cleaned;
  return "";
}

// Backwards-compatible API used throughout the current UI. It now returns the
// same inline SVG component so existing pages immediately stop depending on
// operating-system flag emoji rendering.
export function flagFromCountry(country = "", code = "") {
  return <CountryFlag country={country} code={code} />;
}

function FlagGraphic({code}){
  switch(code){
    case "US": return <><rect width="30" height="20" fill="#fff"/><g fill="#b22234"><rect y="0" width="30" height="2"/><rect y="4" width="30" height="2"/><rect y="8" width="30" height="2"/><rect y="12" width="30" height="2"/><rect y="16" width="30" height="2"/></g><rect width="13" height="10" fill="#3c3b6e"/><g fill="#fff"><circle cx="2.5" cy="2.5" r=".8"/><circle cx="6.5" cy="2.5" r=".8"/><circle cx="10.5" cy="2.5" r=".8"/><circle cx="4.5" cy="5.5" r=".8"/><circle cx="8.5" cy="5.5" r=".8"/><circle cx="2.5" cy="8.5" r=".8"/><circle cx="6.5" cy="8.5" r=".8"/><circle cx="10.5" cy="8.5" r=".8"/></g></>;
    case "CA": return <><rect width="30" height="20" fill="#fff"/><rect width="6" height="20" fill="#d80621"/><rect x="24" width="6" height="20" fill="#d80621"/><path d="M15 3l1.2 3 2.8-1-1 3 2 1.2-3 1 1 3-3-1-3 1 1-3-3-1 2-1.2-1-3 2.8 1z" fill="#d80621"/></>;
    case "GB": return <><rect width="30" height="20" fill="#012169"/><path d="M0 0l30 20M30 0L0 20" stroke="#fff" strokeWidth="4"/><path d="M0 0l30 20M30 0L0 20" stroke="#c8102e" strokeWidth="2"/><path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6"/><path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="3"/></>;
    case "IE": return <><rect width="10" height="20" fill="#169b62"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ff883e"/></>;
    case "PT": return <><rect width="12" height="20" fill="#046a38"/><rect x="12" width="18" height="20" fill="#da291c"/><circle cx="12" cy="10" r="3.5" fill="#ffcd00"/><circle cx="12" cy="10" r="2.2" fill="#fff"/><circle cx="12" cy="10" r="1.3" fill="#046a38"/></>;
    case "MX": return <><rect width="10" height="20" fill="#006847"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ce1126"/><circle cx="15" cy="10" r="2" fill="#8b5a2b"/></>;
    case "JP": return <><rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="5" fill="#bc002d"/></>;
    case "DE": return <><rect width="30" height="6.67" fill="#000"/><rect y="6.67" width="30" height="6.67" fill="#dd0000"/><rect y="13.34" width="30" height="6.66" fill="#ffce00"/></>;
    case "FR": return <><rect width="10" height="20" fill="#0055a4"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ef4135"/></>;
    case "IT": return <><rect width="10" height="20" fill="#009246"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ce2b37"/></>;
    case "ES": return <><rect width="30" height="20" fill="#aa151b"/><rect y="5" width="30" height="10" fill="#f1bf00"/></>;
    case "NL": return <><rect width="30" height="6.67" fill="#ae1c28"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><rect y="13.34" width="30" height="6.66" fill="#21468b"/></>;
    case "BE": return <><rect width="10" height="20" fill="#000"/><rect x="10" width="10" height="20" fill="#ffd90c"/><rect x="20" width="10" height="20" fill="#ef3340"/></>;
    case "BR": return <><rect width="30" height="20" fill="#009c3b"/><path d="M15 3l10 7-10 7L5 10z" fill="#ffdf00"/><circle cx="15" cy="10" r="4" fill="#002776"/></>;
    case "AR": return <><rect width="30" height="6.67" fill="#74acdf"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><rect y="13.34" width="30" height="6.66" fill="#74acdf"/><circle cx="15" cy="10" r="1.7" fill="#f6b40e"/></>;
    case "CL": return <><rect width="30" height="10" fill="#fff"/><rect y="10" width="30" height="10" fill="#d52b1e"/><rect width="10" height="10" fill="#0039a6"/><circle cx="5" cy="5" r="1.5" fill="#fff"/></>;
    case "CN": return <><rect width="30" height="20" fill="#de2910"/><circle cx="6" cy="5" r="2.3" fill="#ffde00"/></>;
    case "CO": return <><rect width="30" height="10" fill="#fcd116"/><rect y="10" width="30" height="5" fill="#003893"/><rect y="15" width="30" height="5" fill="#ce1126"/></>;
    case "CZ": return <><rect width="30" height="10" fill="#fff"/><rect y="10" width="30" height="10" fill="#d7141a"/><path d="M0 0l12 10L0 20z" fill="#11457e"/></>;
    case "DK": return <><rect width="30" height="20" fill="#c60c30"/><rect x="9" width="3" height="20" fill="#fff"/><rect y="8.5" width="30" height="3" fill="#fff"/></>;
    case "FI": return <><rect width="30" height="20" fill="#fff"/><rect x="9" width="4" height="20" fill="#003580"/><rect y="8" width="30" height="4" fill="#003580"/></>;
    case "HU": return <><rect width="30" height="6.67" fill="#ce2939"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><rect y="13.34" width="30" height="6.66" fill="#477050"/></>;
    case "ID": return <><rect width="30" height="10" fill="#ce1126"/><rect y="10" width="30" height="10" fill="#fff"/></>;
    case "IN": return <><rect width="30" height="6.67" fill="#ff9933"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><rect y="13.34" width="30" height="6.66" fill="#138808"/><circle cx="15" cy="10" r="2" fill="none" stroke="#000080" strokeWidth=".8"/></>;
    case "LI": return <><rect width="30" height="10" fill="#002b7f"/><rect y="10" width="30" height="10" fill="#ce1126"/><circle cx="6" cy="5" r="1.6" fill="#f6d14a"/></>;
    case "MY": return <><rect width="30" height="20" fill="#fff"/><g fill="#cc0001"><rect y="0" width="30" height="2"/><rect y="4" width="30" height="2"/><rect y="8" width="30" height="2"/><rect y="12" width="30" height="2"/><rect y="16" width="30" height="2"/></g><rect width="14" height="10" fill="#010066"/><circle cx="6" cy="5" r="3" fill="#fc0"/><circle cx="7" cy="5" r="2.4" fill="#010066"/></>;
    case "MC": return <><rect width="30" height="10" fill="#ce1126"/><rect y="10" width="30" height="10" fill="#fff"/></>;
    case "PL": return <><rect width="30" height="10" fill="#fff"/><rect y="10" width="30" height="10" fill="#dc143c"/></>;
    case "RH": return <><rect width="30" height="6" fill="#2e8b57"/><rect y="6" width="30" height="8" fill="#fff"/><rect y="14" width="30" height="6" fill="#2e8b57"/><circle cx="15" cy="10" r="1.8" fill="#b08d34"/></>;
    case "RU": return <><rect width="30" height="6.67" fill="#fff"/><rect y="6.67" width="30" height="6.67" fill="#0039a6"/><rect y="13.34" width="30" height="6.66" fill="#d52b1e"/></>;
    case "ZA": return <><rect width="30" height="20" fill="#007749"/><path d="M0 0l12 10L0 20" fill="#000"/><path d="M0 2l10 8L0 18" fill="none" stroke="#ffb81c" strokeWidth="3"/><path d="M10 8h20v4H10z" fill="#fff"/><path d="M12 8h18v4H12z" fill="#007749"/><path d="M15 0h15v7H15z" fill="#de3831"/><path d="M15 13h15v7H15z" fill="#002395"/></>;
    case "SE": return <><rect width="30" height="20" fill="#006aa7"/><rect x="9" width="3" height="20" fill="#fecc00"/><rect y="8.5" width="30" height="3" fill="#fecc00"/></>;
    case "CH": return <><rect width="30" height="20" fill="#d52b1e"/><rect x="13" y="4" width="4" height="12" fill="#fff"/><rect x="9" y="8" width="12" height="4" fill="#fff"/></>;
    case "TH": return <><rect width="30" height="3" fill="#a51931"/><rect y="3" width="30" height="3" fill="#fff"/><rect y="6" width="30" height="8" fill="#2d2a4a"/><rect y="14" width="30" height="3" fill="#fff"/><rect y="17" width="30" height="3" fill="#a51931"/></>;
    case "UY": return <><rect width="30" height="20" fill="#fff"/><g fill="#0038a8"><rect y="4" width="30" height="2"/><rect y="8" width="30" height="2"/><rect y="12" width="30" height="2"/><rect y="16" width="30" height="2"/></g><circle cx="5" cy="5" r="2.3" fill="#f6b40e"/></>;
    case "VE": return <><rect width="30" height="6.67" fill="#f4d900"/><rect y="6.67" width="30" height="6.67" fill="#0033a0"/><rect y="13.34" width="30" height="6.66" fill="#cf142b"/></>;
    case "AT": return <><rect width="30" height="6.67" fill="#ed2939"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><rect y="13.34" width="30" height="6.66" fill="#ed2939"/></>;
    case "AU": return <><rect width="30" height="20" fill="#00008b"/><rect width="14" height="10" fill="#012169"/><path d="M0 0l14 10M14 0L0 10" stroke="#fff" strokeWidth="2"/><path d="M7 0v10M0 5h14" stroke="#fff" strokeWidth="3"/><path d="M7 0v10M0 5h14" stroke="#c8102e" strokeWidth="1.5"/><circle cx="22" cy="11" r="1.4" fill="#fff"/><circle cx="25" cy="16" r="1" fill="#fff"/></>;
    case "NZ": return <><rect width="30" height="20" fill="#00247d"/><rect width="14" height="10" fill="#012169"/><path d="M0 0l14 10M14 0L0 10" stroke="#fff" strokeWidth="2"/><path d="M7 0v10M0 5h14" stroke="#fff" strokeWidth="3"/><path d="M7 0v10M0 5h14" stroke="#c8102e" strokeWidth="1.5"/><circle cx="22" cy="6" r="1.4" fill="#cc142b"/><circle cx="25" cy="12" r="1.4" fill="#cc142b"/></>;
    case "HK": return <><rect width="30" height="20" fill="#de2910"/><g fill="#fff" transform="translate(15 10)"><ellipse rx="1.2" ry="4" transform="rotate(0) translate(0 -3)"/><ellipse rx="1.2" ry="4" transform="rotate(72) translate(0 -3)"/><ellipse rx="1.2" ry="4" transform="rotate(144) translate(0 -3)"/><ellipse rx="1.2" ry="4" transform="rotate(216) translate(0 -3)"/><ellipse rx="1.2" ry="4" transform="rotate(288) translate(0 -3)"/></g></>;
    default: return <><rect width="30" height="20" fill="#27384f"/><path d="M4 4h22v12H4z" fill="none" stroke="#8fa0b8" strokeWidth="1.2"/><path d="M5 5l20 10M25 5L5 15" stroke="#8fa0b8" strokeWidth=".7"/></>;
  }
}

export function CountryFlag({country="",code="",className="",title=null,size="md"}){
  const cc=countryCodeFor(country,code);
  const dimensions=size==="sm"?"h-[12px] w-[18px]":size==="lg"?"h-[20px] w-[30px]":"h-[14px] w-[20px]";
  const label=title||String(country||code||"Unknown nationality");
  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-[2px] border border-white/25 bg-slate-800 shadow-sm align-middle ${dimensions} ${className}`}
      title={label}
      aria-label={label}
      role="img"
    >
      <svg viewBox="0 0 30 20" className="h-full w-full" aria-hidden="true">
        <FlagGraphic code={cc}/>
      </svg>
    </span>
  );
}

export function DriverPortrait({ driver, size = "h-8 w-8", className = "" }) {
  const name = driver?.display_name || driver?.name || driver?.driver_name || "Driver";
  const src = driver?.portrait_path || driver?.portrait || null;
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${size} rounded-full object-cover bg-gray-100 ring-1 ring-black/10 ${className}`}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    );
  }
  const initials = name.split(/\s+/).filter(Boolean).map((x) => x[0]).join("").slice(0,2).toUpperCase();
  return (
    <div className={`${size} rounded-full bg-gray-100 ring-1 ring-black/10 flex items-center justify-center text-[10px] font-semibold ${className}`}>
      {initials || "?"}
    </div>
  );
}

export function TeamLogo({ teamId, name = "Team", size = "h-8 w-8", className = "" }) {
  if (!teamId) {
    return <div className={`${size} rounded bg-gray-100 ${className}`} />;
  }
  return (
    <img
      src={`/logos/teams/${String(teamId).toLowerCase()}.png`}
      alt={name}
      className={`${size} object-contain rounded bg-white ${className}`}
      onError={(e) => { e.currentTarget.style.display = "none"; }}
    />
  );
}
