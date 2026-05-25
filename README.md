# MDXG Redline

[![English](https://img.shields.io/badge/Language-English-blue?style=for-the-badge)](./README.md)
[![日本語](https://img.shields.io/badge/言語-日本語-lightgrey?style=for-the-badge)](./README_ja.md)

**MDXG-compliant markdown review tool — runs as a single standalone HTML file, exports review comments as structured JSON for LLM agents.**

> Third-party implementation of [vercel-labs/mdxg](https://github.com/vercel-labs/mdxg). Conforms to the MDXG specification, but is not affiliated with Vercel Labs or the upstream repository.

MDXG Redline is a browser tool that lets an LLM agent receive feedback on long-form markdown from a human reviewer as **location-aware structured JSON instead of free-form prose**. Sitting between LLM agents and human reviewers, it replaces the ambiguous "paste markdown, receive prose feedback" loop with a **machine-readable feedback artifact**.

End users only need a **single HTML file** (`review.html`). No server, no extra installation, zero outbound traffic from LLM content by default.

## Features

- **Location-aware inline comments**: Select any text range, leave a comment, and export JSON that pinpoints each comment with `headingPath` and `sourceLine`
- **Single-file HTML distribution**: All dependencies (including `marked` and Shiki core / JS engine / 2 themes) are inlined — no CDN references
- **Two input paths**: Embed markdown into the HTML up front, or pick a file from the browser
- **Read-only**: Never mutates the source markdown
- **Virtual Pages (Stacked View)**: H1 / H2 boundaries split the document into virtual pages rendered as paper-like sheets stacked vertically (Word / Pages style). A left TOC sidebar, H3–H6 outline under the active page, and Prev/Next row deliver MDXG §6–§9 conformance
- **Syntax highlighting**: Shiki (`github-light` + `github-dark`) renders fenced code blocks for 27 languages, with a copy button injected onto each block
- **Resizable side panels**: The left TOC (180–480px) and the right Conversation sidebar (280–640px) can be dragged independently and collapsed. State persists in `localStorage`, and distributors can pre-set the initial values with `--page-nav-width` / `--comments-width`
- **Light / dark themes**: Initial value follows `prefers-color-scheme`; a 3-state toolbar toggle cycles through `system → light → dark`. The choice is persisted to `localStorage`, and distributors can pre-set the initial hint with `--theme`

## Usage

### Get `review.html`

Obtain `review.html` via either:

- **Download**: Grab `review.html` directly from GitHub Releases (no install required)
- **npm**: `npm install mdxg-redline` and use `node_modules/mdxg-redline/dist/review.html`

### Quickest path

Open `review.html` in your browser, load markdown via `Open file`, select text → `＋ Comment` to leave a comment, then `Comments ▾ → Copy as JSON` to hand it back.

### Generate and open a review request with `npx mdxg-redline`

When an LLM agent needs to request a review from a human, or for one-off reviews of a single local markdown file, the bundled CLI builds a review HTML with the markdown already embedded and opens it in your default browser.

```bash
npx mdxg-redline <input.md>                                # writes alongside input.md and opens browser
npx mdxg-redline <input.md> ./reviews                      # writes into ./reviews
npx mdxg-redline --no-open <input.md>                      # generate only, do not open browser
cat spec.md | npx mdxg-redline - --document-name spec.md   # read markdown from stdin
npx mdxg-redline --help                                    # print full usage and exit
```

#### Options

| Option                                   | Description                                                                                                                                                                            | Default            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `--no-open`                              | Suppress browser launch. The output path is always printed to stdout so CI scripts and agents can capture it                                                                           | (launches browser) |
| `--document-name <name>`                 | Override the document name (used for the `data-name` attribute and the output filename prefix). Recommended when reading from stdin to get a meaningful filename                       | input MD basename  |
| `--theme <system\|light\|dark>`          | Initial theme hint for the generated HTML (`<html data-theme>`)                                                                                                                        | unset              |
| `--comments-width <0\|280-640>`          | Initial width of the comments panel (px). `0` starts with the panel closed (only the right edge tab visible)                                                                           | `360` / open       |
| `--page-nav-width <0\|180-480>`          | Initial width of the left pages panel (px). `0` starts with the panel closed (only the left edge tab visible)                                                                          | `220` / open       |
| `--shiki-langs <auto\|all\|none\|<csv>>` | Shiki grammar injection mode. `auto` scans the markdown for fenced languages, `all` injects all 27, `none` skips injection (plain text fallback), `<csv>` takes a list like `ts,js,py` | `auto`             |
| `--help`                                 | Print the usage help and exit                                                                                                                                                          | —                  |

**UI hint precedence**: Values written by `--theme` / `--comments-width` / `--page-nav-width` are evaluated by the receiving inline script as **`localStorage` (the user's UI interaction history) > CLI hint > default (`prefers-color-scheme` / default width)**. When the CLI option is omitted, the attribute itself is not emitted and the default decision path runs unchanged.

#### Output

- Filename is auto-derived as `<input-md-basename>-<docHash>-review.html` (per §8 file-naming protocol)
- `output-dir` defaults to the input's directory (or cwd when reading from stdin)

#### Browser launch

- By default the CLI launches the system browser via `$BROWSER` → `open` (macOS) → `xdg-open` (Linux) → `cmd.exe /c start` (Windows), in that order
- When VS Code Remote Containers / Codespaces is detected, the CLI instead starts a tiny HTTP server on `127.0.0.1` at port `51729` (override with `MDXG_REDLINE_PORT`) and hands the host browser an `http://localhost:<port>/...` URL (since `file://` paths in the container are invisible to the host). If the preferred port is busy, the CLI falls back to a random port and prints a warning to stderr — **note that random ports may not be forwarded to the host browser if `forwardPorts` is not set to `auto`, so pin a known-free `MDXG_REDLINE_PORT` (or register it in `devcontainer.json` `forwardPorts`) for reliable host access**

Requires Node.js 20+ (see `engines.node` in `package.json`)

See [docs/DESIGN.md §3 User flow](docs/DESIGN.md#3-ユーザーフロー) and [§8 Workspace protocol](docs/DESIGN.md#8-ワークスペースプロトコル) for escape handling and the file-naming protocol.

### Standard loop between an LLM agent and a reviewer (Chromium-based browsers recommended)

For workflows where an agent and a reviewer iterate multiple times on the same machine.

```mermaid
sequenceDiagram
    participant Agent as LLM Agent
    participant Folder as Shared folder
    participant Browser as Browser
    participant Reviewer as Reviewer
    loop Each round
      Agent->>Folder: Generate mdFileName-docHash-review.html<br/>via npx mdxg-redline
      Folder->>Browser: CLI auto-launches the default browser
      Reviewer->>Browser: Select text → add comments
      Reviewer->>Browser: Click Write feedback.json
      Browser->>Folder: Write mdFileName-docHash-feedback.json
      Folder->>Agent: Pair review/feedback by shared prefix
      Note over Agent: Generate revised markdown → next round
    end
```

1. The agent runs `npx mdxg-redline <input.md> <folder>` to generate `<mdFileName>-<docHash>-review.html` in a shared folder (`mdFileName` is the basename with the `.md` / `.markdown` extension stripped; `docHash` is the first 16 hex chars of SHA-256 over the markdown body)
2. The CLI launches the default browser with that HTML. The reviewer writes comments
3. The reviewer clicks `Write feedback.json` (split button in the comments panel). On first use, a picker prompts for the output folder and the handle is persisted to IndexedDB; subsequent clicks write to the same folder without re-prompting
4. `<mdFileName>-<docHash>-feedback.json` is written into the same folder (sharing the same `<mdFileName>` / `<docHash>` as the source `review.html`, so pairs can be matched mechanically)
5. The agent reads the matching feedback.json, prepares a revised markdown, and starts the next round with `npx mdxg-redline <input2.md> <folder>` — repeat

`Write feedback.json` relies on the File System Access API, so only Chromium-based browsers (Chrome / Edge / Arc / Brave / Opera) support it. On Safari / Firefox, fall back to `Comments ▾ → Export as JSON` (download) or `Copy as JSON` (clipboard).

See [docs/DESIGN.md §8 Workspace Protocol](docs/DESIGN.md#8-ワークスペースプロトコル) for the full file-naming protocol and lifecycle.

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

## Excluding generated artifacts from git

When the output directory (the CLI's `output-dir` or the folder chosen via `Write feedback.json`) lives inside a git repository, add the following patterns to `.gitignore` so that review artifacts are not accidentally committed:

```gitignore
*-review.html
*-feedback.json
```

## MDXG compliance status

The [Markdown Experience Guidelines (MDXG)](https://github.com/vercel-labs/mdxg) are currently a preview specification and may change. MDXG Redline embeds an **MDXG Viewer** (the read-only rendering conformance level) and layers inline commenting and structured feedback JSON export on top of it as review-specific features. Viewer features are being adopted incrementally.

| MDXG section             | Required level | Current status                                                                           |
| ------------------------ | -------------- | ---------------------------------------------------------------------------------------- |
| §1 Theming               | MUST (Viewer)  | Compliant (DADS theme + 3-state toggle following `prefers-color-scheme`)                 |
| §2 Code Block Rendering  | MUST (Viewer)  | Compliant (Shiki dual theme over 27 languages, copy button injected per block)           |
| §3 Task Lists            | MUST (Viewer)  | Supported via marked defaults                                                            |
| §4 Images                | MUST (Viewer)  | Partial (relative image paths not resolved due to the trust boundary)                    |
| §5 Tables                | MUST (Viewer)  | Compliant (horizontal scrolling supported)                                               |
| §6 Virtual Pages         | MUST (Viewer)  | Compliant (H1 / H2 boundary split, ATX / setext forms, code-fence tracking)              |
| §7 Page Navigation       | MUST (Viewer)  | Compliant (Stacked View with all pages stacked vertically, left TOC + page scroll-spy)   |
| §8 Page Outline          | MUST (Viewer)  | Compliant (H3–H6 inline outline under the active page + IntersectionObserver scroll-spy) |
| §9 Sequential Navigation | MUST (Viewer)  | Compliant (Prev / Next row integrated into the left TOC header, hidden at boundaries)    |
| §10 Search               | MUST (Viewer)  | Not supported yet                                                                        |
| §13 Keyboard Navigation  | MUST (Viewer)  | Partial (accessible names audited, page-nav keyboard operations not yet implemented)     |

For the roadmap ahead, see [docs/DESIGN.md §12 MDXG compliance roadmap and future extensions](docs/DESIGN.md#12-mdxg-準拠ロードマップ今後の拡張).

## Development

The build tool is [Vite+ (vp)](https://viteplus.dev/), installed via npm (`vite-plus`) as a dev dependency. The devcontainer and `local_setup.sh` handle setup, so using those is the fastest path for local development.

```bash
npm ci
npm run build                  # Generates both dist/review.html (distribution HTML) and dist/review-request.mjs (review-request CLI)
npm run build:review-request   # = vp build --config vite.review-request.config.ts  rebuilds the review-request CLI only
npm run build:watch # = vp build --watch  rebuilds review.html on file changes
npm run dev         # = vp dev           dev server with HMR
npm test            # = vp test          runs in-source tests
```

`npm ci` will install `vp` locally from `vite-plus`.

## License

MIT
