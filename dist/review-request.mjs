#!/usr/bin/env node
import { marked } from "marked";
import { basename, dirname, resolve } from "node:path";
import process$1 from "node:process";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
//#region src/core/shiki-aliases.generated.ts
var SHIKI_SUPPORTED_LANGS = [
	"abap",
	"actionscript-3",
	"ada",
	"angular-html",
	"angular-ts",
	"apache",
	"apex",
	"apl",
	"applescript",
	"ara",
	"asciidoc",
	"asm",
	"astro",
	"awk",
	"ballerina",
	"bat",
	"beancount",
	"berry",
	"bibtex",
	"bicep",
	"bird2",
	"blade",
	"bsl",
	"c",
	"c3",
	"cadence",
	"cairo",
	"clarity",
	"clojure",
	"cmake",
	"cobol",
	"codeowners",
	"codeql",
	"coffee",
	"common-lisp",
	"coq",
	"cpp",
	"crystal",
	"csharp",
	"css",
	"csv",
	"cue",
	"cypher",
	"d",
	"dart",
	"dax",
	"desktop",
	"diff",
	"docker",
	"dotenv",
	"dream-maker",
	"edge",
	"elixir",
	"elm",
	"emacs-lisp",
	"erb",
	"erlang",
	"fennel",
	"fish",
	"fluent",
	"fortran-fixed-form",
	"fortran-free-form",
	"fsharp",
	"gdresource",
	"gdscript",
	"gdshader",
	"genie",
	"gherkin",
	"git-commit",
	"git-rebase",
	"gleam",
	"glimmer-js",
	"glimmer-ts",
	"glsl",
	"gn",
	"gnuplot",
	"go",
	"graphql",
	"groovy",
	"hack",
	"haml",
	"handlebars",
	"haskell",
	"haxe",
	"hcl",
	"hjson",
	"hlsl",
	"html",
	"html-derivative",
	"http",
	"hurl",
	"hxml",
	"hy",
	"imba",
	"ini",
	"java",
	"javascript",
	"jinja",
	"jison",
	"json",
	"json5",
	"jsonc",
	"jsonl",
	"jsonnet",
	"jssm",
	"jsx",
	"julia",
	"just",
	"kdl",
	"kotlin",
	"kusto",
	"latex",
	"lean",
	"less",
	"liquid",
	"llvm",
	"log",
	"logo",
	"lua",
	"luau",
	"make",
	"markdown",
	"marko",
	"matlab",
	"mdc",
	"mdx",
	"mermaid",
	"mipsasm",
	"mojo",
	"moonbit",
	"move",
	"narrat",
	"nextflow",
	"nextflow-groovy",
	"nginx",
	"nim",
	"nix",
	"nushell",
	"objective-c",
	"objective-cpp",
	"ocaml",
	"odin",
	"openscad",
	"pascal",
	"perl",
	"php",
	"pkl",
	"plsql",
	"po",
	"polar",
	"postcss",
	"powerquery",
	"powershell",
	"prisma",
	"prolog",
	"proto",
	"pug",
	"puppet",
	"purescript",
	"python",
	"qml",
	"qmldir",
	"qss",
	"r",
	"racket",
	"raku",
	"razor",
	"reg",
	"regexp",
	"rel",
	"riscv",
	"ron",
	"rosmsg",
	"rst",
	"ruby",
	"rust",
	"sas",
	"sass",
	"scala",
	"scheme",
	"scss",
	"sdbl",
	"shaderlab",
	"shellscript",
	"shellsession",
	"smalltalk",
	"solidity",
	"soy",
	"sparql",
	"splunk",
	"sql",
	"ssh-config",
	"stata",
	"stylus",
	"surrealql",
	"svelte",
	"swift",
	"system-verilog",
	"systemd",
	"talonscript",
	"tasl",
	"tcl",
	"templ",
	"terraform",
	"tex",
	"toml",
	"ts-tags",
	"tsv",
	"tsx",
	"turtle",
	"twig",
	"typescript",
	"typespec",
	"typst",
	"v",
	"vala",
	"vb",
	"verilog",
	"vhdl",
	"viml",
	"vue",
	"vue-html",
	"vue-vine",
	"vyper",
	"wasm",
	"wenyan",
	"wgsl",
	"wikitext",
	"wit",
	"wolfram",
	"xml",
	"xsl",
	"yaml",
	"zenscript",
	"zig"
];
var ALIAS_TO_CANONICAL = {
	"1c": "bsl",
	"1c-query": "sdbl",
	abap: "abap",
	"actionscript-3": "actionscript-3",
	ada: "ada",
	adoc: "asciidoc",
	"angular-html": "angular-html",
	"angular-ts": "angular-ts",
	apache: "apache",
	apex: "apex",
	apl: "apl",
	applescript: "applescript",
	ara: "ara",
	asciidoc: "asciidoc",
	asm: "asm",
	astro: "astro",
	awk: "awk",
	ballerina: "ballerina",
	bash: "shellscript",
	bat: "bat",
	batch: "bat",
	be: "berry",
	beancount: "beancount",
	berry: "berry",
	bibtex: "bibtex",
	bicep: "bicep",
	bird: "bird2",
	bird2: "bird2",
	blade: "blade",
	bsl: "bsl",
	c: "c",
	"c#": "csharp",
	"c++": "cpp",
	c3: "c3",
	cadence: "cadence",
	cairo: "cairo",
	cdc: "cadence",
	cjs: "javascript",
	clarity: "clarity",
	clj: "clojure",
	clojure: "clojure",
	"closure-templates": "soy",
	cmake: "cmake",
	cmd: "vb",
	cobol: "cobol",
	codeowners: "codeowners",
	codeql: "codeql",
	coffee: "coffee",
	coffeescript: "coffee",
	"common-lisp": "common-lisp",
	console: "shellsession",
	coq: "coq",
	cpp: "cpp",
	cql: "cypher",
	crystal: "crystal",
	cs: "csharp",
	csharp: "csharp",
	css: "css",
	csv: "csv",
	cts: "typescript",
	cue: "cue",
	cypher: "cypher",
	d: "d",
	dart: "dart",
	dax: "dax",
	desktop: "desktop",
	diff: "diff",
	docker: "docker",
	dockerfile: "docker",
	dotenv: "dotenv",
	"dream-maker": "dream-maker",
	edge: "edge",
	elisp: "emacs-lisp",
	elixir: "elixir",
	elm: "elm",
	"emacs-lisp": "emacs-lisp",
	erb: "erb",
	erl: "erlang",
	erlang: "erlang",
	f: "fortran-fixed-form",
	"f#": "fsharp",
	f03: "fortran-free-form",
	f08: "fortran-free-form",
	f18: "fortran-free-form",
	f77: "fortran-fixed-form",
	f90: "fortran-free-form",
	f95: "fortran-free-form",
	fennel: "fennel",
	fish: "fish",
	fluent: "fluent",
	for: "fortran-fixed-form",
	"fortran-fixed-form": "fortran-fixed-form",
	"fortran-free-form": "fortran-free-form",
	fs: "fsharp",
	fsharp: "fsharp",
	fsl: "jssm",
	ftl: "fluent",
	gd: "gdscript",
	gdresource: "gdresource",
	gdscript: "gdscript",
	gdshader: "gdshader",
	genie: "genie",
	gherkin: "gherkin",
	"git-commit": "git-commit",
	"git-rebase": "git-rebase",
	gjs: "glimmer-js",
	gleam: "gleam",
	"glimmer-js": "glimmer-js",
	"glimmer-ts": "glimmer-ts",
	glsl: "glsl",
	gn: "gn",
	gnuplot: "gnuplot",
	go: "go",
	gql: "graphql",
	graphql: "graphql",
	groovy: "groovy",
	gts: "glimmer-ts",
	hack: "hack",
	haml: "haml",
	handlebars: "handlebars",
	haskell: "haskell",
	haxe: "haxe",
	hbs: "handlebars",
	hcl: "hcl",
	hjson: "hjson",
	hlsl: "hlsl",
	hs: "haskell",
	html: "html",
	"html-derivative": "html-derivative",
	http: "http",
	hurl: "hurl",
	hxml: "hxml",
	hy: "hy",
	imba: "imba",
	ini: "ini",
	jade: "pug",
	java: "java",
	javascript: "javascript",
	jinja: "jinja",
	jison: "jison",
	jl: "julia",
	js: "javascript",
	json: "json",
	json5: "json5",
	jsonc: "jsonc",
	jsonl: "jsonl",
	jsonnet: "jsonnet",
	jssm: "jssm",
	jsx: "jsx",
	julia: "julia",
	just: "just",
	kdl: "kdl",
	kotlin: "kotlin",
	kql: "kusto",
	kt: "kotlin",
	kts: "kotlin",
	kusto: "kusto",
	latex: "latex",
	lean: "lean",
	lean4: "lean",
	less: "less",
	liquid: "liquid",
	lisp: "common-lisp",
	lit: "ts-tags",
	llvm: "llvm",
	log: "log",
	logo: "logo",
	lua: "lua",
	luau: "luau",
	make: "make",
	makefile: "make",
	markdown: "markdown",
	marko: "marko",
	matlab: "matlab",
	mbt: "moonbit",
	mbti: "moonbit",
	md: "markdown",
	mdc: "mdc",
	mdx: "mdx",
	mediawiki: "wikitext",
	mermaid: "mermaid",
	mips: "mipsasm",
	mipsasm: "mipsasm",
	mjs: "javascript",
	mmd: "mermaid",
	mojo: "mojo",
	moonbit: "moonbit",
	move: "move",
	mts: "typescript",
	nar: "narrat",
	narrat: "narrat",
	nextflow: "nextflow",
	"nextflow-groovy": "nextflow-groovy",
	nf: "nextflow",
	nginx: "nginx",
	nim: "nim",
	nix: "nix",
	nu: "nushell",
	nushell: "nushell",
	objc: "objective-c",
	"objective-c": "objective-c",
	"objective-cpp": "objective-cpp",
	ocaml: "ocaml",
	odin: "odin",
	openscad: "openscad",
	pascal: "pascal",
	perl: "perl",
	perl6: "raku",
	php: "php",
	pkl: "pkl",
	plsql: "plsql",
	po: "po",
	polar: "polar",
	postcss: "postcss",
	pot: "po",
	potx: "po",
	powerquery: "powerquery",
	powershell: "powershell",
	prisma: "prisma",
	prolog: "prolog",
	properties: "ini",
	proto: "proto",
	protobuf: "proto",
	ps: "powershell",
	ps1: "powershell",
	pug: "pug",
	puppet: "puppet",
	purescript: "purescript",
	py: "python",
	python: "python",
	ql: "codeql",
	qml: "qml",
	qmldir: "qmldir",
	qss: "qss",
	r: "r",
	racket: "racket",
	raku: "raku",
	razor: "razor",
	rb: "ruby",
	reg: "reg",
	regex: "regexp",
	regexp: "regexp",
	rel: "rel",
	riscv: "riscv",
	ron: "ron",
	rosmsg: "rosmsg",
	rs: "rust",
	rst: "rst",
	ruby: "ruby",
	rust: "rust",
	sas: "sas",
	sass: "sass",
	scad: "openscad",
	scala: "scala",
	scheme: "scheme",
	scss: "scss",
	sdbl: "sdbl",
	sh: "shellscript",
	shader: "shaderlab",
	shaderlab: "shaderlab",
	shell: "shellscript",
	shellscript: "shellscript",
	shellsession: "shellsession",
	smalltalk: "smalltalk",
	solidity: "solidity",
	soy: "soy",
	sparql: "sparql",
	spl: "splunk",
	splunk: "splunk",
	sql: "sql",
	"ssh-config": "ssh-config",
	stata: "stata",
	styl: "stylus",
	stylus: "stylus",
	surql: "surrealql",
	surrealql: "surrealql",
	svelte: "svelte",
	swift: "swift",
	"system-verilog": "system-verilog",
	systemd: "systemd",
	talon: "talonscript",
	talonscript: "talonscript",
	tasl: "tasl",
	tcl: "tcl",
	templ: "templ",
	terraform: "terraform",
	tex: "tex",
	tf: "terraform",
	tfvars: "terraform",
	toml: "toml",
	tres: "gdresource",
	ts: "typescript",
	"ts-tags": "ts-tags",
	tscn: "gdresource",
	tsp: "typespec",
	tsv: "tsv",
	tsx: "tsx",
	turtle: "turtle",
	twig: "twig",
	typ: "typst",
	typescript: "typescript",
	typespec: "typespec",
	typst: "typst",
	v: "v",
	vala: "vala",
	vb: "vb",
	verilog: "verilog",
	vhdl: "vhdl",
	vim: "viml",
	viml: "viml",
	vimscript: "viml",
	vue: "vue",
	"vue-html": "vue-html",
	"vue-vine": "vue-vine",
	vy: "vyper",
	vyper: "vyper",
	wasm: "wasm",
	wenyan: "wenyan",
	wgsl: "wgsl",
	wiki: "wikitext",
	wikitext: "wikitext",
	wit: "wit",
	wl: "wolfram",
	wolfram: "wolfram",
	xml: "xml",
	xsl: "xsl",
	yaml: "yaml",
	yml: "yaml",
	zenscript: "zenscript",
	zig: "zig",
	zsh: "shellscript",
	文言: "wenyan"
};
//#endregion
//#region src/core/scan-fenced-langs.ts
var isTokenLike$2 = (value) => {
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
var walkTokens$1 = (tokens, acc) => {
	if (!Array.isArray(tokens)) return;
	for (const token of tokens) if (isTokenLike$2(token)) {
		collectCodeLang(token, acc);
		walkTokens$1(token.tokens, acc);
		walkTokens$1(token.items, acc);
	}
};
/**
* markdown 全体を走査して、フェンスで指定された言語の Shiki 正規名集合を返す。
* 入力 markdown が空 / フェンスなし / 全部 plain fallback でも空 Set を返す。
*/
var scanFencedLangs = (markdown) => {
	const acc = /* @__PURE__ */ new Set();
	walkTokens$1(marked.lexer(markdown), acc);
	return acc;
};
var HELP_FLAGS = new Set(["--help", "-h"]);
var DOCUMENT_NAME_FLAG = "--document-name";
var THEME_FLAG = "--theme";
var SHIKI_LANGS_FLAG = "--shiki-langs";
var COMMENTS_WIDTH_FLAG = "--comments-width";
var PAGE_NAV_WIDTH_FLAG = "--page-nav-width";
var MERMAID_FLAG = "--mermaid";
var MATH_FLAG = "--math";
var MATH_FONTS_FLAG = "--math-fonts";
var MARKDOWN_CSS_FLAG = "--markdown-css";
var CLEAN_FLAG = "--clean";
var YES_FLAG = "--yes";
var KEEP_FLAG = "--keep";
var RECURSIVE_FLAG = "--recursive";
var HEX_16_PATTERN = /^[0-9a-f]{16}$/i;
var THEME_VALUES = [
	"system",
	"light",
	"dark"
];
var isThemeHint = (value) => THEME_VALUES.includes(value);
var COMMENTS_WIDTH_MIN = 280;
var COMMENTS_WIDTH_MAX = 640;
var PAGE_NAV_WIDTH_MIN = 180;
var PAGE_NAV_WIDTH_MAX = 480;
var isValidCommentsWidthHint = (value) => {
	if (!Number.isFinite(value) || !Number.isInteger(value)) return false;
	if (value === 0) return true;
	return value >= COMMENTS_WIDTH_MIN && value <= COMMENTS_WIDTH_MAX;
};
var isValidPageNavWidthHint = (value) => {
	if (!Number.isFinite(value) || !Number.isInteger(value)) return false;
	if (value === 0) return true;
	return value >= PAGE_NAV_WIDTH_MIN && value <= PAGE_NAV_WIDTH_MAX;
};
/**
* `--comments-width` の値を整数 (0 or 280–640) にパースする。
* 範囲外・非数値・小数は null (CLI 側で invalid 扱い)。
*/
var parseCommentsWidthValue = (raw) => {
	const trimmed = raw.trim();
	if (trimmed === "") return null;
	const num = Number(trimmed);
	if (!isValidCommentsWidthHint(num)) return null;
	return num;
};
/**
* `--page-nav-width` の値を整数 (0 or 180–480) にパースする。
* 範囲外・非数値・小数は null (CLI 側で invalid 扱い)。
*/
var parsePageNavWidthValue = (raw) => {
	const trimmed = raw.trim();
	if (trimmed === "") return null;
	const num = Number(trimmed);
	if (!isValidPageNavWidthHint(num)) return null;
	return num;
};
var MERMAID_VALUES = [
	"auto",
	"on",
	"off"
];
var isMermaidMode = (value) => MERMAID_VALUES.includes(value);
/**
* `--mermaid` の値を MermaidMode にパースする。pure な関数で、CLI 引数パースと
* 単体テストの両方から再利用する。未知の値・空文字は null を返し、CLI 側で invalid 扱い。
*/
var parseMermaidValue = (value) => {
	const trimmed = value.trim();
	if (isMermaidMode(trimmed)) return trimmed;
	return null;
};
/**
* `--math` の値を MathMode にパースする。MermaidMode と同じ literal を共有しているので
* 受け付ける値も同じ。CLI 側の dispatch だけが分かれる。
*/
var parseMathValue = (value) => parseMermaidValue(value);
var MATH_FONTS_VALUES = ["minimal", "all"];
var isMathFontsMode = (value) => MATH_FONTS_VALUES.includes(value);
/**
* `--math-fonts` の値を MathFontsMode にパースする。pure。
*/
var parseMathFontsValue = (value) => {
	const trimmed = value.trim();
	if (isMathFontsMode(trimmed)) return trimmed;
	return null;
};
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
* `--shiki-langs` の値を ShikiLangsMode にパースする。pure。
* 空白だけ / 未サポートのみは空 list (= none と等価) を返す。
*/
var parseShikiLangsValue = (value) => parseShikiLangsKeyword(value.trim()) ?? parseShikiLangsList(value.trim());
//#endregion
//#region src/cli/parse-clean-args.ts
var INITIAL_CLEAN_STATE = {
	cleanSeen: false,
	dir: null,
	keep: /* @__PURE__ */ new Set(),
	pendingDir: false,
	pendingKeep: false,
	recursive: false,
	valid: true,
	yes: false
};
var consumeCleanDirValue = (acc, token) => ({
	...acc,
	dir: token,
	pendingDir: false
});
var consumeCleanKeepValue = (acc, token) => {
	if (!HEX_16_PATTERN.test(token)) return {
		...acc,
		valid: false
	};
	const next = new Set(acc.keep);
	next.add(token.toLowerCase());
	return {
		...acc,
		keep: next,
		pendingKeep: false
	};
};
var markCleanFlag = (acc) => {
	if (acc.cleanSeen) return {
		...acc,
		valid: false
	};
	return {
		...acc,
		cleanSeen: true,
		pendingDir: true
	};
};
var CLEAN_FLAG_TABLE = [
	{
		flag: CLEAN_FLAG,
		mark: markCleanFlag
	},
	{
		flag: KEEP_FLAG,
		mark: (acc) => ({
			...acc,
			pendingKeep: true
		})
	},
	{
		flag: YES_FLAG,
		mark: (acc) => ({
			...acc,
			yes: true
		})
	},
	{
		flag: RECURSIVE_FLAG,
		mark: (acc) => ({
			...acc,
			recursive: true
		})
	},
	{
		flag: "-r",
		mark: (acc) => ({
			...acc,
			recursive: true
		})
	}
];
var isCleanFlagToken = (token) => CLEAN_FLAG_TABLE.some((row) => row.flag === token);
var consumeCleanFlag = (acc, token) => {
	const entry = CLEAN_FLAG_TABLE.find((row) => row.flag === token);
	if (!entry) return {
		...acc,
		valid: false
	};
	return entry.mark(acc);
};
var stepCleanArg = (acc, token) => {
	if (!acc.valid) return acc;
	if (acc.pendingDir) {
		if (token.startsWith("--") || isCleanFlagToken(token)) return stepCleanArg({
			...acc,
			pendingDir: false
		}, token);
		return consumeCleanDirValue(acc, token);
	}
	if (acc.pendingKeep) return consumeCleanKeepValue(acc, token);
	return consumeCleanFlag(acc, token);
};
var parseCleanArgs = (argv) => {
	const state = argv.reduce(stepCleanArg, INITIAL_CLEAN_STATE);
	if (!state.valid || state.pendingKeep) return { mode: "invalid" };
	return {
		dir: state.dir ?? ".",
		keep: state.keep,
		mode: "clean",
		recursive: state.recursive,
		yes: state.yes
	};
};
//#endregion
//#region src/cli/flag-parser.ts
var INITIAL_PARTITION_STATE = {
	commentsWidth: null,
	documentName: null,
	markdownCssPath: null,
	math: null,
	mathFonts: null,
	mermaid: null,
	open: true,
	pageNavWidth: null,
	pending: null,
	positional: [],
	shikiLangs: null,
	showOpenFile: false,
	themeHint: null,
	valid: true
};
var defineFlagDef = (spec) => ({
	consume: (acc, token) => {
		const value = spec.parser(token);
		if (value === null) return {
			...acc,
			valid: false
		};
		return spec.assign(acc, value);
	},
	flag: spec.flag
});
var parseThemeHintValue = (token) => {
	if (!isThemeHint(token)) return null;
	return token;
};
var parseMarkdownCssPathValue = (token) => {
	if (token === "-") return null;
	return token;
};
var VALUE_FLAG_DEFS = [
	defineFlagDef({
		assign: (acc, value) => ({
			...acc,
			documentName: value
		}),
		flag: DOCUMENT_NAME_FLAG,
		parser: (token) => token
	}),
	defineFlagDef({
		assign: (acc, value) => ({
			...acc,
			themeHint: value
		}),
		flag: THEME_FLAG,
		parser: parseThemeHintValue
	}),
	defineFlagDef({
		assign: (acc, value) => ({
			...acc,
			shikiLangs: value
		}),
		flag: SHIKI_LANGS_FLAG,
		parser: (token) => parseShikiLangsValue(token)
	}),
	defineFlagDef({
		assign: (acc, value) => ({
			...acc,
			commentsWidth: value
		}),
		flag: COMMENTS_WIDTH_FLAG,
		parser: parseCommentsWidthValue
	}),
	defineFlagDef({
		assign: (acc, value) => ({
			...acc,
			pageNavWidth: value
		}),
		flag: PAGE_NAV_WIDTH_FLAG,
		parser: parsePageNavWidthValue
	}),
	defineFlagDef({
		assign: (acc, value) => ({
			...acc,
			mermaid: value
		}),
		flag: MERMAID_FLAG,
		parser: parseMermaidValue
	}),
	defineFlagDef({
		assign: (acc, value) => ({
			...acc,
			math: value
		}),
		flag: MATH_FLAG,
		parser: parseMathValue
	}),
	defineFlagDef({
		assign: (acc, value) => ({
			...acc,
			mathFonts: value
		}),
		flag: MATH_FONTS_FLAG,
		parser: parseMathFontsValue
	}),
	defineFlagDef({
		assign: (acc, value) => ({
			...acc,
			markdownCssPath: value
		}),
		flag: MARKDOWN_CSS_FLAG,
		parser: parseMarkdownCssPathValue
	})
];
var VALUE_FLAG_INDEX = new Map(VALUE_FLAG_DEFS.map((def) => [def.flag, def]));
var consumeStandaloneFlag = (acc, token) => {
	if (token === "--no-open") return {
		...acc,
		open: false
	};
	if (token === "--show-open-file") return {
		...acc,
		showOpenFile: true
	};
	return null;
};
var consumeFlag = (acc, token) => {
	const standalone = consumeStandaloneFlag(acc, token);
	if (standalone !== null) return standalone;
	const def = VALUE_FLAG_INDEX.get(token);
	if (def) return {
		...acc,
		pending: def
	};
	return {
		...acc,
		valid: false
	};
};
var consumePendingValue = (acc, token) => {
	if (acc.pending === null) return null;
	if (token.startsWith("--")) return {
		...acc,
		pending: null,
		valid: false
	};
	return acc.pending.consume({
		...acc,
		pending: null
	}, token);
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
var isPartitionValid = (state) => state.valid && state.pending === null;
//#endregion
//#region src/cli/parse-run-args.ts
var attachIfPresent = (result, key, value) => {
	if (value === null || typeof value === "undefined") return;
	result[key] = value;
};
var attachPartitionOptionals = (result, state) => {
	attachIfPresent(result, "documentName", state.documentName);
	attachIfPresent(result, "themeHint", state.themeHint);
	attachIfPresent(result, "shikiLangs", state.shikiLangs);
	attachIfPresent(result, "markdownCssPath", state.markdownCssPath);
	attachIfPresent(result, "mermaid", state.mermaid);
	attachIfPresent(result, "math", state.math);
	attachIfPresent(result, "mathFonts", state.mathFonts);
	attachIfPresent(result, "commentsWidth", state.commentsWidth);
	attachIfPresent(result, "pageNavWidth", state.pageNavWidth);
};
var partitionArgs = (argv) => {
	const state = argv.reduce(stepArg, INITIAL_PARTITION_STATE);
	const result = {
		open: state.open,
		positional: state.positional,
		showOpenFile: state.showOpenFile,
		valid: isPartitionValid(state)
	};
	attachPartitionOptionals(result, state);
	return result;
};
var attachRunOptionals = (result, parts) => {
	attachIfPresent(result, "outputDir", parts.positional[1]);
	attachIfPresent(result, "documentName", parts.documentName);
	attachIfPresent(result, "themeHint", parts.themeHint);
	attachIfPresent(result, "markdownCssPath", parts.markdownCssPath);
	attachIfPresent(result, "shikiLangs", parts.shikiLangs);
	attachIfPresent(result, "commentsWidth", parts.commentsWidth);
	attachIfPresent(result, "pageNavWidth", parts.pageNavWidth);
	attachIfPresent(result, "mermaid", parts.mermaid);
	attachIfPresent(result, "math", parts.math);
	attachIfPresent(result, "mathFonts", parts.mathFonts);
};
var buildRunArgs = (parts) => {
	const [inputPath] = parts.positional;
	const result = {
		inputPath,
		mode: "run",
		open: parts.open
	};
	if (parts.showOpenFile) result.showOpenFile = true;
	attachRunOptionals(result, parts);
	return result;
};
var parseRunArgs = (argv) => {
	const parts = partitionArgs(argv);
	if (!parts.valid) return { mode: "invalid" };
	if (parts.positional.length < 1 || parts.positional.length > 2) return { mode: "invalid" };
	return buildRunArgs(parts);
};
//#endregion
//#region src/cli/help-text.ts
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
                         (default: top level only).

Examples:
  mdxg-redline spec.md
  mdxg-redline spec.md ./reviews
  mdxg-redline --no-open spec.md
  mdxg-redline --theme dark spec.md
  cat spec.md | mdxg-redline - --document-name spec.md
  mdxg-redline --clean
  mdxg-redline --clean ./reviews
  mdxg-redline --clean ./reviews --yes
  mdxg-redline --clean ./reviews --keep a1b2c3d4e5f6a7b8 --yes
  mdxg-redline --clean ./reviews --recursive --yes
`;
//#endregion
//#region src/cli/parse-args.ts
var parseArgs = (argv) => {
	if (argv.length === 0) return { mode: "help" };
	if (argv.some((token) => HELP_FLAGS.has(token))) return { mode: "help" };
	if (argv.includes("--clean")) return parseCleanArgs(argv);
	return parseRunArgs(argv);
};
//#endregion
//#region src/core/filename-sanitize.ts
var sanitizeMdFileName = (name) => {
	const cleaned = name.replace(/\p{Cc}/gu, "_").replace(/[\\/]/g, "_");
	if (cleaned === "" || cleaned === "." || cleaned === "..") return "_";
	if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(cleaned)) return `${cleaned}_`;
	return cleaned;
};
//#endregion
//#region src/core/embed/hash.ts
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
//#endregion
//#region src/core/embed/names.ts
/**
* MD ファイル名から `.md` / `.markdown` 拡張子を除いた basename を返す。
* 大文字小文字無視。拡張子が無いファイル名はそのまま返す。
* ファイル命名規約 §8 の `mdFileName` 部分を組み立てるベース。
*/
var stripMarkdownExt = (filename) => filename.replace(/\.(?:markdown|md)$/i, "");
/** ファイル命名規約 §8 に従って配布用 HTML のファイル名を組み立てる */
var deriveReviewHtmlName = (mdFileName, docHash) => `${mdFileName}-${docHash}-review.html`;
/** ファイル命名規約 §8 に従って人間→エージェント方向の JSON ファイル名を組み立てる */
var deriveFeedbackJsonName = (mdFileName, docHash) => `${mdFileName}-${docHash}-feedback.json`;
//#endregion
//#region src/core/embed/script-encoding.ts
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
/**
* feedback payload を `<script id="embedded-feedback">` に埋め込み可能な JSON 文字列に
* エンコードする。CLI が同じ <name>-<hash>- プレフィックスの feedback.json から読み取って
* 注入する resume 経路で使う。`<` を Unicode escape する点は他の embedded-* と共通で、
* 復元側 (boot.ts) は textContent を `JSON.parse` → `embeddedCommentsFromUnknown` で受ける。
*/
var encodeEmbeddedFeedback = (payload) => escapeJsonForScriptTag(JSON.stringify(payload));
var escapeScriptTagInJs = (jsSource) => {
	let count = 0;
	const escaped = jsSource.replace(/<\/script>/gi, () => {
		count += 1;
		return String.raw`<\/script>`;
	});
	return {
		count,
		escaped
	};
};
var escapeStyleTagInCss$1 = (cssSource) => cssSource.replace(/<\/style>/gi, String.raw`<\/style>`);
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
//#region src/core/embed/html-attribute-rewriter.ts
var HTML_TAG_RE = /<html\b[^>]*>/i;
var VALID_ATTR_NAME_RE = /^[a-z][a-z0-9-]*$/;
var assertAttrName = (attrName) => {
	if (!VALID_ATTR_NAME_RE.test(attrName)) throw new Error(`unsupported attribute name for rewriter: ${attrName}`);
};
/**
* 開きタグ文字列に `attrName="<escapedValue>"` を挿入 or 上書きする。
* - 既存の `attrName="..."` があれば値を差し替え
* - 無ければ末尾 `>` の直前にスペース付きで追加
*
* `escapedValue` は既に HTML 属性 escape 済み (`&quot;` / `&amp;` / `&lt;` / `&gt;` 等) である前提。
*/
var setOrInsertAttribute = (openingTag, attrName, escapedValue) => {
	assertAttrName(attrName);
	const re = new RegExp(`\\b${attrName}="[^"]*"`);
	if (re.test(openingTag)) return openingTag.replace(re, `${attrName}="${escapedValue}"`);
	return openingTag.replace(/>$/, ` ${attrName}="${escapedValue}">`);
};
/**
* template HTML の `<html>` 開きタグに `data-*` 属性を 1 つ upsert する。
* 値は HTML 属性 escape を経由するため、CLI バリデーション済みでない値でも安全。
* <html> タグが見つからなければ Error を投げる (呼び出し側が CLI エラーに変換)。
*/
var upsertHtmlDataAttribute = (reviewHtml, attrName, value) => {
	const match = HTML_TAG_RE.exec(reviewHtml);
	if (!match) throw new Error("template HTML に <html> タグが見つかりません");
	const [tag] = match;
	const newTag = setOrInsertAttribute(tag, attrName, escapeHtml(value));
	return reviewHtml.slice(0, match.index) + newTag + reviewHtml.slice(match.index + tag.length);
};
//#endregion
//#region src/build/inline-markdown-css.ts
var MARKDOWN_CSS_RE = /(<style\b(?=[^>]*\bid="markdown-css")[^>]*>)([\s\S]*?)(<\/style>)/i;
var maskHtmlComments = (html) => html.replace(/<!--[\s\S]*?-->/g, (match) => " ".repeat(match.length));
var escapeStyleTagInCss = (cssSource) => cssSource.replace(/<\/style>/gi, String.raw`<\/style>`);
/**
* `<style id="markdown-css">` の中身を `css` で書き換えた新しい HTML 文字列を返す。
* 元文字列は変更しない。該当 `<style>` タグが無ければ Error を投げる
* (呼び出し側が CLI / build エラーに変換)。
*/
var inlineMarkdownCssIntoHtml = (html, css) => {
	const masked = maskHtmlComments(html);
	const match = MARKDOWN_CSS_RE.exec(masked);
	if (!match) throw new Error("template HTML に id=\"markdown-css\" の <style> タグが見つかりません");
	const [fullMatch, openingTag, , closingTag] = match;
	const replaced = `${openingTag}${escapeStyleTagInCss(css)}${closingTag}`;
	return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length);
};
//#endregion
//#region src/core/embed/html-rewrite.ts
var EMBEDDED_MD_RE = /(<script\b(?=[^>]*\bid="embedded-md")(?=[^>]*\btype="text\/markdown")[^>]*>)([\s\S]*?)(<\/script>)/i;
var EMBEDDED_SHIKI_LANGS_RE = /(<script\b(?=[^>]*\bid="embedded-shiki-langs")(?=[^>]*\btype="application\/json")[^>]*>)([\s\S]*?)(<\/script>)/i;
var EMBEDDED_FEEDBACK_RE = /(<script\b(?=[^>]*\bid="embedded-feedback")(?=[^>]*\btype="application\/json")[^>]*>)([\s\S]*?)(<\/script>)/i;
var STATUS_SPAN_RE = /(<span\b(?=[^>]*\bid="status")[^>]*>)([\s\S]*?)(<\/span>)/i;
var HEAD_OPEN_RE = /<head\b[^>]*>/i;
var EMBEDDED_MD_META_RE = /\s*<meta\b[^>]*\bname="mdxg-redline:embedded-md"[^>]*\/?>/i;
/**
* 「ロード済み」状態のステータステキストを組み立てる。CLI 経由配布物の paint 前確定と、
* JS 起動後の loadFromMarkdown 完了表示で同じ文字列を使うことで初期描画と JS 描画が一致する。
*/
var formatLoadedStatus = (docName, docHash) => `${docName} (${docHash}) · loaded`;
var replaceMatchedHtmlRegion = (html, regex, buildBody) => {
	const match = regex.exec(html);
	if (!match) return null;
	const [fullMatch, openingTag, , closingTag] = match;
	const replaced = `${openingTag}${buildBody()}${closingTag}`;
	return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length);
};
/**
* `<span id="status">` の中身を CLI が書き換える。paint 前から最終状態を見せることで、
* JS の loadFromMarkdown が走るまで「No file」が一瞬見える FOUC を構造的に防ぐ。
*/
var rewriteInitialStatus = (reviewHtml, statusText) => {
	const result = replaceMatchedHtmlRegion(reviewHtml, STATUS_SPAN_RE, () => escapeHtml(statusText));
	if (result === null) throw new Error("template HTML に id=\"status\" の <span> タグが見つかりません");
	return result;
};
/**
* paint 前介入用の <meta> を <head> 直下に挿入する (既存があれば置換、idempotent)。
* <head> 内 inline script がこの meta を検出して `<html>.has-embedded-md` を付ける仕組みで、
* body 内の `<script id="embedded-md">` 直後で判定する方式より早期に介入できる。
*/
var upsertEmbeddedMdMeta = (reviewHtml) => {
	const cleaned = reviewHtml.replace(EMBEDDED_MD_META_RE, "");
	const headMatch = HEAD_OPEN_RE.exec(cleaned);
	if (!headMatch) throw new Error("template HTML に <head> タグが見つかりません");
	const insertPos = headMatch.index + headMatch[0].length;
	return cleaned.slice(0, insertPos) + "\n    <meta name=\"mdxg-redline:embedded-md\" content=\"1\" />" + cleaned.slice(insertPos);
};
var TITLE_RE = /(<title\b[^>]*>)([\s\S]*?)(<\/title>)/i;
/**
* `<html>` 開きタグに `data-theme="<themeHint>"` を挿入する。属性が既にあれば上書き。
* inline script はこの属性を localStorage より低い優先度で初期値ヒントとして使う。
* 未指定時は属性を付けないため、呼び出し側で themeHint の有無を判断してから呼ぶ
* (CLI 既定では --theme 未指定時はこの関数を呼ばない方針)。
*/
var upsertHtmlDataTheme = (reviewHtml, themeHint) => upsertHtmlDataAttribute(reviewHtml, "data-theme", themeHint);
/**
* `<html>` 開きタグに `data-comments-width="<value>"` を挿入する。属性が既にあれば上書き。
* inline script はこの属性を localStorage より低い優先度で初期値ヒントとして使う。
* 値の正当性 (0 or 240–640) は CLI 側でバリデーション済み前提だが、属性 escape 経路は
* data-theme と揃える。
*/
var upsertHtmlDataCommentsWidth = (reviewHtml, value) => upsertHtmlDataAttribute(reviewHtml, "data-comments-width", String(value));
/**
* `<html>` 開きタグに `data-page-nav-width="<value>"` を挿入する。属性が既にあれば上書き。
* 値の正当性 (0 or 180–480) は CLI 側でバリデーション済み前提。data-comments-width と対称。
*/
var upsertHtmlDataPageNavWidth = (reviewHtml, value) => upsertHtmlDataAttribute(reviewHtml, "data-page-nav-width", String(value));
/**
* `<html>` 開きタグに `data-toolbar-open-file="off"` を挿入する (idempotent)。
* CLI が --show-open-file を指定していない時にだけ呼び、ブラウザ側 toolbar.ts はこの属性で
* Open file ボタンと隠し input を起動時に DOM から削除する (DESIGN.md §3 入力 1 のフットガン
* を CLI 経路で構造的に塞ぐ意図)。値は `'off'` のみで運用するため型でも literal に絞る。
*/
var upsertHtmlDataToolbarOpenFile = (reviewHtml, value) => upsertHtmlDataAttribute(reviewHtml, "data-toolbar-open-file", value);
/**
* `<title>` の中身を書き換える (idempotent)。ブラウザタブ・ファイル共有先で配布物を識別できるよう、
* CLI 経路では `"MDXG Redline — <docName>"` 形式で上書きする (DESIGN.md §5.e)。
* <title> タグが見つからない場合は no-op (フェイタルではなく warning 相当)。
* <title> 中の特殊文字は HTML escape される (信頼境界、DESIGN.md §11)。
*/
var rewriteTitle = (reviewHtml, newTitle) => replaceMatchedHtmlRegion(reviewHtml, TITLE_RE, () => escapeHtml(newTitle)) ?? reviewHtml;
/**
* `<script id="embedded-shiki-langs">` の中身を grammars の JSON で書き換える。
* - `grammars` が空オブジェクト `{}` でも JSON `{}` が書き込まれる (browser は空 langs として扱う)
* - 該当 `<script>` タグが template HTML に無ければ Error を投げる (呼び出し側が CLI エラーに変換)
*
* embedded-md のように属性経由の上書きはなく、コンテンツ置換のみ。
*/
var rewriteEmbeddedShikiLangs = (reviewHtml, grammars) => {
	const result = replaceMatchedHtmlRegion(reviewHtml, EMBEDDED_SHIKI_LANGS_RE, () => encodeEmbeddedShikiLangs(grammars));
	if (result === null) throw new Error("template HTML に id=\"embedded-shiki-langs\" の <script> タグが見つかりません");
	return result;
};
/**
* `<script id="embedded-feedback">` の中身を feedback payload の JSON で書き換える。
* CLI が同じ <name>-<hash>- プレフィックスの feedback.json を見つけた resume 経路で呼ばれる。
* 該当 `<script>` タグが template HTML に無ければ Error (template 不整合)。
*/
var rewriteEmbeddedFeedback = (reviewHtml, payload) => {
	const result = replaceMatchedHtmlRegion(reviewHtml, EMBEDDED_FEEDBACK_RE, () => encodeEmbeddedFeedback(payload));
	if (result === null) throw new Error("template HTML に id=\"embedded-feedback\" の <script> タグが見つかりません");
	return result;
};
/**
* `<style id="markdown-css">` の中身をユーザー指定の CSS で書き換える。デフォルトでは build 時に
* `src/styles/markdown.css` の内容が inline されており、CLI `--markdown-css <path>` が指定された
* ときだけ呼ばれる (DESIGN.md §3 / §12 §1 Theming)。
*
* 中核ロジックは src/build/inline-markdown-css.ts に集約 (build 時 inline と CLI rewrite で
* 同一実装を共有)。回帰防止テスト (HTML コメント中の literal を無視する等) も同ファイルに
* 集約済み。embed.ts 側は他の rewrite* 関数群との並びを保つための薄い public alias。
*/
var rewriteEmbeddedMarkdownCss = inlineMarkdownCssIntoHtml;
/**
* template HTML の文字列を受け取り、`<script id="embedded-md">` の中身と data-name 属性を
* 書き換えた新しい HTML 文字列を返す。元文字列は変更しない。
* embedded-md タグが見つからない場合は Error を投げる（呼び出し側が CLI エラーに変換）。
*
* theme 属性の付与は `upsertHtmlDataTheme` を別途呼ぶ責務分担にしている。
*/
var rewriteReviewHtml = (reviewHtml, markdown, docName) => {
	const match = EMBEDDED_MD_RE.exec(reviewHtml);
	if (!match) throw new Error("template HTML に id=\"embedded-md\" の <script> タグが見つかりません");
	const [fullMatch, openingTag, , closingTag] = match;
	const replaced = `${setOrInsertAttribute(openingTag, "data-name", escapeHtml(docName))}${encodeEmbeddedMarkdown(markdown)}${closingTag}`;
	return reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length);
};
//#endregion
//#region src/core/embed/runtime-assets.ts
var EMBEDDED_MERMAID_RE = /(<script\b(?=[^>]*\bid="embedded-mermaid")(?=[^>]*\btype="module")[^>]*>)([\s\S]*?)(<\/script>)/i;
var EMBEDDED_KATEX_JS_RE = /(<script\b(?=[^>]*\bid="embedded-katex")(?=[^>]*\btype="module")[^>]*>)([\s\S]*?)(<\/script>)/i;
var EMBEDDED_KATEX_CSS_RE = /(<style\b(?=[^>]*\bid="embedded-katex-css")[^>]*>)([\s\S]*?)(<\/style>)/i;
var EMBEDDED_KATEX_FONTS_EXTRA_CSS_RE = /(<style\b(?=[^>]*\bid="embedded-katex-fonts-extra-css")[^>]*>)([\s\S]*?)(<\/style>)/i;
/**
* `<script id="embedded-mermaid" type="module">` の中身を Mermaid ESM runtime で書き換える。
* runtime は `dist/mermaid.mjs` の文字列を想定しており、bridge コード
* (`globalThis.__mdxgMermaid = mermaid; document.dispatchEvent(...)`) は entry 側に含まれているため
* ここでは追加しない。書き込み時に literal `<\/script>` を `<\/script>` に escape する。
*
* 戻り値の `escapedScriptCount` は CLI が stderr に「N 件 escape した」を報告する用 (運用上 0 件が
* 普通だが、Mermaid version up でエラーメッセージ等に混入する可能性をゼロにしないため可視化する)。
*
* - `runtime` が空文字なら script タグの中身を空のまま残す (注入しない場合の no-op 経路)
* - 該当タグが無ければ Error を投げる
*/
var rewriteEmbeddedMermaid = (reviewHtml, runtime) => {
	const match = EMBEDDED_MERMAID_RE.exec(reviewHtml);
	if (!match) throw new Error("template HTML に id=\"embedded-mermaid\" の <script> タグが見つかりません");
	const [fullMatch, openingTag, , closingTag] = match;
	const { count, escaped } = escapeScriptTagInJs(runtime);
	const replaced = `${openingTag}${escaped}${closingTag}`;
	return {
		escapedScriptCount: count,
		html: reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length)
	};
};
var rewriteStyleBlock = (html, css, target) => {
	const match = target.re.exec(html);
	if (!match) throw new Error(`template HTML に id="${target.blockId}" の <style> タグが見つかりません`);
	const [fullMatch, openingTag, , closingTag] = match;
	const replaced = `${openingTag}${escapeStyleTagInCss$1(css)}${closingTag}`;
	return html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length);
};
var rewriteKatexJs = (html, js) => {
	const match = EMBEDDED_KATEX_JS_RE.exec(html);
	if (!match) throw new Error("template HTML に id=\"embedded-katex\" の <script> タグが見つかりません");
	const [fullMatch, openingTag, , closingTag] = match;
	const { count, escaped } = escapeScriptTagInJs(js);
	const replaced = `${openingTag}${escaped}${closingTag}`;
	return {
		escapedScriptCount: count,
		html: html.slice(0, match.index) + replaced + html.slice(match.index + fullMatch.length)
	};
};
/**
* `<script id="embedded-katex" type="module">` / `<style id="embedded-katex-css">` /
* `<style id="embedded-katex-fonts-extra-css">` の 3 ブロックを KaTeX runtime / CSS で
* 書き換える (Mermaid と完全に対称、DESIGN.md §12 §14 Math Rendering)。
*
* - `assets.fontsExtraCss` が undefined のとき (CLI `--math-fonts minimal` 既定) は
*   fonts-extra ブロックには触らず空のまま残す。standalone build は vite.config.ts 側で
*   全 family を inline する別経路を持つ
* - 該当タグが無ければ Error を投げる
* - `escapedScriptCount` は `js` 内の literal `<\/script>` 件数を返す (CLI が stderr 報告用)
*/
var rewriteEmbeddedKatex = (reviewHtml, assets) => {
	const { escapedScriptCount, html: withJs } = rewriteKatexJs(reviewHtml, assets.js);
	const withMinimal = rewriteStyleBlock(withJs, assets.minimalCss, {
		blockId: "embedded-katex-css",
		re: EMBEDDED_KATEX_CSS_RE
	});
	if (typeof assets.fontsExtraCss !== "string") return {
		escapedScriptCount,
		html: withMinimal
	};
	return {
		escapedScriptCount,
		html: rewriteStyleBlock(withMinimal, assets.fontsExtraCss, {
			blockId: "embedded-katex-fonts-extra-css",
			re: EMBEDDED_KATEX_FONTS_EXTRA_CSS_RE
		})
	};
};
//#endregion
//#region src/core/math.ts
var isTokenLike$1 = (value) => {
	if (typeof value !== "object" || value === null) return false;
	return typeof value.type === "string";
};
var isEscapedDollar = (text, pos) => {
	let backslashes = 0;
	let cursor = pos - 1;
	while (cursor >= 0 && text[cursor] === "\\") {
		backslashes += 1;
		cursor -= 1;
	}
	return backslashes % 2 === 1;
};
var findDisplayEnd = (text, from) => {
	let cursor = from;
	while (cursor < text.length - 1) {
		if (text[cursor] === "$" && text[cursor + 1] === "$" && !isEscapedDollar(text, cursor)) return cursor;
		cursor += 1;
	}
	return -1;
};
var isWhitespaceBefore = (text, pos) => {
	const ch = text[pos - 1];
	return ch === " " || ch === "	" || ch === "\n";
};
var isInvalidInlineOpening = (text, after) => {
	if (after >= text.length) return true;
	const ch = text.charAt(after);
	return ch === " " || ch === "	" || ch === "\n";
};
var findInlineEnd = (text, from) => {
	let cursor = from;
	while (cursor < text.length) {
		const ch = text[cursor];
		if (ch === "\n") return -1;
		if (ch === "$" && !isEscapedDollar(text, cursor) && !isWhitespaceBefore(text, cursor)) return cursor;
		cursor += 1;
	}
	return -1;
};
var buildSegment = (args) => {
	const { text, start, openLen, contentEnd, closeLen, type } = args;
	const closeEnd = contentEnd + closeLen;
	return {
		next: closeEnd,
		segment: {
			end: closeEnd,
			raw: text.slice(start, closeEnd),
			source: text.slice(start + openLen, contentEnd),
			start,
			type
		}
	};
};
var displayScanner = (text, start) => {
	if (text[start] !== "$" || text[start + 1] !== "$") return null;
	const endPos = findDisplayEnd(text, start + 2);
	if (endPos === -1) return {
		next: start + 2,
		segment: null
	};
	return buildSegment({
		closeLen: 2,
		contentEnd: endPos,
		openLen: 2,
		start,
		text,
		type: "display"
	});
};
var inlineScanner = (text, start) => {
	if (text[start] !== "$") return null;
	if (isInvalidInlineOpening(text, start + 1)) return {
		next: start + 1,
		segment: null
	};
	const endPos = findInlineEnd(text, start + 1);
	if (endPos === -1) return {
		next: start + 1,
		segment: null
	};
	return buildSegment({
		closeLen: 1,
		contentEnd: endPos,
		openLen: 1,
		start,
		text,
		type: "inline"
	});
};
var SCANNERS = [displayScanner, inlineScanner];
var stepAt = (text, cursor) => {
	if (text[cursor] !== "$" || isEscapedDollar(text, cursor)) return {
		next: cursor + 1,
		segment: null
	};
	for (const scanner of SCANNERS) {
		const step = scanner(text, cursor);
		if (step !== null) return step;
	}
	return {
		next: cursor + 1,
		segment: null
	};
};
/**
* `$...$` (inline) / `$$...$$` (display) 数式を 1 つの plain text 入力から検出する。
* 結果は `start` 昇順、display を inline より先に判定する (`$$...$$` を `$...$` 2 個と
* 誤解釈しない)。`MathSegment.source` は `$` 区切りを除去した LaTeX 本体で、
* 後段の renderer / upgrade はこれを `katex.renderToString` に直接渡せる。
*/
var scanMath = (text) => {
	const segments = [];
	let cursor = 0;
	while (cursor < text.length) {
		const step = stepAt(text, cursor);
		if (step.segment !== null) segments.push(step.segment);
		cursor = step.next;
	}
	return segments;
};
var tokenRawText = (token) => {
	if (typeof token.raw === "string") return token.raw;
	if (typeof token.text === "string") return token.text;
	return "";
};
var addSegmentsToCounts = (segments, counts) => {
	for (const segment of segments) if (segment.type === "inline") counts.inline += 1;
	else counts.display += 1;
};
var isWalkableToken = (token) => token.type !== "code" && token.type !== "codespan";
var accumulateMathCounts = (tokens, counts) => {
	if (!Array.isArray(tokens)) return;
	for (const token of tokens) if (isTokenLike$1(token) && isWalkableToken(token)) if (token.type === "text") addSegmentsToCounts(scanMath(tokenRawText(token)), counts);
	else {
		accumulateMathCounts(token.tokens, counts);
		accumulateMathCounts(token.items, counts);
	}
};
/**
* markdown 全体から `$...$` / `$$...$$` の件数を inline / display 別に集計する。
* code / codespan 配下の `$` は marked AST 上で別トークンに分離されているため自動的に除外される。
* CLI の `--math auto` 注入判定 (`countMath(md).inline + countMath(md).display > 0`) で使う。
*/
var countMath = (markdown) => {
	const tokens = marked.lexer(markdown);
	const counts = {
		display: 0,
		inline: 0
	};
	accumulateMathCounts(tokens, counts);
	return counts;
};
//#endregion
//#region src/cli/assets/katex.ts
/**
* `--math` mode と markdown 内容から KaTeX runtime を注入すべきか判定する pure 関数
* (Mermaid と完全に対称、DESIGN.md §12 §14 Math Rendering)。
* - mode 未指定 / `auto`: countMath で inline + display > 0 のときのみ true
* - `on`: 常に true
* - `off`: 常に false
*/
var shouldInjectKatex = (mode, markdown) => {
	if (mode === "off") return false;
	if (mode === "on") return true;
	const counts = countMath(markdown);
	return counts.inline + counts.display > 0;
};
var readKatexAsset = async (path) => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error(`${path} が見つかりません。先に \`npm run build\` を実行して dist/katex/ を生成してください。`, { cause: error });
		throw error;
	}
};
var MATH_SIZE_HINT = {
	all: "+~340 KB",
	minimal: "+~250 KB"
};
var readKatexAssets = async (scriptDir, fontsMode) => {
	const [js, minimalCss] = await Promise.all([readKatexAsset(resolve(scriptDir, "katex", "katex.mjs")), readKatexAsset(resolve(scriptDir, "katex", "katex.css"))]);
	const sizeHintGzip = MATH_SIZE_HINT[fontsMode];
	if (fontsMode === "minimal") return {
		js,
		minimalCss,
		sizeHintGzip
	};
	return {
		fontsExtraCss: await readKatexAsset(resolve(scriptDir, "katex", "katex-fonts-extra.css")),
		js,
		minimalCss,
		sizeHintGzip
	};
};
var reportKatexInjection = (report) => {
	const counts = countMath(report.markdown);
	const total = counts.inline + counts.display;
	process$1.stderr.write(`Detected ${total} math expression(s). Embedding KaTeX runtime (fonts=${report.fontsMode}, ${report.sizeHintGzip} gzipped).\n`);
	if (report.escapedScriptCount > 0) process$1.stderr.write(`(escaped ${report.escapedScriptCount} literal <\/script> in KaTeX runtime)\n`);
};
var applyKatex = async (html, args, ctx) => {
	if (!shouldInjectKatex(args.math, ctx.markdown)) return html;
	const fontsMode = args.mathFonts ?? "minimal";
	const assets = await readKatexAssets(ctx.scriptDir, fontsMode);
	const { escapedScriptCount, html: rewritten } = rewriteEmbeddedKatex(html, {
		fontsExtraCss: assets.fontsExtraCss,
		js: assets.js,
		minimalCss: assets.minimalCss
	});
	reportKatexInjection({
		escapedScriptCount,
		fontsMode,
		markdown: ctx.markdown,
		sizeHintGzip: assets.sizeHintGzip
	});
	return rewritten;
};
//#endregion
//#region src/core/scan-mermaid.ts
var isTokenLike = (value) => {
	if (typeof value !== "object" || value === null) return false;
	return typeof value.type === "string";
};
var isMermaidLang = (raw) => {
	if (typeof raw !== "string") return false;
	const [head] = raw.trim().split(/\s+/u, 1);
	return typeof head === "string" && head.toLowerCase() === "mermaid";
};
var isMermaidCodeToken = (token) => {
	if (token.type !== "code") return false;
	return isMermaidLang(token.lang);
};
var walkTokens = (tokens, counter) => {
	if (!Array.isArray(tokens)) return;
	for (const token of tokens) if (isTokenLike(token)) {
		if (isMermaidCodeToken(token)) counter.value += 1;
		walkTokens(token.tokens, counter);
		walkTokens(token.items, counter);
	}
};
/**
* markdown 全体を走査して、`mermaid` 言語識別子付きフェンスの数を返す。
* 大小文字は区別しない (`Mermaid` / `MERMAID` も検出)。
* インラインコードや info string 中の "mermaid" 文字列は検出しない。
*/
var scanMermaidFences = (markdown) => {
	const tokens = marked.lexer(markdown);
	const counter = { value: 0 };
	walkTokens(tokens, counter);
	return counter.value;
};
//#endregion
//#region src/cli/assets/mermaid.ts
/**
* `--mermaid` mode と markdown 内容から Mermaid runtime を注入すべきか判定する pure 関数。
* - mode 未指定 / `auto`: scanMermaidFences > 0 のときのみ true
* - `on`: 常に true
* - `off`: 常に false
*/
var shouldInjectMermaid = (mode, markdown) => {
	if (mode === "off") return false;
	if (mode === "on") return true;
	return scanMermaidFences(markdown) > 0;
};
var readMermaidRuntime = async (scriptDir) => {
	const path = resolve(scriptDir, "mermaid.mjs");
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error(`${path} が見つかりません。先に \`npm run build\` を実行して dist/mermaid.mjs を生成してください。`, { cause: error });
		throw error;
	}
};
var applyMermaid = async (html, args, ctx) => {
	if (!shouldInjectMermaid(args.mermaid, ctx.markdown)) return html;
	const { escapedScriptCount, html: rewritten } = rewriteEmbeddedMermaid(html, await readMermaidRuntime(ctx.scriptDir));
	const count = scanMermaidFences(ctx.markdown);
	process$1.stderr.write(`Detected ${count} mermaid block(s). Embedding mermaid runtime (+~700 KB gzipped).\n`);
	if (escapedScriptCount > 0) process$1.stderr.write(`(escaped ${escapedScriptCount} literal <\/script> in mermaid runtime)\n`);
	return rewritten;
};
//#endregion
//#region src/core/feedback.ts
/** unknown が object record としてプロパティ参照可能かを最初に狭める最小ガード */
var isRecord$1 = (value) => value !== null && typeof value === "object";
/** JSON 由来 number の NaN / Infinity を弾く。offset 計算に流す値なので有限値だけ許可する */
var isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
/** ID や blockId のように空文字だと復元不能になる識別子向けの文字列ガード */
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var hasValidOffsets = (value) => {
	const { endOffset, startOffset } = value;
	return isFiniteNumber(startOffset) && isFiniteNumber(endOffset) && startOffset >= 0 && endOffset > startOffset;
};
/**
* embedded feedback / 既存 feedback.json から来る 1 コメント分の検証 (pageIndex 未確定段階)。
* `sourceLine` は §6.6 invariant により必須で、1 以上の正整数でなければならない。
* `pageIndex` は import 後に sourceLine から逆引きして埋めるためここでは検証しない。
*/
var isImportableComment = (value) => {
	if (!isRecord$1(value)) return false;
	const { blockId, comment, created, id, quote, sourceLine } = value;
	return isNonEmptyString(id) && isNonEmptyString(blockId) && typeof quote === "string" && typeof comment === "string" && isNonEmptyString(created) && isFiniteNumber(sourceLine) && sourceLine >= 1 && hasValidOffsets(value);
};
/** unknown 配列から有効な ImportedComment だけを取り出す。外部 JSON の壊れた要素は fail-soft で除外する */
var commentsFromUnknown = (value) => {
	if (!Array.isArray(value)) return [];
	return value.filter(isImportableComment);
};
//#endregion
//#region src/cli/assets/resume-feedback.ts
var STDIN_TOKEN$1 = "-";
var parseFeedbackJson = (raw) => {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
};
var isRecord = (value) => value !== null && typeof value === "object";
/**
* `isImportableComment` を通る件数のみ数える。ブラウザ側 boot 経路は壊れた要素を fail-soft に
* filter するため、raw `payload.comments.length` と「実際に貼り直される件数」が乖離する。
*/
var countComments = (payload) => {
	if (!isRecord(payload)) return 0;
	return commentsFromUnknown(payload.comments).length;
};
var extractDocHash = (payload) => {
	if (!isRecord(payload)) return null;
	if (typeof payload.docHash !== "string") return null;
	return payload.docHash;
};
/**
* `outputPath` と同じディレクトリにある `<mdFileName>-<docHash>-feedback.json` のフルパス。
* compose-review-html.ts の outputPath 組み立てと同じ sanitize / stripExt ルールに揃える。
*/
var resolveFeedbackPath = (docName, docHash, outputPath) => {
	const mdFileName = sanitizeMdFileName(stripMarkdownExt(docName));
	return resolve(dirname(outputPath), deriveFeedbackJsonName(mdFileName, docHash));
};
var extractErrorCode = (error) => {
	if (error instanceof Error && "code" in error) return String(error.code);
	return "unknown";
};
/**
* ENOENT (= 初回ラウンドで feedback.json が存在しない) は silent skip。
* EACCES / EISDIR / ELOOP 等の他 I/O エラーも、resume が失敗するだけで review HTML 生成
* 自体は続行できるため stderr 警告 + skip にダウングレードする (CLI 全体を落とさない)。
*/
var readFeedbackFile = async (feedbackPath) => {
	try {
		return {
			raw: await readFile(feedbackPath, "utf8"),
			warning: null
		};
	} catch (error) {
		const code = extractErrorCode(error);
		if (code === "ENOENT") return {
			raw: null,
			warning: null
		};
		return {
			raw: null,
			warning: `(skipped resuming ${feedbackPath}: read failed with ${code})\n`
		};
	}
};
var validateFeedbackPayload = (raw, expectedDocHash, feedbackPath) => {
	const payload = parseFeedbackJson(raw);
	if (payload === null) return {
		payload: null,
		warning: `(skipped resuming ${feedbackPath}: invalid JSON)\n`
	};
	const payloadDocHash = extractDocHash(payload);
	if (payloadDocHash !== expectedDocHash) return {
		payload: null,
		warning: `(skipped resuming ${feedbackPath}: docHash mismatch — got ${payloadDocHash ?? "null"}, expected ${expectedDocHash})\n`
	};
	return {
		payload,
		warning: null
	};
};
var readValidatedFeedback = async (feedbackPath, expectedDocHash) => {
	const { raw, warning: readWarning } = await readFeedbackFile(feedbackPath);
	if (readWarning !== null) process$1.stderr.write(readWarning);
	if (raw === null) return null;
	const { payload, warning } = validateFeedbackPayload(raw, expectedDocHash, feedbackPath);
	if (warning !== null) {
		process$1.stderr.write(warning);
		return null;
	}
	return {
		feedbackPath,
		payload
	};
};
var resolveResumePayload = async (args, ctx) => {
	if (args.inputPath === STDIN_TOKEN$1) return null;
	return readValidatedFeedback(resolveFeedbackPath(ctx.docName, ctx.docHash, ctx.outputPath), ctx.docHash);
};
var applyResumeFeedback = async (html, args, ctx) => {
	const resolved = await resolveResumePayload(args, ctx);
	if (resolved === null) return html;
	const count = countComments(resolved.payload);
	const rewritten = rewriteEmbeddedFeedback(html, resolved.payload);
	process$1.stderr.write(`Resumed ${count} comment(s) from ${resolved.feedbackPath}.\n`);
	return rewritten;
};
//#endregion
//#region src/cli/error-message.ts
var errorMessage = (error) => {
	if (error instanceof Error) return error.message;
	return String(error);
};
//#endregion
//#region src/cli/assets/shiki.ts
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
	for await (const chunk of process$1.stdin) chunks.push(toBuffer(chunk));
	return Buffer.concat(chunks).toString("utf8");
};
var resolveInput = async (inputPath, documentName) => {
	if (inputPath === STDIN_TOKEN) {
		const markdown = await readStdin();
		return {
			defaultOutputDir: process$1.cwd(),
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
//#region src/cli/compose-review-html.ts
var readReviewHtml = async (path) => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error(`${path} が見つかりません。先に \`npm run build\` を実行して dist/embed-template.html を生成してください。`, { cause: error });
		throw error;
	}
};
var prepareEmbed = async (args) => {
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const [input, reviewHtml] = await Promise.all([resolveInput(args.inputPath, args.documentName), readReviewHtml(resolve(scriptDir, "embed-template.html"))]);
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
var applyCommentsWidthHint = (html, commentsWidth) => {
	if (typeof commentsWidth !== "number") return html;
	return upsertHtmlDataCommentsWidth(html, commentsWidth);
};
var applyPageNavWidthHint = (html, pageNavWidth) => {
	if (typeof pageNavWidth !== "number") return html;
	return upsertHtmlDataPageNavWidth(html, pageNavWidth);
};
var applyToolbarOpenFileHint = (html, showOpenFile) => {
	if (showOpenFile === true) return html;
	return upsertHtmlDataToolbarOpenFile(html, "off");
};
var applyTitleRewrite = (html, docName) => rewriteTitle(html, `MDXG Redline — ${docName}`);
var applyMarkdownCss = async (html, args) => {
	if (typeof args.markdownCssPath !== "string") return html;
	return rewriteEmbeddedMarkdownCss(html, await readFile(args.markdownCssPath, "utf8"));
};
var applyHintRewrites = (args, ctx) => {
	return applyTitleRewrite(applyToolbarOpenFileHint(applyPageNavWidthHint(applyCommentsWidthHint(applyThemeHint(rewriteReviewHtml(ctx.reviewHtml, ctx.markdown, ctx.docName), args.themeHint), args.commentsWidth), args.pageNavWidth), args.showOpenFile), ctx.docName);
};
var composeReviewHtml = async (args, ctx) => {
	return upsertEmbeddedMdMeta(rewriteInitialStatus(await applyMarkdownCss(await applyResumeFeedback(await applyKatex(await applyMermaid(await applyShikiLangs(applyHintRewrites(args, ctx), args, ctx), args, ctx), args, ctx), args, ctx), args), formatLoadedStatus(ctx.docName, ctx.docHash)));
};
//#endregion
//#region src/cli/clean-format.ts
var formatEntryLines = (header, entries) => {
	if (entries.length === 0) return [];
	return [header, ...entries.map((entry) => `  ${entry.filename}`)];
};
var formatDryRun = (dir, result) => {
	if (result.toDelete.length === 0 && result.kept.length === 0) return `No review/feedback artifacts found in ${dir}.\n`;
	const deleteLines = formatEntryLines(`[dry-run] Would delete ${result.toDelete.length} file(s) in ${dir}:`, result.toDelete);
	const keepLines = formatEntryLines(`Kept ${result.kept.length} file(s) matching --keep:`, result.kept);
	return `${[
		...deleteLines,
		...keepLines,
		`Run with --yes to delete.`
	].join("\n")}\n`;
};
var formatDeleted = (dir, deleted, kept) => {
	if (deleted === 0 && kept === 0) return `No review/feedback artifacts found in ${dir}.\n`;
	const head = `Deleted ${deleted} file(s) in ${dir}.\n`;
	if (kept === 0) return head;
	return `${head}Kept ${kept} file(s) matching --keep.\n`;
};
//#endregion
//#region src/cli/clean-io.ts
var defaultCleanIo = {
	readdir: async (path, opts = {}) => readdir(path, { recursive: opts.recursive === true }),
	stderr: (text) => {
		process.stderr.write(text);
	},
	stdout: (text) => {
		process.stdout.write(text);
	},
	unlink: async (path) => unlink(path)
};
//#endregion
//#region src/cli/clean.ts
/**
* `<mdFileName>-<16桁hex>-(review.html|feedback.json)` 形式のファイル名を識別する正規表現。
* 大小無視は parseReviewMdFilename 削除前の挙動と整合させるための保険で、CLI 自体は
* 小文字 hex で出力するため通常は小文字でマッチする。
*/
var REVIEW_ARTIFACT_PATTERN = /^(.+)-([0-9a-f]{16})-(review\.html|feedback\.json)$/i;
var matchEntry = (filename) => {
	const match = REVIEW_ARTIFACT_PATTERN.exec(filename);
	if (!match) return null;
	const [, mdFileName, hash, suffix] = match;
	if (suffix !== "review.html" && suffix !== "feedback.json") return null;
	return {
		docHash: hash.toLowerCase(),
		filename,
		mdFileName,
		suffix
	};
};
/**
* ファイル名列を「削除候補 / `--keep` で温存 / 規約外で skip」の 3 つに振り分ける pure 関数。
* I/O を持たないため in-source test で全分岐を網羅する。
*/
var classifyEntries = (filenames, keepHashes) => {
	const matched = filenames.map((filename) => matchEntry(filename)).filter((entry) => entry !== null);
	const skipped = filenames.filter((filename) => matchEntry(filename) === null);
	const toDelete = matched.filter((entry) => !keepHashes.has(entry.docHash));
	return {
		kept: matched.filter((entry) => keepHashes.has(entry.docHash)),
		skipped,
		toDelete
	};
};
var deleteEntries = async (dir, entries, io) => {
	await Promise.all(entries.map(async (entry) => io.unlink(resolve(dir, entry.filename))));
};
/**
* `--clean` の実行エントリ。CLI 経由でも他テスト経路でも使えるよう、I/O は引数で受け取る。
* 戻り値は process exit code 相当 (0 = success, 1 = failure)。
*/
var runClean = async (args, io) => {
	const dirAbs = resolve(args.dir);
	const result = classifyEntries(await io.readdir(dirAbs, { recursive: args.recursive }), args.keep);
	if (!args.yes) {
		io.stdout(formatDryRun(dirAbs, result));
		return 0;
	}
	await deleteEntries(dirAbs, result.toDelete, io);
	io.stdout(formatDeleted(dirAbs, result.toDelete.length, result.kept.length));
	return 0;
};
//#endregion
//#region src/cli/open-command.ts
var isHostBrowserUnreachableViaFile = (env) => {
	if (env.REMOTE_CONTAINERS === "true") return true;
	if (env.CODESPACES === "true") return true;
	const browser = env.BROWSER ?? "";
	return browser.includes("vscode-server") && browser.includes("helpers/browser.sh");
};
var buildOpenCommand = (platform, path, env = process$1.env) => {
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
	const { args, command } = buildOpenCommand(process$1.platform, path, process$1.env);
	execFile(command, args, (error) => {
		if (error) process$1.stderr.write(`review-request: ブラウザを起動できませんでした (${command}: ${error.message})。上記のパスを手動で開いてください。\n`);
		done();
	});
});
//#endregion
//#region src/cli/serve.ts
var SERVE_AUTOSTOP_MS = 3e3;
var SERVE_GIVEUP_MS = 1e4;
var SERVE_HOST = "127.0.0.1";
var DEFAULT_PORT = 51729;
var PORT_ENV_VAR = "MDXG_REDLINE_PORT";
var resolvePreferredPort = (env) => {
	const raw = env[PORT_ENV_VAR];
	if (!raw) return DEFAULT_PORT;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		process$1.stderr.write(`review-request: ${PORT_ENV_VAR}="${raw}" は有効なポート番号ではないため ${String(DEFAULT_PORT)} を使います。\n`);
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
	process$1.stderr.write(`review-request: ポート ${String(preferred)} が使用中のため ${String(result.port)} を使います。${PORT_ENV_VAR} でデフォルトを上書きできます。今回はブラウザ側 IndexedDB のサイレント復元 (Write feedback.json の保存先記憶) が効かない可能性があります。\n`);
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
	const listened = await listenWithFallback(server, resolvePreferredPort(process$1.env));
	return {
		done: new Promise((doneResolve) => {
			const stop = () => {
				server.closeAllConnections();
				server.close(() => doneResolve());
			};
			const giveup = setTimeout(stop, SERVE_GIVEUP_MS);
			server.once("request", () => {
				clearTimeout(giveup);
				setTimeout(stop, SERVE_AUTOSTOP_MS);
			});
		}),
		url: `http://localhost:${String(listened.port)}/${encodeURIComponent(basename(filePath))}`
	};
};
var openOutput = async (outputPath) => {
	if (!isHostBrowserUnreachableViaFile(process$1.env)) {
		await openInBrowser(outputPath);
		return;
	}
	const handle = await serveOnceAndAutoStop(outputPath);
	process$1.stderr.write(`review-request: VS Code Remote 環境を検知。HTTP サーバーを ${handle.url} で起動しました。初回アクセス後 ${SERVE_AUTOSTOP_MS / 1e3} 秒、リクエストが無ければ ${SERVE_GIVEUP_MS / 1e3} 秒で自動停止します。\n`);
	await openInBrowser(handle.url);
	await handle.done;
};
//#endregion
//#region src/cli/review-request.ts
var runEmbed = async (args) => {
	const ctx = await prepareEmbed(args);
	const result = await composeReviewHtml(args, ctx);
	await writeFile(ctx.outputPath, result, "utf8");
	process$1.stdout.write(`${ctx.outputPath}\n`);
	if (args.open) await openOutput(ctx.outputPath);
};
var handleNonRunModes = (args) => {
	if (args.mode === "help") {
		process$1.stdout.write(HELP_TEXT);
		return true;
	}
	if (args.mode === "invalid") {
		process$1.stderr.write(`mdxg-redline: invalid arguments. Run \`mdxg-redline --help\` for usage.\n`);
		process$1.exit(1);
	}
	return false;
};
var main = async () => {
	const args = parseArgs(process$1.argv.slice(2));
	if (handleNonRunModes(args)) return;
	if (args.mode === "clean") {
		const code = await runClean({
			dir: args.dir,
			keep: args.keep,
			recursive: args.recursive,
			yes: args.yes
		}, defaultCleanIo);
		process$1.exit(code);
	}
	if (args.mode === "run") await runEmbed(args);
};
main().catch((error) => {
	process$1.stderr.write(`review-request: ${errorMessage(error)}\n`);
	process$1.exit(1);
});
//#endregion
export {};
