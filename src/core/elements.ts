import type { ModdleElement } from 'bpmn-moddle';

import { operationError, usageError } from '../errors.js';
import type {
  Change,
  Diagnostic,
  IndexedElement,
  IndexedFlow,
  IndexedItem,
  MutationResult
} from '../types.js';
import { removeDiForIds, staleDiDiagnostic } from './di.js';
import type { BpmnDocument } from './document.js';
import { assertValidId, allocateId } from './ids.js';
import {
  attach,
  clearRawAttribute,
  create,
  isType
} from './moddle.js';
import { sourceDefaultId, supportsDefault } from './connections.js';

export type AddKind = 'start' | 'end' | 'task' | 'gateway';

export interface AddOptions {
  kind: AddKind;
  type?: string;
  id?: string;
  name?: string;
  processId?: string;
}

export interface UpdateOptions {
  name?: string;
  condition?: string;
  clearCondition?: boolean;
  setDefault?: boolean;
  clearDefault?: boolean;
  executable?: boolean;
}

interface TypeMapping {
  bpmnType: string;
  prefix: string;
}

const TASK_TYPES: Record<string, string> = {
  task: 'bpmn:Task',
  user: 'bpmn:UserTask',
  service: 'bpmn:ServiceTask',
  script: 'bpmn:ScriptTask',
  manual: 'bpmn:ManualTask',
  'business-rule': 'bpmn:BusinessRuleTask',
  send: 'bpmn:SendTask',
  receive: 'bpmn:ReceiveTask'
};

const GATEWAY_TYPES: Record<string, string> = {
  exclusive: 'bpmn:ExclusiveGateway',
  parallel: 'bpmn:ParallelGateway',
  inclusive: 'bpmn:InclusiveGateway',
  'event-based': 'bpmn:EventBasedGateway',
  complex: 'bpmn:ComplexGateway'
};

function mapping(bpmnType: string): TypeMapping {
  return {
    bpmnType,
    prefix: bpmnType.replace(/^[^:]+:/, '')
  };
}

function resolveAddType(kind: AddKind, type?: string): TypeMapping {
  if (kind === 'start') {
    if (type !== undefined) {
      throw usageError('--type is not supported for start events.');
    }

    return mapping('bpmn:StartEvent');
  }

  if (kind === 'end') {
    if (type !== undefined) {
      throw usageError('--type is not supported for end events.');
    }

    return mapping('bpmn:EndEvent');
  }

  if (kind === 'task') {
    const key = type ?? 'task';
    const bpmnType = TASK_TYPES[key];

    if (!bpmnType) {
      throw usageError(
        `Unknown task type "${key}". Expected one of: ${Object.keys(TASK_TYPES).join(', ')}.`
      );
    }

    return mapping(bpmnType);
  }

  if (kind === 'gateway') {
    const key = type ?? 'exclusive';
    const bpmnType = GATEWAY_TYPES[key];

    if (!bpmnType) {
      throw usageError(
        `Unknown gateway type "${key}". Expected one of: ${Object.keys(GATEWAY_TYPES).join(', ')}.`
      );
    }

    return mapping(bpmnType);
  }

  throw usageError(`Unknown element kind "${kind}". Expected start, end, task or gateway.`);
}

export function addElement(doc: BpmnDocument, options: AddOptions): MutationResult {
  const process = doc.selectProcess(options.processId);
  const type = resolveAddType(options.kind, options.type);

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
    id = allocateId(doc.index.allIds, type.prefix);
  }

  const attrs: Record<string, any> = { id };

  if (options.name !== undefined && options.name.length > 0) {
    attrs.name = options.name;
  }

  const element = create(type.bpmnType, attrs);
  attach(process.element, element);

  doc.refresh();

  const stale = doc.index.di.content;
  const warnings: Diagnostic[] = stale ? [staleDiDiagnostic(id)] : [];

  const change: Change = {
    op: 'add',
    id,
    type: type.bpmnType,
    ...(options.name === undefined ? {} : { name: options.name })
  };

  return {
    changes: [change],
    warnings,
    di: { present: doc.index.di.present, stale }
  };
}

