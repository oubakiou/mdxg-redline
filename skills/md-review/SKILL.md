---
name: md-review
description: |
  Run the standard markdown review loop end-to-end with the mdxg-redline CLI: send a markdown document to a human reviewer, wait (via Bash polling) for the feedback.json they export, then apply their location-aware inline comments back into the markdown and revise it. Always use this skill when the user wants human-in-the-loop review of markdown with structured JSON feedback — e.g. "send this spec out for review", "get a human to review this before we move on", "have someone redline this doc", "leave inline comments on this draft". Even without an explicit file name or tool name, actively consider this skill for any request involving a human review round, human-in-the-loop checking, redlining, or structured reviewer feedback on a document. The same workflow applies when the user launches it as a slash command like `/md-review <path>`.
argument-hint: <path/to/markdown.md>
license: MIT
---

# md-review

A skill that lets Claude run the standard review loop end-to-end using the mdxg-redline CLI. One round consists of the following steps:

1. Prepare the target markdown (read an existing .md, have Claude generate one, or use the path specified by the user via `$ARGUMENTS`)
2. Run `scripts/request-review.sh <input.md>` to generate the review HTML and launch the browser; capture the `REVIEW_HTML` / `FEEDBACK_JSON` paths from stdout
3. Run `scripts/wait-feedback.sh <feedback.json>` to poll until the feedback.json appears
4. Read the detected feedback.json and apply the comments to the markdown
5. Send the updated markdown out for another review
6. Ask the user whether to proceed to the next round, clean up review artifacts and finish, or finish as-is

The reviewer needs time to write comments (minutes to hours), so Claude's turn is free during polling — either work on other tasks or sleep.

## Trigger patterns

- **Auto-triggering**: When the user says things like "send this for review", "I want a human review", "mdxg-redline", "redline", etc., Claude automatically selects this skill based on the description
- **Slash command**: When the user explicitly runs `/md-review path/to/markdown.md`, that argument is used as `INPUT_MD`. If the argument is empty or natural language, Claude identifies the markdown from context
- **Natural language path**: When the user says something like "send `docs/spec.md` out for review" with an embedded path, that path is used as `INPUT_MD`

## When to use / not use

**Use**

- When the user explicitly requests structured feedback from a human — e.g. "have someone review this spec", "get comments via mdxg-redline"
- When the user wants to run multiple rounds of review → revision → re-review
- When Claude has generated markdown and the user wants a human check rather than self-review

**Do not use**

- When the reviewer is an LLM, not a human (this skill processes structured JSON feedback written by human reviewers; it is not for LLM-as-judge style automated evaluation)
- For simple markdown operations that don't involve human review — e.g. "summarize this markdown", "fix the formatting"

## Workflow overview

```text
[User instruction]
   └─ Claude prepares the markdown (generate or read existing file)
        └─ Bash: npx mdxg-redline <input.md> [output-dir]
             └─ Capture <name>-<docHash>-review.html path from stdout
                  └─ Browser opens on the reviewer's side (environment-dependent)
                       └─ Bash: poll for feedback.json
                            └─ Read and parse feedback.json
                                 └─ Apply comments[] to the markdown
                                      └─ Ask user: "next round / clean up / finish as-is"
                                           └─ Round N+1 or clean up or finish
```

## Step details

### 1. Prepare the target markdown

Determine the path to the target markdown as `INPUT_MD`.

- If the user has indicated an existing .md path (via slash command argument or natural language): use that path
- If Claude is generating the markdown from scratch: save it with the Write tool to an appropriate directory and lock in the path. Decide the output directory in consultation with the user, or default to the same directory as the input .md

### 2. Generate the review HTML & launch the browser via CLI

Call the `scripts/request-review.sh` wrapper. Internally it runs `npx mdxg-redline` and writes the absolute paths of the review HTML and the corresponding feedback.json to stdout:

```bash
bash .claude/skills/md-review/scripts/request-review.sh <INPUT_MD> [output-dir]
```

The wrapper must be invoked via `bash` and with a **CWD-relative path** (relative to the project root). `gh skill install` strips the execute bit from files under scripts/, so direct execution via `./script.sh` fails with `Permission denied`. Using `bash script.sh` avoids depending on the execute bit.

Additionally, the `Bash(bash .claude/skills/md-review/scripts/...:*)` permission rules in `.claude/settings.local.json` are evaluated as string prefix matches, so calling the wrapper with an absolute path like `bash /workspaces/<repo>/.claude/skills/...` won't match the prefix and will re-trigger the approval prompt. The general Bash tool convention is "prefer absolute paths", but this wrapper is an exception — **invoke it with a relative path** to align with the prefix permission. Keep CWD at the project root and call `bash .claude/skills/md-review/scripts/request-review.sh ...`.

