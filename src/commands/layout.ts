import { ioError, operationError, usageError } from '../errors.js';
import {
  ensureTrailingNewline,
  isDirectory,
  isSameFilePath,
  pathExists,
  writeTextFileAtomic
} from '../io/filesystem.js';
import { BpmnDocument } from '../core/document.js';
import { reconcileFlowReferences } from '../core/references.js';
import {
  hasLayoutTargets,
  multipleProcessesWarning,
  noLayoutTargetsWarning,
  runAutoLayout
} from '../layout/auto-layout.js';
import type { Diagnostic } from '../types.js';
import {
  printJson,
  serializeDiagnostic,
  successEnvelope
} from '../output/json.js';
import { printLayout, printWarnings } from '../output/text.js';
import { parseFormat } from './shared.js';

export interface LayoutCliOptions {
  force?: boolean;
  output?: string;
  stdout?: boolean;
  format?: string;
}

export async function runLayout(
  file: string,
  options: LayoutCliOptions
): Promise<void> {
  const format = parseFormat(options.format);
  const stdout = options.stdout === true;

  if (stdout && options.output !== undefined) {
    throw usageError('--stdout and --output cannot be used together.');
  }

  if (stdout && format === 'json') {
    throw usageError('--stdout cannot be combined with --format json.');
  }

  const doc = await BpmnDocument.load(file);
  const warnings: Diagnostic[] = [...doc.parseWarnings];
  const multiple = multipleProcessesWarning(doc.index);

  if (multiple) {
    warnings.push(multiple);
  }

  if (!hasLayoutTargets(doc.index)) {
    warnings.push(noLayoutTargetsWarning());

    if (stdout) {
      process.stdout.write(ensureTrailingNewline(doc.rawXml));
      printWarnings(warnings);
      return;
    }

    const counts = {
      diPresent: doc.index.di.present,
      shapes: doc.index.di.shapes,
      edges: doc.index.di.edges
    };

    if (format === 'json') {
      printJson(
        successEnvelope('layout', file, {
          output: null,
          wrote: false,
          before: counts,
          after: counts,
          warnings: warnings.map(serializeDiagnostic)
        })
      );
      return;
    }

    process.stdout.write('No layout written.\n');
    printWarnings(warnings);
    return;
  }

  const outputPath = options.output;
  const samePath =
    outputPath !== undefined && (await isSameFilePath(outputPath, file));
  const inPlace = outputPath === undefined || samePath;

  if (!stdout) {
    if (inPlace) {
      if (doc.index.di.content && options.force !== true) {
        throw operationError(
          'E_LAYOUT_OVERWRITE_DI',
          'The file already contains BPMN DI; auto-layout would replace the existing layout.',
          {
            hint: 'Use --force to replace it, or --output <path> to write a copy.'
          }
        );
      }
    } else if (await pathExists(outputPath!)) {
      if (await isDirectory(outputPath!)) {
        throw ioError('E_IS_DIRECTORY', `Path is a directory: ${outputPath}`);
      }

      if (options.force !== true) {
        throw operationError(
          'E_OUTPUT_EXISTS',
          `Output file already exists: ${outputPath}`,
          { hint: 'Use --force to overwrite it.' }
        );
      }
    }
  }

  reconcileFlowReferences(doc.index);
  const inputXml = await doc.toXML();
  const result = await runAutoLayout(doc, inputXml);
  warnings.push(...result.warnings);

  if (stdout) {
    process.stdout.write(result.xml);
    printWarnings(warnings);
    return;
  }

  const target = inPlace ? file : outputPath!;
  await writeTextFileAtomic(target, result.xml);

  if (format === 'json') {
    printJson(
      successEnvelope('layout', file, {
        output: target,
        wrote: true,
        before: result.before,
        after: result.after,
        warnings: warnings.map(serializeDiagnostic)
      })
    );
    return;
  }

  printLayout(target, true, result.before, result.after);
  printWarnings(warnings);
}
