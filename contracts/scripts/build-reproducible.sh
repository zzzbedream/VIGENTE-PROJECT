#!/usr/bin/env bash
# Reproducible wasm build — closes finding M-05 (audit/10_SECURITY_REVIEW_REPORT.md).
#
# The problem it solves: rustc embeds the absolute path of the crate and of
# $CARGO_HOME into the binary (they surface in panic messages). Two machines with
# different usernames therefore produced different wasm hashes from identical
# source, so nobody could verify that the wasm on the ledger came from this repo.
#
# The fix: remap both prefixes to fixed virtual paths (/cargo, /src) so the output
# depends on the source and the toolchain, not on who built it. The toolchain is
# pinned in rust-toolchain.toml — both are required; either alone is not enough.
#
# Usage:  bash contracts/scripts/build-reproducible.sh [contract ...]
# Output: sha256 of the raw and optimized wasm for each contract.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"

# rustc matches the path as the OS spells it: on Windows that is a backslash path.
to_native() { command -v cygpath >/dev/null 2>&1 && cygpath -w "$1" || echo "$1"; }
NATIVE_CARGO="$(to_native "$CARGO_HOME_DIR")"
NATIVE_REPO="$(to_native "$REPO_ROOT")"

export RUSTFLAGS="--remap-path-prefix=${NATIVE_CARGO}=/cargo --remap-path-prefix=${NATIVE_REPO}=/src"
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-0}"

TARGET="wasm32-unknown-unknown"   # the target the deployed contracts use
CONTRACTS=("$@")
if [ ${#CONTRACTS[@]} -eq 0 ]; then
  CONTRACTS=(margin-controller oracle-aggregator vigente-badge)
fi

echo "toolchain: $(rustc --version)"
echo "target:    $TARGET"
echo "rustflags: $RUSTFLAGS"
echo

for c in "${CONTRACTS[@]}"; do
  d="$REPO_ROOT/contracts/$c"
  [ -d "$d" ] || { echo "skip $c (no such crate)"; continue; }
  ( cd "$d" && cargo build --target "$TARGET" --release >/dev/null 2>&1 )
  wasm="$(ls "$d/target/$TARGET/release/"*.wasm 2>/dev/null | grep -v optimized | head -1)"
  [ -n "$wasm" ] || { echo "$c: no wasm produced"; continue; }
  stellar contract optimize --wasm "$wasm" >/dev/null 2>&1 || true
  opt="${wasm%.wasm}.optimized.wasm"
  raw_hash="$(sha256sum "$wasm" | cut -d' ' -f1)"
  opt_hash="$([ -f "$opt" ] && sha256sum "$opt" | cut -d' ' -f1 || echo "n/a")"
  printf '%-20s raw=%s\n%-20s opt=%s\n' "$c" "$raw_hash" "" "$opt_hash"
done
