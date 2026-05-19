# mdxg-redline

[![English](https://img.shields.io/badge/Language-English-blue?style=for-the-badge)](./README.md)
[![日本語](https://img.shields.io/badge/言語-日本語-lightgrey?style=for-the-badge)](./README_ja.md)

**MDXG-compliant markdown review tool — runs as a single standalone HTML file, exports review comments as structured JSON for LLM agents.**

> Third-party implementation of [vercel-labs/mdxg](https://github.com/vercel-labs/mdxg). Conforms to the MDXG specification, but is not affiliated with Vercel Labs or the upstream repository.

`mdxg-redline` is a browser tool that lets an LLM agent receive feedback on long-form markdown from a human reviewer as **location-aware structured JSON instead of free-form prose**. Sitting between LLM agents and human reviewers, it replaces the ambiguous "paste markdown, receive prose feedback" loop with a **machine-readable feedback artifact**.

End users only need a **single HTML file** (`review.html`). No server, no extra installation, zero network traffic.

## Features

- **Location-aware inline comments**: Select any text range, leave a comment, and export JSON that pinpoints each comment with `headingPath` and `sourceLine`
- **Single-file HTML distribution**: All dependencies (including `marked`) are inlined — no CDN references
- **Three handoff paths**: Workspace watching / embedded HTML / URL hash
- **Read-only**: Never mutates the source markdown

## Usage

### Get `review.html`

Obtain `review.html` via either:

- **Download**: Grab `review.html` directly from GitHub Releases (no install required)
- **npm**: `npm install mdxg-redline` and use `node_modules/mdxg-redline/dist/review.html`

### Quickest path

Open `review.html` in your browser, load markdown via `Open file`, select text → `＋ Comment` to leave a comment, then `Comments ▾ → Copy as JSON` to hand it back.

### Workspace watching (recommended, Chromium-based browsers only)

For workflows where an agent and a reviewer iterate multiple times on the same machine.

1. The agent writes `<name>-<hash>-review.md` into a workspace directory (e.g. `.temp/review-session/`), where `<name>` is the basename with `.md` / `.markdown` extension stripped, and `<hash>` is the first 16 hex chars of SHA-256 over the markdown body. Running `dist/embed.mjs <input.md> <output-dir>` also produces a matching `<name>-<hash>-review.html` alongside the `.md`, so reviewers on non-Chromium browsers can be handed the HTML on its own
2. Open `review.html` in your browser and pick the directory via `Watch folder`
3. The reviewer writes comments and clicks `Write feedback.json`
4. `<name>-<hash>-feedback.json` is written into the same directory (same `<name>` and `<hash>` as the source `review.md`)
5. The agent reads the matching `feedback.json` and writes back a revised `<name>-<new-hash>-review.md` — repeat

See [the Workspace Protocol section in docs/DESIGN.md](docs/DESIGN.md#8-ワークスペースプロトコル) for the full file-naming protocol.

## Output JSON

```jsonc
{
  "document": "spec.md",
  "docHash": "a1b2c3d4e5f6a7b8",
  "exportedAt": "2026-05-15T10:30:00.000Z",
  "comments": [
    {
      "id": "a1b2c3d4",
      "quote": "the selected text",
      "comment": "This assumes X but X is never defined",
      "created": "2026-05-15T10:28:11.000Z",
      "headingPath": ["## 3. Input and Output Paths"],
      "sourceLine": 42,
    },
  ],
}
```

## MDXG compliance status

The [Markdown Experience Guidelines (MDXG)](https://github.com/vercel-labs/mdxg) are currently a preview specification and may change. Reviewer-facing features are being adopted incrementally.

| MDXG section             | Required level | Current status                                                         |
| ------------------------ | -------------- | ---------------------------------------------------------------------- |
| §1 Theming               | MUST (Viewer)  | Partial (DADS theme; host theme adaptation is not implemented yet)     |
| §2 Code Block Rendering  | MUST (Viewer)  | Partial (copy button and syntax highlighting are not implemented yet)  |
| §3 Task Lists            | MUST (Viewer)  | Supported via marked defaults                                          |
| §4 Images / §5 Tables    | MUST (Viewer)  | Supported via marked defaults                                          |
| §6 Virtual Pages         | MUST (Viewer)  | Not supported yet (requires integration design with the comment model) |
| §7 Page Navigation       | MUST (Viewer)  | Not supported yet                                                      |
| §8 Page Outline          | MUST (Viewer)  | Not supported yet                                                      |
| §9 Sequential Navigation | MUST (Viewer)  | Not supported yet                                                      |
| §10 Search               | MUST (Viewer)  | Not supported yet                                                      |
| §13 Keyboard Navigation  | MUST (Viewer)  | Partial                                                                |

For the roadmap ahead, see [docs/DESIGN.md §13](docs/DESIGN.md).

## Development

The build tool is [Vite+ (vp)](https://viteplus.dev/), installed via npm (`vite-plus`) as a dev dependency. The devcontainer and `local_setup.sh` handle setup, so using those is the fastest path for local development.

```bash
npm ci
npm run build       # = vp build       generates dist/review.html
npm run build:watch # = vp build --watch rebuilds on file changes
npm run dev         # = vp dev          dev server with HMR
npm test            # = vp test         runs in-source tests
```

`npm ci` will install `vp` locally from `vite-plus`. If you set up via the devcontainer or `local_setup.sh`, dependencies are already installed for you, so you don't need to run `npm ci` separately.

## License

MIT
