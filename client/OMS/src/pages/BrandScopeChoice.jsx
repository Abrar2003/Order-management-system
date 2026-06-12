import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { updateBrandScope } from "../auth/auth.service";
import "../App.css";

const BRAND_SCOPE_OPTIONS = [
  {
    value: "dutch",
    label: "Dutch Interior",
    image: "/dutch_interior.png",
    imageAlt: "Dutch Interior",
  },
  {
    value: "giga",
    label: "Giga",
    image: "/Giga.png",
    imageAlt: "Giga",
  },
];

const BrandScopeChoice = () => {
  const navigate = useNavigate();
  const [allBrands, setAllBrands] = useState(true);
  const [selectedScope, setSelectedScope] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectScope = (scope) => {
    setAllBrands(false);
    setSelectedScope(scope);
    setError("");
  };

  const toggleAllBrands = (event) => {
    const checked = event.target.checked;
    setAllBrands(checked);
    if (checked) {
      setSelectedScope("");
    }
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextScope = allBrands ? "all" : selectedScope;
    if (!nextScope) {
      setError("Select a brand scope or keep All brands enabled.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await updateBrandScope(nextScope);
      navigate("/", { replace: true });
    } catch (submitError) {
      console.error(submitError);
      setError(
        submitError?.response?.data?.message ||
          submitError?.message ||
          "Failed to save brand selection.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell d-flex justify-content-center py-5 brand-scope-page-shell">
      <div className="card om-card shadow-sm w-100 brand-scope-card">
        <div className="card-body p-4 p-md-5">
          <h1 className="h4 mb-4 text-center">Choose Brand View</h1>

          {error && <div className="alert alert-danger py-2">{error}</div>}

          <form onSubmit={handleSubmit} className="d-grid gap-4">
            <div className="brand-scope-options" aria-label="Select brand view">
              {BRAND_SCOPE_OPTIONS.map((option) => {
                const selected = !allBrands && selectedScope === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`brand-scope-option${selected ? " is-selected" : ""}`}
                    onClick={() => selectScope(option.value)}
                    disabled={saving || allBrands}
                    aria-pressed={selected}
                  >
                    <img
                      src={option.image}
                      alt={option.imageAlt}
                      className="brand-scope-logo"
                    />
                    <span className="brand-scope-label">{option.label}</span>
                  </button>
                );
              })}
            </div>

            <label className="brand-scope-all-toggle">
              <input
                type="checkbox"
                className="form-check-input"
                checked={allBrands}
                onChange={toggleAllBrands}
                disabled={saving}
              />
              <span>All brands</span>
            </label>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || (!allBrands && !selectedScope)}
            >
              {saving ? "Saving..." : "Continue"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default BrandScopeChoice;
