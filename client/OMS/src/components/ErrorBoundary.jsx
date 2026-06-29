import React from "react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught React ErrorBoundary exception:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoToSignin = () => {
    window.location.assign("/signin");
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="d-flex flex-column align-items-center justify-content-center min-vh-100 bg-light px-3 text-center">
          <div className="card shadow-sm border-0 p-4" style={{ maxWidth: "450px", width: "100%" }}>
            <div className="mb-3 fs-1 text-warning">⚠️</div>
            <h3 className="h4 font-weight-bold text-dark mb-2">Session or Page Update Needed</h3>
            <p className="text-secondary mb-4 small">
              The application encountered an unexpected issue or your session timed out after being idle. Refreshing will restore normal functionality.
            </p>
            <div className="d-flex flex-column gap-2">
              <button
                type="button"
                className="btn btn-primary btn-md w-100"
                onClick={this.handleReload}
              >
                Reload Page
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-md w-100"
                onClick={this.handleGoToSignin}
              >
                Go to Sign In
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
