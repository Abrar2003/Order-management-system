import { useEffect, useMemo, useRef, useState } from "react";
import { createBatchFromFolderManifest } from "../../api/workflowApi";
import {
  buildFileManifest,
  buildTaskPreview,
  formatBytes,
  getRootFolder,
  summarizeManifest,
} from "../../utils/workflowManifest";

const normalizeText = (value) => String(value ?? "").trim();

const isDuplicateBatchMessage = (message = "") =>
  normalizeText(message).toLowerCase().includes("already exists");

const WorkflowBatchCreateModal = ({
  taskTypes = [],
  availableUsers = [],
  onClose,
  onCreated,
}) => {
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({
    name: "",
    source_folder_name: "",
    brand: "",
    description: "",
    task_type_key: "",
    assignee_ids: [],
  });
  const [manifest, setManifest] = useState([]);
  const [rootFolder, setRootFolder] = useState("");
  const [summary, setSummary] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [duplicateError, setDuplicateError] = useState("");

  const selectedTaskType = useMemo(
    () =>
      (Array.isArray(taskTypes) ? taskTypes : []).find(
        (taskType) => taskType?.key === form.task_type_key,
      ) || null,
    [form.task_type_key, taskTypes],
  );

  const previewTasks = useMemo(
    () =>
      buildTaskPreview({
        manifest,
        rootFolder,
        taskType: selectedTaskType,
        batchName: form.name,
        sourceFolderName: form.source_folder_name,
      }),
    [form.name, form.source_folder_name, manifest, rootFolder, selectedTaskType],
  );

  const previewError = useMemo(() => {
    if (!selectedTaskType || manifest.length === 0) return "";
    if (previewTasks.length > 0) return "";
    return `No matching files were found for ${selectedTaskType?.name || selectedTaskType?.key}.`;
  }, [manifest.length, previewTasks.length, selectedTaskType]);

  useEffect(() => {
    if (!form.task_type_key && taskTypes.length > 0) {
      const firstActiveTaskType =
        taskTypes.find((entry) => entry?.is_active !== false) || taskTypes[0];
      if (firstActiveTaskType?.key) {
        setForm((prev) => ({
          ...prev,
          task_type_key: firstActiveTaskType.key,
        }));
      }
    }
  }, [form.task_type_key, taskTypes]);

  const handleFolderSelection = (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) {
      setManifest([]);
      setRootFolder("");
      setSummary(null);
      return;
    }

    const nextRootFolder = getRootFolder(selectedFiles);
    const nextManifest = buildFileManifest(selectedFiles);
    const nextSummary = summarizeManifest(nextManifest, nextRootFolder);

    setRootFolder(nextRootFolder);
    setManifest(nextManifest);
    setSummary(nextSummary);
    setError("");
    setDuplicateError("");
    setForm((prev) => ({
      ...prev,
      name: normalizeText(prev.name) || nextRootFolder,
      source_folder_name: nextRootFolder || prev.source_folder_name,
    }));
  };

  const toggleAssignee = (userId) => {
    setForm((prev) => {
      const nextIds = prev.assignee_ids.includes(userId)
        ? prev.assignee_ids.filter((entry) => entry !== userId)
        : [...prev.assignee_ids, userId];
      return {
        ...prev,
        assignee_ids: nextIds,
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setDuplicateError("");

    if (manifest.length === 0) {
      setError("Please select a folder to build the file manifest.");
      return;
    }
    if (!normalizeText(form.name)) {
      setError("Batch name is required.");
      return;
    }
    if (!normalizeText(form.source_folder_name)) {
      setError("Source folder name is required.");
      return;
    }
    if (!normalizeText(form.task_type_key)) {
      setError("Task type is required.");
      return;
    }
    if (!previewTasks.length) {
      setError(previewError || "No matching tasks can be created from this folder.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createBatchFromFolderManifest({
        name: normalizeText(form.name),
        source_folder_name: normalizeText(form.source_folder_name),
        brand: normalizeText(form.brand),
        description: normalizeText(form.description),
        task_type_key: normalizeText(form.task_type_key),
        assignment_mode: "manual",
        assignee_ids: form.assignee_ids,
        file_manifest: manifest.map((entry) => ({
          name: entry.name,
          relative_path: entry.relative_path,
          folder_path: entry.folder_path,
          extension: entry.extension,
          mime_type: entry.mime_type,
          size_bytes: entry.size_bytes,
        })),
      });
      onCreated?.(result?.data || result);
    } catch (submitError) {
      const message =
        submitError?.response?.data?.message
        || submitError?.message
        || "Failed to create workflow batch.";
      if (isDuplicateBatchMessage(message)) {
        setDuplicateError(message);
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal d-block om-modal-backdrop"
      tabIndex="-1"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-centered modal-xl workflow-modal-dialog"
        role="document"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <div>
              <h5 className="modal-title">Create Workflow Batch from Folder</h5>
              <div className="small text-muted">
                OMS creates a batch container and then generates separate workflow tasks
                from the JSON manifest only.
              </div>
            </div>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onClose}
            />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              {duplicateError && (
                <div className="alert alert-warning">
                  <div className="fw-semibold mb-1">Duplicate batch blocked</div>
                  <div>{duplicateError}</div>
                </div>
              )}

              <section className="card om-card mb-3">
                <div className="card-body">
                  <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
                    <div>
                      <div className="text-uppercase text-secondary small fw-semibold mb-1">
                        Step 1
                      </div>
                      <h6 className="mb-1">Select Source Folder</h6>
                      <p className="text-secondary mb-0">
                        The browser reads file names, paths, types, and sizes only. No file
                        binary is uploaded.
                      </p>
                    </div>
                    <div className="d-flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-outline-primary"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Choose Folder
                      </button>
                    </div>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    className="d-none"
                    multiple
                    webkitdirectory=""
                    directory=""
                    onChange={handleFolderSelection}
                  />

                  {rootFolder ? (
                    <div className="mt-3">
                      <div className="d-flex flex-wrap gap-2">
                        <span className="om-summary-chip">Root: {rootFolder}</span>
                        <span className="om-summary-chip">
                          Files: {summary?.total_files || 0}
                        </span>
                        <span className="om-summary-chip">
                          Direct Subfolders: {summary?.direct_subfolders_count || 0}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="alert alert-secondary mt-3 mb-0">
                      No folder selected yet.
                    </div>
                  )}
                </div>
              </section>

              <div className="row g-3">
                <div className="col-lg-5">
                  <section className="card om-card h-100">
                    <div className="card-body">
                      <div className="text-uppercase text-secondary small fw-semibold mb-2">
                        Step 2
                      </div>
                      <h6 className="mb-3">Batch Metadata</h6>

                      <div className="row g-3">
                        <div className="col-12">
                          <label className="form-label">Batch Name</label>
                          <input
                            type="text"
                            className="form-control"
                            value={form.name}
                            onChange={(event) =>
                              setForm((prev) => ({ ...prev, name: event.target.value }))
                            }
                          />
                        </div>

                        <div className="col-12">
                          <label className="form-label">Source Folder Name</label>
                          <input
                            type="text"
                            className="form-control"
                            value={form.source_folder_name}
                            onChange={(event) =>
                              setForm((prev) => ({
                                ...prev,
                                source_folder_name: event.target.value,
                              }))
                            }
                          />
                          <div className="form-text">
                            Auto-detected from the selected folder root. You can adjust it if
                            needed.
                          </div>
                        </div>

                        <div className="col-12">
                          <label className="form-label">Brand</label>
                          <input
                            type="text"
                            className="form-control"
                            value={form.brand}
                            onChange={(event) =>
                              setForm((prev) => ({ ...prev, brand: event.target.value }))
                            }
                          />
                        </div>

                        <div className="col-12">
                          <label className="form-label">Task Type</label>
                          <select
                            className="form-select"
                            value={form.task_type_key}
                            onChange={(event) =>
                              setForm((prev) => ({
                                ...prev,
                                task_type_key: event.target.value,
                              }))
                            }
                          >
                            <option value="">Select task type</option>
                            {taskTypes
                              .filter((taskType) => taskType?.is_active !== false)
                              .map((taskType) => (
                                <option key={taskType._id || taskType.key} value={taskType.key}>
                                  {taskType.name}
                                </option>
                              ))}
                          </select>
                        </div>

                        <div className="col-12">
                          <label className="form-label">Description</label>
                          <textarea
                            rows="3"
                            className="form-control"
                            value={form.description}
                            onChange={(event) =>
                              setForm((prev) => ({
                                ...prev,
                                description: event.target.value,
                              }))
                            }
                          />
                        </div>

                        <div className="col-12">
                          <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                            <label className="form-label mb-0">Assignees</label>
                            <span className="small text-secondary">Optional</span>
                          </div>
                          {availableUsers.length === 0 ? (
                            <div className="alert alert-secondary mb-0 py-2">
                              No user options available. You can still create the batch with
                              pending tasks.
                            </div>
                          ) : (
                            <div className="workflow-user-picker">
                              {availableUsers.map((user) => {
                                const userId = user?._id || user?.id;
                                const checked = form.assignee_ids.includes(userId);
                                return (
                                  <label
                                    key={userId}
                                    className="form-check d-flex align-items-center gap-2 mb-0"
                                  >
                                    <input
                                      type="checkbox"
                                      className="form-check-input mt-0"
                                      checked={checked}
                                      onChange={() => toggleAssignee(userId)}
                                    />
                                    <span>
                                      {user?.name || user?.username || "User"}{" "}
                                      <span className="text-secondary small">
                                        ({user?.role || "user"})
                                      </span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="col-12">
                          <div className="alert alert-secondary py-2 mb-0">
                            Due date is not shown here yet because the current backend batch API
                            does not store it.
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                <div className="col-lg-7">
                  <section className="card om-card mb-3">
                    <div className="card-body">
                      <div className="text-uppercase text-secondary small fw-semibold mb-2">
                        Step 3
                      </div>
                      <h6 className="mb-3">File Summary</h6>

                      {summary ? (
                        <div className="workflow-summary-grid">
                          <span className="om-summary-chip">
                            Total Files: {summary.total_files}
                          </span>
                          <span className="om-summary-chip">
                            Images: {summary.image_files}
                          </span>
                          <span className="om-summary-chip">
                            PDFs: {summary.pdf_files}
                          </span>
                          <span className="om-summary-chip">
                            Excel: {summary.excel_files}
                          </span>
                          <span className="om-summary-chip">
                            CAD: {summary.cad_files}
                          </span>
                          <span className="om-summary-chip">
                            3D: {summary.three_d_files}
                          </span>
                          <span className="om-summary-chip">
                            Other: {summary.other_files}
                          </span>
                          <span className="om-summary-chip">
                            Direct Subfolders: {summary.direct_subfolders_count}
                          </span>
                        </div>
                      ) : (
                        <div className="text-secondary">Select a folder to calculate the summary.</div>
                      )}
                    </div>
                  </section>

                  <section className="card om-card h-100">
                    <div className="card-body">
                      <div className="text-uppercase text-secondary small fw-semibold mb-2">
                        Step 4
                      </div>
                      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                        <div>
                          <h6 className="mb-1">Expected Task Preview</h6>
                          <div className="small text-secondary">
                            Preview the separate child tasks that will be created inside this
                            batch. Backend remains the final source of truth.
                          </div>
                        </div>
                        <span className="om-summary-chip">
                          Expected Tasks: {previewTasks.length}
                        </span>
                      </div>

                      {previewError && (
                        <div className="alert alert-warning py-2">{previewError}</div>
                      )}

                      {!selectedTaskType ? (
                        <div className="text-secondary">Choose a task type to preview generated tasks.</div>
                      ) : previewTasks.length === 0 ? (
                        <div className="text-secondary">No preview tasks yet.</div>
                      ) : (
                        <div className="d-grid gap-3">
                          {previewTasks.map((task) => (
                            <div key={task.id} className="workflow-preview-card">
                              <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
                                <div className="fw-semibold">{task.title}</div>
                                <span className="om-summary-chip">
                                  Source Files: {task.source_file_count}
                                </span>
                              </div>

                              <div className="small text-secondary mb-2">
                                Folder: {task.source_folder_path || rootFolder || "N/A"}
                              </div>

                              <div className="workflow-preview-files">
                                {task.source_files.slice(0, 8).map((entry) => (
                                  <div
                                    key={`${task.id}:${entry.relative_path}`}
                                    className="workflow-preview-file-row"
                                  >
                                    <div className="fw-medium">{entry.name}</div>
                                    <div className="small text-secondary">
                                      {entry.relative_path}
                                    </div>
                                  </div>
                                ))}
                                {task.source_files.length > 8 && (
                                  <div className="small text-secondary">
                                    + {task.source_files.length - 8} more files
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </div>

              {manifest.length > 0 && (
                <section className="card om-card mt-3">
                  <div className="card-body">
                    <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                      <div>
                        <h6 className="mb-1">Manifest Preview</h6>
                        <div className="small text-secondary">
                          Metadata only. No file content is uploaded or stored.
                        </div>
                      </div>
                      <span className="om-summary-chip">Rows: {manifest.length}</span>
                    </div>

                    <div className="table-responsive">
                      <table className="table table-sm align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Relative Path</th>
                            <th>Folder Path</th>
                            <th>Type</th>
                            <th>Size</th>
                          </tr>
                        </thead>
                        <tbody>
                          {manifest.slice(0, 25).map((entry) => (
                            <tr key={entry.relative_path}>
                              <td>{entry.name}</td>
                              <td>{entry.relative_path}</td>
                              <td>{entry.folder_path}</td>
                              <td>{entry.file_type}</td>
                              <td>{formatBytes(entry.size_bytes)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {manifest.length > 25 && (
                      <div className="small text-secondary mt-2">
                        Showing first 25 manifest rows.
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "Creating..." : "Create Batch"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default WorkflowBatchCreateModal;
