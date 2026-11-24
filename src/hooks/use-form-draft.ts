// =============================================================================
// use-form-draft.ts — Hook Reutilizável de Auto-Save e Estado Online/Offline
// Primus Gestão — Fase 4
// =============================================================================

import { useEffect, useRef, useState, useCallback } from "react";
import {
  clearDraft,
  hasMeaningfulContent,
  loadDraft,
  saveDraft,
  type DraftStorageEnvelope,
} from "@/lib/offline-draft-helper";

interface UseFormDraftOptions<T extends Record<string, unknown>> {
  tenantId: string;
  userId: string;
  formId: string;
  entityId?: string;
  currentData: T;
  onRestore: (data: T) => void;
  debounceMs?: number;
}

export function useFormDraft<T extends Record<string, unknown>>({
  tenantId,
  userId,
  formId,
  entityId,
  currentData,
  onRestore,
  debounceMs = 1000,
}: UseFormDraftOptions<T>) {
  const [draftAvailable, setDraftAvailable] = useState<DraftStorageEnvelope<T> | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const dataRef = useRef(currentData);
  dataRef.current = currentData;

  // Monitoramento de conexão online/offline
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Checagem inicial de rascunho existente
  useEffect(() => {
    if (!tenantId || !userId) return;
    const existing = loadDraft<T>(tenantId, userId, formId, entityId);
    if (existing && hasMeaningfulContent(existing.data)) {
      setDraftAvailable(existing);
    }
  }, [tenantId, userId, formId, entityId]);

  // Auto-save com debounce
  useEffect(() => {
    if (!tenantId || !userId) return;
    if (!hasMeaningfulContent(currentData)) return;

    const timer = setTimeout(() => {
      const saved = saveDraft(tenantId, userId, formId, currentData, entityId);
      if (saved) {
        setLastSavedAt(
          new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        );
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [currentData, tenantId, userId, formId, entityId, debounceMs]);

  const restore = useCallback(() => {
    if (draftAvailable) {
      onRestore(draftAvailable.data);
      setDraftAvailable(null);
    }
  }, [draftAvailable, onRestore]);

  const discard = useCallback(() => {
    clearDraft(tenantId, userId, formId, entityId);
    setDraftAvailable(null);
  }, [tenantId, userId, formId, entityId]);

  const clear = useCallback(() => {
    clearDraft(tenantId, userId, formId, entityId);
    setDraftAvailable(null);
    setLastSavedAt(null);
  }, [tenantId, userId, formId, entityId]);

  return {
    isOnline,
    draftAvailable,
    lastSavedAt,
    restoreDraft: restore,
    discardDraft: discard,
    clearDraft: clear,
  };
}
