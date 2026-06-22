import React from "react";

const ReportInfoBanner = ({ description, dataShown, howItWorks }) => {
  return (
    <div
      className="card mb-4 border-0"
      style={{
        background: "var(--om-color-surface-muted)",
        borderRadius: "var(--om-radius-md)",
        borderLeft: "4px solid var(--om-color-accent)",
        boxShadow: "var(--om-shadow-xs)",
      }}
    >
      <div className="card-body p-3">
        <div className="d-flex align-items-start gap-3">
          <div
            className="d-flex align-items-center justify-content-center flex-shrink-0 rounded-circle"
            style={{
              width: "32px",
              height: "32px",
              background: "var(--om-color-accent-soft)",
              color: "var(--om-color-accent-strong)",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 16 16"
            >
              <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1A1.1 1.1 0 1 1 8 3.5 1 1.1 0 0 1 8 5.5z" />
            </svg>
          </div>
          <div className="flex-grow-1">
            <p
              className="mb-2"
              style={{
                fontSize: "0.95rem",
                lineHeight: "1.45",
                fontWeight: "500",
                color: "var(--om-color-text)",
              }}
            >
              {description}
            </p>
            <div
              className="d-flex flex-wrap gap-x-4 gap-y-2 mt-2 pt-2 border-top"
              style={{
                borderColor: "var(--om-color-border)",
                fontSize: "0.85rem",
              }}
            >
              <div className="d-flex align-items-baseline gap-1" style={{ marginRight: "1.5rem" }}>
                <span
                  className="fw-semibold flex-shrink-0"
                  style={{ color: "var(--om-color-text-muted)" }}
                >
                  Data Shown:
                </span>
                <span style={{ color: "var(--om-color-text-muted)" }}>{dataShown}</span>
              </div>
              <div className="d-flex align-items-baseline gap-1">
                <span
                  className="fw-semibold flex-shrink-0"
                  style={{ color: "var(--om-color-text-muted)" }}
                >
                  How:
                </span>
                <span style={{ color: "var(--om-color-text-muted)" }}>{howItWorks}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportInfoBanner;