function ensureNameable(item: IndexedItem): void {
  if (
    item.category !== 'process' &&
    item.category !== 'flowNode' &&
    item.category !== 'sequenceFlow' &&
    item.category !== 'lane' &&
    item.category !== 'participant'
  ) {
    throw operationError(
      'E_UNSUPPORTED_UPDATE',
      `${item.type} ${item.id} does not support a name update.`
    );
  }
}

function currentCondition(flow: IndexedFlow): string | null {
  const body = flow.element.conditionExpression?.body;
  return typeof body === 'string' ? body : null;
}

export function renameItem(
  doc: BpmnDocument,
  id: string,
  name: string
): MutationResult {
  return updateItem(doc, id, { name });
}

export function updateItem(
  doc: BpmnDocument,
  id: string,
  options: UpdateOptions
): MutationResult {
  const item = doc.resolve(id);
  const wantsName = options.name !== undefined;
  const wantsCondition =
    options.condition !== undefined || options.clearCondition === true;
  const wantsDefault =
    options.setDefault === true || options.clearDefault === true;
  const wantsExecutable = options.executable !== undefined;

  if (!wantsName && !wantsCondition && !wantsDefault && !wantsExecutable) {
    throw usageError('No update option was provided.');
  }

  if (options.condition !== undefined && options.clearCondition === true) {
    throw usageError('--condition and --clear-condition cannot be used together.');
  }

  if (options.setDefault === true && options.clearDefault === true) {
    throw usageError('--default and --no-default cannot be used together.');
  }

  if (options.condition !== undefined && options.condition.length === 0) {
    throw usageError('--condition must not be empty.');
  }

  if (wantsName) {
    ensureNameable(item);
  }

  let flow: IndexedFlow | null = null;

  if (wantsCondition || wantsDefault) {
    if (item.category !== 'sequenceFlow') {
      throw operationError(
        'E_UNSUPPORTED_UPDATE',
        `${item.type} ${item.id} is not a sequence flow.`
      );
    }

    flow = item;
  }

  if (wantsExecutable && item.category !== 'process') {
    throw operationError(
      'E_UNSUPPORTED_UPDATE',
      `${item.type} ${item.id} is not a process.`
    );
  }

  if (flow && wantsDefault && flow.source === null) {
    throw operationError(
      'E_DEFAULT_FLOW',
      `Sequence flow ${flow.id} has no source element.`
    );
  }

  if (flow && options.condition !== undefined && options.setDefault === true) {
    throw usageError('A default sequence flow cannot have a condition.');
  }

  if (
    flow &&
    options.condition !== undefined &&
    flow.source !== null &&
    sourceDefaultId(flow.source) === flow.id &&
    options.clearDefault !== true
  ) {
    throw operationError(
      'E_DEFAULT_FLOW_CONDITION',
      `Sequence flow ${flow.id} is the source default and cannot have a condition.`,
      { hint: 'Clear the default with --no-default first.' }
    );
  }

  if (flow && options.setDefault === true) {
    if (options.condition !== undefined) {
      throw usageError('A default sequence flow cannot have a condition.');
    }

    if (flow.source === null) {
      throw operationError(
        'E_DEFAULT_FLOW',
        `Sequence flow ${flow.id} has no source element.`
      );
    }

    if (!supportsDefault(flow.source)) {
      throw operationError(
        'E_INVALID_DEFAULT',
        `${flow.source.$type} ${flow.source.id ?? '(no id)'} does not support a default sequence flow.`
      );
    }

    const existingDefault = sourceDefaultId(flow.source);

    if (existingDefault !== null && existingDefault !== flow.id) {
      throw operationError(
        'E_DEFAULT_EXISTS',
        `${flow.source.id ?? '(source)'} already has a default sequence flow (${existingDefault}).`,
        { hint: 'Clear the existing default first.' }
      );
    }

    if (currentCondition(flow) !== null && options.clearCondition !== true) {
      throw operationError(
        'E_DEFAULT_FLOW_CONDITION',
        `Sequence flow ${flow.id} has a condition and cannot be the default flow.`,
        { hint: 'Clear the condition with --clear-condition, or choose another flow.' }
      );
    }
  }

  const fields: Record<string, { from: unknown; to: unknown }> = {};
  let changed = false;

  if (wantsName) {
    const before = item.name;
    const after = options.name === '' ? null : options.name!;

    item.element.set('name', after === null ? undefined : after);
    fields.name = { from: before, to: after };

    if (before !== after) {
      changed = true;
    }
  }

  if (flow && wantsCondition) {
    const before = currentCondition(flow);
    const after = options.clearCondition === true ? null : options.condition!;

    if (options.clearCondition === true) {
      flow.element.set('conditionExpression', undefined);
    } else {
      const expression = create('bpmn:FormalExpression', {
        body: after
      });

      expression.$parent = flow.element;
      flow.element.set('conditionExpression', expression);
    }

    fields.condition = { from: before, to: after };

    if (before !== after) {
      changed = true;
    }
  }

  if (flow && wantsDefault) {
    const source = flow.source;

    if (source === null) {
      throw operationError(
        'E_DEFAULT_FLOW',
        `Sequence flow ${flow.id} has no source element.`
      );
    }

    const before = sourceDefaultId(source) === flow.id;
    const after = options.setDefault === true;

    if (options.setDefault === true) {
      clearRawAttribute(source, 'default');
      source.set('default', flow.element);
    } else if (before) {
      source.set('default', undefined);
      clearRawAttribute(source, 'default');
    }

    fields.default = { from: before, to: after };

    if (before !== after) {
      changed = true;
    }
  }

  if (wantsExecutable) {
    const before = item.category === 'process' && item.isExecutable;
    const after = options.executable === true;

    item.element.set('isExecutable', after);
    fields.executable = { from: before, to: after };

    if (before !== after) {
      changed = true;
    }
  }

  doc.refresh();

  return {
    changes: [
      {
        op: 'update',
        id,
        type: item.type,
        fields,
        changed
      }
    ],
    warnings: [],
    di: { present: doc.index.di.present, stale: false }
  };
}

