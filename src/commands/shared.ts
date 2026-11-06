import { usageError } from '../errors.js';
import type {
  CommandName,
  Diagnostic,
  MutationResult,
  OutputFormat
} from '../types.js';
import {
  printJson,
  serializeDiagnostic,
  successEnvelope
} from '../output/json.js';
import { printMutation } from '../output/text.js';
import type { BpmnDocument } from '../core/document.js';

export function parseFormat(value: string | undefined): OutputFormat {
  if (value === undefined || value === 'text') {
    return 'text';
  }

  if (value === 'json') {
    return 'json';
  }

  throw usageError(`Unknown output format "${value}". Use "text" or "json".`);
}

export function allWarnings(
  doc: BpmnDocument,
  result: MutationResult
): Diagnostic[] {
  return [...doc.parseWarnings, ...result.warnings];
}

export function mutationPayload(
  result: MutationResult,
  warnings: Diagnostic[]
): Record<string, unknown> {
  return {
    changes: result.changes,
    di: result.di,
    warnings: warnings.map(serializeDiagnostic)
  };
}

export async function persistMutation(
  command: CommandName,
  doc: BpmnDocument,
  result: MutationResult,
  file: string,
  format: OutputFormat
): Promise<void> {
  const warnings = allWarnings(doc, result);
  await doc.save();

  if (format === 'json') {
    printJson(successEnvelope(command, file, mutationPayload(result, warnings)));
  } else {
    printMutation(file, result.changes, warnings);
  }
}
