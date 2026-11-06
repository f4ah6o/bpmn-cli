import { readFile, writeFile } from 'node:fs/promises';

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('usage: node scripts/set-version.mjs <version>');
  console.error('example: node scripts/set-version.mjs 2026.11.0');
  process.exit(1);
}

const packageUrl = new URL('../package.json', import.meta.url);
const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'));

packageJson.version = version;
await writeFile(packageUrl, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(`Set package version to ${version}`);
