// src/components/entity/EntityClickBus.jsx
import { useEffect } from "react";
import { useModalStore } from "../../state/ModalStore.js";

/**
 * Captura cliques/teclas em elementos com data-entity + data-id e abre o modal.
 * Ex.: <a data-entity="team" data-id="t_0001" data-tab="drivers">Ligier</a>
 */
export default function EntityClickBus() {
  const open = useModalStore((s) => s.open);

  useEffect(() => {
    const activate = (type, id, tab, ev) => {
      try {
        open({ type, id, tab: tab || "overview" });
      } catch (e) {
        console.warn("[EntityClickBus] open failed:", e);
      }
    };

    const onClick = (e) => {
      // já dentro de um modal? ignora
      if (e.target.closest?.('[role="dialog"]')) return;

      const el = e.target.closest?.("[data-entity][data-id]");
      if (!el) return;

      // só botão primário, sem modificadores
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const type = el.getAttribute("data-entity");
      const id   = el.getAttribute("data-id");
      const tab  = el.getAttribute("data-tab") || "overview";
      if (!type || !id) return;

      // TRAVAR NAVEGAÇÃO/ABERTURA DE NOVO TAB
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();

      // Se for <a>, travar também eventos internos
      if (el.tagName === "A") {
        el.removeAttribute("href"); // evita navegação em re-render
      }

      activate(type, id, tab, e);
    };

    const onKeyDown = (e) => {
      const el = e.target.closest?.("[data-entity][data-id]");
      if (!el) return;

      // Enter ou Space ativam
      const isEnter = e.key === "Enter";
      const isSpace = e.key === " ";
      if (!isEnter && !isSpace) return;

      const type = el.getAttribute("data-entity");
      const id   = el.getAttribute("data-id");
      const tab  = el.getAttribute("data-tab") || "overview";
      if (!type || !id) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();

      activate(type, id, tab, e);
    };

    document.addEventListener("click", onClick, true);     // capture
    document.addEventListener("keydown", onKeyDown, true); // capture
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return null;
}
