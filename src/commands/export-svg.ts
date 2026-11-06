import { extname } from 'node:path';
import type { ModdleElement } from 'bpmn-moddle';

import { ioError, operationError, usageError } from '../errors.js';
import {
  ensureTrailingNewline,
  isDirectory,
  isSameFilePath,
  pathExists,
  writeTextFileAtomic
} from '../io/filesystem.js';
import { BpmnDocument } from '../core/document.js';
import { isType, moddle } from '../core/moddle.js';
import { reconcileFlowReferences } from '../core/references.js';
import {
  hasLayoutTargets,
  multipleProcessesWarning,
  runAutoLayout
} from '../layout/auto-layout.js';
import { BPMN_JS_VERSION, renderSvg } from '../svg/render.js';
import type { Diagnostic } from '../types.js';
import {
  printJson,
  serializeDiagnostic,
  successEnvelope
} from '../output/json.js';
import { printExportSvg, printWarnings } from '../output/text.js';
import { parseFormat } from './shared.js';

export interface ExportSvgCliOptions {
  output?: string;
  stdout?: boolean;
  force?: boolean;
  diagram?: string;
  relayout?: boolean;
  format?: string;
}

interface DiagramInfo {
  id: string | null;
  name: string | null;
}

function defaultOutputPath(file: string): string {
  const extension = extname(file);
  return extension.toLowerCase() === '.bpmn'
    ? `${file.slice(0, -extension.length)}.svg`
    : `${file}.svg`;
}

function diagramInfos(definitions: ModdleElement): DiagramInfo[] {
  const diagrams = Array.isArray(definitions.diagrams)
    ? (definitions.diagrams as ModdleElement[])
    : [];

  return diagrams.map((diagram) => ({
    id: typeof diagram.id === 'string' ? diagram.id : null,
    name: typeof diagram.name === 'string' ? diagram.name : null
  }));
}

async function parseDefinitions(xml: string): Promise<ModdleElement> {
  let parsed: Awaited<ReturnType<typeof moddle.fromXML>>;

  try {
    parsed = await moddle.fromXML(xml);
  } catch (error) {
    throw operationError(
      'E_SVG_RENDER',
      `Could not parse the BPMN XML used for SVG rendering: ${(error as Error).message}`,
      { cause: error }
    );
  }

  if (!parsed.rootElement || !isType(parsed.rootElement, 'bpmn:Definitions')) {
    throw operationError(
      'E_SVG_RENDER',
      'The BPMN XML used for SVG rendering is not a definitions document.'
    );
  }

  return parsed.rootElement;
}

function diWarnings(doc: BpmnDocument): Diagnostic[] {
  const warnings: Diagnostic[] = [];

  if (doc.index.di.missing > 0) {
    warnings.push({
      source: 'cli',
      code: 'SVG_DI_MISSING',
      message:
        `${doc.index.di.missing} element(s) have no BPMN DI shape; the SVG may omit them.`,
      hint: 'Use --relayout to regenerate the layout in memory.'
    } as Diagnostic & { hint: string });
  }

  if (doc.index.di.stale > 0) {
    warnings.push({
      source: 'cli',
      code: 'SVG_DI_STALE',
      message:
        `${doc.index.di.stale} BPMN DI shape(s) reference elements that no longer exist.`,
      hint: 'Use --relayout to regenerate the layout in memory.'
    } as Diagnostic & { hint: string });
  }

  return warnings;
}

export async function runExportSvg(
  file: string,
  options: ExportSvgCliOptions
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

  if (!hasLayoutTargets(doc.index)) {
    throw operationError(
      'E_SVG_EMPTY',
      'There are no flow elements to render.',
      { hint: 'Add at least one flow element before exporting SVG.' }
    );
  }

  const multiple = multipleProcessesWarning(doc.index);
  if (multiple) {
    warnings.push(multiple);
  }

  const generated = options.relayout === true || !doc.index.di.content;
  let xml: string;
  let definitions: ModdleElement;
  let di: {
    present: boolean;
    generated: boolean;
    shapes: number;
    edges: number;
  };

  if (generated) {
    reconcileFlowReferences(doc.index);
    const inputXml = await doc.toXML();
    const result = await runAutoLayout(doc, inputXml);
    xml = result.xml;
    definitions = await parseDefinitions(xml);
    warnings.push(...result.warnings);
    di = {
      present: true,
      generated: true,
      shapes: result.after.shapes,
      edges: result.after.edges
    };
  } else {
    xml = doc.rawXml;
    definitions = doc.definitions;
    warnings.push(...diWarnings(doc));
    di = {
      present: doc.index.di.present,
      generated: false,
      shapes: doc.index.di.shapes,
      edges: doc.index.di.edges
    };
  }

  const diagrams = diagramInfos(definitions);
  if (diagrams.length === 0) {
    throw operationError(
      'E_SVG_EMPTY',
      'The BPMN document has no BPMNDiagram to render.'
    );
  }

  let selected: DiagramInfo;

  if (options.diagram !== undefined) {
    const found = diagrams.find((diagram) => diagram.id === options.diagram);
    if (!found) {
      throw operationError(
        'E_DIAGRAM_NOT_FOUND',
        `No BPMNDiagram found with id "${options.diagram}".`,
        { details: { diagrams: diagrams.map((diagram) => diagram.id) } }
      );
    }
    selected = found;
  } else {
    selected = diagrams[0]!;

    if (diagrams.length > 1) {
      warnings.push({
        source: 'cli',
        code: 'SVG_MULTIPLE_DIAGRAMS',
        message:
          'Multiple BPMNDiagram elements were found; only the first one is rendered.',
        relatedElementIds: diagrams
          .map((diagram) => diagram.id)
          .filter((id): id is string => id !== null)
      });
    }
  }

  const rendered = await renderSvg(xml, {
    ...(selected.id === null ? {} : { diagramId: selected.id })
  });
  warnings.push(...rendered.warnings);

  if (stdout) {
    process.stdout.write(ensureTrailingNewline(rendered.svg));
    printWarnings(warnings);
    return;
  }

  const target = options.output ?? defaultOutputPath(file);

  if (await isSameFilePath(target, file)) {
    throw operationError(
      'E_SVG_OUTPUT_SAME_AS_INPUT',
      'The SVG output path is the same as the BPMN input path.',
      { hint: 'Choose a different --output path.' }
    );
  }

  if (await pathExists(target)) {
    if (await isDirectory(target)) {
      throw ioError('E_IS_DIRECTORY', `Path is a directory: ${target}`);
    }

    if (options.force !== true) {
      throw operationError(
        'E_OUTPUT_EXISTS',
        `Output file already exists: ${target}`,
        { hint: 'Use --force to overwrite it.' }
      );
    }
  }

  const written = await writeTextFileAtomic(
    target,
    ensureTrailingNewline(rendered.svg)
  );

  const payload = {
    output: target,
    wrote: true,
    format: 'svg',
    bpmnJs: BPMN_JS_VERSION,
    diagram: {
      id: selected.id,
      name: selected.name
    },
    di,
    svg: {
      width: rendered.width,
      height: rendered.height,
      viewBox: rendered.viewBox,
      bytes: written.bytes
    },
    warnings: warnings.map(serializeDiagnostic)
  };

  if (format === 'json') {
    printJson(successEnvelope('export-svg', file, payload));
    return;
  }

  printExportSvg(target, {
    width: rendered.width,
    height: rendered.height,
    shapes: di.shapes,
    edges: di.edges
  });
  printWarnings(warnings);
}
