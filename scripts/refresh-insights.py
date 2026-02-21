#!/usr/bin/env python3
"""
Full insight pipeline orchestrator. Designed to run from cron.

Steps:
  1. Fetch latest videos for each channel in sources.json (catch-up-channel.py)
  2. Extract insights from new transcripts (bulk-ingest-loop.py)
  3. Deduplicate insights (dedup-insights.py)
  4. Regenerate HTML dashboard (generate-dashboard.py)

Each step runs as a subprocess so failures don't cascade.
Idempotent: safe to run multiple times.
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SOURCES_FILE = os.path.join(PROJECT_ROOT, '.claude', 'skills', 'youtube-planner', 'sources.json')
DB_PATH = os.path.join(PROJECT_ROOT, 'store', 'messages.db')
YOUTUBE_DIR = os.path.join(PROJECT_ROOT, 'workspace', 'group', 'youtube')
CATCH_UP_SCRIPT = os.path.join(PROJECT_ROOT, '.claude', 'skills', 'youtube-planner', 'catch-up-channel.py')
BULK_INGEST_SCRIPT = os.path.join(PROJECT_ROOT, 'scripts', 'bulk-ingest-loop.py')
DEDUP_SCRIPT = os.path.join(PROJECT_ROOT, 'scripts', 'dedup-insights.py')
DASHBOARD_SCRIPT = os.path.join(PROJECT_ROOT, '.claude', 'skills', 'youtube-planner', 'generate-dashboard.py')
LOG_FILE = '/tmp/refresh-insights.log'

DEFAULT_LOOKBACK_DAYS = 30


def log(msg):
    """Print timestamped log message."""
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line)


def run_step(name, cmd, env=None, timeout=None, stream=False):
    """Run a subprocess step, returning (success, duration_seconds).

    If stream=True, stdout is printed line-by-line in real time instead of
    being buffered until the process exits.
    """
    log(f'START: {name}')
    start = time.time()
    try:
        if stream:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
                bufsize=1,
            )
            for line in proc.stdout:
                log(f'  {line.rstrip()}')
            proc.wait(timeout=timeout)
            duration = time.time() - start
            if proc.returncode != 0:
                stderr = proc.stderr.read()
                log(f'FAIL: {name} (exit {proc.returncode}, {duration:.0f}s)')
                if stderr.strip():
                    for err_line in stderr.strip().split('\n'):
                        log(f'  STDERR: {err_line}')
                return False, duration
            log(f'DONE: {name} ({duration:.0f}s)')
            return True, duration
        else:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                env=env,
                timeout=timeout,
            )
            duration = time.time() - start
            if result.stdout.strip():
                for line in result.stdout.strip().split('\n'):
                    log(f'  {line}')
            if result.returncode != 0:
                log(f'FAIL: {name} (exit {result.returncode}, {duration:.0f}s)')
                if result.stderr.strip():
                    for line in result.stderr.strip().split('\n'):
                        log(f'  STDERR: {line}')
                return False, duration
            log(f'DONE: {name} ({duration:.0f}s)')
            return True, duration
    except subprocess.TimeoutExpired:
        duration = time.time() - start
        log(f'TIMEOUT: {name} ({duration:.0f}s)')
        return False, duration
    except FileNotFoundError:
        duration = time.time() - start
        log(f'NOT FOUND: {name} - command not found: {cmd[0]}')
        return False, duration


def main():
    start_time = time.time()
    log('=== Refresh Insights Pipeline ===')

    # 1. Validate TRANSCRIPT_API_KEY
    api_key = os.environ.get('TRANSCRIPT_API_KEY')
    if not api_key:
        log('ERROR: TRANSCRIPT_API_KEY environment variable not set')
        sys.exit(1)

    # 2. Read sources.json
    if not os.path.exists(SOURCES_FILE):
        log(f'ERROR: sources file not found: {SOURCES_FILE}')
        sys.exit(1)

    with open(SOURCES_FILE) as f:
        config = json.load(f)

    channels = config.get('sources', [])
    lookback_days = config.get('lookback_days', DEFAULT_LOOKBACK_DAYS)

    if not channels:
        log('ERROR: no channels found in sources.json')
        sys.exit(1)

    log(f'Channels: {len(channels)}, lookback: {lookback_days} days')

    # Inherit current env and pass through TRANSCRIPT_API_KEY
    env = os.environ.copy()

    # 3. Fetch latest videos for each channel
    fetch_ok = 0
    fetch_fail = 0

    for i, channel in enumerate(channels, 1):
        log(f'[{i}/{len(channels)}] Fetching: {channel}')
        success, _ = run_step(
            f'catch-up {channel}',
            ['python3', CATCH_UP_SCRIPT, channel, str(lookback_days)],
            env=env,
            timeout=120,
        )
        if success:
            fetch_ok += 1
        else:
            fetch_fail += 1

    log(f'Fetch complete: {fetch_ok} ok, {fetch_fail} failed')

    # 4. Bulk ingest new transcripts into insights (stream output for progress)
    success, _ = run_step(
        'bulk-ingest-loop',
        ['python3', BULK_INGEST_SCRIPT],
        env=env,
        timeout=7200,  # 2 hours max for bulk ingest
        stream=True,
    )
    ingest_ok = success

    # 5. Deduplicate insights
    success, _ = run_step(
        'dedup-insights',
        ['python3', DEDUP_SCRIPT],
        env=env,
        timeout=1800,  # 30 minutes max
    )
    dedup_ok = success

    # 6. Regenerate dashboard
    success, _ = run_step(
        'generate-dashboard',
        ['python3', DASHBOARD_SCRIPT],
        env=env,
        timeout=60,
    )
    dashboard_ok = success

    # 7. Summary
    total_time = time.time() - start_time
    summary = (
        f'\n=== Pipeline Complete ({total_time:.0f}s) ===\n'
        f'Channels fetched: {fetch_ok}/{len(channels)}\n'
        f'Bulk ingest: {"ok" if ingest_ok else "FAILED"}\n'
        f'Dedup: {"ok" if dedup_ok else "FAILED"}\n'
        f'Dashboard: {"ok" if dashboard_ok else "FAILED"}\n'
    )
    log(summary)

    # Write summary to log file
    try:
        with open(LOG_FILE, 'a') as f:
            ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            f.write(f'\n--- {ts} ---\n')
            f.write(f'Channels: {fetch_ok}/{len(channels)} ok\n')
            f.write(f'Ingest: {"ok" if ingest_ok else "FAILED"}\n')
            f.write(f'Dedup: {"ok" if dedup_ok else "FAILED"}\n')
            f.write(f'Dashboard: {"ok" if dashboard_ok else "FAILED"}\n')
            f.write(f'Total time: {total_time:.0f}s\n')
    except IOError as e:
        log(f'WARNING: could not write to log file: {e}')

    # After first sync, reduce lookback to 1 day to save API tokens.
    # Cron runs at least daily so 1 day is sufficient for subsequent runs.
    if lookback_days > 1:
        config['lookback_days'] = 1
        with open(SOURCES_FILE, 'w') as f:
            json.dump(config, f, indent=2)
            f.write('\n')
        log(f'Lookback reduced from {lookback_days}d to 1d for future cron runs')

    # Exit non-zero if any critical step failed
    if fetch_fail == len(channels):
        log('All channel fetches failed')
        sys.exit(1)
    if not ingest_ok:
        log('Bulk ingest failed')
        sys.exit(1)

    sys.exit(0)


if __name__ == '__main__':
    main()
