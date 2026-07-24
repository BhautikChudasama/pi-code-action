#!/bin/bash
# Wrapper script for git push with retry logic.
set -euo pipefail

MAX_RETRIES=3
RETRY_DELAY=5

for attempt in $(seq 1 $MAX_RETRIES); do
  if git push "$@"; then
    echo "Push succeeded on attempt $attempt"
    exit 0
  fi

  if [ "$attempt" -lt "$MAX_RETRIES" ]; then
    echo "Push failed on attempt $attempt, retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY
  fi
done

echo "Push failed after $MAX_RETRIES attempts"
exit 1
