import { Fragment, useMemo, useState } from "react";
import SortHeaderButton from "./SortHeaderButton";
import { formatDateDDMMYYYY } from "../utils/date";
import { getNextClientSortState, sortClientRows } from "../utils/clientSort";

const headers = [
  ["container", "Container Number"], ["brand", "Brand"], ["vendor", "Vendor"],
  ["stuffed_cbm", "Stuffed CBM"], ["stuffing_dates", "Stuffing Date"],
  ["shipping_etas", "ETA"], ["shipping_etds", "ETD"],
];
const formatQuantity = (value) => Number(value).toLocaleString("en-IN");
const formatDates = (dates) => dates.length ? dates.map((date) => formatDateDDMMYYYY(date, "-")).join(", ") : "-";

const DailyShipmentTable = ({ rows = [] }) => {
  const [expanded, setExpanded] = useState(() => new Set());
  const [sort, setSort] = useState({ sortBy: "stuffing_dates", sortOrder: "desc" });
  const sortedRows = useMemo(() => sortClientRows(rows, {
    ...sort,
    getSortValue: (row, column) => Array.isArray(row[column]) ? row[column].at(-1) || "" : row[column],
  }), [rows, sort]);
  const toggleRow = (id) => setExpanded((previous) => {
    const next = new Set(previous);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return <div className="table-responsive product-analytics-scroll">
    <table className="table table-striped table-hover align-middle om-table mb-0 product-analytics-table">
      <thead className="table-primary"><tr>{headers.map(([column, label]) => <th scope="col" key={column}>
        <SortHeaderButton label={label} isActive={sort.sortBy === column} direction={sort.sortOrder} onClick={() => setSort(getNextClientSortState(sort.sortBy, sort.sortOrder, column))} />
      </th>)}</tr></thead>
      <tbody>
        {sortedRows.length === 0 && <tr><td colSpan={headers.length} className="text-center py-4">No shipments found</td></tr>}
        {sortedRows.map((row) => {
          const isExpanded = expanded.has(row.id);
          const detailId = `daily-shipment-${encodeURIComponent(row.id)}`;
          return <Fragment key={row.id}>
            <tr className="product-analytics-parent-row" onClick={() => toggleRow(row.id)}>
              <td><button type="button" className="product-analytics-toggle" aria-label={`${isExpanded ? "Collapse" : "Expand"} items for ${row.container}`} aria-expanded={isExpanded} aria-controls={detailId} onClick={(event) => { event.stopPropagation(); toggleRow(row.id); }}>{isExpanded ? "-" : "+"}</button><span className="fw-semibold">{row.container}</span></td>
              <td>{row.brand || "-"}</td><td>{row.vendor || "-"}</td>
              <td>{row.stuffed_cbm.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 6 })}</td>
              <td>{formatDates(row.stuffing_dates)}</td><td>{formatDates(row.shipping_etas)}</td><td>{formatDates(row.shipping_etds)}</td>
            </tr>
            {isExpanded && <tr id={detailId} className="product-analytics-detail-row"><td colSpan={headers.length}>
              <div className="product-analytics-detail-wrap"><table className="table table-sm align-middle mb-0 product-analytics-detail-table">
                <thead><tr><th scope="col">PO</th><th scope="col">Item Code</th><th scope="col">Order Quantity</th><th scope="col">Stuffed Quantity</th><th scope="col">Remaining Quantity</th></tr></thead>
                <tbody>{row.items.map((item) => <tr key={item.id}>
                  <td>{item.order_id || "-"}</td>
                  {item.fully_shipped ? <td colSpan="4" className="text-success fw-semibold">All items are shipped</td> : <>
                    <td>{item.item_code || "-"}</td><td>{formatQuantity(item.order_quantity)}</td>
                    <td>{formatQuantity(item.stuffed_quantity)}</td><td>{formatQuantity(item.remaining_quantity)}</td>
                  </>}
                </tr>)}</tbody>
              </table></div>
            </td></tr>}
          </Fragment>;
        })}
      </tbody>
    </table>
  </div>;
};

export default DailyShipmentTable;
