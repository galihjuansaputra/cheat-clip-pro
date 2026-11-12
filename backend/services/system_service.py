import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple

from backend.config import COOKIES_PATH, ROOT_COOKIES_PATH, TEMP_DIR, UPLOADS_DIR, _base_dir, logger


def get_dir_size_and_count(dir_path) -> Tuple[int, int]:
    p = Path(dir_path)
    total_bytes = 0
    total_files = 0
    if p.exists() and p.is_dir():
        for item in p.rglob("*"):
            if item.is_file():
                try:
                    total_bytes += item.stat().st_size
                    total_files += 1
                except Exception:
                    pass
    return total_files, total_bytes


def get_temp_storage_summary() -> dict:
    """Returns total files, bytes, and formatted size of temp download storage."""
    base_dir = Path(_base_dir)
    f1, b1 = get_dir_size_and_count(TEMP_DIR)
    f2, b2 = get_dir_size_and_count(base_dir / "temp")
    tot_files = f1 + f2
    tot_bytes = b1 + b2
    tot_mb = round(tot_bytes / (1024 * 1024), 2)
    formatted = f"{tot_mb} MB" if tot_mb < 1024 else f"{round(tot_mb / 1024, 2)} GB"
    return {
        "total_files": tot_files,
        "total_bytes": tot_bytes,
        "total_mb": tot_mb,
        "formatted_size": formatted
    }


def clear_temp_files() -> dict:
    """
    Clears all temporary downloaded video clips, audio slices, ASS files, and frames
    from TEMP_DIR and backend/temp. Re-creates empty directories.
    PROTECTED: cookies.txt and any cookie files are strictly PRESERVED and NEVER deleted.
    """
    base_dir = Path(_base_dir)
    cleared_files = 0
    cleared_bytes = 0

    PROTECTED_COOKIE_NAMES = {"cookies.txt", ".cookies", "youtube_cookies.txt", "cookie.txt"}

    def is_protected_cookie(p: Path) -> bool:
        if p.name.lower() in PROTECTED_COOKIE_NAMES:
            return True
        try:
            if COOKIES_PATH.exists() and p.resolve() == COOKIES_PATH.resolve():
                return True
        except Exception:
            pass
        return False

    target_dirs = [TEMP_DIR, base_dir / "temp"]
    for d in target_dirs:
        if d.exists() and d.is_dir():
            for item in list(d.iterdir()):
                try:
                    if is_protected_cookie(item):
                        logger.info(f"Preserving protected cookie file: {item}")
                        continue
                    if item.name == "uploads":
                        continue

                    if item.is_file() or item.is_symlink():
                        sz = item.stat().st_size
                        item.unlink()
                        cleared_files += 1
                        cleared_bytes += sz
                    elif item.is_dir():
                        has_cookie = False
                        for sub in list(item.rglob("*")):
                            if is_protected_cookie(sub):
                                has_cookie = True
                                logger.info(f"Preserving protected cookie file inside folder: {sub}")
                                continue
                            if sub.is_file() or sub.is_symlink():
                                try:
                                    cleared_files += 1
                                    cleared_bytes += sub.stat().st_size
                                    sub.unlink()
                                except Exception:
                                    pass
                        if not has_cookie:
                            shutil.rmtree(item, ignore_errors=True)
                except Exception as e:
                    logger.warning(f"Could not delete temp item {item}: {e}")
        d.mkdir(parents=True, exist_ok=True)

    # Ensure frames and uploads directories inside TEMP_DIR exist
    (TEMP_DIR / "frames").mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    cleared_mb = round(cleared_bytes / (1024 * 1024), 2)
    formatted = f"{cleared_mb} MB" if cleared_mb < 1024 else f"{round(cleared_mb / 1024, 2)} GB"
    logger.info(f"Cleared temp folder: {cleared_files} files, {formatted}")
    return {
        "success": True,
        "cleared_files": cleared_files,
        "cleared_bytes": cleared_bytes,
        "cleared_mb": cleared_mb,
        "cookies_preserved": True,
        "has_cookies": False,
        "message": f"Successfully cleared {cleared_files} temporary files ({formatted}). Cookies remain safely stored in your browser LocalStorage."
    }


def is_protected_system_file(p: Path) -> bool:
    """Checks whether a given file/dir is protected (cookies, fonts, etc.)."""
    PROTECTED_COOKIE_NAMES = {"cookies.txt", ".cookies", "youtube_cookies.txt", "cookie.txt"}
    if p.name.lower() in PROTECTED_COOKIE_NAMES:
        return True
    try:
        if COOKIES_PATH.exists() and p.resolve() == COOKIES_PATH.resolve():
            return True
    except Exception:
        pass
    try:
        if ROOT_COOKIES_PATH.exists() and p.resolve() == ROOT_COOKIES_PATH.resolve():
            return True
    except Exception:
        pass
    try:
        from backend.config import FONTS_DIR
        if FONTS_DIR.exists() and (p.resolve() == FONTS_DIR.resolve() or FONTS_DIR.resolve() in p.resolve().parents):
            return True
    except Exception:
        pass
    return False


