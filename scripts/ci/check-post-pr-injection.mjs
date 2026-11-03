#!/usr/bin/env node
/**
 * T5 post-PR injection check: what the merged change added that an agent, a
 * runner or a reader could be steered by.
 *
 * It reads the merge commit's own diff (HEAD^1..HEAD) and the commit message,
 * and looks only at what the merge ADDED, so old text never turns it red. It
 * needs no secrets and runs nothing from the change. Findings, all failing:
 *
 *   hidden-char    bidi controls or Unicode tag characters in any added text;
 *                  zero-width characters in instruction surfaces and code
 *   phrase         instruction-override wording or chat-template tokens added to
 *                  a file an agent reads (CLAUDE.md, .claude/**, workflows, ...)
 *   commit-message the same wording or characters in the merge commit message
 *                  (a squash copies the PR body there)
 *   expr-injection an untrusted ${{ github.event... }} value used in a run or
 *                  script body instead of an env: value
 *   loader-env     LD_PRELOAD, NODE_OPTIONS and similar set in a workflow
 *   unpinned-action `uses:` pinned to @main, @master, @HEAD or @latest
 *   pr-target      a pull_request_target trigger added
 *   secret-dump    toJSON(secrets) or toJSON(vars) in an expression
 *   new-secret     a secrets.X / vars.X name not in the allowlist
 *   new-host       a URL host not in the allowlist (instruction and CI surfaces)
 *   lifecycle      a package.json install-time script added
 *
 * The allowlist is scripts/ci/post-pr-injection-allowlist.json. Adding to it is
 * a reviewed change (CODEOWNERS), which is the point: a new host or secret name
 * is something a person has looked at.
 *
 * Usage: node scripts/ci/check-post-pr-injection.mjs [--base <rev>] [--head <rev>] [--all]
 *   --all  scan every tracked file as if it were all added (a dry run for baselining)
 * Exit: 0 clean, 1 findings, 2 cannot compare (fail closed).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* eslint-disable security/detect-unsafe-regex, security/detect-non-literal-regexp, security/detect-non-literal-fs-filename --
   The patterns are fixed and run over single lines capped at MAX_LINE (see scan);
   the two constructed ones are built from constant code points, not input; the
   file paths are this repo's own allowlist and the CI step summary. */
const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_LINE = 20000;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// ── What counts as a surface ────────────────────────────────────────────────
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const INSTRUCTION_SURFACE = [
  /(^|\/)(CLAUDE|AGENTS|GEMINI)\.md$/i,
  /^\.claude\/(agents|skills|commands|hooks)\//,
  /^\.claude\/[^/]+\.md$/,
  /^\.claude\/settings[^/]*\.json$/,
  /^\.github\/(copilot-instructions\.md|claude-review\/|workflows\/|actions\/|ISSUE_TEMPLATE\/|PULL_REQUEST_TEMPLATE)/,
  /^\.cursor(\/|rules$)/,
  /^\.windsurfrules$/,
  /^\.mcp\.json$/,
];
const WORKFLOW_FILE = /^\.github\/(workflows\/[^/]+\.ya?ml|actions\/.+\.ya?ml)$/;
const CODE_FILE = /\.(js|mjs|cjs|ts|sh|ya?ml|json|toml)$/;
const URL_SURFACE_EXTRA = [
  /^scripts\/ci\//,
  /^workers\/[^/]+\/wrangler\.[^/]+$/,
  /(^|\/)package\.json$/,
];

export const isInstructionSurface = (p) =>
  !TEST_FILE.test(p) && INSTRUCTION_SURFACE.some((re) => re.test(p));
const isUrlSurface = (p) =>
  !TEST_FILE.test(p) && (isInstructionSurface(p) || URL_SURFACE_EXTRA.some((re) => re.test(p)));

