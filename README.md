<p align="center">
  <img src="assets/pi-logo.png" width="80" height="80" alt="Shelly Logo" />
</p>

<h1 align="center">Shelly Code Action</h1>

A GitHub Action that brings [Pi](https://pi.dev) coding agent to your issues and pull requests. Mention `@shelly` in a comment and it gets to work -- reviewing code, implementing features, fixing bugs, rebasing branches, and more.

Works with any OpenAI-compatible LLM endpoint. Bring your own model.

## Quick Start

Create `.github/workflows/shelly.yml`:

```yaml
name: Pi
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  pi:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@pi')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@pi'))
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: BhautikChudasama/pi-code-action@main
        with:
          provider: openai
          model: openrouter/anthropic/claude-sonnet-4.5
          api_key: ${{ secrets.PI_API_KEY }}
          base_url: https://your-endpoint.example.com/v1
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

Add your API key as a repository secret (`PI_API_KEY`), push the workflow, and comment `@shelly` on any issue or PR.

## What can it do?

**On issues:**
- `@shelly implement this feature` -- creates a branch, writes code, pushes, gives you a PR link
- `@shelly what does this codebase do?` -- reads the code and answers
- `@shelly add the "bug" label` -- manages labels
- `@shelly hi` -- just says hi, no branches or commits

**On pull requests:**
- `@shelly review this` -- posts inline comments on specific lines
- `@shelly fix the failing test` -- reads CI logs, fixes the code, pushes
- `@shelly rebase` -- rebases onto base branch
- `@shelly resolve the fixed review comments` -- checks what's fixed and resolves threads

**On inline review comments:**
- Reply `@shelly fix this` to any review comment -- Pi reads the parent comment, understands the context, and fixes exactly that

## How it works

1. You comment `@shelly` on an issue or PR
2. Pi posts a tracking comment with a spinner
3. Pi reads the issue/PR context, comments, and diff
4. Pi thinks, uses tools, and updates the comment live as it works
5. When done, the comment gets a header with duration and links

For issues that need code changes, Shelly creates a branch and pushes commits. For questions and reviews, it just replies -- no unnecessary branches.

## Two modes

**Tag mode** (default) -- triggered by `@shelly` mentions. Fetches full GitHub context, creates tracking comments, uses all 18 tools.

**Agent mode** -- triggered when `prompt` input is provided. Runs the prompt directly without tracking comments. Good for automation workflows like CI/CD.

```yaml
# Agent mode example
- uses: BhautikChudasama/pi-code-action@main
  with:
    prompt: "Run the test suite and report results"
    provider: openai
    model: openrouter/anthropic/claude-sonnet-4.5
    api_key: ${{ secrets.PI_API_KEY }}
    base_url: https://your-endpoint.example.com/v1
```

## Tools

Shelly comes with 18 built-in tools plus web search, and optional integrations for PostgreSQL and Kubernetes:

| Category | Tools |
|---|---|
| Code | `read`, `edit`, `write`, `bash`, `grep`, `find`, `ls` |
| Comments | `update_tracking_comment` |
| Code Review | `get_pr_diff`, `create_inline_comment`, `list_review_comments`, `resolve_review_thread` |
| CI/CD | `get_ci_status`, `get_workflow_run_details`, `download_job_log` |
| Issue Management | `add_labels`, `remove_labels`, `close_issue`, `create_issue` |
| PR Management | `request_reviewers`, `rebase_branch`, `get_conflict_files` |
| Web | `web_search`, `web_fetch` (via [pi-web-extension](https://www.npmjs.com/package/pi-web-extension)) |
| PostgreSQL | `pg_query`, `pg_schema`, `pg_table_info`, `pg_explain`, `pg_connections` |
| Kubernetes | `k8s_get`, `k8s_describe`, `k8s_logs`, `k8s_events`, `k8s_rollout_status`, `k8s_top`, `k8s_delete_pod`, `k8s_rollout_restart`, `k8s_exec` |

PostgreSQL and Kubernetes tools activate automatically when the right env vars are set (see below).

## PostgreSQL Integration

Set `DATABASE_URL` and Shelly can query your database, inspect schemas, and debug slow queries. All queries are **read-only** -- INSERT, UPDATE, DELETE, DROP, and TRUNCATE are blocked.

```yaml
- uses: BhautikChudasama/pi-code-action@main
  with:
    # ... provider, model, api_key, base_url
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

Then ask things like:
- `@shelly show me the schema of the users table`
- `@shelly why is this query slow?` -- runs EXPLAIN ANALYZE
- `@shelly how many active connections are there?`

## Kubernetes Integration

Set `KUBECONFIG` or `KUBE_NAMESPACE` and Shelly can inspect your cluster, read logs, and restart pods. Destructive operations are blocked -- no deleting PVCs, PVs, secrets, namespaces. No port-forward, no apply, no secret access.

```yaml
- uses: BhautikChudasama/pi-code-action@main
  with:
    # ... provider, model, api_key, base_url
  env:
    KUBECONFIG: ${{ secrets.KUBECONFIG }}
    KUBE_NAMESPACE: production  # optional default namespace
```

Then ask things like:
- `@shelly are all pods healthy?`
- `@shelly show me the logs for the api pod`
- `@shelly why is the deployment stuck?` -- checks events and rollout status
- `@shelly restart the api deployment`
- `@shelly what's the CPU/memory usage?`

Pod deletion is allowed (for stuck/crashlooping pods), but only one at a time -- no wildcards or `--all`.

## Configuration

### Inputs

| Input | Description | Default |
|---|---|---|
| `provider` | LLM provider (`openai`, `anthropic`, `google`) | `anthropic` |
| `model` | Model ID | `claude-sonnet-4-5` |
| `api_key` | API key for the LLM provider | -- |
| `base_url` | Custom OpenAI-compatible endpoint URL | -- |
| `github_token` | GitHub token for API access | `GITHUB_TOKEN` |
| `trigger_phrase` | What triggers Pi | `@shelly` |
| `thinking_level` | Reasoning depth (`off`, `low`, `medium`, `high`, `max`) | `off` |
| `branch_prefix` | Prefix for new branches | `pi/` |
| `extensions` | Additional Pi extensions to load (newline-separated) | -- |
| `pi_args` | Extra CLI arguments for Pi | -- |
| `max_cost` | Max cost in USD before aborting | -- |
| `max_turns` | Max LLM turns before aborting | -- |

### Using a custom endpoint

Any OpenAI-compatible API works. Set `provider: openai`, your `model` ID, and `base_url`:

```yaml
- uses: BhautikChudasama/pi-code-action@main
  with:
    provider: openai
    model: openrouter/deepseek/deepseek-v3.2
    api_key: ${{ secrets.API_KEY }}
    base_url: https://your-proxy.example.com/v1
```

### Loading extra extensions

```yaml
- uses: BhautikChudasama/pi-code-action@main
  with:
    extensions: |
      npm:some-pi-extension
      git:github.com/user/custom-extension
```

## Project structure

```
pi-code-action/
  action.yml                          # GitHub Action definition
  extensions/
    github-tools.ts                   # GitHub tools (comments, CI, review, labels, rebase...)
    postgres-tools.ts                 # PostgreSQL tools (read-only queries, schema, explain)
    kubernetes-tools.ts               # Kubernetes tools (pods, logs, events, rollout, exec)
  src/
    entrypoints/
      run.ts                          # Main orchestrator (prepare → install → run → cleanup)
    modes/
      detector.ts                     # Tag vs Agent mode detection
      tag/index.ts                    # Tag mode setup
      agent/index.ts                  # Agent mode setup
    create-prompt/
      index.ts                        # Prompt construction with GitHub context
    github/
      context.ts                      # GitHub event parsing
      token.ts                        # Token setup
      api/client.ts                   # Octokit client
      data/fetcher.ts                 # Fetch issues, PRs, comments, diffs
      data/formatter.ts               # Format GitHub data as markdown
      operations/branch.ts            # Branch checkout/creation
      operations/git-config.ts        # Git auth configuration
      operations/comments/            # Comment create + update
      validation/                     # Permissions, triggers, actor checks
    utils/
      parse-pi-output.ts              # Parse Pi's JSONL output
      retry.ts                        # Retry with backoff
```

## Development

```bash
bun install
bun test
bun run typecheck
bun run format
```

## License

MIT