function arrayOf(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function removeFromArray(array: any[] | null | undefined, value: unknown): void {
  if (!Array.isArray(array)) {
    return;
  }

  const index = array.indexOf(value);

  if (index >= 0) {
    array.splice(index, 1);
  }
}

function removeFromContainer(container: ModdleElement | null, element: ModdleElement): void {
  if (!container) {
    return;
  }

  removeFromArray(arrayOf(container.flowElements), element);
}

function collectDescendantIds(element: ModdleElement, ids: Set<string>): void {
  if (typeof element.id === 'string' && element.id.length > 0) {
    ids.add(element.id);
  }

  for (const child of arrayOf(element.flowElements)) {
    if (isType(child, 'bpmn:SequenceFlow')) {
      continue;
    }

    if (isType(child, 'bpmn:FlowNode')) {
      collectDescendantIds(child, ids);
    }
  }
}

function collectBoundaryIds(doc: BpmnDocument, ids: Set<string>): void {
  let changed = true;

  while (changed) {
    changed = false;

    for (const element of doc.index.elements) {
      if (
        element.semanticKind === 'boundary' &&
        element.attachedTo !== null &&
        ids.has(element.attachedTo) &&
        !ids.has(element.id)
      ) {
        ids.add(element.id);
        changed = true;
      }
    }
  }
}

function incidentFlows(doc: BpmnDocument, ids: Set<string>): IndexedFlow[] {
  return doc.index.flows.filter((flow) => {
    return (
      (flow.sourceId !== null && ids.has(flow.sourceId)) ||
      (flow.targetId !== null && ids.has(flow.targetId))
    );
  });
}

function clearDefaultReferences(doc: BpmnDocument, flow: IndexedFlow): void {
  for (const item of doc.index.elements) {
    const value = item.element.default;

    if (value === flow.element) {
      item.element.set('default', undefined);
      clearRawAttribute(item.element, 'default');
    } else if (item.element.$attrs?.default === flow.id) {
      item.element.set('default', undefined);
      clearRawAttribute(item.element, 'default');
    }
  }
}

function removeFlowElement(
  doc: BpmnDocument,
  flow: IndexedFlow,
  removedIds: Set<string>,
  changes: Change[]
): void {
  removeFromContainer(flow.container, flow.element);
  removeFromArray(flow.source?.outgoing, flow.element);
  removeFromArray(flow.target?.incoming, flow.element);
  clearDefaultReferences(doc, flow);

  removedIds.add(flow.id);
  changes.push({
    op: 'remove',
    id: flow.id,
    type: flow.type,
    ...(flow.name === null ? {} : { name: flow.name })
  });
}

function removeLaneRefs(doc: BpmnDocument, ids: Set<string>): void {
  for (const lane of doc.index.lanes) {
    const refs = lane.element.flowNodeRef;

    if (!Array.isArray(refs)) {
      continue;
    }

    for (let index = refs.length - 1; index >= 0; index -= 1) {
      const referenceId =
        typeof refs[index]?.id === 'string' ? refs[index].id : null;

      if (referenceId !== null && ids.has(referenceId)) {
        refs.splice(index, 1);
      }
    }
  }
}

export function removeItem(
  doc: BpmnDocument,
  id: string,
  cascade: boolean
): MutationResult {
  const item = doc.resolve(id);

  if (item.category === 'sequenceFlow') {
    const hadDi = doc.index.di.content;
    const removedIds = new Set<string>();
    const changes: Change[] = [];

    removeFlowElement(doc, item, removedIds, changes);
    removeDiForIds(doc.definitions, removedIds);
    doc.refresh();

    return {
      changes,
      warnings: hadDi ? [staleDiDiagnostic(item.id)] : [],
      di: { present: doc.index.di.present, stale: hadDi }
    };
  }

  if (item.category !== 'flowNode') {
    throw operationError(
      'E_UNSUPPORTED_REMOVE',
      `Removing ${item.type} ${item.id} is not supported in this version.`
    );
  }

  const nodeIds = new Set<string>();
  collectDescendantIds(item.element, nodeIds);
  collectBoundaryIds(doc, nodeIds);

  const flows = incidentFlows(doc, nodeIds);
  const hasChildren = nodeIds.size > 1;

  if (!cascade && (flows.length > 0 || hasChildren)) {
    throw operationError(
      'E_REMOVE_REQUIRES_CASCADE',
      `${item.id} has connected flows or child elements. Use --cascade to remove them.`,
      {
        details: {
          flows: flows.map((flow) => flow.id),
          elements: [...nodeIds].filter((candidate) => candidate !== item.id)
        }
      }
    );
  }

  const hadDi = doc.index.di.content;
  const removedIds = new Set<string>();
  const changes: Change[] = [];
  const nodeItems = [...nodeIds]
    .map((nodeId) => doc.index.byId.get(nodeId)?.[0])
    .filter((candidate): candidate is IndexedElement => candidate?.category === 'flowNode');

  for (const flow of flows) {
    removeFlowElement(doc, flow, removedIds, changes);
  }

  for (const node of nodeItems) {
    if (node.id === item.id) {
      continue;
    }

    removeFromContainer(node.container, node.element);
    removedIds.add(node.id);
    changes.push({
      op: 'remove',
      id: node.id,
      type: node.type,
      ...(node.name === null ? {} : { name: node.name })
    });
  }

  removeFromContainer(item.container, item.element);
  removedIds.add(item.id);
  changes.push({
    op: 'remove',
    id: item.id,
    type: item.type,
    ...(item.name === null ? {} : { name: item.name })
  });

  removeLaneRefs(doc, nodeIds);
  removeDiForIds(doc.definitions, removedIds);
  doc.refresh();

  return {
    changes,
    warnings: hadDi ? [staleDiDiagnostic(item.id)] : [],
    di: { present: doc.index.di.present, stale: hadDi }
  };
}
