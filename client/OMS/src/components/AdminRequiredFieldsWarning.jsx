const AdminRequiredFieldsWarning = ({
  canUseStoredValue = false,
  onUseStoredValue,
  onUpdateAnyway,
  onGoBack,
  disabled = false,
  missingFields = [],
}) => (
  <div className="alert alert-danger mb-0" role="alert">
    <div>The following mandatory fields are missing. Do you want to update anyway?</div>
    {missingFields.length > 0 && (
      <ul className="mb-0 mt-2">
        {missingFields.map((field) => (
          <li key={field}>{field}</li>
        ))}
      </ul>
    )}
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
