import { createRequire } from 'node:module';

import type { ModdleElement } from 'bpmn-moddle';

import { ioError, usageError } from '../errors.js';
import { readTextFile } from '../io/filesystem.js';
import type { Finding, Severity } from '../types.js';
import type { BpmnDocument } from './document.js';
import { collectIds } from './ids.js';
import { isType } from './moddle.js';
import { rawRefId, valueId } from './model.js';
import { reconcileFlowReferences } from './references.js';

const require = createRequire(import.meta.url);

interface LintReport {
  id?: string;
  message: string;
  path?: string[];
  category?: string;
  meta?: any;
}

interface LinterLike {
  lint(rootElement: ModdleElement): Promise<Record<string, LintReport[]>>;
}

interface LintConfig {
  extends?: string | string[];
  rules?: Record<string, unknown>;
  moddleExtensions?: Record<string, unknown>;
}

export function defaultLintConfig(): LintConfig {
  return {
    extends: ['bpmnlint:recommended'],
    rules: {
      'label-required': 'warn',
      'no-bpmndi': 'warn'
    }
  };
}

export async function loadLintConfig(filePath: string): Promise<LintConfig> {
  const text = await readTextFile(filePath);
  let config: unknown;

  try {
    config = JSON.parse(text);
  } catch (error) {
    throw ioError('E_CONFIG_PARSE', `Could not parse lint config ${filePath}: ${(error as Error).message}`, {
      cause: error
    });
  }

  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw usageError('The lint config must be a JSON object.');
  }

  const candidate = config as Record<string, unknown>;
  const extendsValue = candidate.extends;

  if (
    extendsValue !== undefined &&
    typeof extendsValue !== 'string' &&
    !(Array.isArray(extendsValue) && extendsValue.every((value) => typeof value === 'string'))
  ) {
    throw usageError('Config "extends" must be a string or an array of strings.');
  }

  if (
    candidate.rules !== undefined &&
    (candidate.rules === null ||
      typeof candidate.rules !== 'object' ||
      Array.isArray(candidate.rules))
  ) {
    throw usageError('Config "rules" must be an object.');
  }

  if (
    candidate.moddleExtensions !== undefined &&
    (candidate.moddleExtensions === null ||
      typeof candidate.moddleExtensions !== 'object' ||
      Array.isArray(candidate.moddleExtensions))
  ) {
    throw usageError('Config "moddleExtensions" must be an object.');
  }

  return candidate as LintConfig;
}

function makeFinding(
  severity: Severity,
  source: Finding['source'],
  rule: string,
  message: string,
  elementId?: string,
  details?: Record<string, unknown>
): Finding {
  const finding: Finding = {
    severity,
    source,
    rule,
    message
  };

  if (elementId !== undefined) {
    finding.elementId = elementId;
  }

  if (details !== undefined) {
    finding.details = details;
  }

  return finding;
}

function referenceId(reference: unknown): string | null {
  return valueId(reference);
}

function attachedOrRaw(
  element: ModdleElement,
  property: string
): string | null {
  return rawRefId(element[property], element.$attrs, property);
}

function storedReferenceIds(element: ModdleElement, property: string): string[] | null {
  const value = element[property];

  if (!Array.isArray(value)) {
    return null;
  }

  return value
    .map((reference) => referenceId(reference))
    .filter((id): id is string => id !== null)
    .sort();
}

