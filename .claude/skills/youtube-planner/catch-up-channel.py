#!/usr/bin/env python3
"""
Catch up a single channel with recent videos.
Usage: python3 catch-up-channel.py @ChannelHandle [lookback_days]
"""

import hashlib
import os
import sqlite3
import sys
import json
import subprocess
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

DB_PATH = Path('/Users/allenharper/nanoclaw/store/messages.db')


def sanitize(text):
    """Convert text to filesystem-safe slug"""
    return '-'.join(filter(None, (''.join(c if c.isalnum() or c == '-' else '-' for c in text.lower())).split('-')))[:80]


def is_insight_indexed(vid):
    """Check if video is already indexed in insight_sources (saves API tokens)."""
    if not DB_PATH.exists():
        return False
    try:
        url = f'https://www.youtube.com/watch?v={vid}'
        url_hash = hashlib.sha256(url.encode()).hexdigest()
        db = sqlite3.connect(str(DB_PATH))
        row = db.execute('SELECT 1 FROM insight_sources WHERE id = ?', (url_hash,)).fetchone()
        db.close()
        return row is not None
    except Exception:
        return False

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 catch-up-channel.py @ChannelHandle [lookback_days]")
        sys.exit(1)

    channel = sys.argv[1]
    lookback_days = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    api_key = os.environ.get('TRANSCRIPT_API_KEY')
    if not api_key:
        print("Error: TRANSCRIPT_API_KEY not set")
        sys.exit(1)

    # Setup paths (use absolute path to nanoclaw workspace)
    nanoclaw_root = Path('/Users/allenharper/nanoclaw')
    base = nanoclaw_root / 'workspace' / 'group' / 'youtube'
    base.mkdir(parents=True, exist_ok=True)

    # Fetch latest videos from channel
    print(f"Fetching latest videos from {channel}...")
    result = subprocess.run([
        'curl', '-s',
        f'https://transcriptapi.com/api/v2/youtube/channel/latest?channel={channel}',
        '-H', f'Authorization: Bearer {api_key}'
    ], capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error fetching videos: {result.stderr}")
        sys.exit(1)

    data = json.loads(result.stdout)
    if 'error' in data:
        print(f"API Error: {data['error']}")
        sys.exit(1)

    videos = data.get('results', [])
    channel_name = sanitize(channel.lstrip('@'))

    # Filter to lookback window
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    filtered = []
    for v in videos:
        pub_str = v.get('published', '')
        if pub_str:
            pub_date = datetime.fromisoformat(pub_str.replace('Z', '+00:00'))
            if pub_date >= cutoff:
                filtered.append(v)

    # Skip Shorts (videoId format or duration hint from API)
    non_shorts = []
    for v in filtered:
        # YouTube Shorts URLs contain /shorts/ — some APIs flag this
        link = v.get('link', '')
        if '/shorts/' in link:
            continue
        non_shorts.append(v)

    url_shorts = len(filtered) - len(non_shorts)
    print(f"Found {len(filtered)} videos from last {lookback_days} days"
          + (f" ({url_shorts} shorts skipped)" if url_shorts else ""))

    # Process each video
    transcript_count = 0
    metadata_count = 0
    skipped_indexed = 0
    skipped_shorts = 0

    for i, video in enumerate(non_shorts, 1):
        vid = video.get('videoId')
        title = video.get('title', 'untitled')
        views = video.get('viewCount', 0)
        published = video.get('published', '')

        slug = sanitize(title)
        pub_date = datetime.fromisoformat(published.replace('Z', '+00:00'))
        date_str = pub_date.strftime('%Y-%m-%d')

        video_dir = base / date_str / channel_name / slug
        metadata_dir = video_dir / 'metadata'
        metadata_dir.mkdir(parents=True, exist_ok=True)

        print(f"  [{i}/{len(non_shorts)}] → {channel_name}/{slug}")

        # Skip transcript fetch if already indexed for insights (saves API tokens)
        if is_insight_indexed(vid):
            print(f"    Already indexed — skipping transcript")
            skipped_indexed += 1
        else:
            # Check transcript cache on disk
            cache_search = subprocess.run([
                'find', str(base), '-path', f'*/{channel_name}/{slug}/transcript.txt'
            ], capture_output=True, text=True)

            if not cache_search.stdout.strip():
                print(f"    Fetching transcript...")
                fetch_result = subprocess.run([
                    'curl', '-s',
                    f'https://transcriptapi.com/api/v2/youtube/transcript?video_url={vid}&format=json&include_timestamp=true&send_metadata=true',
                    '-H', f'Authorization: Bearer {api_key}'
                ], capture_output=True, text=True)

                if fetch_result.returncode == 0:
                    try:
                        transcript_data = json.loads(fetch_result.stdout)
                        if 'error' not in transcript_data:
                            # Check duration — skip shorts (< 120s)
                            segments = transcript_data.get('transcript', [])
                            duration = segments[-1].get('start', 0) if segments else 0
                            if duration < 120:
                                print(f"    Short ({int(duration)}s) — skipping")
                                skipped_shorts += 1
                                time.sleep(0.25)
                            else:
                                with open(video_dir / 'transcript.json', 'w') as f:
                                    json.dump(transcript_data, f, indent=2)
                                with open(video_dir / 'transcript.txt', 'w') as f:
                                    for item in segments:
                                        start = item.get('start', 0)
                                        text = item.get('text', '')
                                        f.write(f"[{start}s] {text}\n")
                                transcript_count += 1
                                time.sleep(0.25)  # Rate limiting
                        else:
                            print(f"    Error: {transcript_data.get('error')}")
                    except json.JSONDecodeError:
                        print(f"    Error: Invalid JSON response")
            else:
                print(f"    Using cached transcript")

        # Compute duration from transcript if available
        duration_seconds = None
        transcript_file = video_dir / 'transcript.json'
        if transcript_file.exists():
            try:
                tdata = json.load(open(transcript_file))
                segs = tdata.get('transcript', [])
                if segs:
                    last = segs[-1]
                    duration_seconds = round(last.get('start', 0) + last.get('duration', 0))
            except Exception:
                pass

        # Always save metadata snapshot for VPH tracking
        timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d-%H%M')
        metadata_file = metadata_dir / f'{timestamp}.json'

        metadata = {
            'video_id': vid,
            'title': title,
            'author_name': channel,
            'published': published,
            'viewCount': views,
            'thumbnail_url': f'https://i.ytimg.com/vi/{vid}/mqdefault.jpg',
            'link': f'https://www.youtube.com/watch?v={vid}'
        }
        if duration_seconds is not None:
            metadata['duration_seconds'] = duration_seconds

        with open(metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)

        metadata_count += 1

    print(f"\n✓ Catch-up complete for {channel}")
    print(f"  Transcripts fetched: {transcript_count}")
    print(f"  Shorts skipped: {url_shorts + skipped_shorts}" + (f" ({skipped_shorts} wasted API credits)" if skipped_shorts else ""))
    print(f"  Already indexed: {skipped_indexed}")
    print(f"  Metadata snapshots: {metadata_count}")
    print(f"  API credits used: {transcript_count}")

if __name__ == '__main__':
    main()
