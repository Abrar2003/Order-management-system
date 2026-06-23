import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api/axios";

const DEFAULT_SAVE_DELAY_MS = 1200;

const serializeDraftPayload = (payload) => {
  try {
    return JSON.stringify(payload || {});
  } catch {
    return "";
  }
};

const buildDraftUrl = ({ basePath, mode, recordId = "" }) => {
  const params = new URLSearchParams();
  params.set("mode", mode);
  if (recordId) {
    params.set("record_id", recordId);
  }
  return `${basePath}?${params.toString()}`;
};

const formatDraftTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const useFormDraft = ({
  enabled = true,
  basePath = "",
  mode = "",
  recordId = "",
  form,
  setForm,
  draftValue,
  onDraftRestore,
  saveDelayMs = DEFAULT_SAVE_DELAY_MS,
} = {}) => {
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const formRef = useRef(form);
  const loadedRef = useRef(false);
  const lastSavedPayloadRef = useRef("");
  const loadTokenRef = useRef(0);
  const saveGenerationRef = useRef(0);
  const onDraftRestoreRef = useRef(onDraftRestore);
  const effectiveDraftValue = draftValue === undefined ? form : draftValue;

  useEffect(() => {
    formRef.current = effectiveDraftValue;
  }, [effectiveDraftValue]);

  useEffect(() => {
    onDraftRestoreRef.current = onDraftRestore;
  }, [onDraftRestore]);

  const draftUrl = useMemo(() => {
    if (!enabled || !basePath || !mode) return "";
    return buildDraftUrl({ basePath, mode, recordId });
  }, [basePath, enabled, mode, recordId]);

  useEffect(() => {
    loadedRef.current = false;
    lastSavedPayloadRef.current = "";
    setStatus("");
    setMessage("");

    if (!draftUrl) return undefined;

    let ignore = false;
    const loadToken = loadTokenRef.current + 1;
    loadTokenRef.current = loadToken;

    const loadDraft = async () => {
      try {
        setStatus("loading");
        setMessage("Checking draft...");
        const response = await api.get(draftUrl);
        if (ignore || loadTokenRef.current !== loadToken) return;

        const draft = response?.data?.data;
        const payload = draft?.payload;
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          if (typeof onDraftRestoreRef.current === "function") {
            onDraftRestoreRef.current(payload);
          } else {
            setForm(payload);
          }
          lastSavedPayloadRef.current = serializeDraftPayload(payload);
          const restoredAt = formatDraftTime(draft.updated_at);
          setStatus("restored");
          setMessage(restoredAt ? `Draft restored from ${restoredAt}` : "Draft restored");
        } else {
          lastSavedPayloadRef.current = serializeDraftPayload(formRef.current);
          setStatus("");
          setMessage("");
        }
      } catch {
        if (!ignore && loadTokenRef.current === loadToken) {
          lastSavedPayloadRef.current = serializeDraftPayload(formRef.current);
          setStatus("error");
          setMessage("Draft recovery unavailable");
        }
      } finally {
        if (!ignore && loadTokenRef.current === loadToken) {
          loadedRef.current = true;
        }
      }
    };

    loadDraft();

    return () => {
      ignore = true;
    };
  }, [draftUrl, setForm]);

  useEffect(() => {
    if (!draftUrl || !loadedRef.current) return undefined;

    const serialized = serializeDraftPayload(effectiveDraftValue);
    if (!serialized || serialized === lastSavedPayloadRef.current) {
      return undefined;
    }
    const saveGeneration = saveGenerationRef.current;

    const timeoutId = setTimeout(async () => {
      if (saveGenerationRef.current !== saveGeneration) return;
      try {
        setStatus("saving");
        setMessage("Saving draft...");
        const response = await api.put(draftUrl, {
          mode,
          record_id: recordId,
          payload: formRef.current || {},
        });
        if (saveGenerationRef.current !== saveGeneration) {
          try {
            await api.delete(draftUrl);
          } catch {
            // Clearing after a stale save is best-effort only.
          }
          return;
        }
        const savedPayload = response?.data?.data?.payload || formRef.current || {};
        lastSavedPayloadRef.current = serializeDraftPayload(savedPayload);
        setStatus("saved");
        setMessage("Draft saved");
      } catch {
        setStatus("error");
        setMessage("Draft save failed");
      }
    }, saveDelayMs);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [draftUrl, effectiveDraftValue, mode, recordId, saveDelayMs]);

  const clearDraft = useCallback(async ({ resetStatus = true } = {}) => {
    if (!draftUrl) return;
    saveGenerationRef.current += 1;
    try {
      await api.delete(draftUrl);
      lastSavedPayloadRef.current = serializeDraftPayload(formRef.current);
      if (resetStatus) {
        setStatus("cleared");
        setMessage("Draft discarded");
      }
    } catch {
      if (resetStatus) {
        setStatus("error");
        setMessage("Draft discard failed");
      }
    }
  }, [draftUrl]);

  const pauseDraftSaves = useCallback(() => {
    saveGenerationRef.current += 1;
    loadedRef.current = false;
  }, []);

  const resumeDraftSaves = useCallback(() => {
    loadedRef.current = true;
  }, []);

  return {
    clearDraft,
    pauseDraftSaves,
    resumeDraftSaves,
    draftMessage: message,
    draftStatus: status,
    hasDraftStatus: Boolean(message),
  };
};

export default useFormDraft;
