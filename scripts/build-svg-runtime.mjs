import { build } from 'esbuild';

await build({
  entryPoints: ['src/svg/runtime-entry.js'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  outfile: 'dist/svg-runtime.mjs',
  legalComments: 'inline',
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  logLevel: 'info'
});
