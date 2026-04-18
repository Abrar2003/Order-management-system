import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";

const normalizeInspectorOption = (entry = {}) => {
  const id = String(entry?.id || entry?._id || "").trim();
  const name = String(entry?.name || entry?.user?.name || entry?.user?.email || "").trim();

  return {
    id,
    name: name || id,
  };
};

export const useShippingInspectors = () => {
  const [inspectors, setInspectors] = useState([]);
  const [loadingInspectors, setLoadingInspectors] = useState(true);
  const [inspectorError, setInspectorError] = useState("");

  useEffect(() => {
    let ignore = false;

    const fetchInspectors = async () => {
      try {
        setLoadingInspectors(true);
        setInspectorError("");

        const response = await api.get("/inspectors/options");
        const nextInspectors = Array.isArray(response?.data?.data)
          ? response.data.data
              .map((entry) => normalizeInspectorOption(entry))
              .filter((entry) => entry.id)
          : [];

        if (!ignore) {
          setInspectors(nextInspectors);
        }
      } catch (err) {
        if (!ignore) {
          setInspectors([]);
          setInspectorError(
            err?.response?.data?.message || "Failed to load inspectors.",
          );
        }
      } finally {
        if (!ignore) {
          setLoadingInspectors(false);
        }
      }
    };

    fetchInspectors();

    return () => {
      ignore = true;
    };
  }, []);

  const inspectorById = useMemo(
    () =>
      new Map(
        inspectors.map((entry) => [entry.id, entry]),
      ),
    [inspectors],
  );

  return {
    inspectors,
    inspectorById,
    loadingInspectors,
    inspectorError,
  };
};

