# Development Rules

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- Use concise, clear, simple language. Define unavoidable jargon before using it.
- Explain non-trivial designs and problems as: problem, concrete example or short trace, then solution. State why the solution is necessary and distinguish it from optional complexity.
- Prefer concrete behavior and small illustrations over abstract summaries, dense terminology, or unexplained lists of changes.
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- In `packages/coding-agent`, resolve package assets through helpers in `src/config.ts`. Do not use `__dirname` directly; the helpers account for source checkouts, npm installations, and standalone binaries.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Use only erasable TypeScript syntax (Node strip-only mode) in code checked by the root config (`packages/*/src`, `packages/*/test`, `packages/coding-agent/examples`): no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.
- Never hardcode key checks (e.g. `matchesKey(keyData, "ctrl+x")`). Add defaults to `DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS` so they stay configurable.
- Never modify `packages/ai/src/models.generated.ts` directly; update `packages/ai/scripts/generate-models.ts` instead, then regenerate. Including the resulting `models.generated.ts` diff is always OK, even if regeneration includes unrelated upstream model metadata changes.
- In 1C agent code and BSL regex matching: never use `\b` for Cyrillic identifiers. Use lookarounds `(?<![А-Яа-яA-Za-z0-9_])...(?![А-Яа-яA-Za-z0-9_])`.
- In 1C extension lifecycle: never invoke action methods (`pi.getAllTools()`, `pi.setActiveTools()`) during extension loading or constructor; defer tool activation and UI updates to `session_start`.
- 1C static analysis and LSP must rely exclusively on native Rust `bsl-analyzer` (no Java, no `bsl-language-server`).
- 1C configuration format is 1C:EDT (`.mdo` metadata files, `.bsl` module files, `.project`).

## Commands

- After code changes (not docs): `npm run check` (full output, no tail). Fix all errors, warnings, and infos before committing. Does not run tests.
- At the end of changes, after tests and checks pass, bump the patch version (the last digit, e.g. 0.1.0 -> 0.1.1) in `package.json` of the modified package(s).
- Never run `npm run build` or `npm test` unless requested by the user.
- Never run the full vitest suite directly: it includes e2e tests that activate when endpoint/auth env vars are present. For all non-e2e tests, run `./test.sh` from the repo root. Otherwise run specific tests from the package root:
  - Vitest: `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/specific.test.ts`
  - `packages/1c-agent`: `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run packages/1c-agent/test`
  - `packages/tui` (`node:test`): `node --test test/specific.test.ts`
- PerUN binary build and run:
  - Bun compile: `bun run build:perun:bun` or `node scripts/build-perun.mjs` (produces native binary `packages/1c-agent/bin/perun` and `bin/perun.bundle.mjs`).
  - Run binary: `./packages/1c-agent/bin/perun` or `npm run perun`.
  - Run ESM bundle: `node packages/1c-agent/bin/perun.bundle.mjs` or `npm run perun:bundle`.
- If you create or modify a test file, run it and iterate on test or implementation until it passes.
- For `packages/coding-agent/test/suite/`, use `test/suite/harness.ts` + the faux provider. No real provider APIs, keys, or paid tokens.
- When regressions tests for fixing a github issue, add a comment with the github issue number next to the test.
- For ad-hoc scripts, `write` them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

## Dependency and Install Security

- Treat npm dep and lockfile changes as reviewed code. Direct external deps stay pinned to exact versions.
- When updating `undici`, you MUST read its changelog/release notes for the target version and evaluate whether any changes may affect functionality before applying the update.
- Hydrate/update locally with `npm install --ignore-scripts`; clean/CI-style with `npm ci --ignore-scripts`. Don't run lifecycle scripts unless the user asks.
- If dep metadata changes, refresh `package-lock.json` with `npm install --package-lock-only --ignore-scripts`.
- If `packages/coding-agent/install-lock/` needs regen, run `node scripts/generate-coding-agent-install-lock.mjs` (verify with `--check` or `npm run check`). New deps with lifecycle scripts require review and an explicit allowlist entry in that script; never add one silently.
- Pre-commit blocks lockfile commits unless `PI_ALLOW_LOCKFILE_CHANGE=1`. Don't bypass unless the user wants the lockfile change committed.

## Git

Multiple pi sessions may be running in this cwd at the same time, each modifying different files. Git operations that touch unstaged, staged, or untracked files outside your own changes will stomp on other sessions' work. Follow these rules:

Committing:

