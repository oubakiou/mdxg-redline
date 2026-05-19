#!/usr/bin/env node
import { basename, dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";
//#region \0@oxc-project+runtime@0.129.0/helpers/taggedTemplateLiteral.js
function _taggedTemplateLiteral(e, t) {
	return t || (t = e.slice(0)), Object.freeze(Object.defineProperties(e, { raw: { value: Object.freeze(t) } }));
}
//#endregion
//#region src/embed-core.ts
var _templateObject;
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
if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest;
	describe("escapeScriptContent", () => {
		it("小文字の <\/script> をエスケープする", () => {
			expect(escapeScriptContent("a <\/script> b")).toBe(String.raw`a <\/script> b`);
		});
		it("大文字混在 <\/Script> もエスケープする", () => {
			expect(escapeScriptContent("x <\/Script>y<\/SCRIPT z")).toBe(String.raw`x <\/Script>y<\/SCRIPT z`);
		});
		it("他の文字 (<, &, \" など) はそのまま残す", () => {
			expect(escapeScriptContent("a < b & c \" d")).toBe("a < b & c \" d");
		});
		it("<\/script> が無い markdown はそのまま返す", () => {
			const md = "# hello\n\nworld";
			expect(escapeScriptContent(md)).toBe(md);
		});
	});
	describe("escapeHtmlAttribute", () => {
		it("& \" < > ' を実体参照に置換する", () => {
			expect(escapeHtmlAttribute(`& " < > '`)).toBe("&amp; &quot; &lt; &gt; &#39;");
		});
		it("& が他のエスケープ結果を二重エスケープしないよう先に処理されている", () => {
			expect(escapeHtmlAttribute("A&B\"C")).toBe("A&amp;B&quot;C");
		});
		it("特殊文字を含まない値はそのまま返す", () => {
			expect(escapeHtmlAttribute("spec.md")).toBe("spec.md");
		});
	});
	describe("rewriteReviewHtml", () => {
		const baseHtml = "<html><body><script id=\"embedded-md\" type=\"text/markdown\" data-name=\"document.md\"><\/script></body></html>";
		it("既存テンプレートに markdown と data-name を埋め込める", () => {
			const out = rewriteReviewHtml(baseHtml, "# hello", "spec.md");
			expect(out).toContain("data-name=\"spec.md\"");
			expect(out).toContain("># hello<\/script>");
			expect(out).not.toContain("data-name=\"document.md\"");
		});
		it("markdown 中の <\/script> がエスケープされる", () => {
			expect(rewriteReviewHtml(baseHtml, "before <\/script> after", "a.md")).toContain(String.raw(_templateObject || (_templateObject = _taggedTemplateLiteral(["before <\/script> after<\/script>"], ["before <\\/script> after<\/script>"]))));
		});
		it("data-name に含まれる \" や & がエスケープされる", () => {
			expect(rewriteReviewHtml(baseHtml, "x", "My \"report\" & log.md")).toContain("data-name=\"My &quot;report&quot; &amp; log.md\"");
		});
		it("属性順が異なっても (data-name が先) 書き換えられる", () => {
			const out = rewriteReviewHtml("<script data-name=\"old.md\" id=\"embedded-md\" type=\"text/markdown\"><\/script>", "body", "new.md");
			expect(out).toContain("data-name=\"new.md\"");
			expect(out).toContain("id=\"embedded-md\"");
			expect(out).toContain(">body<\/script>");
		});
		it("data-name 属性が無い場合は補って挿入する", () => {
			const out = rewriteReviewHtml("<script id=\"embedded-md\" type=\"text/markdown\"><\/script>", "body", "new.md");
			expect(out).toContain("data-name=\"new.md\"");
			expect(out).toContain(">body<\/script>");
		});
		it("既存コンテンツがあっても置き換える", () => {
			const out = rewriteReviewHtml("<script id=\"embedded-md\" type=\"text/markdown\" data-name=\"x.md\">old body<\/script>", "new body", "y.md");
			expect(out).toContain(">new body<\/script>");
			expect(out).not.toContain("old body");
		});
		it("markdown に $ を含んでも replace の特殊置換扱いを受けない", () => {
			expect(rewriteReviewHtml(baseHtml, "$1 $& $`", "a.md")).toContain(">$1 $& $`<\/script>");
		});
		it("元文字列を破壊しない", () => {
			const html = baseHtml;
			rewriteReviewHtml(html, "x", "y.md");
			expect(html).toBe(baseHtml);
		});
	});
	describe("rewriteReviewHtml: match scoping", () => {
		it("embedded-md タグが無いと Error を投げる", () => {
			expect(() => rewriteReviewHtml("<html></html>", "x", "a.md")).toThrow(/embedded-md/);
		});
		it("HTML コメント内の literal <script id=\"embedded-md\"> を無視する", () => {
			const out = rewriteReviewHtml("<!-- the <script id=\"embedded-md\"> block --><script id=\"embedded-md\" type=\"text/markdown\" data-name=\"document.md\"><\/script>", "# body", "spec.md");
			expect(out).toContain("<!-- the <script id=\"embedded-md\"> block -->");
			expect(out).toContain("data-name=\"spec.md\"");
			expect(out).toContain("># body<\/script>");
			expect(out).not.toContain("data-name=\"document.md\"");
		});
		it("type=\"text/markdown\" が無い script タグは対象外", () => {
			const html = "<script id=\"embedded-md\"><\/script>";
			expect(() => rewriteReviewHtml(html, "x", "a.md")).toThrow(/embedded-md/);
		});
	});
}
//#endregion
//#region src/embed.ts
var USAGE = "Usage: embed <input.md> <output.html>";
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
var main = async () => {
	const [inputPath, outputPath] = process.argv.slice(2);
	if (!inputPath || !outputPath) {
		process.stderr.write(`${USAGE}\n`);
		process.exit(1);
	}
	const reviewHtmlPath = resolve(dirname(fileURLToPath(import.meta.url)), "review.html");
	const [markdown, reviewHtml] = await Promise.all([readFile(inputPath, "utf8"), readReviewHtml(reviewHtmlPath)]);
	await writeFile(outputPath, rewriteReviewHtml(reviewHtml, markdown, basename(inputPath)), "utf8");
};
main().catch((error) => {
	process.stderr.write(`embed: ${errorMessage(error)}\n`);
	process.exit(1);
});
//#endregion
export {};
