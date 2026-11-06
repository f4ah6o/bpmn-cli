import { BpmnDocument } from '../core/document.js';
import { renameItem } from '../core/elements.js';
import { parseFormat, persistMutation } from './shared.js';

export interface RenameCliOptions {
  name: string;
  format?: string;
}

export async function runRename(
  file: string,
  id: string,
  options: RenameCliOptions
): Promise<void> {
  const format = parseFormat(options.format);
  const doc = await BpmnDocument.load(file);
  const result = renameItem(doc, id, options.name);

  await persistMutation('rename', doc, result, file, format);
}
