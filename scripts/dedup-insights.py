#!/usr/bin/env python3
"""
Post-ingest dedup pass for insights.

For each insight, queries qmd for semantically similar insights.
When a match is found (high score + different source), merges them:
- Keeps the older insight (first_seen)
- Transfers all source links from the duplicate to the keeper
- Updates source_count on the keeper
- Deletes the duplicate insight + its markdown file

Run after bulk ingestion is complete:
  python3 scripts/dedup-insights.py [--threshold 0.65] [--dry-run]
"""

import sqlite3
import subprocess
import json
import os
import sys
import argparse
import time

sys.stdout.reconfigure(line_buffering=True)

PROJECT_ROOT = os.path.join(os.path.dirname(__file__), '..')
DB_PATH = os.path.join(PROJECT_ROOT, 'store', 'messages.db')
INSIGHTS_DIR = os.path.join(PROJECT_ROOT, 'groups', 'main', 'insights')
QMD_BIN = os.path.join(PROJECT_ROOT, 'node_modules', 'qmd', 'qmd')


def qmd_query(text, threshold, limit=10):
    """Run qmd query scoped to insights collection only."""
    try:
        result = subprocess.run(
            [QMD_BIN, 'query', '--json', '-c', 'main',
             '--min-score', str(threshold), '-n', str(limit), text],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        pass
    return []


def qmd_update_embed():
    """Refresh qmd index after deletions."""
    try:
        subprocess.run([QMD_BIN, 'update'], capture_output=True, timeout=60)
        subprocess.run([QMD_BIN, 'embed'], capture_output=True, timeout=120)
        print('  qmd index refreshed')
    except (subprocess.TimeoutExpired, FileNotFoundError):
        print('  WARNING: qmd refresh failed')


def extract_insight_id(file_field):
    """Extract insight UUID from qmd file field like qmd://main/insights/{id}.md"""
    import re
    match = re.search(r'insights/([a-f0-9-]+)\.md', file_field or '')
    return match.group(1) if match else None


def main():
    parser = argparse.ArgumentParser(description='Deduplicate insights via semantic search')
    parser.add_argument('--threshold', type=float, default=0.65,
                        help='Minimum qmd score to consider a match (default: 0.65)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show what would be merged without making changes')
    parser.add_argument('--reset', action='store_true',
                        help='Clear all dedup_checked_at flags and re-check everything')
    args = parser.parse_args()

    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    # Ensure dedup_checked_at column exists
    cols = [r[1] for r in db.execute('PRAGMA table_info(insights)').fetchall()]
    if 'dedup_checked_at' not in cols:
        db.execute('ALTER TABLE insights ADD COLUMN dedup_checked_at TEXT')
        db.commit()
        print('Added dedup_checked_at column')
    elif args.reset:
        db.execute('UPDATE insights SET dedup_checked_at = NULL')
        db.commit()
        print('Reset all dedup_checked_at flags')

    # Get unchecked insights sorted by first_seen (oldest first — keepers)
    all_count = db.execute('SELECT COUNT(*) FROM insights').fetchone()[0]
    insights = db.execute(
        'SELECT id, text, source_count, first_seen, category FROM insights WHERE dedup_checked_at IS NULL ORDER BY first_seen ASC'
    ).fetchall()
    already_checked = all_count - len(insights)

    print(f'Total insights: {all_count}')
    print(f'Already checked: {already_checked}')
    print(f'To process: {len(insights)}')
    print(f'Threshold: {args.threshold}')
    print(f'Dry run: {args.dry_run}')
    print()

    # Track which insights have been deleted (merged into another)
    deleted = set()
    # Track pairs we've already evaluated to avoid checking A↔B from both sides
    seen_pairs = set()
    merge_count = 0
    source_links_moved = 0
    start_time = time.time()

    for i, insight in enumerate(insights):
        if insight['id'] in deleted:
            continue

        # Query qmd for similar insights (scoped to main collection, pre-filtered by threshold)
        hits = qmd_query(insight['text'], args.threshold)

        for hit in hits:
            file_field = hit.get('file', hit.get('docid', ''))
            match_id = extract_insight_id(file_field)
            score = hit.get('score', 0)

            if not match_id:
                continue
            if match_id == insight['id']:
                continue  # skip self
            if match_id in deleted:
                continue  # already merged

            # Skip pairs we've already evaluated (regardless of direction)
            pair = (min(insight['id'], match_id), max(insight['id'], match_id))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)

            if score < args.threshold:
                continue

            # Found a match — get its details
            match = db.execute('SELECT id, text, source_count, first_seen FROM insights WHERE id = ?',
                               (match_id,)).fetchone()
            if not match:
                continue

            # Decide keeper vs duplicate: keep the one with more sources, or older if tied
            if insight['source_count'] > match['source_count']:
                keeper_id, dup_id = insight['id'], match['id']
            elif match['source_count'] > insight['source_count']:
                keeper_id, dup_id = match['id'], insight['id']
            elif insight['first_seen'] <= match['first_seen']:
                keeper_id, dup_id = insight['id'], match['id']
            else:
                keeper_id, dup_id = match['id'], insight['id']

            keeper_text = insight['text'] if keeper_id == insight['id'] else match['text']
            dup_text = match['text'] if keeper_id == insight['id'] else insight['text']

            print(f'[{merge_count+1}] MERGE (score={score:.2f})')
            print(f'  KEEP:   {keeper_text[:80]}')
            print(f'  DELETE: {dup_text[:80]}')

            if not args.dry_run:
                # Transfer source links from duplicate to keeper
                dup_links = db.execute(
                    'SELECT source_id, context, timestamp_ref FROM insight_source_links WHERE insight_id = ?',
                    (dup_id,)
                ).fetchall()

                for link in dup_links:
                    # Check if keeper already has this source
                    existing = db.execute(
                        'SELECT 1 FROM insight_source_links WHERE insight_id = ? AND source_id = ?',
                        (keeper_id, link['source_id'])
                    ).fetchone()
                    if not existing:
                        db.execute(
                            'INSERT INTO insight_source_links (insight_id, source_id, context, timestamp_ref, linked_at) VALUES (?, ?, ?, ?, datetime("now"))',
                            (keeper_id, link['source_id'], link['context'], link['timestamp_ref'])
                        )
                        source_links_moved += 1

                # Update keeper's source_count
                new_count = db.execute(
                    'SELECT COUNT(*) FROM insight_source_links WHERE insight_id = ?',
                    (keeper_id,)
                ).fetchone()[0]
                db.execute(
                    'UPDATE insights SET source_count = ?, last_seen = datetime("now") WHERE id = ?',
                    (new_count, keeper_id)
                )

                # Delete duplicate
                db.execute('DELETE FROM insight_source_links WHERE insight_id = ?', (dup_id,))
                db.execute('DELETE FROM insights WHERE id = ?', (dup_id,))
                db.commit()

                # Remove markdown file
                md_path = os.path.join(INSIGHTS_DIR, f'{dup_id}.md')
                if os.path.exists(md_path):
                    os.remove(md_path)

            deleted.add(dup_id)
            merge_count += 1

            # If the current insight was the one deleted, stop checking its matches
            if dup_id == insight['id']:
                break

        # Mark this insight as dedup-checked (even if no matches found)
        if not args.dry_run and insight['id'] not in deleted:
            db.execute('UPDATE insights SET dedup_checked_at = datetime("now") WHERE id = ?',
                       (insight['id'],))
            db.commit()

        # Progress
        if (i + 1) % 100 == 0:
            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed
            remaining = (len(insights) - i - 1) / rate
            print(f'  ... {i+1}/{len(insights)}, {merge_count} merges, {elapsed:.0f}s elapsed, ~{remaining:.0f}s remaining')

    # Refresh qmd index after deletions
    if merge_count > 0 and not args.dry_run:
        print('\nRefreshing qmd index...')
        qmd_update_embed()

    # Summary
    remaining = db.execute('SELECT COUNT(*) FROM insights').fetchone()[0]
    multi = db.execute('SELECT COUNT(*) FROM insights WHERE source_count > 1').fetchone()[0]
    sources = db.execute('SELECT COUNT(*) FROM insight_sources').fetchone()[0]

    print(f'\n=== DEDUP COMPLETE ===')
    print(f'Merged: {merge_count} duplicates')
    print(f'Source links moved: {source_links_moved}')
    print(f'Remaining insights: {remaining}')
    print(f'Multi-source insights: {multi}')
    print(f'Total sources: {sources}')
    print(f'Time: {time.time() - start_time:.0f}s')

    db.close()


if __name__ == '__main__':
    main()
