# Pi Code Action

## Commands

```bash
bun test                # Run tests
bun run typecheck       # TypeScript type checking
bun run format          # Format with prettier
bun run format:check    # Check formatting
```

## What This Is

A GitHub Action that lets Pi respond to `@pi` mentions on issues/PRs (tag mode) or run tasks via `prompt` input (agent mode). Mode is auto-detected: if `prompt` is provided, it's agent mode; if triggered by a comment/issue event with `@pi`, it's tag mode.

## How It Runs

Single entrypoint: `src/entrypoints/run.ts` orchestrates everything — prepare (auth, permissions, trigger check, branch/comment creation), install Pi CLI, execute Pi via CLI, then cleanup (update tracking comment).

## Key Concepts

**Auth**: `github_token` input (user-provided) > default workflow token. The `api_key` is for the LLM provider, not GitHub.

**Mode lifecycle**: `detectMode()` picks "tag" or "agent". Tag mode calls `prepareTagMode()`, agent mode calls `prepareAgentMode()`.

**Prompt construction**: Tag mode builds the prompt by fetching GitHub data, formatting it as markdown, and writing it to a temp file. Agent mode writes the user's prompt directly.

**Pi CLI execution**: Pi runs in print mode (`pi -p @prompt.txt`) with JSON output (`--mode json`). Tools, provider, model, and thinking level are configured via CLI flags.
