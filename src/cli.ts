#!/usr/bin/env node
import { Command, CommanderError } from 'commander';

import { runAdd } from './commands/add.js';
import { runConnect } from './commands/connect.js';
import { runExportSvg } from './commands/export-svg.js';
import { runInit } from './commands/init.js';
import { runLayout } from './commands/layout.js';
import { runList } from './commands/list.js';
import { runRemove } from './commands/remove.js';
import { runRename } from './commands/rename.js';
import { runUpdate } from './commands/update.js';
import { runValidate } from './commands/validate.js';
import { EXIT_USAGE, CliError, toCliError } from './errors.js';
import { printJsonError } from './output/json.js';
import { printError } from './output/text.js';
import { TOOL_VERSION } from './version.js';

interface RunContext {
  command: string;
  file: string | null;
  format: 'text' | 'json';
}

const COMMANDS = new Set([
  'init',
  'add',
  'connect',
  'remove',
  'rename',
  'update',
  'list',
  'layout',
  'export-svg',
  'validate'
]);

let context: RunContext = {
  command: 'unknown',
  file: null,
  format: 'text'
};

function wantsJson(argv: string[]): boolean {
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--format=json') {
      return true;
    }

    if (argv[index] === '--format' && argv[index + 1] === 'json') {
      return true;
    }
  }

  return false;
}

function inferCommand(argv: string[]): string {
  return argv.slice(2).find((argument) => COMMANDS.has(argument)) ?? 'unknown';
}

async function runAction(
  command: string,
  file: string | null,
  formatValue: string | undefined,
  action: () => Promise<void>
): Promise<void> {
  context = {
    command,
    file,
    format: formatValue === 'json' ? 'json' : 'text'
  };

  try {
    await action();
  } catch (error) {
    throw toCliError(error);
  }
}

