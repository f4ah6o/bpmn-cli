import type { CliError } from '../errors.js';
import type { Diagnostic, Finding } from '../types.js';
import { TOOL } from '../version.js';

export function successEnvelope(
  command: string,
  file: string | null,
  payload: Record<string, unknown>
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    tool: TOOL,
    ok: true,
    command,
    file,
    ...payload
  };
}

export function errorEnvelope(
  command: string,
  file: string | null,
  error: CliError
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    code: error.code,
    message: error.message
  };

  if (error.hint !== undefined) {
    body.hint = error.hint;
  }

  if (error.details !== undefined) {
    body.details = error.details;
  }

  return {
    schemaVersion: 1,
    tool: TOOL,
    ok: false,
    command,
    file,
    error: body
  };
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function printJsonError(
  command: string,
  file: string | null,
  error: CliError
): void {
  process.stderr.write(`${JSON.stringify(errorEnvelope(command, file, error))}\n`);
}

export function serializeDiagnostic(diagnostic: Diagnostic): Record<string, unknown> {
  const value: Record<string, unknown> = {
    source: diagnostic.source,
    code: diagnostic.code,
    message: diagnostic.message
  };

  if (diagnostic.elementId !== undefined) {
    value.elementId = diagnostic.elementId;
  }

  if (diagnostic.relatedElementIds !== undefined) {
    value.relatedElementIds = diagnostic.relatedElementIds;
  }

  return value;
}

export function serializeFinding(finding: Finding): Record<string, unknown> {
  const value: Record<string, unknown> = {
    severity: finding.severity,
    source: finding.source,
    rule: finding.rule,
    message: finding.message
  };

  if (finding.elementId !== undefined) {
    value.elementId = finding.elementId;
  }

  if (finding.path !== undefined) {
    value.path = finding.path;
  }

  if (finding.details !== undefined) {
    value.details = finding.details;
  }

  return value;
}
