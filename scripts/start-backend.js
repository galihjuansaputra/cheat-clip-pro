import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const isWindows = process.platform === 'win32';

function findPythonCandidates() {
  const candidates = [];

  // 1. Local project virtual environments (highest priority)
  const venvNames = ['venv', '.venv', 'env', '.env'];
  for (const v of venvNames) {
    const winPath = path.join(rootDir, v, 'Scripts', 'python.exe');
    const unixPath = path.join(rootDir, v, 'bin', 'python');
    if (isWindows && fs.existsSync(winPath)) {
      candidates.push({ exe: winPath, args: [], name: `${v}/Scripts/python.exe` });
    } else if (!isWindows && fs.existsSync(unixPath)) {
      candidates.push({ exe: unixPath, args: [], name: `${v}/bin/python` });
    }
  }

  // 2. Environment variable override
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    candidates.push({ exe: process.env.PYTHON_PATH, args: [], name: 'PYTHON_PATH env' });
  }

  // 3. System commands
  candidates.push({ exe: 'python', args: [], name: 'System python' });
  if (isWindows) {
    candidates.push({ exe: 'py', args: ['-3'], name: 'Windows Python Launcher (py -3)' });
  }
  candidates.push({ exe: 'python3', args: [], name: 'System python3' });

  // 4. Windows standard installation locations fallback
  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const progPath = path.join(localAppData, 'Programs', 'Python');
      if (fs.existsSync(progPath)) {
        try {
          const dirs = fs.readdirSync(progPath);
          for (const d of dirs) {
            const exe = path.join(progPath, d, 'python.exe');
            if (fs.existsSync(exe)) {
              candidates.push({ exe, args: [], name: `LocalAppData ${d}` });
            }
          }
        } catch {}
      }
    }
    const rootDrives = ['C:\\Python313\\python.exe', 'C:\\Python312\\python.exe', 'C:\\Python311\\python.exe', 'C:\\Python310\\python.exe'];
    for (const p of rootDrives) {
      if (fs.existsSync(p)) {
        candidates.push({ exe: p, args: [], name: p });
      }
    }
  }

  return candidates;
}

function testPython(candidate) {
  try {
    const checkCmd = [
      ...candidate.args,
      '-c',
      "import sys; import uvicorn, fastapi; print('OK')"
    ];
    const res = execSync(`"${candidate.exe}" ${checkCmd.join(' ')}`, {
      cwd: rootDir,
      timeout: 6000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).toString();
    return { works: true, hasDependencies: res.includes('OK') };
  } catch (err) {
    // Check if python runs at all (maybe only dependencies are missing)
    try {
      const basicRes = execSync(`"${candidate.exe}" ${candidate.args.join(' ')} --version`, {
        cwd: rootDir,
        timeout: 4000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).toString();
      if (basicRes.toLowerCase().includes('python')) {
        return { works: true, hasDependencies: false };
      }
    } catch {}
    return { works: false, hasDependencies: false };
  }
}

async function start() {
  console.log('\x1b[36m%s\x1b[0m', '⚡ [Cheat Clip Pro] Initializing Fast & Resilient Python Backend Server...');

  const candidates = findPythonCandidates();
  let selectedCandidate = null;

  for (const c of candidates) {
    const test = testPython(c);
    if (test.works && test.hasDependencies) {
      selectedCandidate = c;
      console.log('\x1b[32m%s\x1b[0m', `✓ Using Python: ${c.name} (${c.exe})`);
      break;
    }
  }

  if (!selectedCandidate) {
    // Pick the first available working Python without running pip install
    for (const c of candidates) {
      const test = testPython(c);
      if (test.works) {
        selectedCandidate = c;
        console.log('\x1b[33m%s\x1b[0m', `⚠️ Using Python: ${c.name} (${c.exe})`);
        break;
      }
    }
  }

  const pythonExe = selectedCandidate ? selectedCandidate.exe : 'python';
  const baseArgs = selectedCandidate ? selectedCandidate.args : [];

  const uvicornArgs = [
    ...baseArgs,
    '-m',
    'uvicorn',
    'backend.main:app',
    '--host',
    '0.0.0.0',
    '--port',
    '8000',
    '--reload'
  ];

  console.log('\x1b[34m%s\x1b[0m', `🚀 Launching FastAPI server on http://127.0.0.1:8000 ...`);

  const backendProc = spawn(pythonExe, uvicornArgs, {
    cwd: rootDir,
    shell: false,
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: rootDir
    }
  });

  backendProc.on('error', (err) => {
    console.error('\x1b[31m%s\x1b[0m', `❌ Failed to start Python backend: ${err.message}`);
    console.error('\x1b[33m%s\x1b[0m', `💡 Ensure Python is installed and run: pip install -r backend/requirements.txt`);
  });

  backendProc.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error('\x1b[31m%s\x1b[0m', `⚠️ Backend server process exited with code ${code}.`);
      console.error('\x1b[33m%s\x1b[0m', `💡 If port 8000 was in use or dependencies missing, run:`);
      console.error('\x1b[33m%s\x1b[0m', `   pip install -r backend/requirements.txt`);
    }
  });

  process.on('SIGINT', () => {
    backendProc.kill('SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    backendProc.kill('SIGTERM');
    process.exit(0);
  });
}

start();
