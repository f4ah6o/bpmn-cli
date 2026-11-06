import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

export const TOOL_NAME = 'bpmn-cli';
export const TOOL_VERSION = packageJson.version;
export const TOOL = { name: TOOL_NAME, version: TOOL_VERSION };
