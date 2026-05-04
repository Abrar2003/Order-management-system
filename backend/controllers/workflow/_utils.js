const normalizeText = (value) => String(value ?? "").trim();

const getErrorStatusCode = (error) => {
  if (error?.code === 11000) return 409;

  const message = normalizeText(error?.message).toLowerCase();
  if (!message) return 500;

  if (
    message.includes("required") ||
    message.includes("invalid") ||
    message.includes("cannot") ||
    message.includes("must be") ||
    message.includes("unsupported")
  ) {
    return 400;
  }

  if (
    message.includes("access") ||
    message.includes("permission") ||
    message.includes("only admin") ||
    message.includes("only an assigned user") ||
    message.includes("do not have access")
  ) {
    return 403;
  }

  if (message.includes("not found")) {
    return 404;
  }

  if (message.includes("already exists") || message.includes("already been generated")) {
    return 409;
  }

  return 500;
};

module.exports = {
  getErrorStatusCode,
};
