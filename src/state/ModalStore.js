import { create } from "zustand";

/**
 * Store do modal com guardas para evitar loops:
 * - Só mexe no history/URL se houver mudança real
 * - _openFromURL/_closeFromURL não mexem no history (evita eco)
 * - setTab só corre se o tab mudou
 *
 * API pública:
 * - open(entity) / close()
 * - setTab(tab)
 * - setEntity(entity) / clearEntity()  // aliases de compatibilidade
 *
 * Entity shape esperado:
 * { type: "driver" | "team" | "staff" | "sponsor" | ... , id: string|number, tab?: string }
 */

export const useModalStore = create((set, get) => ({
  isOpen: false,
  entity: null, // { type:"driver"|..., id:"", tab? }

  /** Abre o modal para a entidade indicada e sincroniza o URL (?e=type:id&tab=...) */
  open(entity) {
    if (!entity?.type || entity.id == null) return;

    const st = get();
    const same =
      st.isOpen &&
      st.entity &&
      st.entity.type === entity.type &&
      String(st.entity.id) === String(entity.id) &&
      (st.entity.tab ?? "overview") === (entity.tab ?? "overview");

    if (!same) set({ isOpen: true, entity: { ...entity } });

    // Atualiza querystring (guard para evitar writes redundantes)
    try {
      const params = new URLSearchParams(window.location.search);
      const next = new URLSearchParams(params);
      next.set("e", `${entity.type}:${entity.id}`);
      if (entity.tab) next.set("tab", entity.tab);
      else next.delete("tab");
      const nextQs = `?${next.toString()}`;
      if (nextQs !== window.location.search) {
        history.pushState(null, "", nextQs);
      }
    } catch {
      /* no-op em ambiente sem window */
    }
  },

  /** Fecha o modal e limpa parâmetros do URL relacionados com a entidade */
  close() {
    const st = get();
    if (!st.isOpen) return;

    // no-op se já está fechado
    set({ isOpen: false, entity: null });

    try {
      const params = new URLSearchParams(window.location.search);
      params.delete("e");
      params.delete("tab");
      const nextQs = params.toString()
        ? `?${params.toString()}`
        : window.location.pathname;
      const current = window.location.search || window.location.pathname;
      if (nextQs !== current) {
        history.pushState(null, "", nextQs);
      }
    } catch {
      /* no-op */
    }
  },

  /** Troca de tab mantendo a mesma entidade, e faz replaceState no URL */
  setTab(tab) {
    const prev = get().entity;
    if (!prev) return;

    const prevTab = prev.tab ?? "overview";
    if (prevTab === tab) return; // guard

    const nextEntity = { ...prev, tab };
    set({ entity: nextEntity });

    try {
      const params = new URLSearchParams(window.location.search);
      params.set("e", `${nextEntity.type}:${nextEntity.id}`);
      params.set("tab", tab);
      const nextQs = `?${params.toString()}`;
      if (nextQs !== window.location.search) {
        history.replaceState(null, "", nextQs);
      }
    } catch {
      /* no-op */
    }
  },

  // ---- Aliases de compatibilidade (para código antigo) ----
  setEntity(entity) {
    get().open(entity);
  },
  clearEntity() {
    get().close();
  },

  // ---- Internos (deep-link, não mexem no history) ----
  _openFromURL(entity) {
    if (!entity?.type || entity.id == null) return;
    const st = get();
    const same =
      st.isOpen &&
      st.entity &&
      st.entity.type === entity.type &&
      String(st.entity.id) === String(entity.id) &&
      (st.entity.tab ?? "overview") === (entity.tab ?? "overview");
    if (!same) set({ isOpen: true, entity: { ...entity } });
  },

  _closeFromURL() {
    const st = get();
    if (st.isOpen || st.entity) set({ isOpen: false, entity: null });
  },
}));

let __entityDeepLinkBound = false;

/**
 * Liga o deep-link uma única vez.
 * Formato suportado:
 *   ?e=TYPE:ID&tab=overview
 * Ex.: ?e=team:t_0005&tab=drivers
 */
export function bindEntityDeepLinkOnce() {
  if (__entityDeepLinkBound) return () => {};
  __entityDeepLinkBound = true;

  const openFromURL = useModalStore.getState()._openFromURL;
  const closeFromURL = useModalStore.getState()._closeFromURL;

  const applyFromURL = () => {
    try {
      const p = new URLSearchParams(window.location.search);
      const e = p.get("e");
      const tab = p.get("tab") || "overview";
      if (e) {
        const [type, id] = e.split(":");
        if (type && id != null && id !== "") {
          openFromURL({ type, id, tab });
          return;
        }
      }
      closeFromURL();
    } catch {
      /* no-op */
    }
  };

  window.addEventListener("popstate", applyFromURL);
  // usar microtask garante que a leitura do location já está estável
  queueMicrotask(applyFromURL);

  return () => {
    window.removeEventListener("popstate", applyFromURL);
    __entityDeepLinkBound = false;
  };
}
