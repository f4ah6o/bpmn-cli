import type { ModdleElement } from 'bpmn-moddle';

export type OutputFormat = 'text' | 'json';

export type CommandName =
  | 'init'
  | 'add'
  | 'connect'
  | 'remove'
  | 'rename'
  | 'update'
  | 'list'
  | 'layout'
  | 'export-svg'
  | 'validate'
  | 'skill';

export type DiagnosticSource = 'parse' | 'layout' | 'cli' | 'render';
export type FindingSource = 'lint' | 'structural' | 'parse' | 'style';
export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  source: DiagnosticSource;
  code: string;
  message: string;
  elementId?: string;
  relatedElementIds?: string[];
}

export interface Finding {
  severity: Severity;
  source: FindingSource;
  rule: string;
  message: string;
  elementId?: string;
  path?: string[];
  details?: Record<string, unknown>;
}

export interface Change {
  op: 'add' | 'remove' | 'update';
  id: string;
  type: string;
  name?: string;
  source?: string;
  target?: string;
  fields?: Record<string, { from: unknown; to: unknown }>;
  changed?: boolean;
}

export type ElementKind =
  | 'start'
  | 'end'
  | 'task'
  | 'gateway'
  | 'subprocess'
  | 'boundary'
  | 'intermediate'
  | 'event'
  | 'other';

export interface DiSummary {
  present: boolean;
  content: boolean;
  diagrams: number;
  shapes: number;
  edges: number;
  missing: number;
  stale: number;
}

export interface BaseIndexItem {
  element: ModdleElement;
  id: string;
  type: string;
  name: string | null;
  process: ModdleElement | null;
  processId: string | null;
  container: ModdleElement | null;
  containerId: string | null;
  containerType: string | null;
}

export interface IndexedProcess extends BaseIndexItem {
  category: 'process';
  isExecutable: boolean;
}

export interface IndexedElement extends BaseIndexItem {
  category: 'flowNode';
  semanticKind: ElementKind;
  attachedTo: string | null;
}

export interface IndexedFlow extends BaseIndexItem {
  category: 'sequenceFlow';
  source: ModdleElement | null;
  target: ModdleElement | null;
  sourceId: string | null;
  targetId: string | null;
  condition: string | null;
  isDefault: boolean;
}

export interface IndexedLane extends BaseIndexItem {
  category: 'lane';
  laneSetId: string | null;
  flowNodeRefs: string[];
}

export interface IndexedParticipant extends BaseIndexItem {
  category: 'participant';
  processRef: ModdleElement | null;
  processRefId: string | null;
}

export interface IndexedMessageFlow extends BaseIndexItem {
  category: 'messageFlow';
  source: ModdleElement | null;
  target: ModdleElement | null;
  sourceId: string | null;
  targetId: string | null;
}

export interface IndexedCollaboration extends BaseIndexItem {
  category: 'collaboration';
}

export type IndexedItem =
  | IndexedProcess
  | IndexedElement
  | IndexedFlow
  | IndexedLane
  | IndexedParticipant
  | IndexedMessageFlow
  | IndexedCollaboration;

export interface ModelIndex {
  definitions: ModdleElement;
  processes: IndexedProcess[];
  collaborations: IndexedCollaboration[];
  containers: ModdleElement[];
  elements: IndexedElement[];
  flows: IndexedFlow[];
  lanes: IndexedLane[];
  participants: IndexedParticipant[];
  messageFlows: IndexedMessageFlow[];
  byId: Map<string, IndexedItem[]>;
  semanticIds: Set<string>;
  allIds: Set<string>;
  di: DiSummary;
  diShapes: Map<string, ModdleElement[]>;
  diEdges: Map<string, ModdleElement[]>;
  diStaleIds: string[];
  diMissingIds: string[];
}

export interface MutationResult {
  changes: Change[];
  warnings: Diagnostic[];
  di: { present: boolean; stale: boolean };
}
