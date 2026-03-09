import { useLayoutEffect, useMemo, useRef } from "react";
import { areSearchParamsEquivalent } from "../utils/searchParams";

export const useRememberSearchParams = (
  searchParams,
  setSearchParams,
  storageKey,
) => {
  const hasInitialized = useRef(false);
  const restoreAttempts = useRef(0);
  const normalizedStorageKey = useMemo(
    () => String(storageKey || "").trim(),
    [storageKey],
  );
  const currentQuery = searchParams.toString();

  useLayoutEffect(() => {
    if (!normalizedStorageKey) return;
    const key = `page-query:${normalizedStorageKey}`;
    const savedQuery = String(sessionStorage.getItem(key) || "").trim();

    if (!hasInitialized.current) {
      if (!currentQuery && savedQuery) {
        if (restoreAttempts.current < 5 && !areSearchParamsEquivalent(savedQuery, currentQuery)) {
          restoreAttempts.current += 1;
          setSearchParams(new URLSearchParams(savedQuery), { replace: true });
          return;
        }
      }

      hasInitialized.current = true;
    }

    if (currentQuery) {
      if (!areSearchParamsEquivalent(savedQuery, currentQuery)) {
        sessionStorage.setItem(key, currentQuery);
      }
    } else {
      sessionStorage.removeItem(key);
    }
  }, [currentQuery, normalizedStorageKey, setSearchParams]);
};
