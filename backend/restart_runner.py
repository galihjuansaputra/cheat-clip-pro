"""
Detached background restart runner for Cheat Clip PRO.
Spawns as an independent detached process, waits for HTTP response delivery,
frees ports 8000 and 5173, and relaunches `npm run dev` in a fresh console.
"""

import os
import sys
import time
import subprocess
import argparse
import logging
from pathlib import Path

# Setup simple logger
logging.basicConfig(level=logging.INFO, format="[restart_runner] %(message)s")
logger = logging.getLogger("restart_runner")

def free_ports_windows(ports=(8000, 5173)):
    """Frees specified ports on Windows using PowerShell or taskkill."""
    current_pid = os.getpid()
    
    # Method 1: PowerShell Get-NetTCPConnection
    ps_cmd = (
        f"$ports = @({','.join(str(p) for p in ports)}); "
        f"foreach ($p in $ports) {{ "
        f"  try {{ "
        f"    $conns = Get-NetTCPConnection -LocalPort $p -ErrorAction Stop; "
        f"    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique; "
        f"    foreach ($procId in $pids) {{ "
        f"      if ($procId -ne {current_pid} -and $procId -gt 4) {{ "
        f"        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue "
        f"      }} "
        f"    }} "
        f"  }} catch {{}} "
        f"}}"
    )
    try:
        subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], timeout=5, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        logger.warning(f"PowerShell port freeing encountered error: {e}")

    # Method 2: Fallback netstat check
    try:
        out = subprocess.check_output("netstat -ano -p tcp", shell=True, text=True, timeout=5)
        for line in out.splitlines():
            parts = line.strip().split()
            if len(parts) >= 5 and parts[0].upper() == "TCP":
                local_addr = parts[1]
                pid = parts[-1]
                for p in ports:
                    if local_addr.endswith(f":{p}") and pid.isdigit() and int(pid) != current_pid and int(pid) > 4:
                        try:
                            subprocess.run(f"taskkill /F /PID {pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        except Exception:
                            pass
    except Exception:
        pass

def free_ports_unix(ports=(8000, 5173)):
    """Frees specified ports on Unix/macOS."""
    for p in ports:
        try:
            cmd = f"lsof -ti :{p} | xargs kill -9"
            subprocess.run(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

def main():
    parser = argparse.ArgumentParser(description="Cheat Clip PRO Background Restart Runner")
    parser.add_argument("--delay", type=float, default=2.5, help="Seconds to wait before freeing ports")
    parser.add_argument("--cwd", type=str, default="", help="Workspace root directory")
    args = parser.parse_args()

    root_dir = Path(args.cwd).resolve() if args.cwd else Path(__file__).resolve().parent.parent
    logger.info(f"Restart sequence initialized for: {root_dir}")
    logger.info(f"Waiting {args.delay}s to allow client response to complete...")
    time.sleep(args.delay)

    logger.info("Freeing ports 8000 and 5173...")
    if os.name == "nt":
        free_ports_windows((8000, 5173))
    else:
        free_ports_unix((8000, 5173))

    time.sleep(1.0)

    logger.info("Launching 'npm run dev'...")
    try:
        if os.name == "nt":
            # Launch in new console window on Windows
            subprocess.Popen(
                ["cmd.exe", "/c", "npm run dev"],
                cwd=str(root_dir),
                creationflags=subprocess.CREATE_NEW_CONSOLE
            )
        else:
            # Launch detached on Unix
            subprocess.Popen(
                ["npm", "run", "dev"],
                cwd=str(root_dir),
                start_new_session=True
            )
        logger.info("New server process launched successfully.")
    except Exception as e:
        logger.error(f"Failed to launch npm run dev: {e}")

if __name__ == "__main__":
    main()
