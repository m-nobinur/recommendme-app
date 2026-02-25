#!/usr/bin/env bash
set -euo pipefail

echo "Running memory smoke tests..."
bun test ./src/lib/memory/*.test.ts

echo "Memory smoke tests passed."
