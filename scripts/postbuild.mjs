import { chmod } from 'node:fs/promises';

try {
  await chmod(new URL('../dist/cli.js', import.meta.url), 0o755);
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}
