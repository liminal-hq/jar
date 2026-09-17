#!/usr/bin/env bash
# Regenerates the TypeScript types the frontend imports from `jar-protocol`.
# Run this after changing any `#[ts(export)]`-annotated type in
# `crates/jar-protocol/src/`. Output location is controlled by
# `TS_RS_EXPORT_DIR` in `.cargo/config.toml` — do not hand-edit anything
# under `apps/jar/src/domain/protocol/generated/`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
cargo test -p jar-protocol
echo "Regenerated apps/jar/src/domain/protocol/generated/"
