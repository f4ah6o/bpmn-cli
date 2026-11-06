import { EXIT_VALIDATION } from '../errors.js';
import { BpmnDocument } from '../core/document.js';
import { validateDocument } from '../core/validation.js';
import {
  printJson,
  serializeFinding,
  successEnvelope
} from '../output/json.js';
import { printValidation } from '../output/text.js';
import { parseFormat } from './shared.js';

export interface ValidateCliOptions {
  config?: string;
  lint?: boolean;
  style?: boolean;
  format?: string;
}

export async function runValidate(
  file: string,
  options: ValidateCliOptions
): Promise<void> {
  const format = parseFormat(options.format);
  const doc = await BpmnDocument.load(file);

  const result = await validateDocument(doc, {
    configPath: options.config,
    noLint: options.lint === false,
    style: options.style === true
  });

  const valid = result.summary.errors === 0;

  if (format === 'json') {
    const envelope = successEnvelope('validate', file, {
      valid,
      findings: result.findings.map(serializeFinding),
      summary: result.summary,
      warnings: []
    });

    envelope.ok = valid;
    printJson(envelope);
  } else {
    printValidation(file, result.findings, result.summary);
  }

  if (!valid) {
    process.exitCode = EXIT_VALIDATION;
  }
}
