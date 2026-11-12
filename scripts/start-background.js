import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(root, '.runtime');
const logs = resolve(root, 'logs');
mkdirSync(runtime, { recursive: true });
mkdirSync(logs, { recursive: true });
const pidFile = resolve(runtime, 'dev.pid');

if (existsSync(pidFile)) {
  const pid = Number(readFileSync(pidFile, 'utf8'));
  try { process.kill(pid, 0); console.log(`Cheat Clip PRO sudah berjalan (PID ${pid}).`); process.exit(0); } catch { /* stale pid */ }
}

const out = resolve(logs, 'dev.log');
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = ['run', 'dev'];
const child = spawn(command, args, {
  cwd: root,
  detached: true,
  windowsHide: true,
  shell: true,
  stdio: 'ignore',
  env: process.env,
});
writeFileSync(pidFile, String(child.pid));
child.unref();
console.log(`Cheat Clip PRO berjalan di background (PID ${child.pid}).`);
console.log(`Log: ${out}`);
