const AdminRequiredFieldsWarning = ({
  canUseStoredValue = false,
  onUseStoredValue,
  onUpdateAnyway,
  onGoBack,
  disabled = false,
}) => (
  <div className="alert alert-warning mb-0" role="alert">
    <div>This necessary field is missing. Do you want to update anyway?</div>
    <div className="d-flex flex-wrap gap-2 mt-2">
      {canUseStoredValue && (
        <button
          type="button"
          className="btn btn-sm btn-outline-dark"
          onClick={onUseStoredValue}
          disabled={disabled}
        >
          Use stored value & update
        </button>
      )}
      <button
        type="button"
        className="btn btn-sm btn-warning"
        onClick={onUpdateAnyway}
        disabled={disabled}
      >
        Update Anyway
      </button>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={onGoBack}
        disabled={disabled}
      >
        Go Back
      </button>
    </div>
  </div>
);

export default AdminRequiredFieldsWarning;
