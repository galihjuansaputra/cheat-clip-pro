import { existsSync, readFileSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pidFile = resolve(root, '.runtime', 'dev.pid');
if (!existsSync(pidFile)) { console.log('Tidak ada proses background yang tercatat.'); process.exit(0); }
const pid = Number(readFileSync(pidFile, 'utf8'));
if (process.platform === 'win32') {
  const pids = new Set(pid > 0 ? [pid] : []);
  const netstat = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout || '';
  for (const line of netstat.split(/\r?\n/)) {
    if ((line.includes(':5173') || line.includes(':8000')) && line.includes('LISTENING')) {
      const parts = line.trim().split(/\s+/);
      const portPid = Number(parts[parts.length - 1]);
      if (portPid) pids.add(portPid);
    }
  }

  // Kill the leftover cmd.exe wrapper that keeps logs/dev.log locked after npm exits.
  const query = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*run-dev-hidden.bat*' -and $_.ProcessId -ne $PID } | Select-Object -ExpandProperty ProcessId";
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8' });
  for (const value of (ps.stdout || '').split(/\s+/)) {
    const wrapperPid = Number(value);
    if (wrapperPid > 0 && wrapperPid !== process.pid) pids.add(wrapperPid);
  }

  for (const target of pids) spawnSync('taskkill', ['/PID', String(target), '/T', '/F'], { stdio: 'ignore' });
} else if (pid > 0) process.kill(pid, 'SIGTERM');
unlinkSync(pidFile);
console.log('Cheat Clip PRO background dihentikan.');
