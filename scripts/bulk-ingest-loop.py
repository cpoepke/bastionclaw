#!/usr/bin/env python3
"""
Bulk YouTube transcript ingestion via IPC message injection.

First video: scheduled task starts a container.
Subsequent videos: IPC input messages sent to the running container.
Each video gets a fresh query context while reusing the same container.

Dedup: happens in a separate post-ingest pass (dedup-insights.py).
"""

import sqlite3
import hashlib
import json
import os
import subprocess
import time
import glob
import sys
from datetime import datetime, timezone

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)
from urllib.parse import urlparse, parse_qs

PROJECT_ROOT = os.path.join(os.path.dirname(__file__), '..')
DB_PATH = os.path.join(PROJECT_ROOT, 'store', 'messages.db')
YOUTUBE_DIR = os.path.join(PROJECT_ROOT, 'workspace', 'group', 'youtube')
IPC_INPUT_DIR = os.path.join(PROJECT_ROOT, 'data', 'ipc', 'main', 'input')
SESSION_DIR = os.path.join(PROJECT_ROOT, 'data', 'sessions', 'main', '.claude', 'projects', '-workspace-group')
CHAT_JID = 'tg:6246700152'
GROUP_FOLDER = 'main'


def normalize_youtube_url(url: str) -> str:
    """Normalize YouTube URL to canonical form, matching hashSourceUrl in db.ts."""
    parsed = urlparse(url)
    if 'youtube.com' in parsed.hostname or 'youtu.be' in parsed.hostname:
        if 'youtu.be' in parsed.hostname:
            video_id = parsed.path.strip('/')
        elif '/shorts/' in parsed.path:
            video_id = parsed.path.split('/shorts/')[-1].strip('/')
        else:
            video_id = parse_qs(parsed.query).get('v', [''])[0]
        if video_id:
            return f'https://www.youtube.com/watch?v={video_id}'
    return url


def hash_url(url: str) -> str:
    """SHA-256 hash of normalized URL."""
    normalized = normalize_youtube_url(url)
    return hashlib.sha256(normalized.encode()).hexdigest()


def fresh_db():
    """Open a fresh DB connection (avoids stale reads from SQLite WAL)."""
    return sqlite3.connect(DB_PATH)


def is_indexed(db, video_id: str) -> bool:
    """Check if a YouTube video is already indexed."""
    url = f'https://www.youtube.com/watch?v={video_id}'
    url_hash = hash_url(url)
    row = db.execute('SELECT id FROM insight_sources WHERE id = ?', (url_hash,)).fetchone()
    return row is not None


def cleanup_ingest_tasks(db):
    """Remove all ingest-* scheduled tasks to prevent stale task interference."""
    deleted = db.execute("DELETE FROM scheduled_tasks WHERE id LIKE 'ingest-%'").rowcount
    db.commit()
    if deleted:
        print(f'  Cleaned {deleted} stale ingest tasks')


def cleanup_ipc_input():
    """Remove any stale IPC input files."""
    if os.path.isdir(IPC_INPUT_DIR):
        for f in os.listdir(IPC_INPUT_DIR):
            fpath = os.path.join(IPC_INPUT_DIR, f)
            if os.path.isfile(fpath):
                os.remove(fpath)


def clear_sessions():
    """Remove accumulated session files AND DB session ID.

    The container resumes the latest session on startup. After many videos,
    the session context grows too large. Clearing forces a fresh session.
    Also clears the session ID from the sessions table so the host doesn't
    pass the old ID to the next container.
    """
    if os.path.isdir(SESSION_DIR):
        removed = 0
        for f in os.listdir(SESSION_DIR):
            fpath = os.path.join(SESSION_DIR, f)
            if os.path.isfile(fpath):
                os.remove(fpath)
                removed += 1
        if removed:
            print(f'  Cleared {removed} session files')

    # Clear stored session ID so host doesn't try to resume it
    db = fresh_db()
    db.execute("DELETE FROM sessions WHERE group_folder = ?", (GROUP_FOLDER,))
    db.commit()
    db.close()


def kill_container():
    """Force-kill any running bastionclaw container for the main group."""
    try:
        result = subprocess.run(
            ['container', 'list'], capture_output=True, text=True, timeout=10
        )
        for line in result.stdout.strip().split('\n'):
            if 'bastionclaw-main-' in line:
                name = line.split()[0]
                print(f'  Killing container: {name}')
                subprocess.run(
                    ['container', 'stop', name], capture_output=True, timeout=15
                )
                time.sleep(2)  # Let host detect exit
                clear_sessions()
                return True
    except (subprocess.TimeoutExpired, FileNotFoundError, IndexError):
        pass
    return False


