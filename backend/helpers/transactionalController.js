class DeferredHttpResponseError extends Error {
  constructor(statusCode, body) {
    super(`HTTP ${statusCode}`);
    this.name = "DeferredHttpResponseError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

const createDeferredResponse = (res) => {
  let statusCode = 200;
  let body;
  let sent = false;

  const deferred = Object.create(res);

  deferred.status = (nextStatusCode) => {
    statusCode = Number(nextStatusCode) || 200;
    return deferred;
  };

  deferred.json = (nextBody) => {
    body = nextBody;
    sent = true;
    return deferred;
  };

  return {
    response: deferred,
    getResult: () => ({ statusCode, body, sent }),
  };
};

const isTransactionUnsupportedError = (error) => {
  const candidates = [
    error,
    error?.cause,
    error?.originalError,
    error?.errorResponse,
  ].filter(Boolean);

  return candidates.some((candidate) => {
    const message = String(candidate?.message || candidate?.errmsg || "")
      .trim()
      .toLowerCase();
    return (
      Number(candidate?.code) === 20 ||
      message.includes(
        "transaction numbers are only allowed on a replica set member or mongos",
      ) ||
      message.includes("transactions are not supported")
    );
  });
};

const sendDeferredResult = (res, result) => {
  if (!result?.sent) {
    return res.status(204).end();
  }
  return res.status(result.statusCode).json(result.body);
};

const sendTransactionsRequired = (res) =>
  res.status(503).json({
    code: "MONGODB_TRANSACTIONS_REQUIRED",
    message:
      "QC updates are temporarily unavailable because atomic database writes are not configured.",
  });

const runTransactionalController = async ({
  connection,
  handler,
  req,
  res,
}) => {
  if (connection?.$supportsTransactions === false) {
    console.error(
      "Atomic controller refused to run without MongoDB transaction support.",
      {
        method: req.method,
        path: req.originalUrl || req.url,
      },
    );
    return sendTransactionsRequired(res);
  }

  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { response, getResult } = createDeferredResponse(res);

    try {
      await connection.transaction(async () => {
        await handler(req, response);

        const result = getResult();
        if (result.sent && result.statusCode >= 400) {
          throw new DeferredHttpResponseError(result.statusCode, result.body);
        }
      });
    } catch (error) {
      if (error instanceof DeferredHttpResponseError) {
        return res.status(error.statusCode).json(error.body);
      }

      if (isTransactionUnsupportedError(error)) {
        connection.$supportsTransactions = false;
        console.error(
          "Atomic controller detected missing MongoDB transaction support.",
          {
            method: req.method,
            path: req.originalUrl || req.url,
          },
        );
        return sendTransactionsRequired(res);
      }

      if (error?.name === "VersionError" && attempt < maxAttempts) {
        continue;
      }

      console.error("Transactional controller failed:", {
        method: req.method,
        path: req.originalUrl || req.url,
        error: error?.message || String(error),
      });

      return res.status(500).json({
        message: "The QC update could not be completed. No changes were saved.",
      });
    }

    return sendDeferredResult(res, getResult());
  }
};

module.exports = {
  DeferredHttpResponseError,
  createDeferredResponse,
  isTransactionUnsupportedError,
  runTransactionalController,
};
