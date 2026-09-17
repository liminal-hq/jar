# AGENTS.md

## Table of Contents

- [Project Status](#project-status)
- [Localization and Spelling](#localization-and-spelling)
- [Markdown Formatting](#markdown-formatting)
- [Authoring Voice](#authoring-voice)
- [Commit Messages](#commit-messages)
- [Pull Request Titles](#pull-request-titles)
- [Pull Request Content](#pull-request-content)
- [Pull Request Labels](#pull-request-labels)
- [Git Workflow](#git-workflow)
- [Local Tooling](#local-tooling)
- [Frontend Code Conventions](#frontend-code-conventions)
- [Documentation](#documentation)
- [Repository Layout](#repository-layout)
- [Licence and Copyright](#licence-and-copyright)
- [Tauri v2](#tauri-v2)

## Project Status

Jar is at the spec/scaffold stage: `SPEC.md`, `SCREENS.md`, `docs/architecture/3d-engine.md`, and `docs/architecture/rust-core.md` are written and treated as the ground truth for implementation; `docs/ui-mockups/` holds the original Claude Design prototype the product design and behaviour were drawn from (reference only — not a code source, see `docs/architecture/3d-engine.md` §0). The repository layout below (`apps/jar`, `crates/jar-core`, `crates/jar-protocol`, `plugins/tauri-plugin-jar`) is scaffolded with stub files matching the module breakdowns in those two architecture docs, but no working sim/render code exists yet. Update this file as each part moves from stub to real implementation.

## Localization and Spelling

**REQUIREMENT:** All UI strings, code variables, comments, commit messages, pull request descriptions, and documentation MUST use **Canadian English** spelling.

Examples:

- `colour` instead of `color`
- `centre` instead of `center`
- `neighbour` instead of `neighbor`
- `behaviour` instead of `behavior`
- `cancelled` instead of `canceled`
- `licence` (noun) vs `license` (verb) — though in UI context usually "Licence"

## Markdown Formatting

**REQUIREMENT:** Do not hard-wrap markdown prose. Write each paragraph or bullet as a single unwrapped line in the source, no matter how long — let the renderer (GitHub, a browser, an editor's soft-wrap) reflow it for display. This applies to markdown-rendered content: PR descriptions, docs under `docs/`, README files, `SPEC.md`, `SCREENS.md`. Commit message bodies are the one exception — hard-wrap those (see [Commit Messages](#commit-messages)); `git log`/`git show` in a terminal don't reflow long lines the way GitHub's PR view does.

- Manual line breaks mid-paragraph don't survive Markdown rendering as intended (they either collapse into the same line anyway or break formatting), and they create noisy diffs when a later edit only changes one word but reflows the whole wrapped block.
- This does not apply to genuinely separate list items, headings, or intentional line breaks (e.g. two-space trailing breaks, blank lines between paragraphs) — only to breaking up one continuous sentence/paragraph across multiple lines.
- Code comments are not markdown-rendered and may wrap normally at a reasonable line length, same as any other source line — this rule doesn't reach them.

**Em dashes:** use a real em dash (`—`) in prose, never `--` as a substitute. Applies everywhere prose appears — PR/issue descriptions, docs, README files, `SPEC.md`, `SCREENS.md`, commit messages, and code comments — independent of the hard-wrap rule's narrower scope above. Doesn't apply to an actual double-hyphen that means something else in context (a CLI flag like `--check`, a numeric range, etc.) — only to `--` standing in for the punctuation mark.

## Authoring Voice

**REQUIREMENT:** Ship the result, not how the conversation arrived at it. Write every outward-facing line — code comments, identifier names, PR descriptions — as the author of the artifact, for the reader who will encounter it later, not as a record of the debugging or review process that produced it.

- Don't reference "this PR", "the review", a reviewer's name, or a commit SHA inside code comments or PR prose. State the fact or the reasoning directly, as if it had always been true.
- When a comment gets edited more than once across a change, rewrite it as one clean explanation — don't leave layered fragments from each edit stacked on top of each other.
- Commit messages are the exception: they're a legitimate place to record _why_ a change happened, including review feedback or debugging context — that's what git history is for.

## Commit Messages

**Format:** Use Conventional Commits format (e.g., `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`).

- Use `test:` for test-related changes, including fixes to tests themselves (do not use `fix:` unless it fixes application code).

**Body Requirements:**

- Explain what and why (not how)
- Use markdown: **bold**, _italics_, `code`, bullet lists
- **Backtick every code-level reference** — component/function/class/variable names, file and directory paths, CSS selectors/properties/values, npm and crate package names, route paths, HTML tag names, config keys, and CLI flags (e.g. `FishModel`, `crates/jar-core/src/tick.rs`, `:hover`, `gravityScale`, `@react-three/rapier`, `plugin:jar|get_snapshot`, `<Canvas>`, `--check`). This applies inline in prose, not just in fenced code blocks. Plain-English descriptions and user-facing UI strings (button labels, screen names, dialog copy) use quotes instead, not backticks — they aren't code.
- **NO markdown headings** - use **bold labels** for sections (not always required)
- Hard-wrap paragraphs (~72-100 chars), unlike other markdown in this repo — see [Markdown Formatting](#markdown-formatting)

**Specific Updates**: Each commit message should reflect the specific changes made in that commit. Do not just recap the entire project history or scope. Focus on the now.

**Shell Interpolation Safety:**

- Do not pass markdown-heavy commit bodies directly via `git commit -m "..."` when they include backticks, `$()`, or shell-sensitive characters.
- Prefer writing the message to a file with a single-quoted heredoc and commit with `git commit -F <file>` to prevent shell expansion.
- If using `-m`, escape shell-sensitive characters explicitly before running the command.
- After committing, verify the stored message with `git log -1 --pretty=fuller` and amend immediately if interpolation altered content.

## Pull Request Titles

**REQUIREMENT:** PR titles MUST be human-readable summaries of the PR change.

- Start with a capital letter, write in the imperative mood, and keep to roughly one 70-character line.
- Do not use Conventional Commit prefixes in PR titles (for example, no `feat:`, `fix:`, `chore:`).
- Describe the outcome or behaviour change, not internal process language.
- Ignore internal planning document notes in PR titles and descriptions unless they directly map to repository changes.
- Keep title style consistent across every open PR in the same stack.
- If one title in a stack is updated, update the rest of the open stack titles to match style and scope.
- Do not rename merged PRs unless explicitly requested.
- Keep linked issues and merge order aligned after any title changes in a stack.

## Pull Request Content

**Requirement:** PR titles and descriptions must not mention internal workflow artefacts.

- Do not mention deferred-review documents, internal queue labels, or internal-only planning notes in outward PR content.
- Keep internal triage mechanics in local runbooks and agent workflows only.
- Use user-facing, outcome-focused language in PR titles and descriptions.
- Only include internal process details in PR content when explicitly requested by the user.
- Open pull requests ready for review by default. Only create a draft PR when the user explicitly asks for a draft or when there is a clearly communicated blocker that makes draft status necessary.

**PR Description Format:**

- Prefer a compact markdown structure with `## Summary` and `## Test plan`.
- Under `## Summary`, use `###` sub-sections when they help group the change cleanly. Good defaults include `### Sim core`, `### Rendering`, `### UI`, `### Documentation`, or similar outcome-oriented labels.
- Under each summary section, use flat bullets with bold lead-ins for scanability.
- Keep the summary focused on outcomes and behaviour changes, not commit history or implementation chronology.
- Under `## Test plan`, use checklist bullets (`- [x]` / `- [ ]`) and include the concrete commands, validations, or remaining gaps.
- If something could not be verified, state that plainly at the end of `## Test plan` or immediately below it.

## Pull Request Labels

**Requirement:** Add labels to every PR when it is created or updated.

- Add at least one primary category label to every PR: `enhancement`, `bug`, `documentation`, `testing`, `ci`, `build`, or `chore`.
- Add shared operational labels where they help clarify handling: `infrastructure`, `internal`, `release`, `blocked`, `skip-changelog`.
- Add product and subsystem scope labels where helpful: `rendering`, `sim`, `rust`, `frontend`, `plugin`, `android`, `data-model`.
- Prefer the broader label style over Conventional Commit terms for PR labelling. Use GitHub label categories like `enhancement` and `bug` instead of labels such as `feat` or `fix`.
- Use `skip-changelog` only when a change should be excluded from generated release notes.
- Keep labels accurate as scope changes during review.

## Git Workflow

**Requirement:** Do not push changes (especially force pushes) to the repository unless explicitly requested by the user.

- **Fix branch naming:** When creating a branch for a fix, use `fix/issue-<number>-<short-description>` (for example, `fix/issue-19-bubble-drift`).
- **GitHub tooling:** Prefer the `gh` CLI for repository, pull request, label, review, and GitHub Actions work.

## Local Tooling

- **Rust fallback:** If Rust tooling such as `cargo` is not available on the host, run Rust/Tauri commands inside a container with the toolchain preinstalled, against the checked-out workspace.
- **Android builds:** no local Android SDK/NDK setup is assumed yet; document the real build command here once Android packaging is wired up.

## Frontend Code Conventions

- **No barrel files.** Don't create an `index.ts`/`index.tsx` that only re-exports from sibling files. Import directly from the file that defines the thing (e.g. `import { FishModel } from '../render/models/FishModel'`, not from a `render/models/index.ts` that re-exports it). Barrels obscure the real dependency graph and slow down tree-shaking and IDE "go to definition."
- **`/src/sim` does not exist.** Discrete sim logic (aging, mood, breeding, genetics, passing) lives in `crates/jar-core`, not TypeScript — see `docs/architecture/rust-core.md`. Frontend code only ever *reacts* to `TickUpdate`/`Born`/`Passed` events pushed over the Tauri `Channel`; it never re-derives sim rules.

## Documentation

- **Updates:** when user-facing behaviour or the screen/state inventory changes, update `SPEC.md`/`SCREENS.md`; when render/physics/AI/model specifics change, update `docs/architecture/3d-engine.md`; when the sim-core schema or module boundary changes, update `docs/architecture/rust-core.md`. Once a `README.md` exists beyond its current stub, keep it in sync too.
- **No hard wrapping:** see [Markdown Formatting](#markdown-formatting) above.

## Repository Layout

Cargo workspace + **Bun workspaces** (not pnpm/npm — chosen deliberately at scaffold time):

- `apps/jar` — the Tauri app: React/TypeScript frontend in `src/` (`windows/` for the flat-chrome dialog windows, `render/` for the R3F tank scene, `domain/protocol/generated/` for `ts-rs`-generated types), Rust backend in `src-tauri/`.
- `crates/jar-core` — pure Rust simulation core. No I/O, no `tauri`/`wasm-bindgen` deps — testable in complete isolation.
- `crates/jar-protocol` — shared types + wire format (`postcard`); `ts-rs` generates the TS interfaces the frontend imports.
- `plugins/tauri-plugin-jar` — the native adapter: background sim loop, `Channel<SimEvent>` push, autosave, thin command handlers. Permissions live in `permissions/default.toml` per the Tauri v2 capabilities system (see [Tauri v2](#tauri-v2) below) — installing the plugin is not enough, each command needs an explicit grant.
- `docs/architecture/` — `3d-engine.md` (render/physics/AI/model spec) and `rust-core.md` (sim-core spec).
- `docs/ui-mockups/` — the original Claude Design prototype, reference only.
- `assets/models/` — raw GLB model files (see `docs/architecture/3d-engine.md` §12 for the asset pipeline).

## Licence and Copyright

**REQUIREMENT:** All source code files (Rust, TypeScript, etc.) MUST include a licence and copyright header as the first content in the file.

**Header format:**

For Rust (`.rs`) files:

```
// Brief one-line summary of what this file does.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT
```

For TypeScript/JavaScript (`.ts`, `.tsx`, `.js`) files:

```
// Brief one-line summary of what this file does.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT
```

## Tauri v2

Jar uses **Tauri v2** targeting desktop (Linux, Windows) and Android (companion, read-only). These are the house patterns and pitfalls to keep in mind:

### Platform Detection

Use `@tauri-apps/plugin-os` for reliable platform detection across all targets.

- The `platform()` function is **synchronous** and determined at compile time.
- Returns: `'linux' | 'macos' | 'ios' | 'freebsd' | 'dragonfly' | 'netbsd' | 'openbsd' | 'solaris' | 'android' | 'windows'`.
- Use this for conditional UI rendering (e.g. the Android companion's read-only mode).

### Tauri APIs

- Prefer Tauri plugins over web APIs when available (e.g., `@tauri-apps/plugin-fs` over browser File API).
- Most Tauri v2 APIs are async — use `async/await`.
- Check plugin documentation for platform-specific limitations.

### Common v1 Pitfalls (Agent Guide)

Because many online resources refer to Tauri v1, older patterns may inadvertently be suggested.

**Configuration (`tauri.conf.json`) differences:** `tauri` → `app` (top-level rename); `build.distDir` → `frontendDist`; `build.devPath` → `devUrl` (URLs only, not paths); `tauri.allowlist` → **removed**, replaced by the capabilities system; `tauri.bundle` → moved to top-level.

**JavaScript API changes:** `@tauri-apps/api` now only exports `core`, `path`, `event`, `window`; everything else moved to `@tauri-apps/plugin-*` (`fs`, `dialog`, `shell`, `os`, etc.).

**Permissions & capabilities (critical):** v1's `allowlist` is replaced by the **capabilities** ACL system. Capability files live in `apps/jar/src-tauri/capabilities/`. Installing a plugin is **not** enough — permissions must be explicitly granted per plugin (e.g. `jar:allow-get-snapshot`). This bites `tauri-plugin-jar` specifically: every command in its `COMMANDS` list needs a matching entry in its `permissions/default.toml`, or a webview `invoke()` call silently fails the ACL check even though the Rust command exists and works.

**Rust changes:** many `tauri::api` modules moved to separate plugins; use `std::fs` or `tauri_plugin_fs` instead of `tauri::api::file`; menu and tray APIs moved to separate crates. Jar's tray icon (`SPEC.md` §2) uses the `tauri::tray` module directly, not a v1-style `SystemTray`.

**Background work and window visibility:** a `setInterval`/`requestAnimationFrame` loop in the webview is throttled or paused when the window is hidden or minimized — this is exactly why `jar-core`'s tick loop runs natively in the Rust backend (`plugins/tauri-plugin-jar`) rather than as a JS timer. See `docs/architecture/rust-core.md` §5.1.
