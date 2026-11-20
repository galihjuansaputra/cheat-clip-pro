import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const isWindows = process.platform === 'win32';

// ANSI colors for clean, styled terminal logging without extra dependencies
const COLORS = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  bold: '\x1b[1m'
};

function formatPrefix(name, color) {
  return `${color}[${name}]${COLORS.reset} `;
}

const children = [];
let isShuttingDown = false;

function killProcess(child) {
  if (!child || child.killed) return;
  try {
    if (isWindows && child.pid) {
      // On Windows, taskkill /T /F ensures all child process trees (Python, Uvicorn, Vite) are terminated
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else if (child.pid) {
      // On Unix/macOS, kill the entire process group
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
}

function shutdown(exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${COLORS.yellow}⚡ [Cheat Clip PRO] Shutting down frontend & backend processes...${COLORS.reset}`);
  for (const child of children) {
    killProcess(child);
  }
  setTimeout(() => process.exit(exitCode), 400);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));
process.on('exit', () => shutdown(0));

function runService(name, command, args, color) {
  const prefix = formatPrefix(name, color);

  const proc = spawn(command, args, {
    cwd: rootDir,
    shell: false,
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' }
  });

  children.push(proc);

  const rlOut = readline.createInterface({ input: proc.stdout, terminal: false });
  rlOut.on('line', (line) => {
    console.log(`${prefix}${line}`);
  });

  const rlErr = readline.createInterface({ input: proc.stderr, terminal: false });
  rlErr.on('line', (line) => {
    console.error(`${prefix}${line}`);
  });

  proc.on('error', (err) => {
    console.error(`${prefix}${COLORS.red}Failed to start: ${err.message}${COLORS.reset}`);
  });

  proc.on('exit', (code, signal) => {
    if (!isShuttingDown) {
      const msg = code !== null ? `exited with code ${code}` : `terminated by signal ${signal}`;
      if (code !== 0 && code !== null) {
        console.error(`${prefix}${COLORS.red}${msg}${COLORS.reset}`);
      } else {
        console.log(`${prefix}${COLORS.gray}${msg}${COLORS.reset}`);
      }
    }
  });

  return proc;
}

console.log(`${COLORS.bold}${COLORS.cyan}===================================================${COLORS.reset}`);
console.log(`${COLORS.bold}  Starting Cheat Clip PRO Development Environment   ${COLORS.reset}`);
console.log(`${COLORS.bold}${COLORS.cyan}===================================================${COLORS.reset}\n`);

// 1. Start Python FastAPI Backend Server
const backendScript = path.join(rootDir, 'scripts', 'start-backend.js');
runService('backend', process.execPath, [backendScript], COLORS.magenta);

// 2. Start Vite Frontend Dev Server
const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
if (fs.existsSync(viteBin)) {
  runService('frontend', process.execPath, [viteBin], COLORS.cyan);
} else {
  const npmCmd = isWindows ? 'cmd.exe' : 'npm';
  const npmArgs = isWindows ? ['/d', '/s', '/c', 'npm run dev-frontend'] : ['run', 'dev-frontend'];
  runService('frontend', npmCmd, npmArgs, COLORS.cyan);
}
