import { BpmnDocument } from '../core/document.js';
import type { ModdleElement } from 'bpmn-moddle';
import {
  printJson,
  serializeDiagnostic,
  successEnvelope
} from '../output/json.js';
import { printList, printWarnings } from '../output/text.js';
import { parseFormat } from './shared.js';

export interface ListCliOptions {
  format?: string;
}

function defaultId(element: ModdleElement): string | null {
  const value = element.default;

  if (value && typeof value === 'object' && typeof value.id === 'string') {
    return value.id;
  }

  const raw = element.$attrs?.default;
  return typeof raw === 'string' ? raw : null;
}

export async function runList(
  file: string,
  options: ListCliOptions
): Promise<void> {
  const format = parseFormat(options.format);
  const doc = await BpmnDocument.load(file);
  const index = doc.index;

  if (format === 'text') {
    printList(file, index);
    printWarnings(doc.parseWarnings);
    return;
  }

  const payload = {
    definitions: {
      id: doc.definitions.id ?? null,
      targetNamespace: doc.definitions.targetNamespace ?? null
    },
    processes: index.processes.map((process) => ({
      id: process.id,
      name: process.name,
      isExecutable: process.isExecutable
    })),
    collaborations: index.collaborations.map((collaboration) => ({
      id: collaboration.id,
      name: collaboration.name,
      participants: index.participants
        .filter((participant) => participant.containerId === collaboration.id)
        .map((participant) => ({
          id: participant.id,
          name: participant.name,
          processRef: participant.processRefId
        }))
    })),
    lanes: index.lanes.map((lane) => ({
      id: lane.id,
      name: lane.name,
      processId: lane.processId,
      laneSetId: lane.laneSetId,
      flowNodeRefs: lane.flowNodeRefs
    })),
    elements: index.elements.map((element) => ({
      id: element.id,
      type: element.type,
      kind: element.semanticKind,
      name: element.name,
      processId: element.processId,
      containerId: element.containerId,
      containerType: element.containerType,
      incoming: index.flows
        .filter((flow) => flow.targetId === element.id)
        .map((flow) => flow.id),
      outgoing: index.flows
        .filter((flow) => flow.sourceId === element.id)
        .map((flow) => flow.id),
      default: defaultId(element.element),
      attachedTo: element.attachedTo
    })),
    flows: index.flows.map((flow) => ({
      id: flow.id,
      type: flow.type,
      name: flow.name,
      processId: flow.processId,
      containerId: flow.containerId,
      source: flow.sourceId,
      target: flow.targetId,
      condition: flow.condition,
      isDefault: flow.isDefault
    })),
    messageFlows: index.messageFlows.map((flow) => ({
      id: flow.id,
      name: flow.name,
      source: flow.sourceId,
      target: flow.targetId
    })),
    di: {
      present: index.di.present,
      content: index.di.content,
      diagrams: index.di.diagrams,
      shapes: index.di.shapes,
      edges: index.di.edges,
      missing: index.di.missing,
      stale: index.di.stale
    },
    counts: {
      elements: index.elements.length,
      flows: index.flows.length,
      messageFlows: index.messageFlows.length,
      lanes: index.lanes.length,
      participants: index.participants.length
    },
    warnings: doc.parseWarnings.map(serializeDiagnostic)
  };

  printJson(successEnvelope('list', file, payload));
}
