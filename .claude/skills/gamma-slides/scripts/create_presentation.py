#!/usr/bin/env python3
"""Create a Gamma presentation from markdown content via the Gamma API."""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error

GAMMA_API_BASE = "https://gamma.app/api/v1"


def get_api_key():
    """Get Gamma API key from environment."""
    key = os.environ.get("GAMMA_API_KEY")
    if not key:
        print(json.dumps({
            "success": False,
            "error": "GAMMA_API_KEY not set. Add it to your .env file. Get a key at gamma.app"
        }), file=sys.stderr)
        sys.exit(1)
    return key


def api_request(endpoint, data=None, method="POST"):
    """Make an API request to Gamma."""
    url = f"{GAMMA_API_BASE}/{endpoint}"
    api_key = get_api_key()

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    if data:
        body = json.dumps(data).encode("utf-8")
    else:
        body = None

    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else str(e)
        print(json.dumps({
            "success": False,
            "error": f"Gamma API error {e.code}: {error_body}"
        }), file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(json.dumps({
            "success": False,
            "error": f"Network error: {str(e)}"
        }), file=sys.stderr)
        sys.exit(1)


def create_presentation(content: str, title: str = None):
    """Create a presentation from markdown content."""
    data = {
        "content": content,
        "format": "markdown"
    }
    if title:
        data["title"] = title

    # Create the presentation
    result = api_request("presentations", data)
    presentation_id = result.get("id")

    if not presentation_id:
        print(json.dumps({
            "success": False,
            "error": "No presentation ID returned from Gamma API",
            "response": result
        }), file=sys.stderr)
        sys.exit(1)

    # Poll for completion
    max_wait = 120  # seconds
    poll_interval = 5  # seconds
    elapsed = 0

    while elapsed < max_wait:
        status = api_request(f"presentations/{presentation_id}", method="GET")
        state = status.get("status", "unknown")

        if state == "completed":
            return {
                "success": True,
                "id": presentation_id,
                "url": status.get("url", f"https://gamma.app/docs/{presentation_id}"),
                "title": status.get("title", title or "Untitled"),
                "slides": status.get("slide_count", "unknown")
            }
        elif state == "failed":
            return {
                "success": False,
                "error": f"Presentation generation failed: {status.get('error', 'unknown')}"
            }

        time.sleep(poll_interval)
        elapsed += poll_interval

    return {
        "success": False,
        "error": f"Timed out after {max_wait}s. Presentation may still be generating.",
        "id": presentation_id
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content", required=True, help="Path to markdown file with slide content")
    parser.add_argument("--title", help="Presentation title (optional)")
    args = parser.parse_args()

    # Read content file
    try:
        with open(args.content) as f:
            content = f.read()
    except FileNotFoundError:
        # If not a file path, treat as inline content
        content = args.content

    if not content.strip():
        print(json.dumps({
            "success": False,
            "error": "Content is empty. Provide markdown content for the slides."
        }), file=sys.stderr)
        sys.exit(1)

    result = create_presentation(content, args.title)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
