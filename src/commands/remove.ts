import { BpmnDocument } from '../core/document.js';
import { removeItem } from '../core/elements.js';
import { parseFormat, persistMutation } from './shared.js';

export interface RemoveCliOptions {
  cascade?: boolean;
  format?: string;
}

export async function runRemove(
  file: string,
  id: string,
  options: RemoveCliOptions
): Promise<void> {
  const format = parseFormat(options.format);
  const doc = await BpmnDocument.load(file);
  const result = removeItem(doc, id, options.cascade === true);

  await persistMutation('remove', doc, result, file, format);
}
