import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import { normalizeTextOptions } from "../utils/optionText";

export const useBrandOptions = (extraOptions = []) => {
  const [brands, setBrands] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [vendorCountryOptions, setVendorCountryOptions] = useState([]);
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
        setVendorCountryOptions(
          Array.isArray(response?.data?.vendor_country_options)
            ? response.data.vendor_country_options
            : [],
        );
      } catch {
        if (!cancelled) {
          setBrands([]);
          setVendors([]);
          setVendorCountryOptions([]);
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
    vendorCountryOptions,
    loadingBrands: loading,
    loadingVendors: loading,
  };
};

export default useBrandOptions;
