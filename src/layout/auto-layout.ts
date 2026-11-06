import type { ModdleElement } from 'bpmn-moddle';
import { LayoutError, layoutProcess } from 'bpmn-auto-layout';

import { operationError } from '../errors.js';
import { ensureTrailingNewline } from '../io/filesystem.js';
import type { Diagnostic, ModelIndex } from '../types.js';
import { countDi } from '../core/di.js';
import type { BpmnDocument } from '../core/document.js';
import { isType, moddle } from '../core/moddle.js';

export interface LayoutCounts {
  diPresent: boolean;
  shapes: number;
  edges: number;
}

export interface LayoutRun {
  xml: string;
  warnings: Diagnostic[];
  before: LayoutCounts;
  after: LayoutCounts;
}

export function hasLayoutTargets(index: ModelIndex): boolean {
  return (
    index.elements.length > 0 ||
    index.flows.length > 0 ||
    index.participants.length > 0 ||
    index.messageFlows.length > 0
  );
}

export function noLayoutTargetsWarning(): Diagnostic {
  return {
    source: 'cli',
    code: 'NO_LAYOUT_TARGETS',
    message: 'There are no flow elements to lay out; the file was left unchanged.'
  };
}

export function multipleProcessesWarning(index: ModelIndex): Diagnostic | null {
  if (index.processes.length <= 1 || index.collaborations.length > 0) {
    return null;
  }

  return {
    source: 'cli',
    code: 'MULTIPLE_PROCESSES',
    message:
      'Multiple processes without a collaboration were found; bpmn-auto-layout lays out only the first process. ' +
      'Other processes may lose their BPMN DI.',
    relatedElementIds: index.processes.map((process) => process.id)
  };
}

export async function runAutoLayout(
  doc: BpmnDocument,
  xml: string
): Promise<LayoutRun> {
  const before: LayoutCounts = {
    diPresent: doc.index.di.present,
    shapes: doc.index.di.shapes,
    edges: doc.index.di.edges
  };

  let result: { xml: string; warnings: Array<Error & { code: string; elementId: string; relatedElementIds: string[] }> };

  try {
    result = await layoutProcess(xml);
  } catch (error) {
    const layoutError =
      error instanceof LayoutError ||
      (error as { name?: string } | null)?.name === 'LayoutError';

    if (layoutError) {
      const typed = error as Error & {
        code?: string;
        elementId?: string;
        relatedElementIds?: string[];
      };

      throw operationError(
        'E_LAYOUT_FAILED',
        `Layout failed: ${typed.message}`,
        {
          cause: error,
          details: {
            layoutCode: typed.code ?? 'UNKNOWN',
            elementId: typed.elementId ?? null,
            relatedElementIds: typed.relatedElementIds ?? []
          }
        }
      );
    }

    throw operationError(
      'E_LAYOUT_FAILED',
      `Layout failed: ${(error as Error).message}`,
      { cause: error }
    );
  }

  let afterDefinitions: ModdleElement;

  try {
    const parsed = await moddle.fromXML(result.xml);

    if (!parsed.rootElement || !isType(parsed.rootElement, 'bpmn:Definitions')) {
      throw new Error('Layout output is not a BPMN definitions document.');
    }

    afterDefinitions = parsed.rootElement;
  } catch (error) {
    throw operationError(
      'E_LAYOUT_INTEGRITY',
      `Layout produced invalid BPMN XML: ${(error as Error).message}`,
      { cause: error }
    );
  }

  assertSemanticIntegrity(doc.definitions, afterDefinitions);

  const counts = countDi(afterDefinitions);
  const after: LayoutCounts = {
    diPresent:
      Array.isArray(afterDefinitions.diagrams) && afterDefinitions.diagrams.length > 0,
    shapes: counts.shapes,
    edges: counts.edges
  };

  return {
    xml: ensureTrailingNewline(result.xml),
    warnings: result.warnings.map((warning) => ({
      source: 'layout',
      code: warning.code,
      message: warning.message,
      ...(warning.elementId === undefined ? {} : { elementId: warning.elementId }),
      ...(Array.isArray(warning.relatedElementIds) && warning.relatedElementIds.length > 0
        ? { relatedElementIds: warning.relatedElementIds }
        : {})
    })),
    before,
    after
  };
}

function assertSemanticIntegrity(
  beforeDefinitions: ModdleElement,
  afterDefinitions: ModdleElement
): void {
  const before = semanticTypeMap(beforeDefinitions);
  const after = semanticTypeMap(afterDefinitions);

  const missing: string[] = [];
  const added: string[] = [];
  const changed: Array<{ id: string; before: string; after: string }> = [];

  for (const [id, type] of before) {
    const afterType = after.get(id);

    if (afterType === undefined) {
      missing.push(id);
    } else if (afterType !== type) {
      changed.push({ id, before: type, after: afterType });
    }
  }

  for (const id of after.keys()) {
    if (!before.has(id)) {
      added.push(id);
    }
  }

  if (missing.length === 0 && added.length === 0 && changed.length === 0) {
    return;
  }

  throw operationError(
    'E_LAYOUT_INTEGRITY',
    'Layout changed the semantic BPMN model; the result was not written.',
    {
      details: { missing, added, changed }
    }
  );
}

function semanticTypeMap(definitions: ModdleElement): Map<string, string> {
  const result = new Map<string, string>();
  const seen = new Set<object>();

  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) {
      return;
    }

    seen.add(value);

    const element = value as ModdleElement;
    const type = element.$type;

    if (
      typeof type === 'string' &&
      !type.startsWith('bpmndi:') &&
      !type.startsWith('dc:') &&
      !type.startsWith('di:')
    ) {
      if (typeof element.id === 'string' && element.id.length > 0) {
        result.set(element.id, type);
      }
    }

    for (const key of Object.keys(element)) {
      if (
        key === 'diagrams' ||
        key === '$parent' ||
        key === '$model' ||
        key === '$descriptor' ||
        key === '$attrs' ||
        key === '$type' ||
        key === '$instanceOf' ||
        key === '$body'
      ) {
        continue;
      }

      if (key.startsWith('$') && key !== '$children') {
        continue;
      }

      const child = (element as Record<string, unknown>)[key];

      if (Array.isArray(child)) {
        for (const entry of child) {
          visit(entry);
        }
      } else if (child !== null && typeof child === 'object') {
        visit(child);
      }
    }
  };

  visit(definitions);
  return result;
}