function buildProgram(): Command {
  const program = new Command();

  program
    .name('bpmn')
    .description('Create, edit, validate, and lay out BPMN 2.0 diagrams')
    .version(TOOL_VERSION, '-V, --version')
    .showHelpAfterError()
    .exitOverride();

  program
    .command('init')
    .description('Create a new BPMN file')
    .argument('<file>', 'BPMN file to create')
    .option('--name <name>', 'process name')
    .option('--id <id>', 'process id')
    .option(
      '--namespace <uri>',
      'target namespace',
      'http://bpmn.io/schema/bpmn'
    )
    .option('--executable', 'mark the process executable')
    .option('--force', 'overwrite an existing file')
    .option('--layout', 'generate BPMN DI immediately')
    .option('--format <format>', 'output format: text or json', 'text')
    .action(async (file: string, options) => {
      await runAction('init', file, options.format, () => runInit(file, options));
    });

  program
    .command('add')
    .description('Add a flow node to a process')
    .argument('<kind>', 'element kind: start, end, task, gateway')
    .argument('<file>', 'BPMN file to edit')
    .option('--id <id>', 'element id')
    .option('--name <name>', 'element name')
    .option('--type <type>', 'task or gateway subtype')
    .option('--process <id>', 'target process id')
    .option('--format <format>', 'output format: text or json', 'text')
    .action(async (kind: string, file: string, options) => {
      await runAction('add', file, options.format, () =>
        runAdd(kind, file, options)
      );
    });

  program
    .command('connect')
    .description('Connect two flow nodes with a sequence flow')
    .argument('<file>', 'BPMN file to edit')
    .argument('<source>', 'source flow-node id')
    .argument('<target>', 'target flow-node id')
    .option('--id <id>', 'sequence-flow id')
    .option('--name <name>', 'sequence-flow label')
    .option('--condition <expression>', 'condition expression')
    .option('--default', 'make this the source default flow')
    .option('--format <format>', 'output format: text or json', 'text')
    .action(async (file: string, source: string, target: string, options) => {
      await runAction('connect', file, options.format, () =>
        runConnect(file, source, target, options)
      );
    });

  program
    .command('remove')
    .description('Remove a flow node or sequence flow')
    .argument('<file>', 'BPMN file to edit')
    .argument('<id>', 'element or sequence-flow id')
    .option('--cascade', 'also remove connected flows and child elements')
    .option('--format <format>', 'output format: text or json', 'text')
    .action(async (file: string, id: string, options) => {
      await runAction('remove', file, options.format, () =>
        runRemove(file, id, options)
      );
    });

  program
    .command('rename')
    .description('Set an element name')
    .argument('<file>', 'BPMN file to edit')
    .argument('<id>', 'element id')
    .requiredOption('--name <name>', 'new name (empty string clears it)')
    .option('--format <format>', 'output format: text or json', 'text')
    .action(async (file: string, id: string, options) => {
      await runAction('rename', file, options.format, () =>
        runRename(file, id, options)
      );
    });

  program
    .command('update')
    .description('Update an element name, condition, default flow, or executable flag')
    .argument('<file>', 'BPMN file to edit')
    .argument('<id>', 'element id')
    .option('--name <name>', 'new name (empty string clears it)')
    .option('--condition <expression>', 'set a sequence-flow condition')
    .option('--clear-condition', 'remove a sequence-flow condition')
    .option('--default', 'mark this sequence flow as the source default')
    .option('--no-default', 'clear this sequence flow as the source default')
    .option('--executable', 'mark a process executable')
    .option('--no-executable', 'mark a process non-executable')
    .option('--format <format>', 'output format: text or json', 'text')
    .action(async (file: string, id: string, options) => {
      await runAction('update', file, options.format, () =>
        runUpdate(file, id, options)
      );
    });

  program
    .command('list')
    .description('List processes, elements, flows, and DI information')
    .argument('<file>', 'BPMN file to inspect')
    .option('--format <format>', 'output format: text or json', 'text')
    .action(async (file: string, options) => {
      await runAction('list', file, options.format, () => runList(file, options));
    });

  program
    .command('layout')
    .description('Generate BPMN DI with automatic layout')
    .argument('<file>', 'BPMN file to lay out')
    .option('--force', 'replace existing BPMN DI')
    .option('--output <path>', 'write the layout to another file')
    .option('--stdout', 'write the layout XML to stdout')
    .option('--format <format>', 'output format: text or json', 'text')
    .action(async (file: string, options) => {
      await runAction('layout', file, options.format, () =>
        runLayout(file, options)
      );
    });

  program
    .command('export-svg')
    .description('Render a BPMN process to SVG with bpmn-js')
    .argument('<file>', 'BPMN file to render')
    .option('--output <path>', 'write the SVG to another file')
    .option('--stdout', 'write the SVG to stdout')
    .option('--force', 'overwrite an existing SVG output')
    .option('--diagram <id>', 'BPMNDiagram id to render')
    .option('--relayout', 'regenerate BPMN DI in memory before rendering')
    .option('--format <format>', 'output format: text or json', 'text')
    .action(async (file: string, options) => {
      await runAction('export-svg', file, options.format, () =>
        runExportSvg(file, options)
      );
    });

  program
    .command('validate')
    .description('Validate BPMN structure, references, and lint rules')
    .argument('<file>', 'BPMN file to validate')
    .option('--config <path>', 'bpmnlint configuration JSON file')
    .option('--no-lint', 'skip bpmnlint rules')
    .option('--format <format>', 'output format: text or json', 'text')
    .action(async (file: string, options) => {
      await runAction('validate', file, options.format, () =>
        runValidate(file, options)
      );
    });

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  const jsonHint = wantsJson(process.argv);

  const outputConfiguration = {
    writeErr: (text: string) => {
      if (!jsonHint) {
        process.stderr.write(text);
      }
    }
  };

  program.configureOutput(outputConfiguration);

  for (const command of program.commands) {
    command.configureOutput(outputConfiguration);
  }

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code.startsWith('commander.help') ||
        error.code.startsWith('commander.version')
      ) {
        process.exitCode = 0;
        return;
      }

      if (jsonHint) {
        const usage = new CliError(
          'E_USAGE',
          error.message.replace(/^error:\s*/, ''),
          { exitCode: EXIT_USAGE }
        );

        printJsonError(inferCommand(process.argv), null, usage);
      }

      process.exitCode = EXIT_USAGE;
      return;
    }

    const cliError = toCliError(error);

    if (context.format === 'json') {
      printJsonError(context.command, context.file, cliError);
    } else {
      printError(cliError);
    }

    if (process.env.BPMN_DEBUG === '1' && cliError.cause !== undefined) {
      console.error(cliError.cause);
    }

    process.exitCode = cliError.exitCode;
  }
}

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  }
});

process.stderr.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  }
});

void main();