def cleanup_expired_temp_files(max_age_hours: int = 48) -> dict:
    """
    Cleans up temporary video frames, audio slices, and ASS files that are older than max_age_hours.
    Strictly preserves cookies.txt and active files.
    """
    return auto_cleanup_expired_files(max_age_seconds=max_age_hours * 3600)


def auto_cleanup_expired_files(
    max_age_seconds: int = 3600,
    max_storage_bytes: int = 5 * 1024 * 1024 * 1024,
    target_reduction_ratio: float = 0.8
) -> dict:
    """
    Automated dual-mode cleanup engine:
    1. Option 1 (Time-based TTL): Deletes temp/export/upload files older than max_age_seconds (default 1 hour).
    2. Option 2 (Storage Quota Ceiling): If total storage exceeds max_storage_bytes (default 5 GB),
       purges oldest files first (FIFO by mtime) down to target_reduction_ratio (default 80% = 4 GB).
    Strictly preserves cookies and custom fonts.
    """
    import time
    base_dir = Path(_base_dir)
    from backend.config import EXPORTS_DIR, TEMP_DIR, UPLOADS_DIR

    target_dirs = [TEMP_DIR, base_dir / "temp", UPLOADS_DIR, EXPORTS_DIR]
    now = time.time()
    cutoff_time = now - max_age_seconds

    ttl_deleted_files = 0
    ttl_deleted_bytes = 0
    quota_deleted_files = 0
    quota_deleted_bytes = 0

    # Pass 1: Time-based TTL cleanup (Option 1)
    for target in target_dirs:
        if not target.exists() or not target.is_dir():
            continue
        for item in list(target.rglob("*")):
            if item.is_file() and not is_protected_system_file(item):
                try:
                    mtime = item.stat().st_mtime
                    if mtime < cutoff_time:
                        sz = item.stat().st_size
                        item.unlink()
                        ttl_deleted_files += 1
                        ttl_deleted_bytes += sz
                except Exception:
                    pass

    # Pass 2: Storage Quota Ceiling check (Option 2)
    current_files = []
    total_current_bytes = 0

    for target in target_dirs:
        if not target.exists() or not target.is_dir():
            continue
        for item in list(target.rglob("*")):
            if item.is_file() and not is_protected_system_file(item):
                try:
                    stat = item.stat()
                    total_current_bytes += stat.st_size
                    current_files.append((stat.st_mtime, stat.st_size, item))
                except Exception:
                    pass

    if total_current_bytes > max_storage_bytes:
        logger.warning(
            f"[Auto-Cleanup] Total temp storage ({round(total_current_bytes / (1024**3), 2)} GB) "
            f"exceeds quota ceiling ({round(max_storage_bytes / (1024**3), 2)} GB). Triggering FIFO quota purge."
        )
        target_ceiling = int(max_storage_bytes * target_reduction_ratio)
        # Sort oldest files first
        current_files.sort(key=lambda x: x[0])
        for mtime, sz, item_path in current_files:
            if total_current_bytes <= target_ceiling:
                break
            try:
                if item_path.exists() and item_path.is_file():
                    item_path.unlink()
                    quota_deleted_files += 1
                    quota_deleted_bytes += sz
                    total_current_bytes -= sz
            except Exception as e:
                logger.warning(f"Failed to unlink file during quota purge {item_path}: {e}")

    # Remove empty subdirectories (skip root targets and frames)
    for target in target_dirs:
        if target.exists() and target.is_dir():
            for item in sorted(list(target.rglob("*")), key=lambda p: len(p.parts), reverse=True):
                if item.is_dir() and item != target and item.name != "frames" and not is_protected_system_file(item):
                    try:
                        if not any(item.iterdir()):
                            item.rmdir()
                    except Exception:
                        pass

    tot_cleaned_files = ttl_deleted_files + quota_deleted_files
    tot_cleaned_bytes = ttl_deleted_bytes + quota_deleted_bytes
    tot_cleaned_mb = round(tot_cleaned_bytes / (1024 * 1024), 2)
    tot_current_mb = round(total_current_bytes / (1024 * 1024), 2)

    if tot_cleaned_files > 0:
        logger.info(
            f"[Auto-Cleanup] Cleaned {tot_cleaned_files} files ({tot_cleaned_mb} MB) "
            f"[TTL: {ttl_deleted_files}, Quota: {quota_deleted_files}]. "
            f"Current storage: {tot_current_mb} MB."
        )

    return {
        "success": True,
        "ttl_deleted_files": ttl_deleted_files,
        "ttl_deleted_bytes": ttl_deleted_bytes,
        "quota_deleted_files": quota_deleted_files,
        "quota_deleted_bytes": quota_deleted_bytes,
        "total_cleaned_files": tot_cleaned_files,
        "total_cleaned_bytes": tot_cleaned_bytes,
        "total_cleaned_mb": tot_cleaned_mb,
        "remaining_storage_bytes": total_current_bytes,
        "remaining_storage_mb": tot_current_mb,
        "max_age_seconds": max_age_seconds,
        "max_storage_bytes": max_storage_bytes
    }


