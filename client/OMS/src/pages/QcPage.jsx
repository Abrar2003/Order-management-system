import { useEffect, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";

const QC = () => {
  const [qcList, setQcList] = useState([]);
  const [inspectors, setInspectors] = useState([]);
  const [vendors, setVendors] = useState([]);

  const [search, setSearch] = useState("");
  const [inspector, setInspector] = useState("");
  const [vendor, setVendor] = useState("");

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const token = localStorage.getItem("token");
  const user = getUserFromToken();

  useEffect(() => {
    fetchQC();
  }, [page, search, inspector, vendor]);

  useEffect(() => {
    fetchInspectors();
  }, []);

  const fetchQC = async () => {
    const res = await axios.get("/qc/list", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        page,
        limit: 20,
        search,
        inspector,
        vendor,
      },
    });

    setQcList(res.data.data);
    setTotalPages(res.data.pagination.totalPages);

    // extract vendors for filter
    const uniqueVendors = [
      ...new Set(res.data.data.map((qc) => qc.order.vendor)),
    ];
    setVendors(uniqueVendors);
  };

  const fetchInspectors = async () => {
    const res = await axios.get("/auth/?role=QC", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    setInspectors(res.data);
  };

  return (
    <>
      <Navbar />

      <h2>QC Records</h2>

      {/* Filters */}
      <div className="filters">

        <select
          value={inspector}
          onChange={(e) => {
            setPage(1);
            setInspector(e.target.value);
          }}
        >
          <option value="">All Inspectors</option>
          {inspectors.map((qc) => (
            <option key={qc._id} value={qc._id}>
              {qc.name}
            </option>
          ))}
        </select>

        <select
          value={vendor}
          onChange={(e) => {
            setPage(1);
            setVendor(e.target.value);
          }}
        >
          <option value="">All Vendors</option>
          {vendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div
        className="orderTableContainer"
        style={{
          border: "1px solid #111827",
          width: "100%",
          borderRadius: "8px",
          padding: "16px",
        }}
      >
        <table className="orderTable">
          <thead className="QCtableHead" style={{ fontSize: "15px" }}>
            <tr>
              <th style={{ width: "10%" }}>PO</th>
              <th style={{ width: "15%" }}>Vendor</th>
              <th style={{ width: "10%" }}>Item</th>
              <th style={{ width: "25%" }}>Description</th>
              <th style={{ width: "10%" }}>Client Demand</th>
              <th style={{ width: "15%" }}>Vendor Provision</th>
              <th style={{ width: "10%" }}>QC Passed</th>
              {/* <th>Pending</th> */}
              <th style={{ width: "10%" }}>Inspector</th>
              <th style={{ width: "15%" }}>Check Details</th>
            </tr>
          </thead>
          <div style={{ height: "20px" }}></div>
          <tbody className="tableBody">
            {qcList.map((qc) => (
              <>
                <tr className="tableRow" key={qc._id}>
                  <td>{qc.order.order_id}</td>
                  <td>{qc.order.vendor}</td>
                  <td>{qc.item.item_code}</td>
                  <td>{qc.item.description}</td>
                  <td>{qc.quantities.client_demand}</td>
                  <td>{qc.quantities.vendor_provision}</td>
                  <td>{qc.quantities.qc_passed}</td>
                  {/* <td>{qc.quantities.pending}</td> */}
                  <td>{qc.inspector.name}</td>
                  <td>
                    <button
                      className="secondayButton"
                      style={{
                        fontSize: "12px",
                        fontWeight: "bold",
                        width: "100%",
                      }}
                    >
                      See Details
                    </button>
                  </td>
                </tr>
                <div style={{ height: "20px" }}></div>
              </>
            ))}

            {qcList.length === 0 && (
              <tr>
                <td colSpan="10">No QC records found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      <div>
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Prev
        </button>

        <span>
          Page {page} of {totalPages}
        </span>

        <button
          disabled={page === totalPages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
};

export default QC;
