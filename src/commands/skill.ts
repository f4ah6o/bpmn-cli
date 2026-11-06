import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { ioError } from '../errors.js';
import { printJson, successEnvelope } from '../output/json.js';
import { parseFormat } from './shared.js';

const SKILL_NAME = 'bpmn-cli';
const SKILL_PATH = fileURLToPath(
  new URL('../../skills/bpmn-cli/SKILL.md', import.meta.url)
);

export interface SkillCliOptions {
  format?: string;
}

export async function runSkill(options: SkillCliOptions): Promise<void> {
  const format = parseFormat(options.format);
  let content: string;

  try {
    content = await readFile(SKILL_PATH, 'utf8');
  } catch (error) {
    throw ioError(
      'E_SKILL_NOT_FOUND',
      'Could not read the bundled BPMN skill at ' + SKILL_PATH + ': ' + (error as Error).message,
      {
        cause: error,
        details: { path: SKILL_PATH },
        hint: 'Reinstall bpmn-cli; the package should include skills/bpmn-cli/SKILL.md.'
      }
    );
  }

  if (format === 'json') {
    printJson(
      successEnvelope('skill', null, {
        skill: {
          name: SKILL_NAME,
          path: SKILL_PATH,
          bytes: Buffer.byteLength(content, 'utf8'),
          content
        }
      })
    );
    return;
  }

  process.stdout.write(content.endsWith('\n') ? content : content + '\n');
}
