export const messagesCliEn = {
  'cli.clean.deleted_summary': 'Deleted {count} file(s) in {dir}.',
  'cli.clean.dry_run_header': '[dry-run] Would delete {count} file(s) in {dir}:',
  'cli.clean.kept_header': 'Kept {count} file(s) matching --keep:',
  'cli.clean.kept_summary': 'Kept {count} file(s) matching --keep.',
  'cli.clean.no_files_found': 'No review/feedback artifacts found in {dir}.',
  'cli.clean.run_with_yes_hint': 'Run with --yes to delete.',
  'cli.error.asset_missing': '{path} not found. Run `npm run build` first to generate {target}.',
  'cli.error.browser_launch_failed':
    'review-request: failed to launch browser ({command}: {message}). Open the path above manually.',
  'cli.error.clean_specified_multiple':
    '{flag}: specified more than once (use it only once to avoid wiping the wrong directory)',
  'cli.error.invalid_arguments':
    'mdxg-redline: invalid arguments: {detail}. Run `mdxg-redline --help` for usage.',
  'cli.error.invalid_arguments_no_detail':
    'mdxg-redline: invalid arguments. Run `mdxg-redline --help` for usage.',
  'cli.error.invalid_flag_value': "{flag}: invalid value '{token}' (expected {expected})",
  'cli.error.invalid_lang': '--lang must be one of: auto, en, ja',
  'cli.error.missing_flag_value': '{flag}: missing value (expected {expected})',
  'cli.error.missing_input_markdown': 'missing input markdown (expected <input.md|-> [output-dir])',
  'cli.error.too_many_positional_args':
    'too many positional arguments: {count} (expected at most 2: <input.md|-> [output-dir])',
  'cli.error.unexpected': 'review-request: unexpected error: {message}',
  'cli.error.unknown_option': 'unknown option: {token}',
  'cli.feedback_hash_mismatch':
    '(skipped resuming {path}: docHash mismatch — got {got}, expected {expected})',
  'cli.feedback_invalid_json': '(skipped resuming {path}: invalid JSON)',
  'cli.feedback_read_failed': '(skipped resuming {path}: read failed with {code})',
  'cli.feedback_resumed': 'Resumed {count} comment(s) from {path}.',
  'cli.help.arguments_block': `Arguments:
  <input.md>             Path to a markdown file. Pass \`-\` to read from stdin.
  [output-dir]           Output directory. Defaults to the input file's
                         directory; for stdin input, defaults to the current
                         working directory. Output filename is auto-derived
                         as <mdFileName>-<docHash>-review.html.`,
  'cli.help.cleanup_block': `Cleanup mode:
  --clean [dir]          Remove all *-<docHash>-review.html and
                         *-<docHash>-feedback.json files in <dir> (top level
                         only). <dir> defaults to the current directory when
                         omitted. By default runs in dry-run mode and only
                         prints the candidates; pass --yes to actually delete.
  --yes                  With --clean, perform deletion (no prompt). Without
                         --yes, --clean is dry-run.
  --keep <docHash>       With --clean, preserve files whose 16-hex docHash
                         matches. May be repeated.
  -r, --recursive        With --clean, also descend into subdirectories
                         (default: top level only).`,
  'cli.help.description':
    'Generate a review-request HTML with the markdown embedded and open it in your default browser.',
  'cli.help.examples_block': `Examples:
  mdxg-redline spec.md
  mdxg-redline spec.md ./reviews
  mdxg-redline --no-open spec.md
  mdxg-redline --theme dark spec.md
  cat spec.md | mdxg-redline - --document-name spec.md
  mdxg-redline --clean
  mdxg-redline --clean ./reviews
  mdxg-redline --clean ./reviews --yes
  mdxg-redline --clean ./reviews --keep a1b2c3d4e5f6a7b8 --yes
  mdxg-redline --clean ./reviews --recursive --yes`,
  'cli.help.options_block': `Options:
  --document-name <name> Override the document name used for the data-name
                         attribute and the output filename prefix. Useful
                         with stdin input.
  --theme <value>        Set the initial theme hint for the generated HTML.
                         One of: system | light | dark. Written as a
                         <html data-theme> attribute. Takes precedence over
                         the viewer's localStorage at every reload (the CLI
                         hint always wins on initial paint; UI toggle clicks
                         override only within the current session, and a
                         subsequent reload re-applies the CLI hint). Omit to
                         leave the attribute off entirely.
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
                         takes precedence over the viewer's localStorage at
                         every reload (UI drags / toggle-tab clicks override
                         only within the current session; reload re-applies
                         the CLI hint). Omit to leave the attribute off
                         entirely.
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
  --lang <value>         Set the CLI's output language for help and error messages.
                         One of: auto (infer from $LC_ALL > $LC_MESSAGES > $LANG,
                         default), en, ja. Affects only CLI output; generated HTML
                         resolves its own display language from localStorage /
                         navigator.language (CLI hint is not embedded). Unlike
                         --shiki-langs / --mermaid / --math, "auto" here infers
                         from env, not by scanning the markdown body.
  --no-open              Generate the HTML but do not launch a browser.
  --show-open-file       Keep the "Open file" item visible in the generated
                         HTML's Open ▾ menu. By default (without this flag),
                         CLI output hides the item to prevent accidentally
                         loading a different markdown (which would discard the
                         current comments). The standalone HTML — opened
                         directly without the CLI — always shows the item.
  --show-paste-markdown  Keep the "Paste markdown" item visible in the
                         generated HTML's Open ▾ menu. By default (without
                         this flag), CLI output hides the item for the same
                         reason as --show-open-file (paste also replaces the
                         currently loaded markdown and discards comments).
                         The standalone HTML always shows the item.
  -h, --help             Print this help and exit. Takes precedence over all
                         other arguments and flags when present.`,
  'cli.help.usage': 'Usage: mdxg-redline [options] <input.md|-> [output-dir]',
  'cli.katex_escaped_script': '(escaped {count} literal </script> in KaTeX runtime)',
  'cli.katex_injection':
    'Detected {count} math expression(s). Embedding KaTeX runtime (fonts={mode}, {size} gzipped).',
  'cli.mermaid_escaped_script': '(escaped {count} literal </script> in mermaid runtime)',
  'cli.mermaid_injection':
    'Detected {count} mermaid block(s). Embedding mermaid runtime (+~700 KB gzipped).',
  'cli.port_in_use_fallback':
    'review-request: port {preferred} is in use, falling back to {random}. Override the default with {var}. The browser-side IndexedDB silent restore (Write feedback.json target memory) may not work this time.',
  'cli.port_invalid':
    'review-request: {var}="{value}" is not a valid port number, using {default}.',
  'cli.serve_address_failed': 'Failed to obtain the HTTP server address.',
  'cli.serve_remote_started':
    'review-request: detected VS Code Remote. HTTP server started at {url}. Auto-stops {seconds1}s after first access, or {seconds2}s without requests.',
} as const

export type CliMessageKey = keyof typeof messagesCliEn
