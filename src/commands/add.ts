import { BpmnDocument } from '../core/document.js';
import { addElement, type AddKind } from '../core/elements.js';
import { usageError } from '../errors.js';
import { parseFormat, persistMutation } from './shared.js';

export interface AddCliOptions {
  id?: string;
  name?: string;
  type?: string;
  process?: string;
  format?: string;
}

const KINDS: AddKind[] = ['start', 'end', 'task', 'gateway'];

export async function runAdd(
  kind: string,
  file: string,
  options: AddCliOptions
): Promise<void> {
  const format = parseFormat(options.format);

  if (!KINDS.includes(kind as AddKind)) {
    throw usageError(
      `Unknown element kind "${kind}". Expected start, end, task or gateway.`
    );
  }

  const doc = await BpmnDocument.load(file);
  const result = addElement(doc, {
    kind: kind as AddKind,
    type: options.type,
    id: options.id,
    name: options.name,
    processId: options.process
  });

  await persistMutation('add', doc, result, file, format);
}
