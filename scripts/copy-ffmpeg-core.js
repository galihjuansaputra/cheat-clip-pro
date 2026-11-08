// Copy the locally installed FFmpeg WASM core into public/ffmpeg so Vite can
// serve it. The core is a ~32 MB binary, so it stays out of git and is restored
// automatically after `npm install` via the postinstall script.
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = resolve(root, 'node_modules/@ffmpeg/core/dist/esm');
const targetDir = resolve(root, 'public/ffmpeg');
const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

if (!existsSync(sourceDir)) {
  console.warn('[ffmpeg] @ffmpeg/core is not installed yet; skipping local core copy.');
  process.exit(0);
}

await mkdir(targetDir, { recursive: true });

for (const file of files) {
  const source = resolve(sourceDir, file);
  if (!existsSync(source)) {
    console.warn(`[ffmpeg] Missing ${file} in @ffmpeg/core; skipping.`);
    continue;
  }
  await copyFile(source, resolve(targetDir, file));
  console.log(`[ffmpeg] Copied ${file} to public/ffmpeg`);
}
