import { BpmnDocument } from '../core/document.js';
import { updateItem } from '../core/elements.js';
import { parseFormat, persistMutation } from './shared.js';

export interface UpdateCliOptions {
  name?: string;
  condition?: string;
  clearCondition?: boolean;
  default?: boolean;
  executable?: boolean;
  format?: string;
}

export async function runUpdate(
  file: string,
  id: string,
  options: UpdateCliOptions
): Promise<void> {
  const format = parseFormat(options.format);
  const doc = await BpmnDocument.load(file);

  const result = updateItem(doc, id, {
    name: options.name,
    condition: options.condition,
    clearCondition: options.clearCondition === true,
    setDefault: options.default === true,
    clearDefault: options.default === false,
    executable: options.executable
  });

  await persistMutation('update', doc, result, file, format);
}
