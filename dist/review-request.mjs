#!/usr/bin/env node
import { marked } from "marked";
import { basename, dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import process from "node:process";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
//#region src/core/shiki-aliases.generated.ts
var SHIKI_SUPPORTED_LANGS = [
	"c",
	"cpp",
	"css",
	"diff",
	"go",
	"html",
	"java",
	"javascript",
	"json",
	"jsx",
	"kotlin",
	"lua",
	"markdown",
	"php",
	"python",
	"ruby",
	"rust",
	"scala",
	"shellscript",
	"sql",
	"swift",
	"toml",
	"tsx",
	"typescript",
	"xml",
	"yaml",
	"zig"
];
var ALIAS_TO_CANONICAL = {
	bash: "shellscript",
	c: "c",
	"c++": "cpp",
	cjs: "javascript",
	cpp: "cpp",
	css: "css",
	cts: "typescript",
	diff: "diff",
	go: "go",
	html: "html",
	java: "java",
	javascript: "javascript",
	js: "javascript",
	json: "json",
	jsx: "jsx",
	kotlin: "kotlin",
	kt: "kotlin",
	kts: "kotlin",
	lua: "lua",
	markdown: "markdown",
	md: "markdown",
	mjs: "javascript",
	mts: "typescript",
	php: "php",
	py: "python",
	python: "python",
	rb: "ruby",
	rs: "rust",
	ruby: "ruby",
	rust: "rust",
	scala: "scala",
	sh: "shellscript",
	shell: "shellscript",
	shellscript: "shellscript",
	sql: "sql",
	swift: "swift",
	toml: "toml",
	ts: "typescript",
	tsx: "tsx",
	typescript: "typescript",
	xml: "xml",
	yaml: "yaml",
	yml: "yaml",
	zig: "zig",
	zsh: "shellscript"
};
//#endregion
//#region src/core/scan-fenced-langs.ts
var isTokenLike = (value) => {
	if (typeof value !== "object" || value === null) return false;
	return typeof value.type === "string";
};
/**
* フェンスの info string (例: `ts foo=bar`) から先頭の言語識別子だけを取り出して
* Shiki 正規名にマップする。エイリアス・大文字混入も含めて正規化する。
* 該当なしの場合は null を返し、呼び出し側で plain text fallback に倒す判断に使う。
*/
var normalizeLangIdentifier = (raw) => {
	if (typeof raw !== "string") return null;
	const [head] = raw.trim().split(/\s+/u, 1);
	if (!head) return null;
	return ALIAS_TO_CANONICAL[head.toLowerCase()] ?? null;
};
var collectCodeLang = (token, acc) => {
	if (token.type !== "code" || typeof token.lang !== "string") return;
	const canonical = normalizeLangIdentifier(token.lang);
	if (canonical !== null) acc.add(canonical);
};
var walkTokens = (tokens, acc) => {
	if (!Array.isArray(tokens)) return;
	for (const token of tokens) if (isTokenLike(token)) {
		collectCodeLang(token, acc);
		walkTokens(token.tokens, acc);
		walkTokens(token.items, acc);
	}
};
/**
* markdown 全体を走査して、フェンスで指定された言語の Shiki 正規名集合を返す。
* 入力 markdown が空 / フェンスなし / 全部 plain fallback でも空 Set を返す。
*/
var scanFencedLangs = (markdown) => {
	const acc = /* @__PURE__ */ new Set();
	walkTokens(marked.lexer(markdown), acc);
	return acc;
};
//#endregion
//#region src/cli/parse-args.ts
var NO_OPEN_FLAG = "--no-open";
var HELP_FLAGS = new Set(["--help", "-h"]);
var DOCUMENT_NAME_FLAG = "--document-name";
var THEME_FLAG = "--theme";
var SHIKI_LANGS_FLAG = "--shiki-langs";
var THEME_VALUES = [
	"system",
	"light",
	"dark"
];
var isThemeHint = (value) => THEME_VALUES.includes(value);
var parseShikiLangsKeyword = (trimmed) => {
	if (trimmed === "auto") return { kind: "auto" };
	if (trimmed === "all") return { kind: "all" };
	if (trimmed === "none") return { kind: "none" };
	return null;
};
var parseShikiLangsList = (trimmed) => {
	const tokens = trimmed.split(",").map((token) => token.trim()).filter((token) => token.length > 0);
	const langs = /* @__PURE__ */ new Set();
	for (const token of tokens) {
		const canonical = normalizeLangIdentifier(token);
		if (canonical !== null) langs.add(canonical);
	}
	return {
		kind: "list",
		langs
	};
};
/**
* `--shiki-langs` の値を ShikiLangsMode にパースする。pure な関数で、CLI 引数パースと
* 単体テストの両方から再利用する。空白だけ / 未サポートのみは空 list (= none と等価) を返す。
*/
var parseShikiLangsValue = (value) => parseShikiLangsKeyword(value.trim()) ?? parseShikiLangsList(value.trim());
var HELP_TEXT = `Usage: mdxg-redline [options] <input.md|-> [output-dir]

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
                           all   Embed all 27 supported grammars (heaviest).
                           none  Embed no grammars (all code blocks render as
                                 plain text).
                           <csv> Comma-separated list of language identifiers
                                 (e.g. ts,js,py). Aliases are normalized to
                                 canonical names; unsupported entries are
                                 silently ignored.
  --no-open              Generate the HTML but do not launch a browser.
  -h, --help             Print this help and exit. Takes precedence over all
                         other arguments and flags when present.

Examples:
  mdxg-redline spec.md
  mdxg-redline spec.md ./reviews
  mdxg-redline --no-open spec.md
  mdxg-redline --theme dark spec.md
  cat spec.md | mdxg-redline - --document-name spec.md
`;
var INITIAL_PARTITION_STATE = {
	documentName: null,
	open: true,
	pendingDocName: false,
	pendingShikiLangs: false,
	pendingTheme: false,
	positional: [],
	shikiLangs: null,
	themeHint: null,
	valid: true
};
var consumeDocNameValue = (acc, token) => {
	if (token.startsWith("--")) return {
		...acc,
		valid: false
	};
	return {
		...acc,
		documentName: token,
		pendingDocName: false
	};
};
var consumeThemeValue = (acc, token) => {
	if (token.startsWith("--") || !isThemeHint(token)) return {
		...acc,
		valid: false
	};
	return {
		...acc,
		pendingTheme: false,
		themeHint: token
	};
};
var consumeShikiLangsValue = (acc, token) => {
	if (token.startsWith("--")) return {
		...acc,
		valid: false
	};
	return {
		...acc,
		pendingShikiLangs: false,
		shikiLangs: parseShikiLangsValue(token)
	};
};
var consumeFlag = (acc, token) => {
	if (token === NO_OPEN_FLAG) return {
		...acc,
		open: false
	};
	if (token === DOCUMENT_NAME_FLAG) return {
		...acc,
		pendingDocName: true
	};
	if (token === THEME_FLAG) return {
		...acc,
		pendingTheme: true
	};
	if (token === SHIKI_LANGS_FLAG) return {
		...acc,
		pendingShikiLangs: true
	};
	return {
		...acc,
		valid: false
	};
};
var consumePendingValue = (acc, token) => {
	if (acc.pendingDocName) return consumeDocNameValue(acc, token);
	if (acc.pendingTheme) return consumeThemeValue(acc, token);
	if (acc.pendingShikiLangs) return consumeShikiLangsValue(acc, token);
	return null;
};
var stepArg = (acc, token) => {
	if (!acc.valid) return acc;
	const pending = consumePendingValue(acc, token);
	if (pending !== null) return pending;
	if (token.startsWith("--")) return consumeFlag(acc, token);
	return {
		...acc,
		positional: [...acc.positional, token]
	};
};
var attachPartitionOptionals = (result, state) => {
	if (state.documentName !== null) result.documentName = state.documentName;
	if (state.themeHint !== null) result.themeHint = state.themeHint;
	if (state.shikiLangs !== null) result.shikiLangs = state.shikiLangs;
};
var partitionArgs = (argv) => {
	const state = argv.reduce(stepArg, INITIAL_PARTITION_STATE);
	const valid = state.valid && !state.pendingDocName && !state.pendingTheme && !state.pendingShikiLangs;
	const result = {
		open: state.open,
		positional: state.positional,
		valid
	};
	attachPartitionOptionals(result, state);
	return result;
};
var attachRunOptionals = (result, parts) => {
	const [, outputDir] = parts.positional;
	if (typeof outputDir === "string") result.outputDir = outputDir;
	if (typeof parts.documentName === "string") result.documentName = parts.documentName;
	if (typeof parts.themeHint === "string") result.themeHint = parts.themeHint;
	if (parts.shikiLangs) result.shikiLangs = parts.shikiLangs;
};
var buildRunArgs = (parts) => {
	const [inputPath] = parts.positional;
	const result = {
		inputPath,
		mode: "run",
		open: parts.open
	};
	attachRunOptionals(result, parts);
	return result;
};
var parseArgs = (argv) => {
	if (argv.length === 0) return { mode: "help" };
	if (argv.some((token) => HELP_FLAGS.has(token))) return { mode: "help" };
	const parts = partitionArgs(argv);
	if (!parts.valid) return { mode: "invalid" };
	if (parts.positional.length < 1 || parts.positional.length > 2) return { mode: "invalid" };
	return buildRunArgs(parts);
};
var sanitizeMdFileName = (name) => {
	const cleaned = name.replace(/\p{Cc}/gu, "_").replace(/[\\/]/g, "_");
	if (cleaned === "" || cleaned === "." || cleaned === "..") return "_";
	if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(cleaned)) return `${cleaned}_`;
	return cleaned;
};
//#endregion
//#region src/core/escape.ts
var REPLACEMENTS = {
	"\"": "&quot;",
	"&": "&amp;",
	"'": "&#39;",
	"<": "&lt;",
	">": "&gt;"
};
var escapeHtml = (value) => value.replace(/[&<>"']/g, (ch) => REPLACEMENTS[ch] || ch);
//#endregion
//#region src/core/embed.ts
/**
* markdown 本文の SHA-256 を計算し、先頭 8 バイトを 16 文字の hex 文字列で返す。
* docHash としてファイル命名規約 (`<mdFileName>-<docHash>-...`) や
* Workspace の差分検知に使う。CLI とブラウザの双方からこの関数を直接呼ぶことで、
* docHash の計算結果がプロセスを跨いで一致することを保証する。
*/
var computeDocHash = async (markdown) => {
	const buf = new TextEncoder().encode(markdown);
	const hash = await crypto.subtle.digest("SHA-256", buf);
	return [...new Uint8Array(hash)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
/**
* MD ファイル名から `.md` / `.markdown` 拡張子を除いた basename を返す。
* 大文字小文字無視。拡張子が無いファイル名はそのまま返す。
* ファイル命名規約 §8 の `mdFileName` 部分を組み立てるベース。
*/
var stripMarkdownExt = (filename) => filename.replace(/\.(?:markdown|md)$/i, "");
/** ファイル命名規約 §8 に従って配布用 HTML のファイル名を組み立てる */
var deriveReviewHtmlName = (mdFileName, docHash) => `${mdFileName}-${docHash}-review.html`;
var escapeJsonForScriptTag = (jsonString) => jsonString.replace(/</g, String.raw`\u003C`);
/**
* markdown 本文を `<script id="embedded-md">` に埋め込み可能な JSON 文字列にエンコードする。
* 復元は `JSON.parse` のみで完結する。
*/
var encodeEmbeddedMarkdown = (markdown) => escapeJsonForScriptTag(JSON.stringify(markdown));
/**
* Shiki grammar の集合を `<script id="embedded-shiki-langs">` に埋め込み可能な JSON 文字列に
* エンコードする。grammars は `{ <canonical>: LanguageRegistration[] }` 形式の plain object で、
* 復元側 (browser) は `JSON.parse` した後 createHighlighterCoreSync の `langs` に値を渡す。
*/
var encodeEmbeddedShikiLangs = (grammars) => escapeJsonForScriptTag(JSON.stringify(grammars));
var EMBEDDED_MD_RE = /(<script\b(?=[^>]*\bid="embedded-md")(?=[^>]*\btype="text\/markdown")[^>]*>)([\s\S]*?)(<\/script>)/i;
var STATUS_SPAN_RE = /(<span\b(?=[^>]*\bid="status")[^>]*>)([\s\S]*?)(<\/span>)/i;
var HEAD_OPEN_RE = /<head\b[^>]*>/i;
var EMBEDDED_MD_META_RE = /\s*<meta\b[^>]*\bname="mdxg-redline:embedded-md"[^>]*\/?>/i;
/**
* 「ロード済み」状態のステータステキストを組み立てる。CLI 経由配布物の paint 前確定と、
* JS 起動後の loadFromMarkdown 完了表示で同じ文字列を使うことで初期描画と JS 描画が一致する。
*/
var formatLoadedStatus = (docName, docHash) => `${docName} (${docHash}) · loaded`;
/**
* `<span id="status">` の中身を CLI が書き換える。paint 前から最終状態を見せることで、
* JS の loadFromMarkdown が走るまで「No file」が一瞬見える FOUC を構造的に防ぐ。
*/
var rewriteInitialStatus = (reviewHtml, statusText) => {
	const match = STATUS_SPAN_RE.exec(reviewHtml);
	if (!match) throw new Error("review.html に id=\"status\" の <span> タグが見つかりません");
	const [fullMatch, openingTag, , closingTag] = match;
	const replaced = `${openingTag}${escapeHtml(statusText)}${closingTag}`;
	return reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length);
};
/**
* paint 前介入用の <meta> を <head> 直下に挿入する (既存があれば置換、idempotent)。
* <head> 内 inline script がこの meta を検出して `<html>.has-embedded-md` を付ける仕組みで、
* body 内の `<script id="embedded-md">` 直後で判定する方式より早期に介入できる。
*/
var upsertEmbeddedMdMeta = (reviewHtml) => {
	const cleaned = reviewHtml.replace(EMBEDDED_MD_META_RE, "");
	const headMatch = HEAD_OPEN_RE.exec(cleaned);
	if (!headMatch) throw new Error("review.html に <head> タグが見つかりません");
	const insertPos = headMatch.index + headMatch[0].length;
	return cleaned.slice(0, insertPos) + "\n    <meta name=\"mdxg-redline:embedded-md\" content=\"1\" />" + cleaned.slice(insertPos);
};
var EMBEDDED_SHIKI_LANGS_RE = /(<script\b(?=[^>]*\bid="embedded-shiki-langs")(?=[^>]*\btype="application\/json")[^>]*>)([\s\S]*?)(<\/script>)/i;
var DATA_NAME_RE = /\bdata-name="[^"]*"/;
var HTML_TAG_RE = /<html\b[^>]*>/i;
var DATA_THEME_RE = /\bdata-theme="[^"]*"/;
var replaceDataName = (openingTag, escapedName) => {
	if (DATA_NAME_RE.test(openingTag)) return openingTag.replace(DATA_NAME_RE, `data-name="${escapedName}"`);
	return openingTag.replace(/>$/, ` data-name="${escapedName}">`);
};
var replaceDataTheme = (openingTag, escapedTheme) => {
	if (DATA_THEME_RE.test(openingTag)) return openingTag.replace(DATA_THEME_RE, `data-theme="${escapedTheme}"`);
	return openingTag.replace(/>$/, ` data-theme="${escapedTheme}">`);
};
/**
* `<html>` 開きタグに `data-theme="<themeHint>"` を挿入する。属性が既にあれば上書き。
* inline script はこの属性を localStorage より低い優先度で初期値ヒントとして使う。
* 未指定時は属性を付けないため、呼び出し側で themeHint の有無を判断してから呼ぶ
* (CLI 既定では --theme 未指定時はこの関数を呼ばない方針)。
*/
var upsertHtmlDataTheme = (reviewHtml, themeHint) => {
	const match = HTML_TAG_RE.exec(reviewHtml);
	if (!match) throw new Error("review.html に <html> タグが見つかりません");
	const [tag] = match;
	const newTag = replaceDataTheme(tag, escapeHtml(themeHint));
	return reviewHtml.slice(0, match.index) + newTag + reviewHtml.slice(match.index + tag.length);
};
/**
* `<script id="embedded-shiki-langs">` の中身を grammars の JSON で書き換える。
* - `grammars` が空オブジェクト `{}` でも JSON `{}` が書き込まれる (browser は空 langs として扱う)
* - 該当 `<script>` タグが review.html に無ければ Error を投げる (呼び出し側が CLI エラーに変換)
*
* embedded-md のように属性経由の上書きはなく、コンテンツ置換のみ。
*/
var rewriteEmbeddedShikiLangs = (reviewHtml, grammars) => {
	const match = EMBEDDED_SHIKI_LANGS_RE.exec(reviewHtml);
	if (!match) throw new Error("review.html に id=\"embedded-shiki-langs\" の <script> タグが見つかりません");
	const [fullMatch, openingTag, , closingTag] = match;
	const replaced = `${openingTag}${encodeEmbeddedShikiLangs(grammars)}${closingTag}`;
	return reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length);
};
/**
* review.html の文字列を受け取り、`<script id="embedded-md">` の中身と data-name 属性を
* 書き換えた新しい HTML 文字列を返す。元文字列は変更しない。
* embedded-md タグが見つからない場合は Error を投げる（呼び出し側が CLI エラーに変換）。
*
* theme 属性の付与は `upsertHtmlDataTheme` を別途呼ぶ責務分担にしている。
*/
var rewriteReviewHtml = (reviewHtml, markdown, docName) => {
	const match = EMBEDDED_MD_RE.exec(reviewHtml);
	if (!match) throw new Error("review.html に id=\"embedded-md\" の <script> タグが見つかりません");
	const [fullMatch, openingTag, , closingTag] = match;
	const replaced = `${replaceDataName(openingTag, escapeHtml(docName))}${encodeEmbeddedMarkdown(markdown)}${closingTag}`;
	return reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length);
};
//#endregion
//#region src/cli/open-command.ts
var isHostBrowserUnreachableViaFile = (env) => {
	if (env.REMOTE_CONTAINERS === "true") return true;
	if (env.CODESPACES === "true") return true;
	const browser = env.BROWSER ?? "";
	return browser.includes("vscode-server") && browser.includes("helpers/browser.sh");
};
var buildOpenCommand = (platform, path, env = process.env) => {
	if (env.BROWSER) return {
		args: [path],
		command: env.BROWSER
	};
	if (platform === "darwin") return {
		args: [path],
		command: "open"
	};
	if (platform === "win32") return {
		args: [
			"/c",
			"start",
			"\"\"",
			path
		],
		command: "cmd.exe"
	};
	return {
		args: [path],
		command: "xdg-open"
	};
};
var openInBrowser = async (path) => new Promise((done) => {
	const { args, command } = buildOpenCommand(process.platform, path, process.env);
	execFile(command, args, (error) => {
		if (error) process.stderr.write(`review-request: ブラウザを起動できませんでした (${command}: ${error.message})。上記のパスを手動で開いてください。\n`);
		done();
	});
});
//#endregion
//#region src/cli/serve.ts
var SERVE_AUTOSTOP_MS = 1e4;
var SERVE_GIVEUP_MS = 6e4;
var SERVE_HOST = "127.0.0.1";
var DEFAULT_PORT = 51729;
var PORT_ENV_VAR = "MDXG_REDLINE_PORT";
var resolvePreferredPort = (env) => {
	const raw = env[PORT_ENV_VAR];
	if (!raw) return DEFAULT_PORT;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		process.stderr.write(`review-request: ${PORT_ENV_VAR}="${raw}" は有効なポート番号ではないため ${String(DEFAULT_PORT)} を使います。\n`);
		return DEFAULT_PORT;
	}
	return parsed;
};
var isPortInUseError = (error) => error instanceof Error && "code" in error && error.code === "EADDRINUSE";
var tryListen = async (server, port) => new Promise((resolveFn, rejectFn) => {
	const listeners = {
		onError: () => {},
		onListening: () => {}
	};
	listeners.onError = (error) => {
		server.removeListener("listening", listeners.onListening);
		rejectFn(error);
	};
	listeners.onListening = () => {
		server.removeListener("error", listeners.onError);
		const addr = server.address();
		if (addr === null || typeof addr === "string") {
			rejectFn(/* @__PURE__ */ new Error("HTTP サーバーのアドレス取得に失敗しました"));
			return;
		}
		resolveFn({
			port: addr.port,
			server
		});
	};
	server.once("error", listeners.onError);
	server.once("listening", listeners.onListening);
	server.listen(port, SERVE_HOST);
});
var listenWithFallback = async (server, preferred) => {
	try {
		return await tryListen(server, preferred);
	} catch (error) {
		if (!isPortInUseError(error)) throw error;
	}
	const result = await tryListen(server, 0);
	process.stderr.write(`review-request: ポート ${String(preferred)} が使用中のため ${String(result.port)} を使います。${PORT_ENV_VAR} でデフォルトを上書きできます。今回はブラウザ側 IndexedDB のサイレント復元 (Write feedback.json の保存先記憶) が効かない可能性があります。\n`);
	return result;
};
var serveOnceAndAutoStop = async (filePath) => {
	const server = createServer((_req, res) => {
		res.writeHead(200, {
			Connection: "close",
			"Content-Type": "text/html; charset=utf-8"
		});
		createReadStream(filePath).pipe(res);
	});
	const listened = await listenWithFallback(server, resolvePreferredPort(process.env));
	return {
		done: new Promise((doneResolve) => {
			const giveup = setTimeout(() => {
				server.close(() => doneResolve());
			}, SERVE_GIVEUP_MS);
			server.once("request", () => {
				clearTimeout(giveup);
				setTimeout(() => {
					server.close(() => doneResolve());
				}, SERVE_AUTOSTOP_MS);
			});
		}),
		url: `http://localhost:${String(listened.port)}/${encodeURIComponent(basename(filePath))}`
	};
};
var openOutput = async (outputPath) => {
	if (!isHostBrowserUnreachableViaFile(process.env)) {
		await openInBrowser(outputPath);
		return;
	}
	const handle = await serveOnceAndAutoStop(outputPath);
	process.stderr.write(`review-request: VS Code Remote 環境を検知。HTTP サーバーを ${handle.url} で起動しました。初回アクセス後 ${SERVE_AUTOSTOP_MS / 1e3} 秒、リクエストが無ければ ${SERVE_GIVEUP_MS / 1e3} 秒で自動停止します。\n`);
	await openInBrowser(handle.url);
	await handle.done;
};
//#endregion
//#region src/cli/input-source.ts
var STDIN_TOKEN = "-";
var STDIN_DEFAULT_DOC_NAME = "stdin.md";
var toBuffer = (chunk) => {
	if (Buffer.isBuffer(chunk)) return chunk;
	return Buffer.from(String(chunk), "utf8");
};
var readStdin = async () => {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(toBuffer(chunk));
	return Buffer.concat(chunks).toString("utf8");
};
var resolveInput = async (inputPath, documentName) => {
	if (inputPath === STDIN_TOKEN) {
		const markdown = await readStdin();
		return {
			defaultOutputDir: process.cwd(),
			docName: documentName ?? STDIN_DEFAULT_DOC_NAME,
			markdown
		};
	}
	const markdown = await readFile(inputPath, "utf8");
	return {
		defaultOutputDir: dirname(inputPath),
		docName: documentName ?? basename(inputPath),
		markdown
	};
};
//#endregion
//#region src/cli/review-request.ts
var errorMessage = (error) => {
	if (error instanceof Error) return error.message;
	return String(error);
};
var readReviewHtml = async (path) => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error(`${path} が見つかりません。先に \`npm run build\` を実行して dist/review.html を生成してください。`, { cause: error });
		throw error;
	}
};
var prepareEmbed = async (args) => {
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const [input, reviewHtml] = await Promise.all([resolveInput(args.inputPath, args.documentName), readReviewHtml(resolve(scriptDir, "review.html"))]);
	const docHash = await computeDocHash(input.markdown);
	const mdFileName = sanitizeMdFileName(stripMarkdownExt(input.docName));
	const outputPath = resolve(args.outputDir ?? input.defaultOutputDir, deriveReviewHtmlName(mdFileName, docHash));
	return {
		docHash,
		docName: input.docName,
		markdown: input.markdown,
		outputPath,
		reviewHtml,
		scriptDir
	};
};
var applyThemeHint = (html, themeHint) => {
	if (typeof themeHint !== "string") return html;
	return upsertHtmlDataTheme(html, themeHint);
};
/**
* `--shiki-langs` の指定 (未指定時は auto と同じ) から注入対象の正規名集合を決める pure 関数。
* - auto / 未指定: markdown を scan して使用されている grammar を集める
* - all: SHIKI_SUPPORTED_LANGS 全部
* - none: 空 Set
* - list: 指定された Set をそのまま使う
*/
var resolveShikiLangSet = (mode, markdown) => {
	if (!mode || mode.kind === "auto") return scanFencedLangs(markdown);
	if (mode.kind === "all") return new Set(SHIKI_SUPPORTED_LANGS);
	if (mode.kind === "none") return /* @__PURE__ */ new Set();
	return new Set(mode.langs);
};
var readGrammarJson = async (scriptDir, lang) => {
	const path = resolve(scriptDir, "shiki-langs", `${lang}.json`);
	try {
		const content = await readFile(path, "utf8");
		return JSON.parse(content);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error(`${path} が見つかりません。先に \`npm run build\` を実行して dist/shiki-langs/ を生成してください。`, { cause: error });
		throw error;
	}
};
var loadShikiGrammars = async (langs, scriptDir) => {
	const grammars = {};
	await Promise.all([...langs].map(async (lang) => {
		grammars[lang] = await readGrammarJson(scriptDir, lang);
	}));
	return grammars;
};
var applyShikiLangs = async (html, args, ctx) => {
	return rewriteEmbeddedShikiLangs(html, await loadShikiGrammars(resolveShikiLangSet(args.shikiLangs, ctx.markdown), ctx.scriptDir));
};
var composeReviewHtml = async (args, ctx) => {
	return upsertEmbeddedMdMeta(rewriteInitialStatus(await applyShikiLangs(applyThemeHint(rewriteReviewHtml(ctx.reviewHtml, ctx.markdown, ctx.docName), args.themeHint), args, ctx), formatLoadedStatus(ctx.docName, ctx.docHash)));
};
var runEmbed = async (args) => {
	const ctx = await prepareEmbed(args);
	const result = await composeReviewHtml(args, ctx);
	await writeFile(ctx.outputPath, result, "utf8");
	process.stdout.write(`${ctx.outputPath}\n`);
	if (args.open) await openOutput(ctx.outputPath);
};
var main = async () => {
	const args = parseArgs(process.argv.slice(2));
	if (args.mode === "help") {
		process.stdout.write(HELP_TEXT);
		return;
	}
	if (args.mode === "invalid") {
		process.stderr.write(`mdxg-redline: invalid arguments. Run \`mdxg-redline --help\` for usage.\n`);
		process.exit(1);
	}
	await runEmbed(args);
};
main().catch((error) => {
	process.stderr.write(`review-request: ${errorMessage(error)}\n`);
	process.exit(1);
});
//#endregion
export { resolveShikiLangSet };
