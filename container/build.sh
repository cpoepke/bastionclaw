#!/bin/bash
# Build the NanoClaw agent container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-agent"
TAG="${1:-latest}"

# Auto-detect container runtime
if command -v container &>/dev/null; then
  RUNTIME="container"
elif command -v docker &>/dev/null && docker info &>/dev/null; then
  RUNTIME="docker"
else
  echo "ERROR: No container runtime found."
  echo "  macOS:  Install Apple Container from https://github.com/apple/container/releases"
  echo "  Linux:  Install Docker: curl -fsSL https://get.docker.com | sh"
  exit 1
fi

echo "Building NanoClaw agent container image..."
echo "Runtime: ${RUNTIME}"
echo "Image: ${IMAGE_NAME}:${TAG}"

$RUNTIME build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | $RUNTIME run -i ${IMAGE_NAME}:${TAG}"
