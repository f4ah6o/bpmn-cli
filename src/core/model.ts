import type { ModdleElement } from 'bpmn-moddle';

import { operationError } from '../errors.js';
import type {
  BaseIndexItem,
  DiSummary,
  ElementKind,
  IndexedCollaboration,
  IndexedElement,
  IndexedFlow,
  IndexedItem,
  IndexedLane,
  IndexedMessageFlow,
  IndexedParticipant,
  IndexedProcess,
  ModelIndex
} from '../types.js';
import { collectIdSet } from './ids.js';
import { isType } from './moddle.js';

export function valueId(value: unknown): string | null {
  if (value !== null && typeof value === 'object') {
    const id = (value as ModdleElement).id;
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
  }

  return null;
}

export function rawRefId(
  value: unknown,
  attrs: Record<string, any> | undefined,
  key: string
): string | null {
  return valueId(value) ?? (typeof attrs?.[key] === 'string' ? attrs[key] : null);
}

function elementName(element: ModdleElement): string | null {
  return typeof element.name === 'string' && element.name.length > 0
    ? element.name
    : null;
}

function baseItem(
  element: ModdleElement,
  process: ModdleElement | null,
  container: ModdleElement | null
): BaseIndexItem {
  return {
    element,
    id: typeof element.id === 'string' ? element.id : '',
    type: element.$type,
    name: elementName(element),
    process,
    processId: process?.id ?? null,
    container,
    containerId: container?.id ?? null,
    containerType: container?.$type ?? null
  };
}

export function semanticKind(element: ModdleElement): ElementKind {
  if (isType(element, 'bpmn:StartEvent')) {
    return 'start';
  }

  if (isType(element, 'bpmn:EndEvent')) {
    return 'end';
  }

  if (isType(element, 'bpmn:Task')) {
    return 'task';
  }

  if (isType(element, 'bpmn:Gateway')) {
    return 'gateway';
  }

  if (
    isType(element, 'bpmn:SubProcess') ||
    element.$type === 'bpmn:Transaction' ||
    element.$type === 'bpmn:AdHocSubProcess'
  ) {
    return 'subprocess';
  }

  if (isType(element, 'bpmn:BoundaryEvent')) {
    return 'boundary';
  }

  if (
    isType(element, 'bpmn:IntermediateCatchEvent') ||
    isType(element, 'bpmn:IntermediateThrowEvent')
  ) {
    return 'intermediate';
  }

  if (isType(element, 'bpmn:Event')) {
    return 'event';
  }

  return 'other';
}

function isSubProcess(element: ModdleElement): boolean {
  return (
    isType(element, 'bpmn:SubProcess') ||
    element.$type === 'bpmn:Transaction' ||
    element.$type === 'bpmn:AdHocSubProcess'
  );
}

