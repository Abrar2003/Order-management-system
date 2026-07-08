import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import { normalizeTextOptions } from "../utils/optionText";

export const useBrandOptions = (extraOptions = []) => {
  const [brands, setBrands] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchBrands = async () => {
      try {
        setLoading(true);
        const response = await api.get("/orders/brands-and-vendors");
        if (cancelled) return;
        setBrands(normalizeTextOptions(response?.data?.brands));
        setVendors(normalizeTextOptions(response?.data?.vendors));
      } catch {
        if (!cancelled) {
          setBrands([]);
          setVendors([]);
        }
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
    () => normalizeTextOptions([...brands, ...(Array.isArray(extraOptions) ? extraOptions : [])]),
    [brands, extraOptions],
  );

  const vendorOptions = useMemo(
    () => normalizeTextOptions(vendors),
    [vendors],
  );

  return {
    brandOptions: options,
    vendorOptions,
    loadingBrands: loading,
    loadingVendors: loading,
  };
};

export default useBrandOptions;
