#!/usr/bin/env node
import { basename, dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
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
* markdown 本文中の `<\/script>` を `<\/script>` に置換する。
* script は raw text element のため、これだけで script タグの早期終了を回避できる。
* 大文字小文字を区別せずに `<\/SCRIPT...` などもまとめて捕まえつつ、原文の case は保持する。
*/
var escapeScriptContent = (markdown) => markdown.replace(/<(\/script)/gi, String.raw`<\$1`);
/**
* data-name 属性に書き込む値を HTML 属性文脈用にエスケープする。
* 属性はダブルクォートで囲む前提に固定しているため、ダブルクォートと特殊文字のみ対象。
* ブラウザは dataset.name 経由で自動デコードするため、boot.ts 側は無変更で良い。
*/
var escapeHtmlAttribute = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
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
	const replaced = `${replaceDataName(openingTag, escapeHtmlAttribute(docName))}${escapeScriptContent(markdown)}${closingTag}`;
	return reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length);
};
//#endregion
//#region src/review-request.ts
var USAGE = "Usage: review-request [--no-open] <input.md> [output-dir]";
var NO_OPEN_FLAG = "--no-open";
var SERVE_AUTOSTOP_MS = 1e4;
var SERVE_GIVEUP_MS = 6e4;
var SERVE_HOST = "127.0.0.1";
var isHostBrowserUnreachableViaFile = (env) => {
	if (env.REMOTE_CONTAINERS === "true") return true;
	if (env.CODESPACES === "true") return true;
	const browser = env.BROWSER ?? "";
	return browser.includes("vscode-server") && browser.includes("helpers/browser.sh");
};
var errorMessage = (error) => {
	if (error instanceof Error) return error.message;
	return String(error);
};
var parseArgs = (argv) => {
	const flags = argv.filter((arg) => arg.startsWith("--"));
	const positional = argv.filter((arg) => !arg.startsWith("--"));
	if (flags.some((flag) => flag !== NO_OPEN_FLAG)) return null;
	if (positional.length < 1 || positional.length > 2) return null;
	return {
		inputPath: positional[0],
		open: !flags.includes(NO_OPEN_FLAG),
		outputDir: positional[1]
	};
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
var readReviewHtml = async (path) => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error(`${path} が見つかりません。先に \`npm run build\` を実行して dist/review.html を生成してください。`, { cause: error });
		throw error;
	}
};
var prepareEmbed = async (inputPath, outputDir) => {
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const [markdown, reviewHtml] = await Promise.all([readFile(inputPath, "utf8"), readReviewHtml(resolve(scriptDir, "review.html"))]);
	const docName = basename(inputPath);
	const docHash = await computeDocHash(markdown);
	return {
		docName,
		markdown,
		outputPath: resolve(outputDir ?? dirname(inputPath), deriveReviewHtmlName(stripMarkdownExt(docName), docHash)),
		reviewHtml
	};
};
var serveOnceAndAutoStop = async (filePath) => new Promise((resolveFn, rejectFn) => {
	const server = createServer((_req, res) => {
		res.writeHead(200, {
			Connection: "close",
			"Content-Type": "text/html; charset=utf-8"
		});
		createReadStream(filePath).pipe(res);
	});
	const done = new Promise((doneResolve) => {
		const giveup = setTimeout(() => {
			server.close(() => doneResolve());
		}, SERVE_GIVEUP_MS);
		server.once("request", () => {
			clearTimeout(giveup);
			setTimeout(() => {
				server.close(() => doneResolve());
			}, SERVE_AUTOSTOP_MS);
		});
	});
	server.on("error", (error) => rejectFn(error));
	server.listen(0, SERVE_HOST, () => {
		const addr = server.address();
		if (addr === null || typeof addr === "string") {
			server.close();
			rejectFn(/* @__PURE__ */ new Error("HTTP サーバーのアドレス取得に失敗しました"));
			return;
		}
		resolveFn({
			done,
			url: `http://localhost:${addr.port}/${encodeURIComponent(basename(filePath))}`
		});
	});
});
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
var runEmbed = async (args) => {
	const ctx = await prepareEmbed(args.inputPath, args.outputDir);
	const result = rewriteReviewHtml(ctx.reviewHtml, ctx.markdown, ctx.docName);
	await writeFile(ctx.outputPath, result, "utf8");
	process.stdout.write(`${ctx.outputPath}\n`);
	if (args.open) await openOutput(ctx.outputPath);
};
var main = async () => {
	const args = parseArgs(process.argv.slice(2));
	if (!args) {
		process.stderr.write(`${USAGE}\n`);
		process.exit(1);
	}
	await runEmbed(args);
};
main().catch((error) => {
	process.stderr.write(`review-request: ${errorMessage(error)}\n`);
	process.exit(1);
});
//#endregion
export { buildOpenCommand, isHostBrowserUnreachableViaFile, parseArgs };
