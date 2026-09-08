import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import ReportInfoBanner from "../components/ReportInfoBanner";
import SortHeaderButton from "../components/SortHeaderButton";
import { formatCbm } from "../utils/cbm";
import { getOptionText } from "../utils/optionText";
import { getNextClientSortState, sortClientRows } from "../utils/clientSort";

const LIMIT = 20;

const AllPackedGoods = () => {
  const [rows, setRows] = useState([]);
  const [options, setOptions] = useState({ brands: [], vendors: [], order_ids: [] });
  const [summary, setSummary] = useState({ total_rows: 0, total_packed_quantity: 0, total_cbm: 0 });
  const [filters, setFilters] = useState({ brand: "", vendor: "", po: "" });
  const [sortBy, setSortBy] = useState("po");
  const [sortOrder, setSortOrder] = useState("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchRows = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams();
      if (filters.brand) params.set("brand", filters.brand);
      if (filters.vendor) params.set("vendor", filters.vendor);
      if (filters.po) params.set("order_id", filters.po);
      const response = await api.get(`/orders/packed-goods/all?${params.toString()}`);
      setRows(Array.isArray(response?.data?.data) ? response.data.data : []);
      setOptions(response?.data?.filters || { brands: [], vendors: [], order_ids: [] });
      setSummary(response?.data?.summary || { total_rows: 0, total_packed_quantity: 0, total_cbm: 0 });
    } catch (fetchError) {
      setError(fetchError?.response?.data?.message || "Failed to load packed goods.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const sortedRows = useMemo(() => sortClientRows(rows, {
    sortBy,
    sortOrder,
    getSortValue: (row, column) => ({
      po: row?.order_id,
      brand: row?.brand,
      vendor: getOptionText(row?.vendor),
      itemCode: row?.item_code,
      orderQuantity: Number(row?.order_quantity || 0),
      packedQuantity: Number(row?.packed_quantity || 0),
      pendingQuantity: Number(row?.pending_quantity || 0),
      totalCbm: Number(row?.total_cbm || 0),
    }[column] || ""),
  }), [rows, sortBy, sortOrder]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / LIMIT));
  const paginatedRows = sortedRows.slice((page - 1) * LIMIT, page * LIMIT);

  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);

  const updateFilter = (key, value) => {
    setPage(1);
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "brand" ? { vendor: "", po: "" } : key === "vendor" ? { po: "" } : {}),
    }));
  };
  const handleSort = (column, defaultDirection = "asc") => {
    const next = getNextClientSortState(sortBy, sortOrder, column, defaultDirection);
    setPage(1);
    setSortBy(next.sortBy);
    setSortOrder(next.sortOrder);
  };

  const columns = [
    ["PO", "po"], ["Brand", "brand"], ["Vendor", "vendor"], ["Item code", "itemCode"],
    ["Order Quantity", "orderQuantity", "desc"], ["Packed Quantity", "packedQuantity", "desc"],
    ["Pending Quantity", "pendingQuantity", "desc"], ["Total Packed CBM", "totalCbm", "desc"],
  ];

  return <>
    <Navbar />
    <div className="page-shell py-3">
      <div className="mb-3">
        <h2 className="h4 mb-1">Packed Goods</h2>
        <p className="text-secondary mb-0">All currently packed and unshipped order lines.</p>
      </div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <span className="om-summary-chip">Rows: {summary.total_rows}</span>
        <span className="om-summary-chip">Packed Quantity: {summary.total_packed_quantity}</span>
        <span className="om-summary-chip">Total Packed CBM: {formatCbm(summary.total_cbm)}</span>
      </div>
      <ReportInfoBanner
        description="Shows every currently packed and unshipped order line."
        dataShown="PO, brand, vendor, item, ordered quantity, packed quantity, pending quantity, and packed CBM."
        howItWorks="Filters are applied across all currently packed goods; no inspection-period date range is used."
      />
      <div className="card om-card mb-3"><div className="card-body"><div className="packed-goods-filter-bar">
        <div className="packed-goods-filter-field"><label className="form-label small mb-1">Brand</label><select className="form-select form-select-sm" value={filters.brand} onChange={(event) => updateFilter("brand", event.target.value)}><option value="">All Brands</option>{options.brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select></div>
        <div className="packed-goods-filter-field"><label className="form-label small mb-1">Vendor</label><select className="form-select form-select-sm" value={filters.vendor} onChange={(event) => updateFilter("vendor", event.target.value)}><option value="">All Vendors</option>{options.vendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}</select></div>
        <div className="packed-goods-filter-field packed-goods-filter-field--po"><label className="form-label small mb-1">PO</label><select className="form-select form-select-sm" value={filters.po} onChange={(event) => updateFilter("po", event.target.value)}><option value="">All POs</option>{options.order_ids.map((po) => <option key={po} value={po}>{po}</option>)}</select></div>
      </div></div></div>
      {error && <div className="alert alert-danger mb-3" role="alert">{error}</div>}
      <div className="card om-card"><div className="card-body p-0">
        {loading ? <div className="text-center py-4">Loading...</div> : <div className="table-responsive"><table className="table table-hover align-middle om-table mb-0"><thead className="table-primary"><tr>{columns.map(([label, key, direction]) => <th key={key}><SortHeaderButton label={label} isActive={sortBy === key} direction={sortOrder} onClick={() => handleSort(key, direction)} /></th>)}</tr></thead><tbody>
          {paginatedRows.length === 0 ? <tr><td colSpan={columns.length} className="text-center py-4">No packed goods found.</td></tr> : paginatedRows.map((row) => <tr key={row.id || `${row.order_id}-${row.item_code}`} className={row.po_has_no_pending_quantity ? "om-report-success-row" : "om-report-warning-row"}><td>{row.order_id || "N/A"}</td><td>{row.brand || "N/A"}</td><td>{getOptionText(row.vendor) || "N/A"}</td><td>{row.item_code || "N/A"}</td><td>{Number(row.order_quantity || 0)}</td><td>{Number(row.packed_quantity || 0)}</td><td>{Number(row.pending_quantity || 0)}</td><td>{formatCbm(row.total_cbm)}</td></tr>)}
        </tbody></table></div>}
      </div>{!loading && sortedRows.length > 0 && <div className="card-footer bg-transparent d-flex justify-content-between align-items-center gap-2"><span className="text-secondary small">Showing {(page - 1) * LIMIT + 1} - {Math.min(page * LIMIT, sortedRows.length)} of {sortedRows.length}</span><div className="d-flex align-items-center gap-2"><button type="button" className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span className="small text-secondary">Page {page} of {totalPages}</span><button type="button" className="btn btn-outline-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>}</div>
    </div>
  </>;
};

export default AllPackedGoods;
