import { useId, useState } from "react";

const EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".jpg", ".jpeg", ".png", ".webp"];

export default function OrderReferenceFileInput({ files, onChange, disabled, required }) {
  const id = useId();
  const [error, setError] = useState("");

  const selectFiles = (event) => {
    const next = [...files, ...event.target.files];
    event.target.value = "";
    const invalid = next.find((file) =>
      !EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension)) ||
      file.size < 1 || file.size > 50 * 1024 * 1024,
    );
    if (invalid || next.length > 10) {
      setError(invalid
        ? `${invalid.name} must be a supported file between 1 byte and 50 MiB.`
        : "Select up to 10 files per batch.");
      return;
    }
    setError("");
    onChange(next);
  };

  return (
    <div>
      <label className="form-label" htmlFor={id}>
        {required ? "Order Reference Documents (required)" : "Add documents"}
      </label>
      <input id={id} className="form-control" type="file" multiple accept={EXTENSIONS.join(",")}
        disabled={disabled} aria-describedby={`${id}-help`} aria-required={required} onChange={selectFiles} />
      <div id={`${id}-help`} className="form-text">PDF, Word, Excel, CSV, JPG, PNG, or WebP. Up to 10 files, 50 MiB each.</div>
      {error && <div role="alert" className="text-danger small mt-1">{error}</div>}
      {files.length > 0 && (
        <ul className="list-unstyled mb-0 mt-2">
          {files.map((file, index) => (
            <li key={`${index}-${file.name}`} className="d-flex gap-2 align-items-center">
              <span className="text-break">{file.name}</span>
              <button type="button" className="btn btn-link btn-sm" disabled={disabled}
                aria-label={`Remove ${file.name}`}
                onClick={() => { setError(""); onChange(files.filter((_, i) => i !== index)); }}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
