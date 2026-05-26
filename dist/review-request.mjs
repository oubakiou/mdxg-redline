#!/usr/bin/env node
import { marked } from "marked";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import process$1 from "node:process";
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
	"文言": "wenyan"
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
var COMMENTS_WIDTH_FLAG = "--comments-width";
var PAGE_NAV_WIDTH_FLAG = "--page-nav-width";
var SHOW_OPEN_FILE_FLAG = "--show-open-file";
var CLEAN_FLAG = "--clean";
var YES_FLAG = "--yes";
var KEEP_FLAG = "--keep";
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
`;
var INITIAL_CLEAN_STATE = {
	dir: null,
	keep: /* @__PURE__ */ new Set(),
	pendingDir: false,
	pendingKeep: false,
	valid: true,
	yes: false
};
var consumeCleanDirValue = (acc, token) => {
	if (token.startsWith("--")) return {
		...acc,
		valid: false
	};
	return {
		...acc,
		dir: token,
		pendingDir: false
	};
};
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
	if (acc.dir !== null || acc.pendingDir) return {
		...acc,
		valid: false
	};
	return {
		...acc,
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
	}
];
var stepCleanArg = (acc, token) => {
	if (!acc.valid) return acc;
	if (acc.pendingDir) return consumeCleanDirValue(acc, token);
	if (acc.pendingKeep) return consumeCleanKeepValue(acc, token);
	const entry = CLEAN_FLAG_TABLE.find((row) => row.flag === token);
	if (!entry) return {
		...acc,
		valid: false
	};
	return entry.mark(acc);
};
var parseCleanArgs = (argv) => {
	const state = argv.reduce(stepCleanArg, INITIAL_CLEAN_STATE);
	if (!state.valid || state.pendingDir || state.pendingKeep || state.dir === null) return { mode: "invalid" };
	return {
		dir: state.dir,
		keep: state.keep,
		mode: "clean",
		yes: state.yes
	};
};
var INITIAL_PARTITION_STATE = {
	commentsWidth: null,
	documentName: null,
	open: true,
	pageNavWidth: null,
	pendingCommentsWidth: false,
	pendingDocName: false,
	pendingPageNavWidth: false,
	pendingShikiLangs: false,
	pendingTheme: false,
	positional: [],
	shikiLangs: null,
	showOpenFile: false,
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
var consumeCommentsWidthValue = (acc, token) => {
	if (token.startsWith("--")) return {
		...acc,
		valid: false
	};
	const parsed = parseCommentsWidthValue(token);
	if (parsed === null) return {
		...acc,
		valid: false
	};
	return {
		...acc,
		commentsWidth: parsed,
		pendingCommentsWidth: false
	};
};
var consumePageNavWidthValue = (acc, token) => {
	if (token.startsWith("--")) return {
		...acc,
		valid: false
	};
	const parsed = parsePageNavWidthValue(token);
	if (parsed === null) return {
		...acc,
		valid: false
	};
	return {
		...acc,
		pageNavWidth: parsed,
		pendingPageNavWidth: false
	};
};
var consumeStandaloneFlag = (acc, token) => {
	if (token === NO_OPEN_FLAG) return {
		...acc,
		open: false
	};
	if (token === SHOW_OPEN_FILE_FLAG) return {
		...acc,
		showOpenFile: true
	};
	return null;
};
var VALUE_FLAG_TABLE = [
	{
		flag: DOCUMENT_NAME_FLAG,
		mark: (acc) => ({
			...acc,
			pendingDocName: true
		})
	},
	{
		flag: THEME_FLAG,
		mark: (acc) => ({
			...acc,
			pendingTheme: true
		})
	},
	{
		flag: SHIKI_LANGS_FLAG,
		mark: (acc) => ({
			...acc,
			pendingShikiLangs: true
		})
	},
	{
		flag: COMMENTS_WIDTH_FLAG,
		mark: (acc) => ({
			...acc,
			pendingCommentsWidth: true
		})
	},
	{
		flag: PAGE_NAV_WIDTH_FLAG,
		mark: (acc) => ({
			...acc,
			pendingPageNavWidth: true
		})
	}
];
var consumeValueFlag = (acc, token) => {
	const entry = VALUE_FLAG_TABLE.find((row) => row.flag === token);
	if (!entry) return null;
	return entry.mark(acc);
};
var consumeFlag = (acc, token) => {
	const standalone = consumeStandaloneFlag(acc, token);
	if (standalone !== null) return standalone;
	const valueFlag = consumeValueFlag(acc, token);
	if (valueFlag !== null) return valueFlag;
	return {
		...acc,
		valid: false
	};
};
var PENDING_VALUE_TABLE = [
	{
		consume: consumeDocNameValue,
		key: "pendingDocName"
	},
	{
		consume: consumeThemeValue,
		key: "pendingTheme"
	},
	{
		consume: consumeShikiLangsValue,
		key: "pendingShikiLangs"
	},
	{
		consume: consumeCommentsWidthValue,
		key: "pendingCommentsWidth"
	},
	{
		consume: consumePageNavWidthValue,
		key: "pendingPageNavWidth"
	}
];
var consumePendingValue = (acc, token) => {
	const entry = PENDING_VALUE_TABLE.find((row) => acc[row.key]);
	if (!entry) return null;
	return entry.consume(acc, token);
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
	if (state.commentsWidth !== null) result.commentsWidth = state.commentsWidth;
	if (state.pageNavWidth !== null) result.pageNavWidth = state.pageNavWidth;
};
var isPartitionValid = (state) => state.valid && !state.pendingDocName && !state.pendingTheme && !state.pendingShikiLangs && !state.pendingCommentsWidth && !state.pendingPageNavWidth;
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
var attachRunStringOptionals = (result, parts) => {
	const [, outputDir] = parts.positional;
	if (typeof outputDir === "string") result.outputDir = outputDir;
	if (typeof parts.documentName === "string") result.documentName = parts.documentName;
	if (typeof parts.themeHint === "string") result.themeHint = parts.themeHint;
};
var attachRunNonStringOptionals = (result, parts) => {
	if (parts.shikiLangs) result.shikiLangs = parts.shikiLangs;
	if (typeof parts.commentsWidth === "number") result.commentsWidth = parts.commentsWidth;
	if (typeof parts.pageNavWidth === "number") result.pageNavWidth = parts.pageNavWidth;
};
var attachRunOptionals = (result, parts) => {
	attachRunStringOptionals(result, parts);
	attachRunNonStringOptionals(result, parts);
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
var parseArgs = (argv) => {
	if (argv.length === 0) return { mode: "help" };
	if (argv.some((token) => HELP_FLAGS.has(token))) return { mode: "help" };
	if (argv.includes(CLEAN_FLAG)) return parseCleanArgs(argv);
	return parseRunArgs(argv);
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
	if (!match) throw new Error("template HTML に id=\"status\" の <span> タグが見つかりません");
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
	if (!headMatch) throw new Error("template HTML に <head> タグが見つかりません");
	const insertPos = headMatch.index + headMatch[0].length;
	return cleaned.slice(0, insertPos) + "\n    <meta name=\"mdxg-redline:embedded-md\" content=\"1\" />" + cleaned.slice(insertPos);
};
var EMBEDDED_SHIKI_LANGS_RE = /(<script\b(?=[^>]*\bid="embedded-shiki-langs")(?=[^>]*\btype="application\/json")[^>]*>)([\s\S]*?)(<\/script>)/i;
var DATA_NAME_RE = /\bdata-name="[^"]*"/;
var HTML_TAG_RE = /<html\b[^>]*>/i;
var DATA_THEME_RE = /\bdata-theme="[^"]*"/;
var DATA_COMMENTS_WIDTH_RE = /\bdata-comments-width="[^"]*"/;
var DATA_PAGE_NAV_WIDTH_RE = /\bdata-page-nav-width="[^"]*"/;
var DATA_TOOLBAR_OPEN_FILE_RE = /\bdata-toolbar-open-file="[^"]*"/;
var TITLE_RE = /(<title\b[^>]*>)([\s\S]*?)(<\/title>)/i;
var replaceDataName = (openingTag, escapedName) => {
	if (DATA_NAME_RE.test(openingTag)) return openingTag.replace(DATA_NAME_RE, `data-name="${escapedName}"`);
	return openingTag.replace(/>$/, ` data-name="${escapedName}">`);
};
var replaceDataTheme = (openingTag, escapedTheme) => {
	if (DATA_THEME_RE.test(openingTag)) return openingTag.replace(DATA_THEME_RE, `data-theme="${escapedTheme}"`);
	return openingTag.replace(/>$/, ` data-theme="${escapedTheme}">`);
};
var replaceDataCommentsWidth = (openingTag, escapedValue) => {
	if (DATA_COMMENTS_WIDTH_RE.test(openingTag)) return openingTag.replace(DATA_COMMENTS_WIDTH_RE, `data-comments-width="${escapedValue}"`);
	return openingTag.replace(/>$/, ` data-comments-width="${escapedValue}">`);
};
var replaceDataPageNavWidth = (openingTag, escapedValue) => {
	if (DATA_PAGE_NAV_WIDTH_RE.test(openingTag)) return openingTag.replace(DATA_PAGE_NAV_WIDTH_RE, `data-page-nav-width="${escapedValue}"`);
	return openingTag.replace(/>$/, ` data-page-nav-width="${escapedValue}">`);
};
/**
* `<html>` 開きタグに `data-theme="<themeHint>"` を挿入する。属性が既にあれば上書き。
* inline script はこの属性を localStorage より低い優先度で初期値ヒントとして使う。
* 未指定時は属性を付けないため、呼び出し側で themeHint の有無を判断してから呼ぶ
* (CLI 既定では --theme 未指定時はこの関数を呼ばない方針)。
*/
var upsertHtmlDataTheme = (reviewHtml, themeHint) => {
	const match = HTML_TAG_RE.exec(reviewHtml);
	if (!match) throw new Error("template HTML に <html> タグが見つかりません");
	const [tag] = match;
	const newTag = replaceDataTheme(tag, escapeHtml(themeHint));
	return reviewHtml.slice(0, match.index) + newTag + reviewHtml.slice(match.index + tag.length);
};
/**
* `<html>` 開きタグに `data-comments-width="<value>"` を挿入する。属性が既にあれば上書き。
* inline script はこの属性を localStorage より低い優先度で初期値ヒントとして使う。
* 値の正当性 (0 or 240–640) は CLI 側でバリデーション済み前提だが、属性 escape 経路は
* data-theme と揃える。
*/
var upsertHtmlDataCommentsWidth = (reviewHtml, value) => {
	const match = HTML_TAG_RE.exec(reviewHtml);
	if (!match) throw new Error("template HTML に <html> タグが見つかりません");
	const [tag] = match;
	const newTag = replaceDataCommentsWidth(tag, escapeHtml(String(value)));
	return reviewHtml.slice(0, match.index) + newTag + reviewHtml.slice(match.index + tag.length);
};
/**
* `<html>` 開きタグに `data-page-nav-width="<value>"` を挿入する。属性が既にあれば上書き。
* 値の正当性 (0 or 180–480) は CLI 側でバリデーション済み前提。data-comments-width と対称。
*/
var upsertHtmlDataPageNavWidth = (reviewHtml, value) => {
	const match = HTML_TAG_RE.exec(reviewHtml);
	if (!match) throw new Error("template HTML に <html> タグが見つかりません");
	const [tag] = match;
	const newTag = replaceDataPageNavWidth(tag, escapeHtml(String(value)));
	return reviewHtml.slice(0, match.index) + newTag + reviewHtml.slice(match.index + tag.length);
};
var replaceDataToolbarOpenFile = (openingTag, value) => {
	if (DATA_TOOLBAR_OPEN_FILE_RE.test(openingTag)) return openingTag.replace(DATA_TOOLBAR_OPEN_FILE_RE, `data-toolbar-open-file="${value}"`);
	return openingTag.replace(/>$/, ` data-toolbar-open-file="${value}">`);
};
/**
* `<html>` 開きタグに `data-toolbar-open-file="off"` を挿入する (idempotent)。
* CLI が --show-open-file を指定していない時にだけ呼び、ブラウザ側 toolbar.ts はこの属性で
* Open file ボタンと隠し input を起動時に DOM から削除する (DESIGN.md §3 入力 1 のフットガン
* を CLI 経路で構造的に塞ぐ意図)。値は `'off'` のみで運用するため型でも literal に絞る。
*/
var upsertHtmlDataToolbarOpenFile = (reviewHtml, value) => {
	const match = HTML_TAG_RE.exec(reviewHtml);
	if (!match) throw new Error("template HTML に <html> タグが見つかりません");
	const [tag] = match;
	const newTag = replaceDataToolbarOpenFile(tag, escapeHtml(value));
	return reviewHtml.slice(0, match.index) + newTag + reviewHtml.slice(match.index + tag.length);
};
/**
* `<title>` の中身を書き換える (idempotent)。ブラウザタブ・ファイル共有先で配布物を識別できるよう、
* CLI 経路では `"MDXG Redline — <docName>"` 形式で上書きする (DESIGN.md §5.e)。
* <title> タグが見つからない場合は no-op (フェイタルではなく warning 相当)。
* <title> 中の特殊文字は HTML escape される (信頼境界、DESIGN.md §11)。
*/
var rewriteTitle = (reviewHtml, newTitle) => {
	const match = TITLE_RE.exec(reviewHtml);
	if (!match) return reviewHtml;
	const [fullMatch, openingTag, , closingTag] = match;
	const replaced = `${openingTag}${escapeHtml(newTitle)}${closingTag}`;
	return reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length);
};
/**
* `<script id="embedded-shiki-langs">` の中身を grammars の JSON で書き換える。
* - `grammars` が空オブジェクト `{}` でも JSON `{}` が書き込まれる (browser は空 langs として扱う)
* - 該当 `<script>` タグが template HTML に無ければ Error を投げる (呼び出し側が CLI エラーに変換)
*
* embedded-md のように属性経由の上書きはなく、コンテンツ置換のみ。
*/
var rewriteEmbeddedShikiLangs = (reviewHtml, grammars) => {
	const match = EMBEDDED_SHIKI_LANGS_RE.exec(reviewHtml);
	if (!match) throw new Error("template HTML に id=\"embedded-shiki-langs\" の <script> タグが見つかりません");
	const [fullMatch, openingTag, , closingTag] = match;
	const replaced = `${openingTag}${encodeEmbeddedShikiLangs(grammars)}${closingTag}`;
	return reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length);
};
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
	const replaced = `${replaceDataName(openingTag, escapeHtml(docName))}${encodeEmbeddedMarkdown(markdown)}${closingTag}`;
	return reviewHtml.slice(0, match.index) + replaced + reviewHtml.slice(match.index + fullMatch.length);
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
var deleteEntries = async (dir, entries, io) => {
	await Promise.all(entries.map(async (entry) => io.unlink(resolve(dir, entry.filename))));
};
/**
* `--clean` の実行エントリ。CLI 経由でも他テスト経路でも使えるよう、I/O は引数で受け取る。
* 戻り値は process exit code 相当 (0 = success, 1 = failure)。
*/
var runClean = async (args, io) => {
	const dirAbs = resolve(args.dir);
	const result = classifyEntries(await io.readdir(dirAbs), args.keep);
	if (!args.yes) {
		io.stdout(formatDryRun(dirAbs, result));
		return 0;
	}
	await deleteEntries(dirAbs, result.toDelete, io);
	io.stdout(formatDeleted(dirAbs, result.toDelete.length, result.kept.length));
	return 0;
};
var defaultCleanIo = {
	readdir: async (path) => readdir(path),
	stderr: (text) => {
		process.stderr.write(text);
	},
	stdout: (text) => {
		process.stdout.write(text);
	},
	unlink: async (path) => unlink(path)
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
//#region src/cli/review-request.ts
var errorMessage = (error) => {
	if (error instanceof Error) return error.message;
	return String(error);
};
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
	return upsertEmbeddedMdMeta(rewriteInitialStatus(await applyShikiLangs(applyTitleRewrite(applyToolbarOpenFileHint(applyPageNavWidthHint(applyCommentsWidthHint(applyThemeHint(rewriteReviewHtml(ctx.reviewHtml, ctx.markdown, ctx.docName), args.themeHint), args.commentsWidth), args.pageNavWidth), args.showOpenFile), ctx.docName), args, ctx), formatLoadedStatus(ctx.docName, ctx.docHash)));
};
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
export { resolveShikiLangSet };
