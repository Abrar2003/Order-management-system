import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";

const DailySummary = () => {
  const navigate = useNavigate();

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(-1)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">Daily Summary</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card">
          <div className="card-body text-secondary">
            Daily summary is not implemented yet. Weekly summary is available under Summary.
          </div>
        </div>
      </div>
    </>
  );
};

export default DailySummary;
