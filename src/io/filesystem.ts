import { randomUUID } from 'node:crypto';
import { open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { ioError } from '../errors.js';

function mapReadError(error: unknown, filePath: string): Error {
  const code = (error as NodeJS.ErrnoException).code;

  if (code === 'ENOENT') {
    return ioError('E_FILE_NOT_FOUND', `File not found: ${filePath}`, {
      cause: error
    });
  }

  if (code === 'EISDIR') {
    return ioError('E_IS_DIRECTORY', `Path is a directory: ${filePath}`, {
      cause: error
    });
  }

  return ioError('E_READ_FAILED', `Could not read ${filePath}: ${(error as Error).message}`, {
    cause: error
  });
}

export async function readTextFile(filePath: string): Promise<string> {
  let buffer: Buffer;

  try {
    buffer = await readFile(filePath);
  } catch (error) {
    throw mapReadError(error, filePath);
  }

  let text: string;

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    throw ioError('E_READ_FAILED', `File is not valid UTF-8: ${filePath}`, {
      cause: error
    });
  }

  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function resolveWriteTarget(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return resolve(filePath);
  }
}

export async function writeTextFileAtomic(
  filePath: string,
  text: string
): Promise<{ path: string; bytes: number }> {
  const target = await resolveWriteTarget(filePath);
  const directory = dirname(target);
  const base = basename(target);
  const temporary = join(directory, `.${base}.${process.pid}.${randomUUID()}.tmp`);

  let existingMode: number | null = null;

  try {
    const existing = await stat(target);
    existingMode = existing.mode & 0o777;
  } catch {
    // New file: respect the process umask.
  }

  const mode = existingMode ?? 0o644;
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(temporary, 'wx', mode);
    await handle.writeFile(text, 'utf8');

    if (existingMode !== null) {
      // open() applies the umask; restore the original mode explicitly.
      await handle.chmod(existingMode);
    }

    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);

    return { path: target, bytes: Buffer.byteLength(text, 'utf8') };
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Ignore cleanup errors.
    }

    try {
      await unlink(temporary);
    } catch {
      // Ignore cleanup errors.
    }

    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'EISDIR') {
      throw ioError('E_IS_DIRECTORY', `Path is a directory: ${filePath}`, {
        cause: error
      });
    }

    throw ioError('E_WRITE_FAILED', `Could not write ${filePath}: ${(error as Error).message}`, {
      cause: error
    });
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

export async function isSameFilePath(first: string, second: string): Promise<boolean> {
  try {
    return (await realpath(first)) === (await realpath(second));
  } catch {
    return resolve(first) === resolve(second);
  }
}

export function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

export function writeStdout(text: string): void {
  process.stdout.write(text);
}

export function writeStderr(text: string): void {
  process.stderr.write(text);
}