stdout will contain the following 2 lines, which Claude parses for subsequent steps:

```
REVIEW_HTML=/path/to/spec-a1b2c3d4e5f6a7b8-review.html
FEEDBACK_JSON=/path/to/spec-a1b2c3d4e5f6a7b8-feedback.json
```

If `output-dir` is omitted, output goes to the same directory as the input .md. There is no need to extract the docHash separately — the wrapper determines the corresponding feedback path by replacing the filename suffix.

**Browser launch**

The CLI attempts to auto-launch the default browser. In headless CI / SSH remote environments where launch fails, pass `--no-open` as the first argument to the wrapper to suppress it:

```bash
bash .claude/skills/md-review/scripts/request-review.sh --no-open <INPUT_MD>
```

Internally this expands to `npx mdxg-redline --no-open`, so the existing wrapper prefix permission still applies.

### 3. Poll for feedback.json

When the reviewer clicks `Write feedback.json` in the browser, `<mdFileName>-<docHash>-feedback.json` appears in `output-dir`. Wait for it via `run_in_background` polling using the `scripts/wait-feedback.sh` wrapper:

```bash
bash .claude/skills/md-review/scripts/wait-feedback.sh "$FEEDBACK_JSON"
```

The second argument can override the timeout in seconds (default: 1800 seconds / 30 minutes).

**Browser requirements (important)**

The `Write feedback.json` button uses the File System Access API, so it is **only supported on Chromium-based browsers (Chrome / Edge / Arc / Brave / Opera)**. Reviewers on Safari / Firefox should use `Comments ▾ → Export as JSON` (download) or `Copy as JSON` (clipboard) as alternatives. Receive the downloaded feedback.json path from the user and resume from step 4 of this skill.

**Polling design decisions**

- Interval is `sleep 5` (5 seconds). Maximum detection delay after the reviewer writes is 5 seconds, which is acceptable
- Timeout defaults to 30 minutes (`timeout 1800`). Reviews can run long, but an upper bound prevents Claude's turn from staying open indefinitely. After timeout, ask the user "Would you like to wait longer?"
- Using `run_in_background: true` frees Claude's main turn — it can work on other tasks or yield. Completion is notified automatically

**Notification to the user**

Once polling starts, inform the user of the current status in one sentence:

> The browser has been launched via mdxg-redline. Waiting for the reviewer to enter comments and click "Write feedback.json" (up to 30 minutes). Processing will continue automatically once complete.

### 4. Read feedback.json and update the markdown

Once polling completes, read feedback.json with the Read tool. Schema:

```jsonc
{
  "document": "spec.md",
  "docHash": "a1b2c3d4e5f6a7b8",
  "exportedAt": "2026-05-15T10:30:00.000Z",
  "comments": [
    {
      "id": "...",
      "quote": "The selected text verbatim",
      "comment": "The reviewer's comment",
      "created": "...",
      "headingPath": ["## 3. Input and output paths", "### 3.2 File selection"],
      "sourceLine": 42,
    },
  ],
}
```

**Procedure for applying comments to the markdown**

1. Locate the relevant line in the markdown using each comment's `sourceLine` (the `offset` argument of `Read` is useful here)
2. Grep for the `quote` near that line as a fallback check (if the markdown was edited mid-round, line numbers may have shifted — use quote search to re-locate)
3. Interpret the `comment` instruction and modify the markdown with the Edit tool
4. After all comments have been applied, report a 3-5 line summary to the user (which comments were applied / deferred)

**When sourceLine is unreliable**

The `docHash` corresponds to the version at the time of review, so if Claude independently edited the markdown during the round, `sourceLine` values may be offset. For safety, position each comment using a **two-step approach: start from `sourceLine`, then grep for `quote` to verify consistency**. If `quote` is not found, narrow down to the relevant section using `headingPath` and then match manually.

**Application policy**

Reviewer comments may be either "please fix this" directives or "what's going on here?" questions:

- Fix instructions → directly modify the markdown
- Questions / discussion prompts → premature to modify immediately. Present to the user: "This appears to be a question, so it may be better to consider a response before applying, or leave it to the user's judgment"
- Conflicting comments → when multiple comments on the same passage give contradictory instructions, present both and ask the user for a decision

When in doubt, it's safer to confirm with the user before applying. Batch-applying changes and showing only the diff risks significant rework if the interpretation diverges from the reviewer's intent.

### 5. Ask the user: next round / clean up / finish as-is

After the markdown update is complete, send the updated markdown out for re-review, then present the user with these three options:

- **Next round**: Wait for the feedback.json from the re-review request just sent, starting from step 3 (polling)
- **Clean up and finish**: Delete old review.html / feedback.json files, then finish (see below)
- **Finish as-is**: Complete without deleting old files

If the user says "one more round", note that **the revised markdown has different content, so the docHash also changes**. The new review.html and feedback.json will have different filenames and are automatically separated from the old ones.

**Clean up**

The mdxg-redline CLI has a `--clean` subcommand:

```bash
# Dry-run: show deletion candidates
npx mdxg-redline --clean <output-dir>

# Actually delete
npx mdxg-redline --clean <output-dir> --yes
```

Ask the user "clean up and finish?" every time — not just after the final round of a multi-round session, but also when finishing after a single round.

## End-to-end example

In practice it looks like this (paths are examples):

```bash
# Round 1: generate → launch review HTML → capture output paths
bash .claude/skills/md-review/scripts/request-review.sh path/to/draft.md path/to/output
# stdout prints REVIEW_HTML=... and FEEDBACK_JSON=... on 2 lines

# While the reviewer is working, poll here (run_in_background recommended)
bash .claude/skills/md-review/scripts/wait-feedback.sh /path/to/draft-XXXX-feedback.json

# Read feedback.json and proceed to markdown editing (Read / Edit tools)
```

If the user says "one more round", re-run from line 1 with the revised markdown in the same `output-dir`. The docHash changes, so a new review HTML and feedback.json pair is generated with a different filename, structurally separated from previous rounds.

## Troubleshooting

**Browser doesn't launch (headless / SSH remote)**

Even if the CLI fails to launch, it exits 0 and prints the absolute path to stdout, so tell the user "please open the path from stdout manually in a browser". In VS Code Codespaces / Remote Containers, the CLI automatically switches to HTTP server mode, so guide the user to open the forwarded `http://localhost:51729`.

**Polling timed out**

The `timeout 1800` expired after 30 minutes without feedback.json appearing. Ask the user "Is the review still in progress? Would you like to wait longer?" If extending, re-launch the poll with the same path. If the reviewer can't use `Write feedback.json` because they're not on a Chromium browser, `Export as JSON` (download) is also an option — ask them for the downloaded feedback.json path.

**Reviewers on Safari / Firefox**

`Write feedback.json` is Chromium-only. Reviewers on Safari / Firefox should use `Comments ▾ → Export as JSON` (download) or `Copy as JSON` (clipboard) as alternatives. Receive the downloaded feedback.json path from the user and resume from step 4 of this skill.

## Why this design (rationale)

- **Why wrap the CLI workflow in a skill**: Running mdxg-redline's standard loop manually each time — CLI invocation → docHash extraction from stdout → polling → feedback ingestion — involves too many steps. Packaging it as a skill lets the user simply say "send this for review" and the entire loop runs automatically
- **Why read filenames from stdout**: The docHash is the first 16 hex digits of SHA-256(markdown). Claude could recompute it, but using the value definitively written by the CLI structurally prevents drift from the naming convention
- **Why use `run_in_background` for polling**: Feedback entry can take minutes to hours. Running a sleep loop in the foreground completely blocks Claude's main turn, but `run_in_background` allows parallel work or yielding to the user during that time
- **Why the two-step approach with sourceLine and quote**: `sourceLine` is the line number in the markdown source, reliable only when the docHash at review time matches the current version. The `quote` grep fallback is essential in case Claude independently edited the markdown during the round
- **Why confine Bash operations to scripts/ wrappers**: Writing raw `npx mdxg-redline` invocations or `timeout 1800 bash -c '...'` directly in SKILL.md forces users to write long prefix patterns with variable arguments and shell expansion in `.claude/settings.local.json`'s `permissions.allow`, which is fragile with prefix matching. Confining operations to `scripts/request-review.sh` and `scripts/wait-feedback.sh` means the wrapper path prefix alone covers all operations for one full round

## Configuration example: permissions.allow

To allow this skill's Bash operations in `.claude/settings.local.json`, the following rules cover one full round:

```json
{
  "permissions": {
    "allow": [
      "Bash(bash .claude/skills/md-review/scripts/request-review.sh:*)",
      "Bash(bash .claude/skills/md-review/scripts/wait-feedback.sh:*)",
      "Bash(npx mdxg-redline --clean:*)"
    ]
  }
}
```

The `npx mdxg-redline` invocation itself is confined to the scripts/ wrappers, so wrapper-level prefix permissions suffice. `--clean` calls the CLI directly during cleanup, so it needs a separate permission rule. If you also want to use the CLI directly outside this skill, add `Bash(npx mdxg-redline:*)`.
