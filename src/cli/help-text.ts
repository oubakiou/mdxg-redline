// review-request CLI の usage テキスト。flag spec と並ぶ書き換え対象なので、
// parse-args.ts の parser logic から分離して 1 ファイルにまとめる。
// テキスト本体は CLI 仕様の単一の真実の源としてここに保持する。

export const HELP_TEXT = `Usage: mdxg-redline [options] <input.md|-> [output-dir]

Generate a review-request HTML with the markdown embedded and open it in
your default browser.

Arguments:
  <input.md>             Path to a markdown file. Pass \`-\` to read from stdin.
  [output-dir]           Output directory. Defaults to the input file's
                         directory; for stdin input, defaults to the current
                         working directory. Output filename is auto-derived
                         as <mdFileName>-<docHash>-review.html.

Options:
  --document-name <name> Override the document name used for the data-name
                         attribute and the output filename prefix. Useful
                         with stdin input.
  --theme <value>        Set the initial theme hint for the generated HTML.
                         One of: system | light | dark. Written as a
                         <html data-theme> attribute and used only when the
                         viewer has no localStorage preference yet (the user's
                         UI toggle history always wins). Omit to leave the
                         attribute off entirely.
  --shiki-langs <value>  Select which Shiki grammars to embed in the HTML
                         for syntax highlighting. One of:
                           auto  Scan the input markdown and embed only the
                                 grammars used by fenced blocks (default).
                           all   Embed all Shiki-bundled grammars (heaviest,
                                 ~235 languages, ~5.5 MB gzipped).
                           none  Embed no grammars (all code blocks render as
                                 plain text).
                           <csv> Comma-separated list of language identifiers
                                 (e.g. ts,js,py). Aliases are normalized to
                                 canonical names; unsupported entries are
                                 silently ignored.
  --comments-width <px>   Set the initial comments-panel width hint for the
                         generated HTML. One of:
                           0         Start with the comments panel closed (only the
                                     edge tab is visible until the user opens
                                     it).
                           280–640   Start open with the given width in pixels.
                         Written as a <html data-comments-width> attribute and
                         used only when the viewer has no localStorage
                         preference yet (the user's UI history always wins).
                         Omit to leave the attribute off entirely.
  --page-nav-width <px>  Set the initial document-pages panel (left TOC) width
                         hint. One of:
                           0         Start with the panel closed (only the left
                                     edge tab is visible).
                           180–480   Start open with the given width in pixels.
                         Written as a <html data-page-nav-width> attribute and
                         follows the same precedence rules as --comments-width.
  --mermaid <value>      Control Mermaid runtime injection for \`\`\`mermaid blocks.
                         One of:
                           auto  Inject Mermaid only if the markdown contains at
                                 least one \`\`\`mermaid block (default). Keeps
                                 distribution size minimal when not used.
                           on    Always inject. Adds ~700 KB gzipped to the
                                 distribution HTML.
                           off   Never inject. \`\`\`mermaid blocks fall back to
                                 Shiki-highlighted code blocks (MDXG §15 [MUST]).
  --math <value>         Control KaTeX runtime injection for $...$ / $$...$$
                         math expressions (MDXG §14). One of:
                           auto  Inject KaTeX only if the markdown contains at
                                 least one math expression (default).
                           on    Always inject. Adds ~250 / ~350 KB gzipped
                                 depending on --math-fonts.
                           off   Never inject. $...$ / $$...$$ render as raw
                                 markdown text (MDXG §14 [MUST]).
  --math-fonts <value>   Choose the KaTeX woff2 font set embedded as data URI
                         (only meaningful when KaTeX is injected). One of:
                           minimal  Main / AMS / Math / Size1-4 only, +~110 KB
                                    gzipped (default). \\mathcal / \\mathfrak /
                                    \\mathscr / SansSerif / Typewriter fall back
                                    to the host's system font.
                           all      Embed all 20 woff2 families, +~220 KB gzipped.
                                    Use when the document relies on rare math
                                    glyphs (\\mathcal{X}, \\mathfrak{X}, ...).
  --markdown-css <path>  Replace the bundled markdown preview stylesheet with the
                         CSS file at <path>. Targets only the markdown preview
                         (#doc scope). Layout / chrome (review.css) is not
                         affected. Useful for distributing review HTML with a
                         custom typographic theme.
  --no-open              Generate the HTML but do not launch a browser.
  --show-open-file       Keep the "Open file" button visible in the generated
                         HTML's header. By default (without this flag), CLI
                         output hides the button to prevent accidentally
                         loading a different markdown (which would discard the
                         current comments). The standalone HTML — opened
                         directly without the CLI — always shows the button.
  -h, --help             Print this help and exit. Takes precedence over all
                         other arguments and flags when present.

Cleanup mode:
  --clean <dir>          Remove all *-<docHash>-review.html and
                         *-<docHash>-feedback.json files in <dir> (top level
                         only). By default runs in dry-run mode and only
                         prints the candidates; pass --yes to actually delete.
  --yes                  With --clean, perform deletion (no prompt). Without
                         --yes, --clean is dry-run.
  --keep <docHash>       With --clean, preserve files whose 16-hex docHash
                         matches. May be repeated.

Examples:
  mdxg-redline spec.md
  mdxg-redline spec.md ./reviews
  mdxg-redline --no-open spec.md
  mdxg-redline --theme dark spec.md
  cat spec.md | mdxg-redline - --document-name spec.md
  mdxg-redline --clean ./reviews
  mdxg-redline --clean ./reviews --yes
  mdxg-redline --clean ./reviews --keep a1b2c3d4e5f6a7b8 --yes
`
