import type { CliError } from '../errors.js';
import type {
  Change,
  Diagnostic,
  Finding,
  ModelIndex
} from '../types.js';

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
}

function quote(value: string | null): string {
  const text = clean(value);
  return text.length === 0 ? '(no name)' : `"${text}"`;
}

export function printWarning(diagnostic: Diagnostic): void {
  const suffix = diagnostic.elementId === undefined ? '' : ` [${diagnostic.elementId}]`;
  process.stderr.write(`warning: ${diagnostic.message}${suffix}\n`);
}

export function printWarnings(warnings: Diagnostic[]): void {
  for (const warning of warnings) {
    printWarning(warning);
  }
}

export function printError(error: CliError): void {
  process.stderr.write(`error: ${clean(error.message)}\n`);

  if (error.hint !== undefined) {
    process.stderr.write(`hint: ${clean(error.hint)}\n`);
  }
}

function formatFieldValue(value: unknown): string {
  if (value === null) {
    return '(none)';
  }

  if (typeof value === 'string') {
    return JSON.stringify(clean(value));
  }

  return String(value);
}

export function printMutation(
  file: string,
  changes: Change[],
  warnings: Diagnostic[]
): void {
  for (const change of changes) {
    if (change.op === 'add') {
      const name = change.name === undefined ? '' : ` ${quote(change.name)}`;
      process.stdout.write(`Added ${change.type} ${change.id}${name}.\n`);
    } else if (change.op === 'remove') {
      process.stdout.write(`Removed ${change.type} ${change.id}.\n`);
    } else if (change.changed === false) {
      process.stdout.write(`No changes for ${change.id}.\n`);
    } else {
      const fields = Object.entries(change.fields ?? {})
        .map(([key, value]) => `${key}=${formatFieldValue(value.to)}`)
        .join(', ');

      process.stdout.write(
        `Updated ${change.id}${fields.length > 0 ? ` (${fields})` : ''}.\n`
      );
    }
  }

  process.stdout.write(`Saved ${file}.\n`);
  printWarnings(warnings);
}

export function printList(file: string, index: ModelIndex): void {
  process.stdout.write(`${file}\n`);
  process.stdout.write(`  namespace: ${index.definitions.targetNamespace ?? '(none)'}\n`);

  for (const processInfo of index.processes) {
    const executable = processInfo.isExecutable ? 'executable' : 'not executable';
    process.stdout.write(
      `  process ${processInfo.id} ${quote(processInfo.name)} (${executable})\n`
    );

    for (const element of index.elements.filter(
      (item) => item.processId === processInfo.id
    )) {
      const attached = element.attachedTo === null ? '' : ` attachedTo=${element.attachedTo}`;
      process.stdout.write(
        `    ${element.type} ${element.id}${element.name === null ? '' : ` ${quote(element.name)}`}${attached}\n`
      );
    }

    for (const flow of index.flows.filter((item) => item.processId === processInfo.id)) {
      const condition = flow.condition === null ? '' : ` [${clean(flow.condition)}]`;
      const fallback = flow.isDefault ? ' (default)' : '';
      process.stdout.write(
        `    ${flow.type} ${flow.id}: ${flow.sourceId ?? '?'} -> ${flow.targetId ?? '?'}${condition}${fallback}\n`
      );
    }

    for (const lane of index.lanes.filter((item) => item.processId === processInfo.id)) {
      process.stdout.write(`    lane ${lane.id} ${quote(lane.name)}: ${lane.flowNodeRefs.join(', ')}\n`);
    }
  }

  for (const collaboration of index.collaborations) {
    process.stdout.write(`  collaboration ${collaboration.id}\n`);

    for (const participant of index.participants.filter(
      (item) => item.containerId === collaboration.id
    )) {
      process.stdout.write(
        `    participant ${participant.id} ${quote(participant.name)} -> ${participant.processRefId ?? '(black box)'}\n`
      );
    }

    for (const messageFlow of index.messageFlows.filter(
      (item) => item.containerId === collaboration.id
    )) {
      process.stdout.write(
        `    messageFlow ${messageFlow.id}: ${messageFlow.sourceId ?? '?'} -> ${messageFlow.targetId ?? '?'}\n`
      );
    }
  }

  const di = index.di;
  process.stdout.write(
    `  DI: ${di.present ? 'present' : 'none'} (${di.shapes} shapes, ${di.edges} edges` +
      `${di.missing > 0 ? `, ${di.missing} missing` : ''}${di.stale > 0 ? `, ${di.stale} stale` : ''})\n`
  );
}

export function printValidation(
  file: string,
  findings: Finding[],
  summary: { errors: number; warnings: number; infos: number }
): void {
  process.stdout.write(`${file}\n`);

  for (const finding of findings) {
    const target = finding.elementId === undefined ? '-' : finding.elementId;
    process.stdout.write(
      `  ${target}  ${finding.severity}  ${clean(finding.message)}  (${finding.rule})\n`
    );
  }

  const total = summary.errors + summary.warnings + summary.infos;

  if (total === 0) {
    process.stdout.write('No problems found.\n');
  } else {
    process.stdout.write(
      `\n${summary.errors > 0 ? 'FAILED' : 'OK'}: ${total} problems ` +
        `(${summary.errors} errors, ${summary.warnings} warnings, ${summary.infos} infos)\n`
    );
  }
}

export function printExportSvg(
  output: string,
  info: { width: number; height: number; shapes: number; edges: number }
): void {
  process.stdout.write(
    `Wrote SVG to ${output} (${info.width}x${info.height}, ` +
      `${info.shapes} shapes, ${info.edges} edges).\n`
  );
}

export function printLayout(
  output: string,
  wrote: boolean,
  before: { shapes: number; edges: number },
  after: { shapes: number; edges: number }
): void {
  if (wrote) {
    process.stdout.write(
      `Wrote layout to ${output} (${before.shapes} -> ${after.shapes} shapes, ` +
        `${before.edges} -> ${after.edges} edges).\n`
    );
  } else {
    process.stdout.write('No layout written.\n');
  }
}