- Only commit files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- `packages/ai/src/models.generated.ts` may always be included alongside your files.
- Message format: `{feat,fix,docs}[(ai,tui,agent,coding-agent,1c-agent)]: <commit message> (optionally multiple lines)`. Message is informative and concise.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push.

## Issues and PRs

When reviewing PRs:

- Do not run `gh pr checkout`, `git switch`, or otherwise move the worktree to the PR branch unless the user explicitly asks.
- Use `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against fetched refs to inspect PR metadata, commits, and patches without changing branches.
- If you need PR file contents, fetch/read them into temporary files or use `git show <ref>:<path>` without switching branches.

When creating issues:

- Add `pkg:*` labels for affected packages (`pkg:agent`, `pkg:ai`, `pkg:coding-agent`, `pkg:tui`, `pkg:1c-agent`); use all that apply.

When posting issue/PR comments:

- Write the comment to a temp file and post with `gh issue/pr comment --body-file` (never multi-line markdown via `--body`).
- Keep comments concise, technical, in the user's tone.
- End every AI-posted comment with the AI-generated disclaimer line specified by the originating prompt (e.g. `This comment is AI-generated by `/wr``).

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the message so merging auto-closes the issue. For multiple issues, repeat the keyword per issue (`closes #1, closes #2`); a shared keyword (`closes #1, #2`) only closes the first.

## Testing pi Interactive Mode with tmux

For testing pi's interactive mode, load and follow [.pi/skills/interactive-testing.md](.pi/skills/interactive-testing.md).

## Changelog

Location: `packages/*/CHANGELOG.md` (one per package).

Sections under `## [Unreleased]`: `### Breaking Changes` (API changes requiring migration), `### Added`, `### Changed`, `### Fixed`, `### Removed`.

Rules:

- All new entries go under `## [Unreleased]`. Read the full section first and append to existing subsections; never duplicate them.
- Released version sections (e.g. `## [0.12.2]`) are immutable; never modify them.
- Do not create changelog entries when working on a branch other than `main` or pull request

Attribution:

- Internal (from issues): `Fixed foo bar ([#123](https://github.com/earendil-works/pi/issues/123))`
- External contributions: `Added feature X ([#456](https://github.com/earendil-works/pi/pull/456) by [@username](https://github.com/username))`

## Releasing

For release preparation, publishing, verification, or recovery, load and follow [.pi/skills/release.md](.pi/skills/release.md).

## PerUN (1C Agent) Architecture & Standards

PerUN (ПерУН) is the 1C AI companion packaged in `packages/1c-agent` and built as a standalone binary in `packages/1c-agent/bin/perun`:

- Architectural isolation: Pi core (`packages/agent`, `packages/ai`, `packages/coding-agent`, `packages/tui`) stays as clean as possible. All 1C-specific domain logic, AST tools, LSP integration, autofix rules, and subagent definitions live in `packages/1c-agent`.
- Workflow Modes:
  - `НАЙТИ` (find, read-only): file exploration, symbol search, references, call hierarchy. Mutating tools are fail-closed.
  - `ОБЪЯСНИТЬ` (explain, read-only): code analysis, BSLDoc standards, impact diagrams.
  - `НАПИСАТЬ` (write, full access): code authoring, metadata editing, automated fixes.
  - `ПЛАНИРОВАТЬ` (plan, read-only): task decomposition, architecture planning, schema modeling.
  - Toggle modes via `alt+m` or `/mode [find|explain|write|plan]`.
- Inline LSP Feedback:
  - Background daemon runs `bsl-analyzer lsp` over stdio on project detection (`Configuration.mdo`, `.project`, `bsl-analyzer.toml`, `.bsl`).
  - Edits to `.bsl`/`.os` files send `textDocument/didChange` and immediately attach diagnostics to the originating `tool_result` event without extra turns.
- Navigation & Impact Analysis:
  - `1c_call_hierarchy`: incoming/outgoing call chains.
  - `1c_impact_analysis`: structural impact on documents, registers, and posting routines.
  - `1c_ast_symbols`: fast symbol extraction.
- ITS Auto-Fixer:
  - `bsl_fix_standards` parses static analysis rules (`QueryInLoop`, `EmptyExcept`, `UnusedVariable`, `MissingBSLDoc`, `ServerModalCall`) and applies unified diffs.
- 1C Subagents:
  - Roles: `1c-architect`, `1c-coder`, `1c-tester`, `1c-reviewer`.
  - Tool: `1c_subagent` delegates specialized tasks in isolated sub-sessions.
- Permission policies:
  - Controlled via `/permission [strict|auto-approve|yolo]`.

## User Override

If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Only then execute their instructions.