// ── Patterns ────────────────────────────────────────────────────────────────
const PHRASES = [
  [
    /\bignore (all |any |the |your )?(previous|prior|above|earlier) (instructions|prompts?|rules|directions)/i,
    'tells a reader to ignore earlier instructions',
  ],
  [
    /\bdisregard (all |any |the |your )?(previous|prior|above|earlier|system) (instructions|prompts?|rules)/i,
    'tells a reader to disregard instructions',
  ],
  [
    /\bforget (everything|all|your) (above|previous|prior|instructions)/i,
    'tells a reader to forget instructions',
  ],
  [/\byou are now (DAN|unrestricted|jailbroken|free of)/i, 'role-reset wording'],
  [/\bnew (system )?instructions?\s*:/i, 'announces replacement instructions'],
  [/<\|(im_start|im_end|system|endoftext)\|>/i, 'chat-template control token'],
  [/<\s*\/?\s*(system|assistant|developer)\s*>/i, 'fake role tag'],
  [/\[\s*(SYSTEM|INST)\s*\]/, 'fake role marker'],
  [
    /\b(do not|don't|never) (tell|inform|mention (this )?to|reveal (this )?to) the (user|owner|reviewer)\b/i,
    'asks to hide something from the user',
  ],
  [
    /\b(you (must|should|need to|will)|please|always|just)\s+(approve|accept|merge) (this|the) (pr|pull request|change)\b|\bmark (this|the) (pr|review|check) as (approved|passing)\b/i,
    'steers a reviewer to approve',
  ],
  [/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/i, 'pipes a download into a shell'],
];
const cp = (n) => String.fromCodePoint(n);
// Built from code points so this file carries no invisible characters itself.
const BIDI_OR_TAG = new RegExp(
  `[${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]|[${cp(0xe0000)}-${cp(0xe007f)}]`,
  'u'
);
const ZERO_WIDTH = new RegExp(`[${cp(0x200b)}${cp(0x2060)}${cp(0x180e)}]|(?!^)${cp(0xfeff)}`, 'u');

const UNTRUSTED =
  /\b(github\.event\.(issue|pull_request|discussion)\.(title|body)|github\.event\.(comment|review|review_comment)\.body|github\.event\.pages\.[^\s}]*page_name|github\.event\.commits\.[^\s}]*\.(message|author\.(email|name))|github\.event\.head_commit\.(message|author\.(email|name))|github\.event\.pull_request\.head\.(ref|label)|github\.event\.pull_request\.head\.repo\.default_branch|github\.head_ref|github\.event\.workflow_run\.(head_branch|display_title|head_commit\.(message|author\.(email|name))|pull_requests\.[^\s}]*head\.ref)|github\.event\.(inputs|client_payload)\.\w+|inputs\.\w+)/;