def find_all_videos():
    """Find all transcript.json files and extract video metadata."""
    videos = []
    for transcript_path in sorted(glob.glob(os.path.join(YOUTUBE_DIR, '**', 'transcript.json'), recursive=True)):
        video_dir = os.path.dirname(transcript_path)

        if 'recommended' in video_dir.lower():
            continue

        metadata_dir = os.path.join(video_dir, 'metadata')
        metadata_files = glob.glob(os.path.join(metadata_dir, '*.json')) if os.path.isdir(metadata_dir) else []

        video_id = None
        title = None

        if metadata_files:
            try:
                with open(metadata_files[0]) as f:
                    meta = json.load(f)
                    video_id = meta.get('video_id')
                    title = meta.get('title', 'Unknown')
            except (json.JSONDecodeError, IOError):
                pass

        if not video_id:
            try:
                with open(transcript_path) as f:
                    data = json.load(f)
                    video_id = data.get('video_id')
            except (json.JSONDecodeError, IOError):
                pass

        if not video_id:
            print(f'  SKIP (no video_id): {video_dir}')
            continue

        # Skip YouTube Shorts (< 120s duration)
        try:
            with open(transcript_path) as f:
                tdata = json.load(f)
            segments = tdata.get('segments', tdata.get('transcript', []))
            if isinstance(segments, list) and segments:
                last_start = segments[-1].get('start', segments[-1].get('offset', 0))
                if last_start < 120:
                    continue
        except (json.JSONDecodeError, IOError, IndexError, TypeError):
            pass

        rel_path = os.path.relpath(video_dir, PROJECT_ROOT)
        container_path = f'/workspace/project/{rel_path}'

        videos.append({
            'video_id': video_id,
            'title': title,
            'host_dir': video_dir,
            'container_dir': container_path,
        })

    return videos


def build_prompt(video):
    """Build the ingest prompt for a single video."""
    container_dir = video['container_dir']
    return f"""Ingest ONE YouTube video. Extract insights and add them all as new.

Video directory: {container_dir}
- Read {container_dir}/metadata/*.json for title, author, video_id
- Read {container_dir}/transcript.json for the full transcript

Steps:
1. Read metadata and transcript
2. Extract 10-15 insights from the transcript
3. For EACH insight: call add_insight directly. Pass source_metadata as a JSON string with author, published, viewCount, videoId from the metadata file.
4. Do NOT call search_insights or link_insight_source — dedup happens in a separate pass.
5. Do NOT call refresh_memory_index — it will be done after all videos are processed.
6. Send a brief summary via send_message: title, # insights added

Insight quality guidelines:
- text: A GENERALIZABLE principle or thesis (10-20 words). Write it as a universal truth that could appear in multiple sources, NOT specific to this video. Bad: "Dan Koe says creators should build one-person businesses". Good: "One-person businesses leverage individual taste and perspective as unfair advantages over scaled competitors".
- detail: 2-3 sentences expanding with specific context from this video.
- category: One of: strategy, technical, creativity, productivity, business, psychology, trend, career
- context: Direct quote from the transcript supporting this insight.
- timestamp_ref: MM:SS from the transcript start field.

MINIMUM 10 insights required. Read the full transcript thoroughly."""


def send_ipc_message(text):
    """Write an IPC input message for the running container to pick up."""
    os.makedirs(IPC_INPUT_DIR, exist_ok=True)
    filename = f'{int(time.time() * 1000)}-{os.urandom(3).hex()}.json'
    filepath = os.path.join(IPC_INPUT_DIR, filename)
    tmp = filepath + '.tmp'
    with open(tmp, 'w') as f:
        json.dump({'type': 'message', 'text': text}, f)
    os.rename(tmp, filepath)


def start_container_via_task(db, video):
    """Schedule a task to start a container. Cleans prior ingest tasks first."""
    cleanup_ingest_tasks(db)

    task_id = f'ingest-{video["video_id"]}'
    now = datetime.now(timezone.utc).isoformat()
    prompt = build_prompt(video)

    db.execute(
        '''INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status, created_at, context_mode)
        VALUES (?, ?, ?, ?, 'once', ?, ?, 'active', ?, 'group')''',
        (task_id, GROUP_FOLDER, CHAT_JID, prompt, now, now, now)
    )
    db.commit()
    print(f'  Scheduled task: {task_id}')


def wait_for_source_indexed(video_id, max_wait=600):
    """Wait until the video appears in insight_sources.

    Returns (db, seconds_waited). seconds_waited=-1 on timeout.
    """
    waited = 0
    while waited < max_wait:
        time.sleep(3)
        waited += 3

        db = fresh_db()
        if is_indexed(db, video_id):
            return db, waited
        if waited % 60 == 0:
            count = db.execute('SELECT COUNT(*) FROM insight_sources').fetchone()[0]
            print(f'  Waiting... ({waited}s, {count} total sources)')
        db.close()

    return fresh_db(), -1  # timeout


