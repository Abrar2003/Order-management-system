import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";

const normalizeText = (value) => String(value ?? "").trim();

const normalizeBrandOptions = (values = []) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(normalizeText)
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));

export const useBrandOptions = (extraOptions = []) => {
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchBrands = async () => {
      try {
        setLoading(true);
        const response = await api.get("/orders/brands-and-vendors");
        if (cancelled) return;
        setBrands(normalizeBrandOptions(response?.data?.brands));
      } catch {
        if (!cancelled) setBrands([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchBrands();

    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(
    () => normalizeBrandOptions([...brands, ...(Array.isArray(extraOptions) ? extraOptions : [])]),
    [brands, extraOptions],
  );

  return { brandOptions: options, loadingBrands: loading };
};

export default useBrandOptions;
