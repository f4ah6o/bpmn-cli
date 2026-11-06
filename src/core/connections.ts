import type { ModdleElement } from 'bpmn-moddle';

import { operationError, usageError } from '../errors.js';
import type {
  Change,
  Diagnostic,
  IndexedElement,
  MutationResult
} from '../types.js';
import { staleDiDiagnostic } from './di.js';
import type { BpmnDocument } from './document.js';
import { assertValidId, allocateId } from './ids.js';
import {
  attach,
  clearRawAttribute,
  create,
  hasDescriptorProperty,
  isType
} from './moddle.js';
import { resolveItem } from './model.js';

export interface ConnectOptions {
  sourceId: string;
  targetId: string;
  id?: string;
  name?: string;
  condition?: string;
  makeDefault?: boolean;
}

function requireFlowNode(item: ReturnType<BpmnDocument['resolve']>): IndexedElement {
  if (item.category !== 'flowNode') {
    throw operationError(
      'E_INVALID_ENDPOINT',
      `Element ${item.id} is not a flow node (found ${item.type}).`
    );
  }

  return item;
}

export function supportsDefault(element: ModdleElement): boolean {
  if (hasDescriptorProperty(element, 'default')) {
    return true;
  }

  if (isType(element, 'bpmn:Activity')) {
    return true;
  }

  if (isType(element, 'bpmn:Gateway')) {
    return !isType(element, 'bpmn:ParallelGateway') &&
      !isType(element, 'bpmn:EventBasedGateway');
  }

  return false;
}

export function sourceDefaultId(source: ModdleElement | null): string | null {
  if (!source) {
    return null;
  }

  const value = source.default;

  if (value && typeof value === 'object' && typeof value.id === 'string') {
    return value.id;
  }

  const raw = source.$attrs?.default;

  return typeof raw === 'string' ? raw : null;
}

export function connect(doc: BpmnDocument, options: ConnectOptions): MutationResult {
  const source = requireFlowNode(resolveItem(doc.index, options.sourceId));
  const target = requireFlowNode(resolveItem(doc.index, options.targetId));
  const sourceContainer = source.container;
  const targetContainer = target.container;

  if (options.condition !== undefined && options.condition.length === 0) {
    throw usageError('--condition must not be empty.');
  }

  if (sourceContainer === null || targetContainer === null) {
    throw operationError(
      'E_CROSS_SCOPE_FLOW',
      'Sequence flows require source and target elements inside a process or subprocess.'
    );
  }

  if (sourceContainer !== targetContainer) {
    throw operationError(
      'E_CROSS_SCOPE_FLOW',
      'A sequence flow cannot cross containment scopes.',
      {
        details: {
          source: source.id,
          sourceContainer: source.containerId,
          target: target.id,
          targetContainer: target.containerId
        },
        hint: 'Connect elements inside the same process or subprocess.'
      }
    );
  }

  if (options.makeDefault && options.condition !== undefined) {
    throw usageError('--condition and --default cannot be used together.');
  }

  const duplicate = doc.index.flows.find((flow) => {
    return (
      flow.container === sourceContainer &&
      flow.sourceId === source.id &&
      flow.targetId === target.id
    );
  });

  if (duplicate) {
    throw operationError(
      'E_DUPLICATE_FLOW',
      `A sequence flow from ${source.id} to ${target.id} already exists (${duplicate.id}).`,
      { details: { existingFlow: duplicate.id } }
    );
  }

  if (options.makeDefault) {
    if (!supportsDefault(source.element)) {
      throw operationError(
        'E_INVALID_DEFAULT',
        `${source.type} ${source.id} does not support a default sequence flow.`
      );
    }

    if (sourceDefaultId(source.element) !== null) {
      throw operationError(
        'E_DEFAULT_EXISTS',
        `${source.id} already has a default sequence flow.`,
        { hint: 'Clear the existing default with "bpmn update <file> <flow> --no-default".' }
      );
    }
  }

  let id: string;

  if (options.id !== undefined) {
    assertValidId(options.id);

    if (doc.index.allIds.has(options.id)) {
      throw operationError('E_ELEMENT_EXISTS', `Element id already exists: ${options.id}`, {
        details: { id: options.id }
      });
    }

    id = options.id;
    doc.index.allIds.add(id);
  } else {
    id = allocateId(doc.index.allIds, 'Flow');
  }

  const flow = create('bpmn:SequenceFlow', {
    id,
    sourceRef: source.element,
    targetRef: target.element
  });

  if (options.name !== undefined && options.name.length > 0) {
    flow.set('name', options.name);
  }

  attach(sourceContainer, flow);

  source.element.get('outgoing').push(flow);
  target.element.get('incoming').push(flow);

  if (options.condition !== undefined) {
    const expression = create('bpmn:FormalExpression', {
      body: options.condition
    });

    expression.$parent = flow;
    flow.set('conditionExpression', expression);
  }

  if (options.makeDefault) {
    clearRawAttribute(source.element, 'default');
    source.element.set('default', flow);
  }

  doc.refresh();

  const warnings: Diagnostic[] = [];
  const stale = doc.index.di.content;

  if (stale) {
    warnings.push(staleDiDiagnostic(id));
  }

  const change: Change = {
    op: 'add',
    id,
    type: 'bpmn:SequenceFlow',
    source: source.id,
    target: target.id,
    ...(options.name === undefined ? {} : { name: options.name })
  };

  return {
    changes: [change],
    warnings,
    di: { present: doc.index.di.present, stale }
  };
}