def main():
    print('=== Bulk YouTube Ingest Loop ===')
    print()

    db = fresh_db()

    # Clean up any stale ingest tasks from previous runs
    cleanup_ingest_tasks(db)
    cleanup_ipc_input()

    videos = find_all_videos()
    print(f'Found {len(videos)} videos with transcripts')

    unindexed = [v for v in videos if not is_indexed(db, v['video_id'])]
    print(f'Already indexed: {len(videos) - len(unindexed)}')
    print(f'To process: {len(unindexed)}')
    print()

    if not unindexed:
        print('All videos already indexed!')
        return

    processed = 0
    errors = 0
    container_started = False
    videos_in_session = 0
    RECYCLE_EVERY = 8  # Recycle container to prevent session accumulation

    for i, video in enumerate(unindexed):
        pct = int((i / len(unindexed)) * 100)
        print(f'[{i+1}/{len(unindexed)}] ({pct}%) {video["title"] or video["video_id"]}')

        try:
            # Recycle container every N videos to prevent session bloat
            if container_started and videos_in_session >= RECYCLE_EVERY:
                print(f'  Recycling container after {videos_in_session} videos')
                kill_container()
                cleanup_ipc_input()
                cleanup_ingest_tasks(db)
                time.sleep(5)
                container_started = False
                videos_in_session = 0

            if not container_started:
                # Bootstrap: start container via scheduled task
                clear_sessions()
                start_container_via_task(db, video)
                container_started = True
                videos_in_session = 1
            else:
                # Inject into running container via IPC
                prompt = build_prompt(video)
                send_ipc_message(prompt)
                print(f'  Sent IPC message')
                videos_in_session += 1

            db_new, waited = wait_for_source_indexed(video['video_id'])
            db.close()
            db = db_new

            if waited < 0:
                pct = int(((i + 1) / len(unindexed)) * 100)
                print(f'  TIMEOUT after 600s — killing container ({pct}% done)')
                errors += 1

                # Kill the running container so host releases the group queue
                kill_container()
                cleanup_ipc_input()
                cleanup_ingest_tasks(db)

                # Wait for host to detect container exit and release queue
                time.sleep(5)

                container_started = False
                videos_in_session = 0
                continue
            else:
                processed += 1
                # Wait for agent to finish writing all insights (stable insight count)
                db.close()
                last_count = 0
                for _ in range(20):  # up to 60s
                    time.sleep(3)
                    db = fresh_db()
                    cur_count = db.execute('SELECT COUNT(*) FROM insights').fetchone()[0]
                    if cur_count == last_count and last_count > 0:
                        break  # insights stopped growing — query done
                    last_count = cur_count
                    db.close()
                else:
                    db = fresh_db()

                # Fresh read for accurate link count after stabilization
                db.close()
                db = fresh_db()
                links = db.execute(
                    '''SELECT COUNT(*) FROM insight_source_links l
                    JOIN insight_sources s ON s.id = l.source_id
                    WHERE s.url LIKE ?''',
                    (f'%{video["video_id"]}%',)
                ).fetchone()[0]
                pct = int(((i + 1) / len(unindexed)) * 100)
                print(f'  Indexed in {waited}s: {links} insights linked ({pct}% done)')

        except KeyboardInterrupt:
            print('\nInterrupted by user')
            break
        except Exception as e:
            print(f'  ERROR: {e}')
            errors += 1

        if (i + 1) % 10 == 0:
            total_insights = db.execute('SELECT COUNT(*) FROM insights').fetchone()[0]
            total_sources = db.execute('SELECT COUNT(*) FROM insight_sources').fetchone()[0]
            multi = db.execute('SELECT COUNT(*) FROM insights WHERE source_count > 1').fetchone()[0]
            print(f'\n  === Progress: {i+1}/{len(unindexed)} videos, {total_insights} insights, {total_sources} sources, {multi} multi-source ===\n')

    # Cleanup
    cleanup_ingest_tasks(db)

    # Final summary
    total_insights = db.execute('SELECT COUNT(*) FROM insights').fetchone()[0]
    total_sources = db.execute('SELECT COUNT(*) FROM insight_sources').fetchone()[0]
    multi = db.execute('SELECT COUNT(*) FROM insights WHERE source_count > 1').fetchone()[0]
    print(f'\n=== DONE ===')
    print(f'Processed: {processed}/{len(unindexed)}')
    print(f'Errors: {errors}')
    print(f'Total insights: {total_insights}')
    print(f'Total sources: {total_sources}')
    print(f'Multi-source insights: {multi}')

    db.close()


if __name__ == '__main__':
    main()
