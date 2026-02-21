#!/usr/bin/env python3
"""
Backfill missing transcripts for videos that have metadata but no transcript.json.
Also writes duration_seconds into metadata files after fetching.

Usage: TRANSCRIPT_API_KEY=... python3 scripts/backfill-transcripts.py [--dry-run]
"""

import json
import os
import sys
import subprocess
import time
from pathlib import Path

DRY_RUN = '--dry-run' in sys.argv
BASE = Path('/Users/allenharper/bastionclaw/workspace/group/youtube')


def find_missing():
    """Find video dirs with metadata but no transcript.json."""
    missing = []
    for date_dir in sorted(BASE.iterdir()):
        if not date_dir.is_dir():
            continue
        for channel_dir in date_dir.iterdir():
            if not channel_dir.is_dir():
                continue
            for video_dir in channel_dir.iterdir():
                if not video_dir.is_dir():
                    continue
                meta_dir = video_dir / 'metadata'
                if not meta_dir.exists():
                    continue
                if (video_dir / 'transcript.json').exists():
                    continue
                # Get video_id from first metadata file
                for mf in meta_dir.glob('*.json'):
                    try:
                        meta = json.load(open(mf))
                        vid = meta.get('video_id')
                        if vid:
                            missing.append((video_dir, vid, meta.get('title', '?')))
                    except Exception:
                        pass
                    break
    return missing


def fetch_transcript(video_dir, vid, title, api_key):
    """Fetch transcript and save to disk. Returns duration_seconds or None."""
    result = subprocess.run([
        'curl', '-s',
        f'https://transcriptapi.com/api/v2/youtube/transcript?video_url={vid}&format=json&include_timestamp=true&send_metadata=true',
        '-H', f'Authorization: Bearer {api_key}'
    ], capture_output=True, text=True)

    if result.returncode != 0:
        print(f'    curl error: {result.stderr[:100]}')
        return None

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        print(f'    invalid JSON response')
        return None

    if 'error' in data:
        print(f'    API error: {data["error"]}')
        return None

    segments = data.get('transcript', [])
    if not segments:
        print(f'    empty transcript')
        return None

    last = segments[-1]
    duration = last.get('start', 0) + last.get('duration', 0)

    if duration < 120:
        print(f'    short ({int(duration)}s) — skipping')
        return None

    # Save transcript files
    with open(video_dir / 'transcript.json', 'w') as f:
        json.dump(data, f, indent=2)
    with open(video_dir / 'transcript.txt', 'w') as f:
        for item in segments:
            start = item.get('start', 0)
            text = item.get('text', '')
            f.write(f'[{start}s] {text}\n')

    return round(duration)


def backfill_duration(video_dir, duration_seconds):
    """Write duration_seconds into all metadata files for this video."""
    meta_dir = video_dir / 'metadata'
    for mf in meta_dir.glob('*.json'):
        try:
            meta = json.load(open(mf))
            if 'duration_seconds' not in meta:
                meta['duration_seconds'] = duration_seconds
                with open(mf, 'w') as f:
                    json.dump(meta, f, indent=2)
        except Exception:
            pass


def main():
    api_key = os.environ.get('TRANSCRIPT_API_KEY')
    if not api_key and not DRY_RUN:
        print('Error: TRANSCRIPT_API_KEY not set')
        sys.exit(1)

    missing = find_missing()
    print(f'Found {len(missing)} videos with metadata but no transcript\n')

    if DRY_RUN:
        for video_dir, vid, title in missing:
            rel = video_dir.relative_to(BASE)
            print(f'  {rel}  ({vid})')
        print(f'\nDry run — no changes made. Run without --dry-run to fetch.')
        return

    fetched = 0
    shorts = 0
    errors = 0

    for i, (video_dir, vid, title) in enumerate(missing, 1):
        rel = video_dir.relative_to(BASE)
        print(f'[{i}/{len(missing)}] {rel}')

        duration = fetch_transcript(video_dir, vid, title, api_key)
        if duration is not None:
            backfill_duration(video_dir, duration)
            print(f'    fetched ({duration}s)')
            fetched += 1
        elif duration is None and (video_dir / 'transcript.json').exists():
            # fetch_transcript returned None but didn't write — it was a short or error
            shorts += 1
        else:
            errors += 1

        time.sleep(0.3)  # Rate limiting

    print(f'\nBackfill complete:')
    print(f'  Transcripts fetched: {fetched}')
    print(f'  Shorts/empty: {shorts}')
    print(f'  Errors: {errors}')
    print(f'  API credits used: {fetched + shorts + errors}')


if __name__ == '__main__':
    main()
