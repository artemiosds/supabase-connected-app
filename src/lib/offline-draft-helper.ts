// =============================================================================
// offline-draft-helper.ts — Armazenamento Local e Isolamento Multi-tenant
// Primus Gestão — Fase 4: Resiliência Offline & Auto-save
// =============================================================================

export interface DraftStorageEnvelope<T> {
  tenantId: string;
  userId: string;
  formId: string;
  entityId?: string;
  savedAt: string; // ISO string
  data: T;
}

export function buildDraftKey(
  tenantId: string,
  userId: string,
  formId: string,
  entityId?: string,
): string {
  const t = (tenantId || "default").trim();
  const u = (userId || "anonymous").trim();
  const f = formId.trim();
  const e = entityId ? `__${entityId.trim()}` : "";
  return `primus_draft__${t}__${u}__${f}${e}`;
}

export function saveDraft<T>(
  tenantId: string,
  userId: string,
  formId: string,
  data: T,
  entityId?: string,
): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    const key = buildDraftKey(tenantId, userId, formId, entityId);
    const envelope: DraftStorageEnvelope<T> = {
      tenantId,
      userId,
      formId,
      ...(entityId !== undefined ? { entityId } : {}),
      savedAt: new Date().toISOString(),
      data,
    };
    window.localStorage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft<T>(
  tenantId: string,
  userId: string,
  formId: string,
  entityId?: string,
): DraftStorageEnvelope<T> | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const key = buildDraftKey(tenantId, userId, formId, entityId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as DraftStorageEnvelope<T>;
    // Validação estrita de isolamento de tenant e usuário
    if (envelope.tenantId !== tenantId || envelope.userId !== userId) {
      return null;
    }
    return envelope;
  } catch {
    return null;
  }
}

export function clearDraft(
  tenantId: string,
  userId: string,
  formId: string,
  entityId?: string,
): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    const key = buildDraftKey(tenantId, userId, formId, entityId);
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function hasMeaningfulContent(obj: Record<string, unknown>): boolean {
  return Object.values(obj).some((v) => {
    if (typeof v === "string") return v.trim().length > 0;
    if (typeof v === "number") return v > 0;
    if (Array.isArray(v)) return v.length > 0;
    return false;
  });
}
