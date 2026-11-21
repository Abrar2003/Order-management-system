"""Run with python3 on Linux; exercises only the dependency switch with fake npm/PM2."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

source = Path(sys.argv[1]).read_text()
section = source.split('log "Installing backend dependencies"', 1)[1].split('log "Installing Chromium for PDF exports"', 1)[0]
for case in ("success", "install_failure", "frontend_failure", "after_swap_failure"):
    with tempfile.TemporaryDirectory(prefix="oms-deploy-test-") as directory:
        root = Path(directory)
        backend = root / "backend"
        frontend = root / "frontend"
        (backend / "node_modules").mkdir(parents=True)
        frontend.mkdir()
        (backend / "node_modules/original").touch()
        for name in ("package.json", "package-lock.json"):
            (backend / name).write_text("{}")
        script = r'''
set -euo pipefail
log() { :; }
get_env_value() { :; }
node() { :; }
npm() {
  if [[ "$PWD" == "$FRONTEND_DIR" ]]; then
    [[ "$CASE" != frontend_failure ]]
    return
  fi
  [[ -f "$BACKEND_DIR/node_modules/original" ]]
  [[ "$CASE" != install_failure ]] || return 1
  mkdir -p "$DEPENDENCY_STAGE/node_modules"
  touch "$DEPENDENCY_STAGE/node_modules/replacement"
}
pm2() {
  echo "$*" >> "$BACKEND_DIR/pm2-calls"
  if [[ "$1" == stop ]]; then [[ -f "$BACKEND_DIR/node_modules/original" ]]; fi
}
''' + section + r'''
[[ -f "$BACKEND_DIR/node_modules/replacement" ]]
[[ -f "$PREVIOUS_DEPENDENCIES/original" ]]
[[ "$CASE" != after_swap_failure ]]
OMS_PAUSED=false
'''
        result = subprocess.run(["bash", "-c", script], env={**os.environ, "CASE": case,
            "BACKEND_DIR": str(backend), "FRONTEND_DIR": str(frontend)}, capture_output=True, text=True)
        assert (result.returncode == 0) == (case == "success"), (case, result.stderr)
        assert (backend / "node_modules" / ("replacement" if case == "success" else "original")).exists(), case
        calls = (backend / "pm2-calls").read_text() if (backend / "pm2-calls").exists() else ""
        if case in ("install_failure", "frontend_failure"):
            assert not calls, (case, calls)
        if case == "after_swap_failure":
            assert "restart oms-backend" in calls and "restart oms-worker" in calls
        assert not list(backend.glob(".deploy-deps.*")), case
        print(f"PASS: {case}")
