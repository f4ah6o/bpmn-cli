import type { ModdleElement } from 'bpmn-moddle';

import { ioError, operationError } from '../errors.js';
import { ensureTrailingNewline, readTextFile, writeTextFileAtomic } from '../io/filesystem.js';
import type { Diagnostic } from '../types.js';
import { assertValidId, allocateId } from './ids.js';
import { attachRoot, isType, moddle } from './moddle.js';
import {
  buildIndex,
  resolveItem,
  selectProcess
} from './model.js';
import type { IndexedItem, IndexedProcess, ModelIndex } from '../types.js';

export interface CreateDocumentOptions {
  processId?: string;
  processName?: string;
  targetNamespace: string;
  executable: boolean;
}

export class BpmnDocument {
  readonly filePath: string;
  readonly definitions: ModdleElement;
  rawXml: string;
  parseWarnings: Diagnostic[];
  index: ModelIndex;

  private constructor(
    filePath: string,
    definitions: ModdleElement,
    rawXml: string,
    parseWarnings: Diagnostic[]
  ) {
    this.filePath = filePath;
    this.definitions = definitions;
    this.rawXml = rawXml;
    this.parseWarnings = parseWarnings;
    this.index = buildIndex(definitions);
  }

  static async load(filePath: string): Promise<BpmnDocument> {
    const rawXml = await readTextFile(filePath);
    let parsed: Awaited<ReturnType<typeof moddle.fromXML>>;

    try {
      parsed = await moddle.fromXML(rawXml);
    } catch (error) {
      throw ioError(
        'E_PARSE_FAILED',
        `Could not parse BPMN XML: ${(error as Error).message}`,
        { cause: error }
      );
    }

    const definitions = parsed.rootElement;

    if (!definitions || !isType(definitions, 'bpmn:Definitions')) {
      throw ioError(
        'E_NOT_BPMN',
        'The file is XML but is not a BPMN definitions document.',
        { details: { rootType: definitions?.$type ?? 'unknown' } }
      );
    }

    const parseWarnings = normalizeParseWarnings(parsed.warnings ?? []);
    return new BpmnDocument(filePath, definitions, rawXml, parseWarnings);
  }

  static create(
    filePath: string,
    options: CreateDocumentOptions
  ): BpmnDocument {
    const ids = new Set<string>();
    const processId =
      options.processId ?? allocateId(ids, 'Process');

    assertValidId(processId);
    ids.add(processId);

    const definitionsId = allocateId(ids, 'Definitions');
    const definitions = moddle.create('bpmn:Definitions', {
      id: definitionsId,
      targetNamespace: options.targetNamespace
    });

    const process = moddle.create('bpmn:Process', {
      id: processId,
      isExecutable: options.executable
    });

    if (options.processName !== undefined && options.processName.length > 0) {
      process.set('name', options.processName);
    }

    attachRoot(definitions, process);

    return new BpmnDocument(filePath, definitions, '', []);
  }

  refresh(): void {
    this.index = buildIndex(this.definitions);
  }

  selectProcess(processId?: string): IndexedProcess {
    return selectProcess(this.index, processId);
  }

  resolve(id: string): IndexedItem {
    return resolveItem(this.index, id);
  }

  async toXML(): Promise<string> {
    let xml: string;

    try {
      const result = await moddle.toXML(this.definitions, { format: true });
      xml = result.xml;
    } catch (error) {
      throw operationError(
        'E_SERIALIZE_FAILED',
        `Could not serialize BPMN XML: ${(error as Error).message}`,
        { cause: error }
      );
    }

    if (!xml.startsWith('<?xml')) {
      xml = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
    }

    return ensureTrailingNewline(xml);
  }

  async save(): Promise<{ path: string; bytes: number }> {
    const xml = await this.toXML();
    const result = await writeTextFileAtomic(this.filePath, xml);
    this.rawXml = xml;
    return result;
  }

  async saveXml(xml: string, outputPath = this.filePath): Promise<{ path: string; bytes: number }> {
    const result = await writeTextFileAtomic(outputPath, ensureTrailingNewline(xml));
    this.rawXml = xml;
    return result;
  }
}

function normalizeParseWarnings(
  warnings: Array<{ message: string; element?: ModdleElement }>
): Diagnostic[] {
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  for (const warning of warnings) {
    const elementId =
      typeof warning.element?.id === 'string' ? warning.element.id : undefined;
    const key = `${elementId ?? ''}|${warning.message}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    diagnostics.push({
      source: 'parse',
      code: 'PARSE_WARNING',
      message: warning.message,
      ...(elementId === undefined ? {} : { elementId })
    });
  }

  return diagnostics;
}