function structureFindings(doc: BpmnDocument): Finding[] {
  const findings: Finding[] = [];
  const index = doc.index;

  const idMap = collectIds(doc.definitions);

  for (const [id, elements] of idMap) {
    if (elements.length > 1) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'duplicate-id',
          `Duplicate BPMN id "${id}".`,
          id,
          { types: elements.map((element) => element.$type) }
        )
      );
    }
  }

  for (const item of [
    ...index.processes,
    ...index.elements,
    ...index.flows,
    ...index.lanes,
    ...index.participants,
    ...index.messageFlows
  ]) {
    if (item.id.length === 0) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'missing-id',
          `${item.type} is missing an id.`,
          undefined,
          { type: item.type }
        )
      );
    }
  }

  for (const flow of index.flows) {
    if (flow.source === null) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'sequence-flow-missing-endpoint',
          `Sequence flow ${flow.id} has no source element.`,
          flow.id
        )
      );
    } else if (!isType(flow.source, 'bpmn:FlowNode')) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'sequence-flow-invalid-endpoint',
          `Sequence flow ${flow.id} has a source that is not a flow node.`,
          flow.id,
          { endpoint: flow.sourceId, type: flow.source.$type }
        )
      );
    }

    if (flow.target === null) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'sequence-flow-missing-endpoint',
          `Sequence flow ${flow.id} has no target element.`,
          flow.id
        )
      );
    } else if (!isType(flow.target, 'bpmn:FlowNode')) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'sequence-flow-invalid-endpoint',
          `Sequence flow ${flow.id} has a target that is not a flow node.`,
          flow.id,
          { endpoint: flow.targetId, type: flow.target.$type }
        )
      );
    }

    if (
      flow.source !== null &&
      flow.target !== null &&
      flow.container !== null &&
      (flow.source.$parent !== flow.container || flow.target.$parent !== flow.container)
    ) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'sequence-flow-cross-scope',
          `Sequence flow ${flow.id} crosses containment scopes.`,
          flow.id,
          {
            sourceContainer: flow.source.$parent?.id ?? null,
            targetContainer: flow.target.$parent?.id ?? null,
            flowContainer: flow.containerId
          }
        )
      );
    }
  }

  for (const messageFlow of index.messageFlows) {
    if (messageFlow.source === null || messageFlow.target === null) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'message-flow-missing-endpoint',
          `Message flow ${messageFlow.id} must reference both source and target.`,
          messageFlow.id
        )
      );
      continue;
    }

    for (const [role, endpoint] of [
      ['source', messageFlow.source],
      ['target', messageFlow.target]
    ] as const) {
      if (
        !isType(endpoint, 'bpmn:FlowNode') &&
        !isType(endpoint, 'bpmn:Participant')
      ) {
        findings.push(
          makeFinding(
            'error',
            'structural',
            'message-flow-invalid-endpoint',
            `Message flow ${messageFlow.id} has an invalid ${role} endpoint.`,
            messageFlow.id,
            { endpoint: endpoint.id, type: endpoint.$type }
          )
        );
      }
    }
  }

  for (const participant of index.participants) {
    if (participant.processRefId === null) {
      continue;
    }

    if (!index.processes.some((process) => process.id === participant.processRefId)) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'participant-missing-process',
          `Participant ${participant.id} references missing process ${participant.processRefId}.`,
          participant.id,
          { processRef: participant.processRefId }
        )
      );
    }
  }

  for (const lane of index.lanes) {
    for (const reference of lane.flowNodeRefs) {
      const target = index.byId.get(reference)?.[0];

      if (!target || target.category !== 'flowNode') {
        findings.push(
          makeFinding(
            'error',
            'structural',
            'lane-ref-missing',
            `Lane ${lane.id} references missing flow node ${reference}.`,
            lane.id,
            { flowNodeRef: reference }
          )
        );
      } else if (target.processId !== lane.processId) {
        findings.push(
          makeFinding(
            'error',
            'structural',
            'lane-ref-outside-process',
            `Lane ${lane.id} references ${reference} from another process.`,
            lane.id,
            { flowNodeRef: reference, processId: target.processId }
          )
        );
      }
    }
  }

  for (const item of index.elements) {
    const defaultId = attachedOrRaw(item.element, 'default');

    if (defaultId === null) {
      continue;
    }

    const flow = index.flows.find((candidate) => candidate.id === defaultId);

    if (!flow) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'default-flow-missing',
          `${item.id} references missing default flow ${defaultId}.`,
          item.id,
          { defaultFlow: defaultId }
        )
      );
      continue;
    }

    if (flow.source !== item.element) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'default-flow-not-outgoing',
          `Default flow ${defaultId} is not outgoing from ${item.id}.`,
          item.id,
          { defaultFlow: defaultId }
        )
      );
    }
  }

  for (const item of index.elements) {
    if (item.semanticKind !== 'boundary') {
      continue;
    }

    const hostId = attachedOrRaw(item.element, 'attachedToRef');

    if (hostId === null) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'boundary-event-missing-host',
          `Boundary event ${item.id} has no attached activity.`,
          item.id
        )
      );
      continue;
    }

    const host = index.byId.get(hostId)?.[0];

    if (!host || host.category !== 'flowNode' || !isType(host.element, 'bpmn:Activity')) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'boundary-event-missing-host',
          `Boundary event ${item.id} is attached to a missing or invalid activity ${hostId}.`,
          item.id,
          { attachedToRef: hostId }
        )
      );
    } else if (host.container !== item.container) {
      findings.push(
        makeFinding(
          'error',
          'structural',
          'boundary-event-cross-scope',
          `Boundary event ${item.id} and its host ${hostId} are in different scopes.`,
          item.id,
          { attachedToRef: hostId }
        )
      );
    }
  }

  for (const item of index.elements) {
    const storedIncoming = storedReferenceIds(item.element, 'incoming');
    const storedOutgoing = storedReferenceIds(item.element, 'outgoing');

    if (storedIncoming !== null) {
      const derivedIncoming = index.flows
        .filter((flow) => flow.targetId === item.id)
        .map((flow) => flow.id)
        .sort();

      if (!sameIds(storedIncoming, derivedIncoming)) {
        findings.push(
          makeFinding(
            'warning',
            'structural',
            'incoming-outgoing-mismatch',
            `${item.id} has inconsistent incoming sequence-flow references.`,
            item.id,
            { stored: storedIncoming, derived: derivedIncoming }
          )
        );
      }
    }

    if (storedOutgoing !== null) {
      const derivedOutgoing = index.flows
        .filter((flow) => flow.sourceId === item.id)
        .map((flow) => flow.id)
        .sort();

      if (!sameIds(storedOutgoing, derivedOutgoing)) {
        findings.push(
          makeFinding(
            'warning',
            'structural',
            'incoming-outgoing-mismatch',
            `${item.id} has inconsistent outgoing sequence-flow references.`,
            item.id,
            { stored: storedOutgoing, derived: derivedOutgoing }
          )
        );
      }
    }
  }

  if (index.di.content) {
    for (const id of index.diMissingIds) {
      findings.push(
        makeFinding(
          'warning',
          'structural',
          'di-missing',
          `${id} has no BPMN DI shape/edge.`,
          id
        )
      );
    }

    for (const id of index.diStaleIds) {
      findings.push(
        makeFinding(
          'warning',
          'structural',
          'di-stale',
          `BPMN DI references missing element ${id}.`,
          id
        )
      );
    }
  }

  if (index.processes.length > 1 && index.collaborations.length === 0) {
    findings.push(
      makeFinding(
        'warning',
        'structural',
        'multiple-processes-no-collaboration',
        'The file has multiple processes but no collaboration; layout only covers the first process.',
        undefined,
        { processes: index.processes.map((process) => process.id) }
      )
    );
  }

  for (const warning of doc.parseWarnings) {
    findings.push(
      makeFinding(
        'warning',
        'parse',
        'parse-warning',
        warning.message,
        warning.elementId
      )
    );
  }

  return findings;
}