function arrayOf(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function buildIndex(definitions: ModdleElement): ModelIndex {
  const processes: IndexedProcess[] = [];
  const collaborations: IndexedCollaboration[] = [];
  const containers: ModdleElement[] = [];
  const elements: IndexedElement[] = [];
  const flows: IndexedFlow[] = [];
  const lanes: IndexedLane[] = [];
  const participants: IndexedParticipant[] = [];
  const messageFlows: IndexedMessageFlow[] = [];
  const byId = new Map<string, IndexedItem[]>();
  const semanticIds = new Set<string>();
  const allIds = collectIdSet(definitions);

  const register = (item: IndexedItem): void => {
    if (item.id.length === 0) {
      return;
    }

    const list = byId.get(item.id) ?? [];
    list.push(item);
    byId.set(item.id, list);
  };

  const recordSemanticId = (element: ModdleElement): void => {
    if (typeof element.id === 'string' && element.id.length > 0) {
      semanticIds.add(element.id);
    }
  };

  const visitLaneSet = (
    laneSet: ModdleElement,
    process: ModdleElement
  ): void => {
    recordSemanticId(laneSet);

    for (const lane of arrayOf(laneSet.lanes)) {
      recordSemanticId(lane);

      const refs = arrayOf(lane.flowNodeRef)
        .map((reference) => rawRefId(reference, lane.$attrs, 'flowNodeRef'))
        .filter((reference): reference is string => reference !== null);

      const item: IndexedLane = {
        ...baseItem(lane, process, process),
        category: 'lane',
        laneSetId: typeof laneSet.id === 'string' ? laneSet.id : null,
        flowNodeRefs: refs
      };

      lanes.push(item);
      register(item);

      if (lane.childLaneSet) {
        visitLaneSet(lane.childLaneSet, process);
      }
    }
  };

  const visitFlowElements = (
    scope: ModdleElement,
    process: ModdleElement
  ): void => {
    for (const artifact of arrayOf(scope.artifacts)) {
      recordSemanticId(artifact);
    }

    for (const element of arrayOf(scope.flowElements)) {
      recordSemanticId(element);

      if (isType(element, 'bpmn:SequenceFlow')) {
        const source = element.sourceRef ?? null;
        const target = element.targetRef ?? null;
        const condition = element.conditionExpression?.body;

        const item: IndexedFlow = {
          ...baseItem(element, process, scope),
          category: 'sequenceFlow',
          source,
          target,
          sourceId: rawRefId(source, element.$attrs, 'sourceRef'),
          targetId: rawRefId(target, element.$attrs, 'targetRef'),
          condition: typeof condition === 'string' ? condition : null,
          isDefault: false
        };

        flows.push(item);
        register(item);
        continue;
      }

      if (isType(element, 'bpmn:FlowNode')) {
        const host = element.attachedToRef ?? null;
        const item: IndexedElement = {
          ...baseItem(element, process, scope),
          category: 'flowNode',
          semanticKind: semanticKind(element),
          attachedTo: rawRefId(host, element.$attrs, 'attachedToRef')
        };

        elements.push(item);
        register(item);
      }

      if (isSubProcess(element)) {
        containers.push(element);
        visitFlowElements(element, process);
      }
    }
  };

  for (const root of arrayOf(definitions.rootElements)) {
    recordSemanticId(root);

    if (isType(root, 'bpmn:Process')) {
      const process = root;
      const item: IndexedProcess = {
        ...baseItem(process, process, null),
        category: 'process',
        isExecutable: process.isExecutable === true
      };

      processes.push(item);
      containers.push(process);
      register(item);

      for (const laneSet of arrayOf(process.laneSets)) {
        visitLaneSet(laneSet, process);
      }

      for (const artifact of arrayOf(process.artifacts)) {
        recordSemanticId(artifact);
      }

      visitFlowElements(process, process);
      continue;
    }

    if (isType(root, 'bpmn:Collaboration')) {
      const collaboration = root;
      const item: IndexedCollaboration = {
        ...baseItem(collaboration, null, null),
        category: 'collaboration'
      };

      collaborations.push(item);
      register(item);

      for (const participant of arrayOf(collaboration.participants)) {
        recordSemanticId(participant);

        const processRef = participant.processRef ?? null;
        const participantItem: IndexedParticipant = {
          ...baseItem(participant, processRef, collaboration),
          category: 'participant',
          processRef,
          processRefId: rawRefId(processRef, participant.$attrs, 'processRef')
        };

        participants.push(participantItem);
        register(participantItem);
      }

      for (const messageFlow of arrayOf(collaboration.messageFlows)) {
        recordSemanticId(messageFlow);

        const source = messageFlow.sourceRef ?? null;
        const target = messageFlow.targetRef ?? null;
        const messageFlowItem: IndexedMessageFlow = {
          ...baseItem(messageFlow, null, collaboration),
          category: 'messageFlow',
          source,
          target,
          sourceId: rawRefId(source, messageFlow.$attrs, 'sourceRef'),
          targetId: rawRefId(target, messageFlow.$attrs, 'targetRef')
        };

        messageFlows.push(messageFlowItem);
        register(messageFlowItem);
      }

      for (const artifact of arrayOf(collaboration.artifacts)) {
        recordSemanticId(artifact);
      }
    }
  }

  for (const flow of flows) {
    if (!flow.source) {
      continue;
    }

    const defaultFlow = flow.source.default;

    flow.isDefault =
      defaultFlow === flow.element ||
      rawRefId(defaultFlow, flow.source.$attrs, 'default') === flow.id;
  }

  const diagrams = arrayOf(definitions.diagrams);
  const diShapes = new Map<string, ModdleElement[]>();
  const diEdges = new Map<string, ModdleElement[]>();
  const diRefIds = new Set<string>();
  let shapeCount = 0;
  let edgeCount = 0;

  for (const diagram of diagrams) {
    const planeRef = rawRefId(
      diagram.plane?.bpmnElement,
      diagram.plane?.$attrs,
      'bpmnElement'
    );

    if (planeRef !== null) {
      diRefIds.add(planeRef);
    }

    for (const di of arrayOf(diagram.plane?.planeElement)) {
      const ref = rawRefId(di.bpmnElement, di.$attrs, 'bpmnElement');

      if (ref === null) {
        continue;
      }

      diRefIds.add(ref);

      if (isType(di, 'bpmndi:BPMNShape')) {
        const list = diShapes.get(ref) ?? [];
        list.push(di);
        diShapes.set(ref, list);
        shapeCount += 1;
      } else if (isType(di, 'bpmndi:BPMNEdge')) {
        const list = diEdges.get(ref) ?? [];
        list.push(di);
        diEdges.set(ref, list);
        edgeCount += 1;
      }
    }
  }

  const diStaleIds = [...diRefIds].filter((id) => !semanticIds.has(id));
  const diMissingIds: string[] = [];

  if (shapeCount + edgeCount > 0) {
    for (const item of elements) {
      if (!diShapes.has(item.id)) {
        diMissingIds.push(item.id);
      }
    }

    for (const item of participants) {
      if (!diShapes.has(item.id)) {
        diMissingIds.push(item.id);
      }
    }

    for (const item of lanes) {
      if (!diShapes.has(item.id)) {
        diMissingIds.push(item.id);
      }
    }

    for (const item of flows) {
      if (!diEdges.has(item.id)) {
        diMissingIds.push(item.id);
      }
    }

    for (const item of messageFlows) {
      if (!diEdges.has(item.id)) {
        diMissingIds.push(item.id);
      }
    }
  }

  const di: DiSummary = {
    present: diagrams.length > 0,
    content: shapeCount + edgeCount > 0,
    diagrams: diagrams.length,
    shapes: shapeCount,
    edges: edgeCount,
    missing: diMissingIds.length,
    stale: diStaleIds.length
  };

  return {
    definitions,
    processes,
    collaborations,
    containers,
    elements,
    flows,
    lanes,
    participants,
    messageFlows,
    byId,
    semanticIds,
    allIds,
    di,
    diShapes,
    diEdges,
    diStaleIds,
    diMissingIds
  };
}

export function resolveItem(index: ModelIndex, id: string): IndexedItem {
  const items = index.byId.get(id);

  if (!items || items.length === 0) {
    throw operationError('E_ELEMENT_NOT_FOUND', `Element not found: ${id}`, {
      details: { id },
      hint: 'Run "bpmn list <file> --format json" to inspect element ids.'
    });
  }

  if (items.length > 1) {
    throw operationError('E_DUPLICATE_ID', `Element id is not unique: ${id}`, {
      details: { id, types: items.map((item) => item.type) }
    });
  }

  return items[0]!;
}

export function selectProcess(index: ModelIndex, processId?: string): IndexedProcess {
  if (processId !== undefined) {
    const process = index.processes.find((candidate) => candidate.id === processId);

    if (!process) {
      throw operationError('E_PROCESS_NOT_FOUND', `Process not found: ${processId}`, {
        details: { id: processId }
      });
    }

    return process;
  }

  if (index.processes.length === 1) {
    return index.processes[0]!;
  }

  if (index.processes.length === 0) {
    throw operationError('E_NO_PROCESS', 'No BPMN process found in this file.', {
      hint: 'Create a file with "bpmn init <file>".'
    });
  }

  throw operationError(
    'E_AMBIGUOUS_PROCESS',
    `Multiple processes found (${index.processes.map((process) => process.id).join(', ')}).`,
    {
      details: { processes: index.processes.map((process) => process.id) },
      hint: 'Specify --process <id>.'
    }
  );
}

export function diRefId(di: ModdleElement): string | null {
  return rawRefId(di.bpmnElement, di.$attrs, 'bpmnElement');
}
