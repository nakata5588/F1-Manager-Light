// src/domain/entityRoutes.js
// Canonical full-profile routes for navigable game-world entities.

const TYPE_SEGMENTS=Object.freeze({
  driver:"drivers",
  team:"teams",
  staff:"staff",
});

export function entityProfilePath(type,id){
  const segment=TYPE_SEGMENTS[String(type||"").toLowerCase()];
  if(!segment||id===null||id===undefined||String(id)==="")return null;
  return `/${segment}/${encodeURIComponent(String(id))}`;
}

export function entityTypeFromProfilePath(pathname){
  const path=String(pathname||"");
  if(/^\/drivers\/[^/]+\/?$/i.test(path))return "driver";
  if(/^\/teams\/[^/]+\/?$/i.test(path))return "team";
  if(/^\/staff\/[^/]+\/?$/i.test(path))return "staff";
  return null;
}