def find_git_executable() -> str:
    if shutil.which("git"):
        return "git"
    candidates = [
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "Git" / "cmd" / "git.exe",
        Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")) / "Git" / "cmd" / "git.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Git" / "cmd" / "git.exe",
        Path(os.environ.get("USERPROFILE", "")) / "scoop" / "apps" / "git" / "current" / "bin" / "git.exe",
        Path(os.environ.get("USERPROFILE", "")) / "scoop" / "shims" / "git.exe",
    ]
    for c in candidates:
        if c and c.exists():
            return str(c.resolve())
    return "git"


def run_git_command(args: List[str], cwd: Optional[Path] = None, timeout: int = 15) -> Tuple[int, str, str]:
    """Runs a git command safely and returns (returncode, stdout, stderr)."""
    target_cwd = cwd or Path(_base_dir).parent
    git_bin = find_git_executable()
    try:
        proc = subprocess.run(
            [git_bin] + args,
            cwd=str(target_cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout
        )
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except Exception as e:
        return -1, "", str(e)


def is_server_environment() -> bool:
    """
    Detects if the application is running in a server/production/containerized environment:
    - Docker container (/.dockerenv, DOCKER_CONTAINER=true, DOKPLOY, etc.)
    - Cloud hosting (VERCEL, RENDER, FLY_ALLOC_ID, RAILWAY_ENVIRONMENT, etc.)
    - Explicit SERVER_MODE=true or ENVIRONMENT=production
    """
    if os.environ.get("SERVER_MODE", "").lower() in ("1", "true", "yes"):
        return True
    if os.environ.get("ENVIRONMENT", "").lower() == "production" or os.environ.get("NODE_ENV", "").lower() == "production":
        return True
    if os.path.exists("/.dockerenv") or os.environ.get("DOCKER_CONTAINER", "").lower() in ("1", "true", "yes"):
        return True
    if any(os.environ.get(k) for k in ("DOKPLOY", "VERCEL", "RENDER", "FLY_ALLOC_ID", "RAILWAY_ENVIRONMENT", "AWS_LAMBDA_FUNCTION_NAME")):
        return True
    return False


def is_update_allowed() -> bool:
    """
    App self-update and server restarts via Web UI are ONLY allowed in local desktop environments.
    In server environments (Docker / Dokploy / Cloud VPS), updates must be handled via orchestrator / git deployment.
    """
    if os.environ.get("ALLOW_SERVER_UPDATE", "").lower() in ("1", "true", "yes"):
        return True
    return not is_server_environment()


def get_current_git_info() -> dict:
    """Retrieves current commit, branch, and remote URL information."""
    root_dir = Path(_base_dir).parent
    rc, commit_info, _ = run_git_command(["log", "-1", "--pretty=format:%h|%H|%s|%cd", "--date=short"], cwd=root_dir)
    rc_branch, branch, _ = run_git_command(["branch", "--show-current"], cwd=root_dir)
    rc_remote, remote_url, _ = run_git_command(["remote", "get-url", "origin"], cwd=root_dir)

    commit_hash = "unknown"
    commit_full = ""
    commit_msg = "Unknown commit"
    commit_date = ""
    if rc == 0 and commit_info:
        parts = commit_info.split("|")
        if len(parts) >= 4:
            commit_hash = parts[0]
            commit_full = parts[1]
            commit_msg = parts[2]
            commit_date = parts[3]

    is_server = is_server_environment()
    allow_update = is_update_allowed()

    return {
        "current_commit": commit_hash,
        "current_commit_full": commit_full,
        "commit_message": commit_msg,
        "commit_date": commit_date,
        "branch": branch if rc_branch == 0 and branch else "master",
        "remote_url": remote_url if rc_remote == 0 and remote_url else "https://github.com/galihjuansaputra/cheat-clip-pro.git",
        "is_server": is_server,
        "allow_update": allow_update
    }


def trigger_detached_restart(delay: float = 2.5):
    """Launches backend/restart_runner.py in a fully detached background process."""
    root_dir = Path(_base_dir).parent
    runner_script = root_dir / "backend" / "restart_runner.py"
    
    flags = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS) if os.name == 'nt' else 0
    subprocess.Popen(
        [sys.executable, str(runner_script), "--delay", str(delay), "--cwd", str(root_dir)],
        cwd=str(root_dir),
        creationflags=flags,
        start_new_session=True if os.name != 'nt' else False,
        close_fds=True
    )
    logger.info(f"Detached restart runner spawned with delay={delay}s")
