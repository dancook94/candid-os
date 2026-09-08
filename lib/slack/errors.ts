export class SlackError extends Error {
  readonly code: string;
  readonly status: number;
  readonly slackError?: string;

  constructor(
    message: string,
    code: string,
    status = 502,
    slackError?: string
  ) {
    super(message);
    this.name = "SlackError";
    this.code = code;
    this.status = status;
    this.slackError = slackError;
  }
}

export function isSlackError(error: unknown): error is SlackError {
  return error instanceof SlackError;
}
