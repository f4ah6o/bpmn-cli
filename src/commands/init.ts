import { ioError, operationError } from '../errors.js';
import { isDirectory, pathExists } from '../io/filesystem.js';
import { BpmnDocument } from '../core/document.js';
import {
  hasLayoutTargets,
  noLayoutTargetsWarning,
  runAutoLayout
} from '../layout/auto-layout.js';
import type { Diagnostic } from '../types.js';
import { printJson, serializeDiagnostic, successEnvelope } from '../output/json.js';
import { printLayout, printWarning } from '../output/text.js';
import { parseFormat } from './shared.js';

export interface InitCliOptions {
  name?: string;
  id?: string;
  namespace: string;
  executable?: boolean;
  force?: boolean;
  layout?: boolean;
  format?: string;
}

export async function runInit(
  file: string,
  options: InitCliOptions
): Promise<void> {
  const format = parseFormat(options.format);

  if (await pathExists(file)) {
    if (await isDirectory(file)) {
      throw ioError('E_IS_DIRECTORY', `Path is a directory: ${file}`);
    }

    if (!options.force) {
      throw operationError(
        'E_FILE_EXISTS',
        `File already exists: ${file}`,
        { hint: 'Use --force to overwrite it.' }
      );
    }
  }

  const doc = BpmnDocument.create(file, {
    processId: options.id,
    processName: options.name,
    targetNamespace: options.namespace,
    executable: options.executable === true
  });

  const processInfo = doc.selectProcess();
  const warnings: Diagnostic[] = [];
  let layoutResult:
    | Awaited<ReturnType<typeof runAutoLayout>>
    | undefined;
  let xml: string | undefined;

  if (options.layout === true) {
    if (!hasLayoutTargets(doc.index)) {
      warnings.push(noLayoutTargetsWarning());
    } else {
      const input = await doc.toXML();
      layoutResult = await runAutoLayout(doc, input);
      warnings.push(...layoutResult.warnings);
      xml = layoutResult.xml;
    }
  }

  if (xml === undefined) {
    await doc.save();
  } else {
    await doc.saveXml(xml, file);
  }

  const di = layoutResult
    ? { present: layoutResult.after.diPresent, stale: false }
    : { present: doc.index.di.present, stale: false };

  const payload = {
    definitions: {
      id: doc.definitions.id ?? null,
      targetNamespace: doc.definitions.targetNamespace ?? null
    },
    process: {
      id: processInfo.id,
      name: processInfo.name,
      isExecutable: processInfo.isExecutable
    },
    changes: [
      {
        op: 'add',
        id: processInfo.id,
        type: 'bpmn:Process',
        ...(processInfo.name === null ? {} : { name: processInfo.name })
      }
    ],
    di,
    layout: layoutResult
      ? {
          performed: true,
          output: file,
          before: layoutResult.before,
          after: layoutResult.after
        }
      : { performed: false },
    warnings: warnings.map(serializeDiagnostic)
  };

  if (format === 'json') {
    printJson(successEnvelope('init', file, payload));
    return;
  }

  const name = processInfo.name === null ? '' : ` "${processInfo.name}"`;
  process.stdout.write(
    `Created ${file} (process ${processInfo.id}${name}).\n`
  );

  if (layoutResult) {
    printLayout(file, true, layoutResult.before, layoutResult.after);
  }

  for (const warning of warnings) {
    printWarning(warning);
  }
}
