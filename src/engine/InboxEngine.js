// Sincroniza Inbox com outputs dos outros motores / eventos
export function syncInbox(gs) {
  const next = { ...gs };
  next.inbox = Array.isArray(gs.inbox) ? gs.inbox.slice(0, 200) : [];
  // Poderias consolidar duplicados, ordenar por data, etc.
  return next;
}
