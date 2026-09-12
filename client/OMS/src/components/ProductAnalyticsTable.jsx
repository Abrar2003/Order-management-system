import { Fragment, useCallback, useMemo, useState } from "react";
import SortHeaderButton from "./SortHeaderButton";
import Tooltip from "./Tooltip";
import { formatDateDDMMYYYY } from "../utils/date";
import { getNextClientSortState, sortClientRows } from "../utils/clientSort";

const hasFiniteNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const formatWholeNumber = (value) => hasFiniteNumber(value) ? Number(value).toLocaleString("en-IN") : "-";
const formatDays = (value, { maximumFractionDigits = 1 } = {}) => {
  if (!hasFiniteNumber(value)) return "-";
  const rounded = Number(value);
  return `${rounded.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits })} ${Math.abs(rounded) === 1 ? "day" : "days"}`;
};
const formatPercent = (value) => hasFiniteNumber(value) ? Number(value).toFixed(2) : "-";

const HEADER_FORMULAS = {
  poCount: ["PO Count", "Formula: PO Count = count of POs grouped under the same item code.", "Expand the item row to view each PO included in this count."],
  itemCode: ["Item Code", "Direct value from the linked order item: order.item.item_code.", "This column is an identifier, so there is no derived formula."],
  orderQuantity: ["Order Qty", "Formula: Order Qty = order.quantity.", "This is taken directly from the order quantity stored on the order row."],
  passedQuantity: ["Passed", "Formula: Passed = sum of passed quantities from all linked inspections.", "Calculation: inspections.reduce((sum, inspection) => sum + inspection.passed, 0)."],
  inspectionTimeDays: ["Inspection Time (days)", "PO formula: last inspection date - first inspection date.", "A PO with one inspection is counted as 1 day; a PO with none shows N/A.", "The subtext is the total number of inspections across the item's POs."],
  rejectionPercent: ["Average Rejection (%)", "PO rejection % = summed manually entered rejected quantity / order quantity x 100.", "Average Rejection (%) = average of the PO rejection percentages for this item."],
  avgPackedTimeDays: ["Avg Packed Time (days)", "PO formula: complete packed date - order date.", "A PO is complete packed when its passed quantity reaches its order quantity.", "The item value averages complete-packed POs only."],
  avgOfferTimeDays: ["Avg Offer Time (days)", "PO formula: first inspection date - order date.", "The item value averages POs that have an inspection date."],
  avgShippingTimeDays: ["Avg Shipping Time (days)", "Formula: average of fully shipped PO shipping times for this item.", "PO shipping time = latest shipment stuffing date - order date.", "POs with pending shipment quantity or invalid dates are not counted."],
};

const HeaderFormulaTooltip = ({ column, children }) => {
  const formula = HEADER_FORMULAS[column];
  if (!formula) return children;
  const [title, ...lines] = formula;
  return <Tooltip openOnFocus={false} content={<div><div className="tooltip-title">{title}</div>{lines.map((line) => <div key={line} className="tooltip-detail">{line}</div>)}</div>}>{children}</Tooltip>;
};

