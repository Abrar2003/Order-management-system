import { useState } from "react";
import { changePassword } from "../auth/auth.service";
import "../App.css";

const initialForm = {
  current_password: "",
  new_password: "",
  confirm_password: "",
};

const ChangePasswordModal = ({ onClose, onSuccess }) => {
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.current_password || !form.new_password || !form.confirm_password) {
      setError("Please fill all password fields.");
      return;
    }

    if (form.new_password !== form.confirm_password) {
      setError("New passwords do not match.");
      return;
    }

    try {
      setSaving(true);
      const response = await changePassword(form);
      setSuccess(response?.message || "Password updated successfully.");
      setForm(initialForm);
      onSuccess?.();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to update password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Change Password</h5>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onClose}
              disabled={saving}
            />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="modal-body d-grid gap-3">
              <div>
                <label className="form-label">Current Password</label>
                <input
                  type="password"
                  name="current_password"
                  className="form-control"
                  value={form.current_password}
                  onChange={handleChange}
                  disabled={saving}
                  required
                />
              </div>

              <div>
                <label className="form-label">New Password</label>
                <input
                  type="password"
                  name="new_password"
                  className="form-control"
                  value={form.new_password}
                  onChange={handleChange}
                  disabled={saving}
                  required
                />
              </div>

              <div>
                <label className="form-label">Confirm New Password</label>
                <input
                  type="password"
                  name="confirm_password"
                  className="form-control"
                  value={form.confirm_password}
                  onChange={handleChange}
                  disabled={saving}
                  required
                />
              </div>

              {error && <div className="alert alert-danger mb-0">{error}</div>}
              {success && <div className="alert alert-success mb-0">{success}</div>}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Updating..." : "Update Password"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChangePasswordModal;
