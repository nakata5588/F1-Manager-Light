// src/components/entity/EntityModalRoot.jsx
import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { useModalStore } from "../../state/ModalStore.js";
import DriverModal from "./DriverModal.jsx";
import TeamModal from "./TeamModal.jsx";
import EntityErrorBoundary from "./EntityErrorBoundary.jsx";

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

  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && close();
    if (isOpen) document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [isOpen, close]);

  useEffect(() => {
    if (isOpen && dialogRef.current) {
      queueMicrotask(() => {
        dialogRef.current?.focus?.({ preventScroll: true });
      });
    }
  }, [isOpen, entity]);

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
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={close}
        aria-label="Close modal"
        tabIndex={-1}
      />
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
        onWheel={(e) => e.stopPropagation()}
      >
        <EntityErrorBoundary entity={entity} onClose={close}>
          <Cmp entity={entity} onClose={close} />
        </EntityErrorBoundary>
      </div>
    </div>,
    document.body
  );
}