const ProductAnalyticsTable = ({ rows = [] }) => {
  const [sortBy, setSortBy] = useState("itemCode");
  const [sortOrder, setSortOrder] = useState("asc");
  const [expandedRowIds, setExpandedRowIds] = useState(() => new Set());
  const handleSortColumn = useCallback((column, defaultDirection = "asc") => {
    const next = getNextClientSortState(sortBy, sortOrder, column, defaultDirection);
    setSortBy(next.sortBy);
    setSortOrder(next.sortOrder);
  }, [sortBy, sortOrder]);
  const toggleRow = useCallback((rowId) => setExpandedRowIds((previous) => {
    const next = new Set(previous);
    next.has(rowId) ? next.delete(rowId) : next.add(rowId);
    return next;
  }), []);
  const sortedRows = useMemo(() => sortClientRows(rows, {
    sortBy,
    sortOrder,
    getSortValue: (row, column) => {
      if (["poCount", "orderQuantity", "passedQuantity"].includes(column)) return Number(row?.[column] || 0);
      if (["inspectionTimeDays", "avgPackedTimeDays", "avgOfferTimeDays", "rejectionPercent", "avgShippingTimeDays"].includes(column)) return hasFiniteNumber(row?.[column]) ? Number(row[column]) : null;
      return row?.[column] || "";
    },
  }), [rows, sortBy, sortOrder]);

  const headers = [
    ["poCount", "PO Count", "desc"], ["itemCode", "Item Code", "asc"], ["orderQuantity", "Order Qty", "desc"],
    ["passedQuantity", "Passed", "desc"], ["inspectionTimeDays", "Inspection Time (days)", "desc"],
    ["rejectionPercent", "Average Rejection (%)", "desc"], ["avgPackedTimeDays", "Avg Packed Time", "desc"],
    ["avgOfferTimeDays", "Avg Offer Time", "desc"], ["avgShippingTimeDays", "Avg Shipping Time", "desc"],
  ];

  return <div className="table-responsive">
    <table className="table table-striped table-hover align-middle om-table mb-0">
      <thead className="table-primary"><tr>{headers.map(([column, label, direction]) => <th key={column}><HeaderFormulaTooltip column={column}><SortHeaderButton label={label} isActive={sortBy === column} direction={sortOrder} onClick={() => handleSortColumn(column, direction)} showNativeTitle={false} /></HeaderFormulaTooltip></th>)}</tr></thead>
      <tbody>
        {sortedRows.length === 0 && <tr><td colSpan="9" className="text-center py-4">No data found</td></tr>}
        {sortedRows.map((row) => {
          const rowId = String(row?.id || row?.itemId || row?.itemCode || "");
          const isExpanded = expandedRowIds.has(rowId);
          const childRows = Array.isArray(row?.orders) ? row.orders : [];
          return <Fragment key={rowId}>
            <tr className="product-analytics-parent-row" onClick={() => toggleRow(rowId)}>
              <td><button type="button" className="product-analytics-toggle" aria-label={isExpanded ? "Collapse PO rows" : "Expand PO rows"} aria-expanded={isExpanded} onClick={(event) => { event.stopPropagation(); toggleRow(rowId); }}>{isExpanded ? "-" : "+"}</button><span className="fw-semibold">{formatWholeNumber(row?.poCount)} {Number(row?.poCount) === 1 ? "PO" : "POs"}</span></td>
              <td><div className="fw-semibold">{row?.itemCode || "-"}</div>{row?.itemName ? <div className="text-secondary small product-analytics-item-name">{row.itemName}</div> : null}</td>
              <td>{formatWholeNumber(row?.orderQuantity)}</td><td>{formatWholeNumber(row?.passedQuantity)}</td>
              <td><div>{formatDays(row?.inspectionTimeDays, { maximumFractionDigits: 0 })}</div><div className="text-secondary small">{formatWholeNumber(row?.inspectionCount)} inspections</div></td>
              <td>{formatPercent(row?.rejectionPercent)}</td><td>{formatDays(row?.avgPackedTimeDays)}</td><td>{formatDays(row?.avgOfferTimeDays)}</td><td>{formatDays(row?.avgShippingTimeDays)}</td>
            </tr>
            {isExpanded && <tr className="product-analytics-detail-row"><td colSpan="9"><div className="product-analytics-detail-wrap"><table className="table table-sm align-middle mb-0 product-analytics-detail-table"><thead><tr><th>PO</th><th>Order Date</th><th>Shipping Time</th><th>Order Qty</th><th>Inspection Time</th><th>Average Rejection (%)</th><th>Packed Time</th><th>Offer Time</th><th>Vendor</th></tr></thead><tbody>
              {childRows.length === 0 ? <tr><td colSpan="9" className="text-center text-secondary py-3">No PO details found</td></tr> : childRows.map((poRow) => <tr key={`${rowId}-${poRow?.orderId}`}><td><div>{poRow?.orderId || "-"}</div><div className="text-secondary small">{poRow?.brand || "-"}</div></td><td>{poRow?.orderDate ? formatDateDDMMYYYY(poRow.orderDate, "-") : "-"}</td><td>{poRow?.isFullyShipped ? formatDays(poRow?.shippingTimeDays) : "-"}</td><td>{formatWholeNumber(poRow?.orderQuantity)}</td><td><div>{formatDays(poRow?.inspectionTimeDays, { maximumFractionDigits: 0 })}</div><div className="text-secondary small">{formatWholeNumber(poRow?.inspectionCount)} inspections</div></td><td>{formatPercent(poRow?.rejectionPercent)}</td><td>{formatDays(poRow?.packedTimeDays)}</td><td>{formatDays(poRow?.offerTimeDays)}</td><td>{poRow?.vendor || "-"}</td></tr>)}
            </tbody></table></div></td></tr>}
          </Fragment>;
        })}
      </tbody>
    </table>
  </div>;
};

export default ProductAnalyticsTable;