// `key: ${{ expr }}` for any key but run/script is an env/with/ref style assignment,
// where the value never reaches a shell or a script as code.
const SAFE_ASSIGNMENT = /^[A-Za-z_][\w-]*:\s*["']?\$\{\{[^}]*\}\}["']?\s*$/;
const LOADER_ENV =
  /\b(LD_PRELOAD|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|BASH_ENV|PYTHONSTARTUP|PYTHONPATH|NODE_PATH|GIT_SSH_COMMAND|GIT_ASKPASS|PROMPT_COMMAND|NODE_OPTIONS)\s*[:=]\s*(.*)$/;
const SAFE_NODE_OPTIONS = /^["']?--max[-_]old[-_]space[-_]size=\d+["']?\s*$/;
const UNPINNED_USES = /^\s*-?\s*uses:\s*\S+@(main|master|HEAD|latest)\s*$/i;
const URL_RE = /https?:\/\/(?:[^\s/@'"`]*@)?([A-Za-z0-9][A-Za-z0-9.-]*)/g;
const LIFECYCLE = /"(preinstall|install|postinstall|prepare)"\s*:/;

// ── Allowlist ───────────────────────────────────────────────────────────────
export function loadAllowlist(
  path = process.env.OCR_INJECTION_ALLOWLIST || join(HERE, 'post-pr-injection-allowlist.json')
) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return {
    hosts: raw.hosts.map((h) => h.host.toLowerCase()),
    secrets: new Set(raw.secrets.map((s) => s.name)),
    vars: new Set(raw.vars.map((s) => s.name)),
    phraseExemptPaths: new Set(raw.phraseExemptPaths.map((s) => s.path)),
  };
}
export const hostAllowed = (host, hosts) => {
  const h = host.toLowerCase().replace(/\.$/, '');
  return hosts.some((a) => h === a || h.endsWith(`.${a}`));
};

// ── Pure scan ───────────────────────────────────────────────────────────────
const excerpt = (s) => s.trim().slice(0, 120);

/** @param {{path:string, lines:{n:number,text:string}[]}[]} files */
export function scan(files, message, allow) {
  const findings = [];
  const add = (id, file, line, msg, text) =>
    findings.push({ id, file, line, msg, excerpt: text == null ? '' : excerpt(text) });

  for (const { path, lines } of files) {
    const instr = isInstructionSurface(path);
    // Test fixtures carry zero-width characters on purpose (hostile-input cases).
    const strictInvisible = instr || (CODE_FILE.test(path) && !/(^|\/)tests?\//.test(path));
    const phraseExempt = allow.phraseExemptPaths.has(path);
    const wf = WORKFLOW_FILE.test(path);
    const urlSurface = isUrlSurface(path);

    for (const { n, text: full } of lines) {
      // The text is attacker-controlled, so the pattern passes below read a bounded
      // prefix; the character-class checks are linear and read the whole line.
      const text = full.length > MAX_LINE ? full.slice(0, MAX_LINE) : full;
      if (BIDI_OR_TAG.test(full))
        add('hidden-char', path, n, 'bidi control or Unicode tag character', '');
      else if (strictInvisible && ZERO_WIDTH.test(full))
        add('hidden-char', path, n, 'zero-width character', '');

      if (instr && !phraseExempt) {
        for (const [re, why] of PHRASES) if (re.test(text)) add('phrase', path, n, why, text);
      }

      if (urlSurface) {
        for (const m of text.matchAll(URL_RE)) {
          if (!hostAllowed(m[1], allow.hosts))
            add('new-host', path, n, `host not in the allowlist: ${m[1]}`, text);
        }
      }

      if (/(^|\/)package\.json$/.test(path) && LIFECYCLE.test(text)) {
        add('lifecycle', path, n, 'install-time script added or changed', text);
      }

      if (!wf) continue;
      const trimmed = text.trim();
      if (/^\s*#/.test(text)) continue;

      for (const m of text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
        const expr = m[1];
        if (
          UNTRUSTED.test(expr) &&
          !(SAFE_ASSIGNMENT.test(trimmed) && !/^(run|script):/.test(trimmed))
        ) {
          add(
            'expr-injection',
            path,
            n,
            `untrusted value used outside an env: assignment: ${expr.trim()}`,
            text
          );
        }
        if (/\b(toJSON|join)\(\s*(secrets|vars)\s*[,)]/i.test(expr)) {
          add('secret-dump', path, n, 'expression dumps the whole secrets or vars context', text);
        }
        for (const s of expr.matchAll(
          /\b(secrets|vars)\.([A-Za-z_]\w*)|\b(secrets|vars)\[\s*['"]([^'"]+)['"]\s*\]/g
        )) {
          const kind = s[1] || s[3];
          const name = s[2] || s[4];
          if (!allow[kind].has(name))
            add('new-secret', path, n, `${kind}.${name} is not in the allowlist`, '');
        }
      }

      const lo = LOADER_ENV.exec(text);
      if (lo && !(lo[1] === 'NODE_OPTIONS' && SAFE_NODE_OPTIONS.test(lo[2]))) {
        add('loader-env', path, n, `${lo[1]} set in a workflow`, text);
      }
      if (UNPINNED_USES.test(text))
        add('unpinned-action', path, n, 'action pinned to a moving ref', text);
      if (
        /^\s*pull_request_target\s*:/.test(text) ||
        /^\s*on\s*:.*\bpull_request_target\b/.test(text)
      ) {
        add('pr-target', path, n, 'pull_request_target trigger added', text);
      }
    }
  }

  if (message) {
    if (BIDI_OR_TAG.test(message) || ZERO_WIDTH.test(message))
      add(
        'commit-message',
        '(commit message)',
        0,
        'hidden character in the merge commit message',
        ''
      );
    for (const [re, why] of PHRASES)
      if (re.test(message)) add('commit-message', '(commit message)', 0, why, message.match(re)[0]);
  }
  return findings;
}

// ── Diff parsing ────────────────────────────────────────────────────────────
export function parseAdded(diffText) {
  const files = [];
  let cur = null;
  let n = 0;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).split('\t')[0];
      cur = p === '/dev/null' ? null : { path: p.replace(/^b\//, ''), lines: [] };
      if (cur) files.push(cur);
    } else if (raw.startsWith('@@')) {
      const m = /\+(\d+)/.exec(raw);
      n = m ? Number(m[1]) : 0;
    } else if (cur && raw.startsWith('+') && !raw.startsWith('+++')) {
      cur.lines.push({ n, text: raw.slice(1) });
      n += 1;
    }
  }
  return files;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const git = (args) =>
  execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const head = opt('--head') || 'HEAD';
  let base = opt('--base') || `${head}^1`;
  if (argv.includes('--all')) base = EMPTY_TREE;

  let diff;
  let message = '';
  try {
    git(['rev-parse', '--verify', `${head}^{commit}`]);
    if (base !== EMPTY_TREE) git(['rev-parse', '--verify', `${base}^{commit}`]);
    diff = git([
      'diff',
      '--unified=0',
      '--no-color',
      '--no-ext-diff',
      '--no-renames',
      '--diff-filter=ACMR',
      base,
      head,
    ]);
    if (base !== EMPTY_TREE) message = git(['log', '--format=%B', `${base}..${head}`]);
  } catch (e) {
    console.error(
      `::error::Cannot compare ${base}..${head}; failing closed (${String(e.message).split('\n')[0]}).`
    );
    process.exit(2);
  }

  const files = parseAdded(diff);
  const findings = scan(files, message, loadAllowlist());
  const summary = process.env.GITHUB_STEP_SUMMARY;
  const surfaces = files.filter((f) => isInstructionSurface(f.path)).map((f) => f.path);

  const out = [
    `## T5 post-PR injection check`,
    '',
    `Compared \`${base.slice(0, 12)}..${head.slice(0, 12)}\`: ${files.length} file(s) with added lines, ${surfaces.length} instruction surface(s) touched.`,
  ];
  if (surfaces.length)
    out.push('', 'Instruction surfaces touched:', ...surfaces.map((p) => `- \`${p}\``));
  if (findings.length) {
    out.push('', '| Check | Where | Finding |', '|---|---|---|');
    for (const f of findings)
      out.push(`| ${f.id} | \`${f.file}:${f.line}\` | ${f.msg.replace(/\|/g, '\\|')} |`);
  } else out.push('', 'No findings.');
  if (summary) appendFileSync(summary, `${out.join('\n')}\n`);

  for (const f of findings) {
    const loc = f.line ? `file=${f.file},line=${f.line}` : `title=${f.file}`;
    console.log(`::error ${loc}::[${f.id}] ${f.msg}${f.excerpt ? ` — ${f.excerpt}` : ''}`);
  }
  console.log(
    findings.length
      ? `${findings.length} finding(s).`
      : 'No injection findings in the merged change.'
  );
  process.exit(findings.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
