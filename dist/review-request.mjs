#!/usr/bin/env node
import { basename, dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import process from "node:process";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
//#region src/cli-parse-args.ts
var NO_OPEN_FLAG = "--no-open";
var HELP_FLAGS = new Set(["--help", "-h"]);
var DOCUMENT_NAME_FLAG = "--document-name";
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
  --no-open              Generate the HTML but do not launch a browser.
  -h, --help             Print this help and exit. Takes precedence over all
                         other arguments and flags when present.

Examples:
  mdxg-redline spec.md
  mdxg-redline spec.md ./reviews
  mdxg-redline --no-open spec.md
  cat spec.md | mdxg-redline - --document-name spec.md
`;
var INITIAL_PARTITION_STATE = {
	documentName: null,
	open: true,
	pendingDocName: false,
	positional: [],
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
var consumeFlag = (acc, token) => {
	if (token === NO_OPEN_FLAG) return {
		...acc,
		open: false
	};
	if (token === DOCUMENT_NAME_FLAG) return {
		...acc,
		pendingDocName: true
	};
	return {
		...acc,
		valid: false
	};
};
var stepArg = (acc, token) => {
	if (!acc.valid) return acc;
	if (acc.pendingDocName) return consumeDocNameValue(acc, token);
	if (token.startsWith("--")) return consumeFlag(acc, token);
	return {
		...acc,
		positional: [...acc.positional, token]
	};
};
var partitionArgs = (argv) => {
	const state = argv.reduce(stepArg, INITIAL_PARTITION_STATE);
	const valid = state.valid && !state.pendingDocName;
	const result = {
		open: state.open,
		positional: state.positional,
		valid
	};
	if (state.documentName !== null) result.documentName = state.documentName;
	return result;
};
var buildRunArgs = (parts) => {
	const [inputPath, outputDir] = parts.positional;
	const result = {
		inputPath,
		mode: "run",
		open: parts.open
	};
	if (typeof outputDir === "string") result.outputDir = outputDir;
	if (typeof parts.documentName === "string") result.documentName = parts.documentName;
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
//#region src/escape.ts
var REPLACEMENTS = {
	"\"": "&quot;",
	"&": "&amp;",
	"'": "&#39;",
	"<": "&lt;",
	">": "&gt;"
};
var escapeHtml = (value) => value.replace(/[&<>"']/g, (ch) => REPLACEMENTS[ch] || ch);
//#endregion
//#region src/embed-core.ts
/**
* markdown 本文の SHA-256 を計算し、先頭 8 バイトを 16 文字の hex 文字列で返す。
* docHash としてファイル命名規約 (`<mdFileName>-<docHash>-...`) や
* Workspace の差分検知に使う。同一ロジックを review.ts でも `hashStr` として呼び出すため、
* 文字列化アルゴリズムは両者で一致させる必要がある。
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
/**
* markdown 本文を `<script>` タグに埋め込み可能な JSON 文字列にエンコードする。
* `JSON.stringify` で JSON 文字列化したうえで、`<` を JSON の Unicode escape `<` に置換する。
* これにより HTML パーサが `<\/script>` を閉じタグとして認識する可能性をゼロにしつつ、
* 復元側は `JSON.parse` のみで Unicode escape も含めて元の markdown 1 文字に戻せる。
*/
var encodeEmbeddedMarkdown = (markdown) => JSON.stringify(markdown).replace(/</g, String.raw`\u003C`);
var EMBEDDED_MD_RE = /(<script\b(?=[^>]*\bid="embedded-md")(?=[^>]*\btype="text\/markdown")[^>]*>)([\s\S]*?)(<\/script>)/i;
var DATA_NAME_RE = /\bdata-name="[^"]*"/;
var replaceDataName = (openingTag, escapedName) => {
	if (DATA_NAME_RE.test(openingTag)) return openingTag.replace(DATA_NAME_RE, `data-name="${escapedName}"`);
	return openingTag.replace(/>$/, ` data-name="${escapedName}">`);
};
/**
* review.html の文字列を受け取り、`<script id="embedded-md">` の中身と data-name 属性を
* 書き換えた新しい HTML 文字列を返す。元文字列は変更しない。
* embedded-md タグが見つからない場合は Error を投げる（呼び出し側が CLI エラーに変換）。
*/
var rewriteReviewHtml = (reviewHtml, markdown, docName) => {
	const match = EMBEDDED_MD_RE.exec(reviewHtml);
	if (!match) throw new Error("review.html に id=\"embedded-md\" の <script> タグが見つかりません");
	const [fullMatch, openingTag, , closingTag] = match;
	const replaced = `${replaceDataName(openingTag, escapeHtml(docName))}${encodeEmbeddedMarkdown(markdown)}${closingTag}`;
	return reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length);
};
//#endregion
//#region src/cli-open-command.ts
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
//#region src/cli-serve.ts
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
//#region src/cli-input-source.ts
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
//#region src/review-request.ts
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
		docName: input.docName,
		markdown: input.markdown,
		outputPath,
		reviewHtml
	};
};
var runEmbed = async (args) => {
	const ctx = await prepareEmbed(args);
	const result = rewriteReviewHtml(ctx.reviewHtml, ctx.markdown, ctx.docName);
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
export {};
