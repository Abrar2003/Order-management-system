import { useMemo, useState } from "react";

const STAGES = [
  ["top", "Drop 1 — Top face", "drops_1_to_5_mm"],
  ["right", "Drop 2 — Right face", "drops_1_to_5_mm"],
  ["bottom", "Drop 3 — Bottom face", "drops_1_to_5_mm"],
  ["corner_2_3_5", "Drop 4 — Corner 2-3-5", "drops_1_to_5_mm"],
  ["edge_3_4", "Drop 5 — Edge 3-4", "drops_1_to_5_mm"],
  ["front", "Drop 6 — Front face", "drop_6_mm"],
];

const getHeights = (weight) => {
  const kg = Number(weight);
  if (!Number.isFinite(kg) || kg <= 0) return null;
  if (kg <= 18) return { drops_1_to_5_mm: 305, drop_6_mm: 460 };
  if (kg <= 36) return { drops_1_to_5_mm: 250, drop_6_mm: 360 };
  if (kg <= 45) return { drops_1_to_5_mm: 200, drop_6_mm: 280 };
  return { drops_1_to_5_mm: 180, drop_6_mm: 230 };
};

const DropTestModal = ({ template, defaultWeight, saving, onClose, onSubmit }) => {
  const [weight, setWeight] = useState(defaultWeight ? String(defaultWeight) : "");
  const [confirmed, setConfirmed] = useState([]);
  const [result, setResult] = useState("");
  const [images, setImages] = useState([]);
  const [videos, setVideos] = useState([]);
  const [error, setError] = useState("");
  const heights = useMemo(() => getHeights(weight), [weight]);

  const submit = async (event) => {
    event.preventDefault();
    if (!heights || confirmed.length !== STAGES.length || !result) {
      setError("Enter the packed weight, confirm all six drops, and select PASS or FAIL.");
      return;
    }
    if (images.length > 10 || videos.length > 2) {
      setError("A Drop Test accepts up to 10 images and 2 videos.");
      return;
    }
    setError("");
    const body = new FormData();
    body.append("gross_packed_weight_kg", weight);
    body.append("confirmed_stages", JSON.stringify(confirmed));
    body.append("result", result);
    images.forEach((file) => body.append("images", file));
    videos.forEach((file) => body.append("videos", file));
    await onSubmit(body);
  };

  const toggleStage = (id) => setConfirmed((current) =>
    current.includes(id) ? current.filter((stage) => stage !== id) : [...current, id],
  );

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog" aria-modal="true">
      <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable" role="document">
        <form className="modal-content" onSubmit={submit}>
          <div className="modal-header">
            <div><h5 className="modal-title mb-0">{template?.name || "Drop Test"}</h5><small className="text-muted">Version {template?.version}</small></div>
            <button type="button" className="btn-close" aria-label="Close" onClick={onClose} disabled={saving} />
          </div>
          <div className="modal-body">
            {template?.testing_guide?.url && <img src={template.testing_guide.url} alt="Drop test guide" className="img-fluid border rounded mb-3" />}
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Gross packed weight (kg)</label>
                <input className="form-control" type="number" min="0.01" step="0.01" required value={weight} onChange={(event) => setWeight(event.target.value)} />
              </div>
              <div className="col-md-8 d-flex align-items-end">
                <div className="alert alert-info mb-0 w-100 py-2">
                  {heights ? <>Drops 1–5: <strong>{heights.drops_1_to_5_mm} mm</strong> · Drop 6: <strong>{heights.drop_6_mm} mm</strong></> : "Enter a gross packed weight to calculate the drop heights."}
                </div>
              </div>
            </div>
            <h6 className="mt-4">Confirm each prescribed drop</h6>
            <div className="row g-2">
              {STAGES.map(([id, label, heightKey]) => <div className="col-md-6" key={id}>
                <label className="border rounded p-2 d-flex gap-2 w-100">
                  <input type="checkbox" checked={confirmed.includes(id)} onChange={() => toggleStage(id)} />
                  <span>{label} <span className="text-muted">({heights?.[heightKey] || "—"} mm)</span></span>
                </label>
              </div>)}
            </div>
            <div className="mt-4">
              <h6>Result</h6>
              <div className="d-flex gap-3">
                {["pass", "fail"].map((value) => <label className="form-check" key={value}>
                  <input className="form-check-input" type="radio" name="drop-test-result" value={value} checked={result === value} onChange={(event) => setResult(event.target.value)} />
                  <span className="form-check-label text-uppercase">{value}</span>
                </label>)}
              </div>
            </div>
            <div className="mt-4">
              <h6>PASS / FAIL criteria</h6>
              <div className="small text-secondary" style={{ whiteSpace: "pre-line" }}>{template?.instructions}</div>
            </div>
            <div className="row g-3 mt-2">
              <div className="col-md-6"><label className="form-label">Evidence images <span className="text-muted">(optional, max 10)</span></label><input className="form-control" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setImages(Array.from(event.target.files || []))} /><small className="text-muted">{images.length}/10 selected</small></div>
              <div className="col-md-6"><label className="form-label">Evidence videos <span className="text-muted">(optional, max 2)</span></label><input className="form-control" type="file" accept="video/mp4,video/quicktime,video/x-matroska,.mp4,.mov,.mkv" multiple onChange={(event) => setVideos(Array.from(event.target.files || []))} /><small className="text-muted">{videos.length}/2 selected</small></div>
            </div>
            {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Submitting…" : "Submit Drop Test"}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DropTestModal;
