/** A failure with a stable code and an HTTP status. Messages are safe to display. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, "not_found", `${what} was not found.`);
export const invalid = (message: string, details?: unknown) => new AppError(422, "invalid", message, details);
export const conflict = (message: string, details?: unknown) => new AppError(409, "conflict", message, details);
export const forbidden = (message = "You do not have permission to do this.") => new AppError(403, "forbidden", message);
