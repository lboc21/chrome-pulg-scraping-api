import path from 'node:path';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const distDir = path.join(rootDir, 'dist');
const watch = process.argv.includes('--watch');

/** MV3 里 background / content script 都必须是自包含的 IIFE */
const ENTRIES = [
  { entry: 'src/background/index.ts', outfile: 'background.js' },
  { entry: 'src/content/inject.ts', outfile: 'content-inject.js' },
  { entry: 'src/content/bridge.ts', outfile: 'content-bridge.js' }
];

const copyStatic = async () => {
  await mkdir(distDir, { recursive: true });
  await copyFile(path.join(rootDir, 'public/manifest.json'), path.join(distDir, 'manifest.json'));
};

const copyManifestPlugin = {
  name: 'copy-manifest',
  setup(build) {
    build.onEnd(async result => {
      if (result.errors.length === 0) await copyStatic();
    });
  }
};

const baseOptions = (entry, outfile) => ({
  entryPoints: [path.join(rootDir, entry)],
  outfile: path.join(distDir, outfile),
  bundle: true,
  format: 'iife',
  target: 'chrome111',
  platform: 'browser',
  charset: 'utf8',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  plugins: [copyManifestPlugin]
});

await copyStatic();

if (watch) {
  for (const { entry, outfile } of ENTRIES) {
    const ctx = await context(baseOptions(entry, outfile));
    await ctx.watch();
  }
  console.log('[ext] 监听中：src/background、src/content');
} else {
  await Promise.all(ENTRIES.map(({ entry, outfile }) => build(baseOptions(entry, outfile))));
  console.log(`[ext] 扩展脚本构建完成 → ${distDir}`);
}
