export const EXIT_OK = 0;
export const EXIT_VALIDATION = 1;
export const EXIT_USAGE = 2;
export const EXIT_IO = 3;
export const EXIT_OPERATION = 4;
export const EXIT_INTERNAL = 5;

export interface CliErrorOptions {
  exitCode?: number;
  hint?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, options: CliErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CliError';
    this.code = code;
    this.exitCode = options.exitCode ?? EXIT_OPERATION;
    this.hint = options.hint;
    this.details = options.details;
  }
}

export function usageError(message: string, hint?: string): CliError {
  return new CliError('E_USAGE', message, { exitCode: EXIT_USAGE, hint });
}

export function ioError(
  code: string,
  message: string,
  options: Omit<CliErrorOptions, 'exitCode'> = {}
): CliError {
  return new CliError(code, message, { ...options, exitCode: EXIT_IO });
}

export function operationError(
  code: string,
  message: string,
  options: Omit<CliErrorOptions, 'exitCode'> = {}
): CliError {
  return new CliError(code, message, { ...options, exitCode: EXIT_OPERATION });
}

export function internalError(message: string, cause?: unknown): CliError {
  return new CliError('E_INTERNAL', message, { exitCode: EXIT_INTERNAL, cause });
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof Error) {
    return new CliError('E_INTERNAL', error.message, {
      exitCode: EXIT_INTERNAL,
      cause: error
    });
  }

  return new CliError('E_INTERNAL', String(error), { exitCode: EXIT_INTERNAL });
}