function sameIds(first: string[], second: string[]): boolean {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((value, index) => value === second[index]);
}

async function lintFindings(
  doc: BpmnDocument,
  config: LintConfig
): Promise<Finding[]> {
  let Linter: new (options: { config: LintConfig; resolver: unknown }) => LinterLike;
  let NodeResolver: new () => unknown;

  try {
    ({ Linter } = require('bpmnlint') as {
      Linter: new (options: { config: LintConfig; resolver: unknown }) => LinterLike;
    });
    NodeResolver = require('bpmnlint/lib/resolver/node-resolver') as new () => unknown;
  } catch (error) {
    throw ioError('E_LINT_UNAVAILABLE', `Could not load bpmnlint: ${(error as Error).message}`, {
      cause: error,
      hint: 'Validate without lint rules using --no-lint.'
    });
  }

  let reports: Record<string, LintReport[]>;

  try {
    const linter = new Linter({
      config,
      resolver: new NodeResolver()
    });

    reports = await linter.lint(doc.definitions);
  } catch (error) {
    throw ioError('E_LINT_FAILED', `Could not run bpmnlint: ${(error as Error).message}`, {
      cause: error,
      hint: 'Check --config, or use --no-lint.'
    });
  }

  const findings: Finding[] = [];

  for (const [rule, ruleReports] of Object.entries(reports)) {
    for (const report of ruleReports) {
      const severity: Severity =
        report.category === 'error' || report.category === 'rule-error'
          ? 'error'
          : report.category === 'warn'
            ? 'warning'
            : 'info';

      const finding: Finding = {
        severity,
        source: 'lint',
        rule,
        message: report.message
      };

      if (report.id !== undefined) {
        finding.elementId = report.id;
      }

      if (report.path !== undefined) {
        finding.path = report.path;
      }

      findings.push(finding);
    }
  }

  return findings;
}

export interface ValidateOptions {
  configPath?: string;
  noLint: boolean;
}

export interface ValidationResult {
  findings: Finding[];
  summary: { errors: number; warnings: number; infos: number };
}

export async function validateDocument(
  doc: BpmnDocument,
  options: ValidateOptions
): Promise<ValidationResult> {
  if (options.configPath !== undefined && options.noLint) {
    throw usageError('--config and --no-lint cannot be used together.');
  }

  const findings = structureFindings(doc);

  if (!options.noLint) {
    const config =
      options.configPath === undefined
        ? defaultLintConfig()
        : await loadLintConfig(options.configPath);

    reconcileFlowReferences(doc.index);
    findings.push(...(await lintFindings(doc, config)));
  }

  const severityRank: Record<Severity, number> = {
    error: 0,
    warning: 1,
    info: 2
  };

  findings.sort((first, second) => {
    return (
      severityRank[first.severity] - severityRank[second.severity] ||
      (first.elementId ?? '').localeCompare(second.elementId ?? '') ||
      first.rule.localeCompare(second.rule) ||
      first.message.localeCompare(second.message)
    );
  });

  const summary = {
    errors: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    infos: findings.filter((finding) => finding.severity === 'info').length
  };

  return { findings, summary };
}
