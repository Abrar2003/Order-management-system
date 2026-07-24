import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import {
  createOmsAssistantState,
  omsAssistantReducer,
} from "../utils/omsAssistantState";
import "../App.css";

const EXAMPLE_QUESTIONS = [
  "How many containers were shipped last month?",
  "How many items do not have PIS barcodes?",
  "Which purchase orders are delayed?",
  "Give me shipment totals by vendor for June 2026.",
];

const displayValue = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const ResultRows = ({ rows = [] }) => {
  const columns = useMemo(() => {
    const keys = rows.flatMap((row) =>
      row && typeof row === "object" && !Array.isArray(row)
        ? Object.keys(row)
        : ["value"],
    );
    const uniqueKeys = [...new Set(keys)];
    return (uniqueKeys.length ? uniqueKeys : ["value"]).slice(0, 8);
  }, [rows]);

  if (!rows.length) return null;

  return (
    <details className="oms-assistant-results mt-3">
      <summary>Supporting rows ({rows.length})</summary>
      <div className="table-responsive mt-2">
        <table className="table table-sm align-middle mb-0">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const record =
                row && typeof row === "object" && !Array.isArray(row)
                  ? row
                  : { value: row };
              return (
                <tr key={`result-${rowIndex}`}>
                  {columns.map((column) => (
                    <td key={column}>{displayValue(record[column])}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
};

const AnswerMetadata = ({ metadata = {} }) => {
  const filters =
    metadata.filters && typeof metadata.filters === "object"
      ? Object.entries(metadata.filters)
      : [];
  const rawDateRange =
    metadata.dateRange && typeof metadata.dateRange === "object"
      ? metadata.dateRange
      : null;
  const dateRange =
    rawDateRange &&
    (rawDateRange.start || rawDateRange.from || rawDateRange.end || rawDateRange.to)
      ? rawDateRange
      : null;
  const hasSummary =
    dateRange ||
    filters.length ||
    Number.isFinite(metadata.returnedRows) ||
    metadata.truncated;

  if (!hasSummary) return null;

  return (
    <div className="oms-assistant-metadata mt-3" aria-label="Answer details">
      {dateRange && (
        <span>
          Date: {displayValue(dateRange.start || dateRange.from)} to{" "}
          {displayValue(dateRange.end || dateRange.to)}
          {dateRange.timezone ? ` (${dateRange.timezone})` : ""}
        </span>
      )}
      {filters.map(([key, value]) => (
        <span key={key}>{key}: {displayValue(value)}</span>
      ))}
      {Number.isFinite(metadata.returnedRows) && (
        <span>Rows: {metadata.returnedRows}</span>
      )}
      {metadata.truncated && <span>Results limited</span>}
    </div>
  );
};

const OmsAssistant = () => {
  const [state, dispatch] = useReducer(
    omsAssistantReducer,
    undefined,
    createOmsAssistantState,
  );
  const [question, setQuestion] = useState("");
  const submittingRef = useRef(false);
  const messageIdRef = useRef(0);
  const endRef = useRef(null);
  const loading = state.status === "loading";

  const nextMessageId = (role) => {
    messageIdRef.current += 1;
    return `${role}-${messageIdRef.current}`;
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [state.messages, state.status]);

  const submitQuestion = async (input) => {
    const message = String(input ?? question).trim();
    if (!message || loading || submittingRef.current) return;

    submittingRef.current = true;
    dispatch({
      type: "submit",
      payload: { id: nextMessageId("user"), message },
    });
    setQuestion("");

    try {
      const body = { message };
      if (state.conversationId) body.conversationId = state.conversationId;
      const response = await api.post("/oms-chat/ask", body);
      const data = response?.data;
      if (!data?.success || typeof data.answer !== "string") {
        throw new Error("Invalid assistant response.");
      }

      dispatch({
        type: "success",
        payload: {
          id: nextMessageId("assistant"),
          answer: data.answer,
          conversationId: data.conversationId,
          metadata: data.metadata,
          rows: data.rows,
        },
      });
    } catch (requestError) {
      dispatch({
        type: "error",
        payload: {
          message:
            requestError?.response?.data?.message ||
            "The OMS Assistant is temporarily unavailable. Please try again.",
        },
      });
    } finally {
      submittingRef.current = false;
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    submitQuestion();
  };

  return (
    <>
      <Navbar />
      <main className="page-shell py-3 oms-assistant-page">
        <header className="mb-3">
          <h1 className="h3 mb-1">OMS Assistant</h1>
          <p className="text-secondary mb-0">
            Ask read-only questions across all OMS data.
          </p>
        </header>

        <section className="card om-card oms-assistant-card" aria-label="OMS Assistant chat">
          <div
            className="card-body oms-assistant-chat"
            role="log"
            aria-live="polite"
            aria-busy={loading}
          >
            {state.messages.length === 0 && (
              <div className="oms-assistant-welcome">
                <h2 className="h5">Try an example</h2>
                <div className="d-flex flex-wrap gap-2">
                  {EXAMPLE_QUESTIONS.map((example) => (
                    <button
                      key={example}
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => submitQuestion(example)}
                      disabled={loading}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {state.messages.map((message) => (
              <article
                key={message.id}
                className={`oms-assistant-message oms-assistant-message--${message.role}`}
              >
                <div className="oms-assistant-role">
                  {message.role === "user" ? "You" : "OMS Assistant"}
                </div>
                <div className="oms-assistant-bubble">
                  <div className="oms-assistant-answer">{message.text}</div>
                  {message.role === "assistant" && (
                    <>
                      <AnswerMetadata metadata={message.metadata} />
                      <ResultRows rows={message.rows} />
                    </>
                  )}
                </div>
              </article>
            ))}

            {loading && (
              <div className="oms-assistant-message oms-assistant-message--assistant">
                <div className="oms-assistant-role">OMS Assistant</div>
                <div className="oms-assistant-bubble" role="status">
                  Checking OMS data...
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="card-footer oms-assistant-composer">
            {state.error && (
              <div className="alert alert-danger py-2" role="alert">
                {state.error}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <label className="form-label" htmlFor="oms-assistant-question">
                Ask a question
              </label>
              <div className="d-flex align-items-end gap-2">
                <textarea
                  id="oms-assistant-question"
                  className="form-control"
                  rows="2"
                  maxLength="2000"
                  placeholder="Ask about orders, shipments, items, QC, vendors, or samples..."
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  disabled={loading}
                />
                <button
                  type="submit"
                  className="btn btn-dark px-4"
                  disabled={loading || !question.trim()}
                >
                  {loading ? "Asking..." : "Ask"}
                </button>
              </div>
              <div className="form-text">Press Enter to send, or Shift+Enter for a new line.</div>
            </form>
          </div>
        </section>
      </main>
    </>
  );
};

export default OmsAssistant;
