// src/components/entity/EntityModalRoot.jsx
import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { useModalStore } from "../../state/ModalStore.js";
import DriverModal from "./DriverModal.jsx";
import TeamModal from "./TeamModal.jsx";

const MODALS = {
  driver: DriverModal,
  team: TeamModal,
  // staff: StaffModal,
  // gp: GpModal,
  // sponsor: SponsorModal,
};

export default function EntityModalRoot() {
  const { isOpen, entity, close } = useModalStore();
  const dialogRef = useRef(null);

  // Fechar por ESC
  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && close();
    if (isOpen) document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [isOpen, close]);

  // Focus inicial no container do modal (a11y)
  useEffect(() => {
    if (isOpen && dialogRef.current) {
      // microtask para garantir que o conteúdo já montou
      queueMicrotask(() => {
        dialogRef.current?.focus?.({ preventScroll: true });
      });
    }
  }, [isOpen, entity]);

  // Bloquear scroll do body enquanto o modal está aberto
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen || !entity) return null;

  const Cmp = MODALS[entity.type];
  if (!Cmp) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={close}
        aria-label="Close modal"
        // torna o backdrop focável para leitores de ecrã
        tabIndex={-1}
      />
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="
          absolute left-1/2 top-1/2
          w-[1200px] max-w-[96vw]
          max-h-[92vh] overflow-hidden
          -translate-x-1/2 -translate-y-1/2
          rounded-2xl bg-white dark:bg-slate-900 shadow-2xl
          outline-none
        "
        // impedir que o scroll do rato “perfure” para o body em alguns browsers
        onWheel={(e) => e.stopPropagation()}
      >
        <Cmp entity={entity} onClose={close} />
      </div>
    </div>,
    document.body
  );
}
