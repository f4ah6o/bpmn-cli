import { BpmnDocument } from '../core/document.js';
import { connect } from '../core/connections.js';
import { parseFormat, persistMutation } from './shared.js';

export interface ConnectCliOptions {
  id?: string;
  name?: string;
  condition?: string;
  default?: boolean;
  format?: string;
}

export async function runConnect(
  file: string,
  source: string,
  target: string,
  options: ConnectCliOptions
): Promise<void> {
  const format = parseFormat(options.format);
  const doc = await BpmnDocument.load(file);

  const result = connect(doc, {
    sourceId: source,
    targetId: target,
    id: options.id,
    name: options.name,
    condition: options.condition,
    makeDefault: options.default === true
  });

  await persistMutation('connect', doc, result, file, format);
}
