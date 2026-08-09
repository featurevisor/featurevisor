export interface FeaturevisorCLIErrorOptions {
  code: string;
  details?: Record<string, unknown>;
}

export class FeaturevisorCLIError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(message: string, options: FeaturevisorCLIErrorOptions) {
    super(message);
    this.name = "FeaturevisorCLIError";
    this.code = options.code;
    this.details = options.details || {};
  }
}

export function getFeaturevisorCLIErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return undefined;
}

export function formatFeaturevisorCLIError(
  error: unknown,
  options: { json?: boolean; pretty?: boolean } = {},
) {
  const message = getFeaturevisorCLIErrorMessage(error) || "An unexpected error occurred.";
  const cliError = error instanceof FeaturevisorCLIError ? error : undefined;

  if (options.json) {
    const payload = {
      error: {
        code: cliError?.code || "unexpected_error",
        message,
        details: cliError?.details || {},
      },
    };

    return options.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
  }

  return message;
}
