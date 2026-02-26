import { useEffect, useRef } from "react";

export const useRememberSearchParams = (
  searchParams,
  setSearchParams,
  storageKey,
) => {
  const hasInitialized = useRef(false);

  useEffect(() => {
    const key = `page-query:${String(storageKey || "").trim()}`;
    const currentQuery = searchParams.toString();

    if (!hasInitialized.current) {
      hasInitialized.current = true;

      if (!currentQuery) {
        const savedQuery = sessionStorage.getItem(key);
        if (savedQuery) {
          setSearchParams(new URLSearchParams(savedQuery), { replace: true });
          return;
        }
      }
    }

    if (currentQuery) {
      sessionStorage.setItem(key, currentQuery);
    } else {
      sessionStorage.removeItem(key);
    }
  }, [searchParams, setSearchParams, storageKey]);
};

