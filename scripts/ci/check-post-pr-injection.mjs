#!/usr/bin/env node
/**
 * T5 post-PR injection check: what the merged change added that an agent, a
 * runner or a reader could be steered by.
 *
 * It reads the merge commit's own diff (HEAD^1..HEAD) and the commit message,
 * and reports only what the merge ADDED, so old text never turns it red. It
 * runs nothing from the change. Findings, all failing:
 *
 *   hidden-char    bidi controls or Unicode tag characters in any added text;
 *                  zero-width characters in instruction surfaces and code
 *   phrase         instruction-override wording or chat-template tokens added to
 *                  a file an agent reads (CLAUDE.md, .claude/**, workflows, ...)
 *   commit-message the same wording or characters in the merge commit message
 *                  (a squash copies the PR body there)
 *   oversize-line  an added line past MAX_LINE on a scanned surface (padding
 *                  must not push text out of the pattern checks)
 *   new-host       a URL host not in the allowlist (instruction and CI surfaces);
 *                  the host is the one URL parsing resolves, not the raw text
 *   lifecycle      a package.json install-time script added or changed, found by
 *                  comparing the parsed before and after, not by the added line
 *
 * Workflow files are parsed as YAML (whole file, then mapped back to the lines the
 * merge added), so a value split over lines or quoted is read as the runner reads it:
 *
 *   expr-injection an untrusted ${{ github.event... }} value inside a `run:` or
 *                  `script:` body; the same value in env:/with:/name: is data
 *   loader-env     LD_PRELOAD, NODE_OPTIONS and similar set in a workflow
 *   unpinned-action `uses:` pinned to @main, @master, @HEAD or @latest
 *   pr-target      a pull_request_target trigger added
 *   secret-dump    toJSON(secrets) or toJSON(vars) in an expression
 *   new-secret     a secrets.X / vars.X name not in the allowlist
 *   yaml-parse     a changed workflow that cannot be read (fails closed)
 *
 * The allowlist is scripts/ci/post-pr-injection-allowlist.json. Adding to it is
 * a reviewed change (CODEOWNERS), which is the point: a new host or secret name
 * is something a person has looked at.
 *
 * Usage: node scripts/ci/check-post-pr-injection.mjs [--base <rev>] [--head <rev>] [--all]
 *   --all  scan every tracked file as if it were all added (a dry run for baselining)
 * Exit: 0 clean, 1 findings, 2 cannot compare (fail closed).
 *
 * Needs the `yaml` package, so T5 installs dependencies with --ignore-scripts
 * before running this: nothing from the change executes first.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, isAlias, isMap, isSeq, isScalar } from 'yaml';

/* eslint-disable security/detect-unsafe-regex, security/detect-non-literal-regexp, security/detect-non-literal-fs-filename --
   The patterns are fixed and run over lines capped at MAX_LINE (see scan), and
   an over-long line is itself a finding; the two constructed ones are built from
   constant code points, not input; the file paths are this repo's own allowlist
   and the CI step summary. */
const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_LINE = 20000;
// Git's empty tree id, asked of git (--all only) so no long hex literal sits in this
// file: the committed-secret gate reads one as a possible secret.
const emptyTreeId = () =>
  execFileSync('git', ['hash-object', '-t', 'tree', '--stdin'], {
    encoding: 'utf8',
    input: '',
  }).trim();

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
const PACKAGE_JSON = /(^|\/)package\.json$/;
const CODE_FILE = /\.(js|mjs|cjs|ts|sh|ya?ml|json|toml)$/;
const URL_SURFACE_EXTRA = [/^scripts\/ci\//, /^workers\/[^/]+\/wrangler\.[^/]+$/, PACKAGE_JSON];

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
  /\b(github\.event\.(issue|pull_request|discussion)\.(title|body)|github\.event\.(comment|review|review_comment)\.body|github\.event\.pages\.[^\s}]*page_name|github\.event\.commits\.[^\s}]*\.(message|author\.(email|name))|github\.event\.head_commit\.(message|author\.(email|name))|github\.event\.pull_request\.head\.(ref|label)|github\.event\.pull_request\.head\.repo\.default_branch|github\.head_ref|github\.event\.workflow_run\.(head_branch|display_title|head_commit\.(message|author\.(email|name))|pull_requests\.[^\s}]*head\.ref)|github\.event\.(inputs|client_payload)\.\w+|inputs\.\w+)/i;
const LOADER_NAMES =
  'LD_PRELOAD|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|BASH_ENV|PYTHONSTARTUP|PYTHONPATH|NODE_PATH|GIT_SSH_COMMAND|GIT_ASKPASS|PROMPT_COMMAND|NODE_OPTIONS';
const LOADER_ENV = new RegExp(`\\b(${LOADER_NAMES})\\s*[:=]\\s*(.*)$`);
const LOADER_KEY = new RegExp(`^(${LOADER_NAMES})$`);
const SAFE_NODE_OPTIONS = /^["']?--max[-_]old[-_]space[-_]size=\d+["']?\s*$/;
const MOVING_REF = /@(main|master|HEAD|latest)$/i;
const URL_CANDIDATE = /https?:\/\/[^\s'"`<>\\)\]]*/gi;
const PLACEHOLDER = /\$\{\{[^}]*\}\}|\$\{[^}]*\}|\$\([^)]*\)|\$[A-Za-z_]\w*/g;
const SOLE_PLACEHOLDER = /^(\$\{\{[^}]*\}\}|\$\{[^}]*\}|\$[A-Za-z_]\w*)(:\d+)?$/;
const LIFECYCLE_KEYS = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
];

// ── Allowlist ───────────────────────────────────────────────────────────────
export function loadAllowlist(
  path = process.env.OCR_INJECTION_ALLOWLIST || join(HERE, 'post-pr-injection-allowlist.json')
) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return {
    hosts: raw.hosts.map((h) => h.host.toLowerCase()),
    // Actions secret and variable names are case-insensitive, so both sides compare upper-case.
    secrets: new Set(raw.secrets.map((s) => s.name.toUpperCase())),
    vars: new Set(raw.vars.map((s) => s.name.toUpperCase())),
    phraseExemptPaths: new Set(raw.phraseExemptPaths.map((s) => s.path)),
    bidiExemptPaths: new Set((raw.bidiExemptPaths || []).map((s) => s.path)),
  };
}
export const hostAllowed = (host, hosts) => {
  const h = host.toLowerCase().replace(/\.$/, '');
  return hosts.some((a) => h === a || h.endsWith(`.${a}`));
};

/**
 * The hosts a line's URLs resolve to, as URL parsing sees them (percent-escapes
 * and IP forms normalized, any scheme case). `null` stands for an authority that
 * does not parse. A URL whose whole host is one shell or Actions placeholder is
 * dynamic and left to the secret and var allowlists.
 */
export function urlHosts(text) {
  const out = [];
  for (const m of text.matchAll(URL_CANDIDATE)) {
    const scheme = m[0].slice(0, m[0].indexOf(':')).toLowerCase();
    // A port that is a number or a placeholder is not part of the host.
    const auth = m[0]
      .slice(m[0].indexOf('//') + 2)
      .split(/[/?#]/)[0]
      .replace(/:(\d+|\$\{[^}]*\}|\$[A-Za-z_]\w*)$/, '');
    // `https://` on its own is a scheme in a string, not a URL.
    if (auth === '' || SOLE_PLACEHOLDER.test(auth)) continue;
    const cleaned = auth.replace(PLACEHOLDER, 'x').replace(/[.,;:!}]+$/, '');
    try {
      out.push({ auth, host: new URL(`${scheme}://${cleaned}`).hostname });
    } catch {
      out.push({ auth, host: null });
    }
  }
  return out;
}

// ── Pure scan ───────────────────────────────────────────────────────────────
const excerpt = (s) => s.trim().slice(0, 120);
// GitHub reads github.event['pull_request']['title'] and github.event.pull_request.TITLE the
// same as the dotted form, so the field rules see this canonical dotted, bracket-free form.
export const canonical = (expr) =>
  expr
    .replace(/\[\s*(['"])([^'"\]]*)\1\s*\]/g, '.$2')
    .replace(/\[\s*(\d+|\*)\s*\]/g, '.$1')
    .replace(/\s*\.\s*/g, '.');
// A finding message can quote added text, so escape backslash first, then the table pipe.
const mdCell = (s) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

const lineStarts = (text) => {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
};
const lineOf = (starts, offset) => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
};

/** Install-time scripts that differ between the two package.json texts. */
export function lifecycleChanges(beforeText, afterText) {
  let after;
  try {
    after = JSON.parse(afterText);
  } catch {
    return [{ key: null, why: 'package.json no longer parses' }];
  }
  let before = {};
  try {
    before = beforeText == null ? {} : JSON.parse(beforeText);
  } catch {
    before = {};
  }
  const out = [];
  for (const key of LIFECYCLE_KEYS) {
    const a = after && after.scripts && after.scripts[key];
    const b = before && before.scripts && before.scripts[key];
    if (a !== undefined && a !== b)
      out.push({ key, why: `install-time script "${key}" added or changed` });
  }
  return out;
}

function scanWorkflow(path, content, added, allow, add) {
  if (content == null) {
    add('yaml-parse', path, 1, 'cannot read the workflow to parse it; failing closed', '');
    return;
  }
  const doc = parseDocument(content);
  if (doc.errors.length) {
    add(
      'yaml-parse',
      path,
      1,
      `workflow does not parse: ${doc.errors[0].message.split('\n')[0]}`,
      ''
    );
    return;
  }
  const starts = lineStarts(content);
  // First line of `node` that the merge added, or null.
  // While an alias is followed from a line the merge added, everything under it is
  // attributed to that line: the use-site is the change, wherever the anchor sits.
  let forced = null;
  const hit = (node) => {
    if (forced != null) return forced;
    const r = node && node.range;
    if (!r) return null;
    const last = lineOf(starts, Math.max(r[0], r[1] - 1));
    for (let n = lineOf(starts, r[0]); n <= last; n += 1) if (added.has(n)) return n;
    return null;
  };

  const checkScalar = (node, key) => {
    const n = hit(node);
    if (n == null) return;
    const value = node.value;
    const code = key === 'run' || key === 'script';
    const exprs = [...value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]);
    // An `if:` value is an expression whether or not it is wrapped in ${{ }}.
    if (key === 'if' && exprs.length === 0) exprs.push(value);
    for (const expr of exprs) {
      if (code && UNTRUSTED.test(canonical(expr)))
        add('expr-injection', path, n, `untrusted value used in a ${key} body: ${expr.trim()}`, '');
      if (/[(,]\s*(secrets|vars)\s*[,)]/i.test(expr))
        add('secret-dump', path, n, 'expression dumps the whole secrets or vars context', '');
      // Context and property names are case-insensitive; read the canonical dotted form.
      for (const s of canonical(expr).matchAll(/\b(secrets|vars)\.([^\s.(),!=<>&|'"[\]}]+)/gi)) {
        const kind = s[1].toLowerCase();
        if (!allow[kind].has(s[2].toUpperCase()))
          add('new-secret', path, n, `${kind}.${s[2]} is not in the allowlist`, '');
      }
    }
    // The decoded value, not the source line: a YAML escape can spell a URL the raw line hides.
    for (const { auth, host } of urlHosts(value)) {
      if (host === null) add('new-host', path, n, `URL authority does not parse: ${auth}`, value);
      else if (!hostAllowed(host, allow.hosts))
        add('new-host', path, n, `host not in the allowlist: ${host}`, value);
    }
    if (code) {
      for (const ln of value.split('\n')) {
        const lo = LOADER_ENV.exec(ln);
        if (lo && !(lo[1] === 'NODE_OPTIONS' && SAFE_NODE_OPTIONS.test(lo[2])))
          add('loader-env', path, n, `${lo[1]} set in a ${key} body`, ln);
      }
    }
    if (key === 'uses' && MOVING_REF.test(value.trim()))
      add('unpinned-action', path, n, 'action pinned to a moving ref', value);
  };

  const prtNodes = (node) => {
    const isPrt = (s) => isScalar(s) && s.value === 'pull_request_target';
    if (isPrt(node)) return [node];
    if (isSeq(node)) return node.items.filter(isPrt);
    if (isMap(node)) return node.items.map((p) => p.key).filter(isPrt);
    return [];
  };

  const visit = (node, key, depth) => {
    if (isMap(node)) {
      for (const pair of node.items) {
        const k = isScalar(pair.key) ? String(pair.key.value) : null;
        if (depth === 0 && k === 'on') {
          for (const t of prtNodes(pair.value)) {
            const n = hit(t);
            if (n != null) add('pr-target', path, n, 'pull_request_target trigger added', '');
          }
        }
        if (key === 'env' && k && LOADER_KEY.test(k)) {
          const n = hit(pair.key) ?? hit(pair.value);
          const v = isScalar(pair.value) ? String(pair.value.value ?? '') : '';
          if (n != null && !(k === 'NODE_OPTIONS' && SAFE_NODE_OPTIONS.test(v)))
            add('loader-env', path, n, `${k} set in a workflow`, v);
        }
        // A merge key (<<) adds entries to the map it sits in, so they keep that map's key.
        visit(pair.value, k === '<<' ? key : k, depth + 1);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) visit(item, key, depth + 1);
    } else if (isAlias(node)) {
      // The runner resolves an alias where it is used, so a value anchored as data can
      // become a run: body. Read the target in the use-site's key context.
      const target = node.resolve(doc);
      if (!target || active.has(target)) return;
      active.add(target);
      const before = forced;
      forced = hit(node) ?? forced;
      visit(target, key, depth + 1);
      forced = before;
      active.delete(target);
    } else if (isScalar(node) && typeof node.value === 'string') {
      checkScalar(node, key);
    }
  };
  const active = new Set();
  visit(doc.contents, null, 0);
}

/**
 * @param {{path:string, lines:{n:number,text:string}[], content?:string|null, before?:string|null}[]} files
 *   content: the file at head (workflows and package.json); before: package.json at base
 */
export function scan(files, message, allow) {
  const findings = [];
  const add = (id, file, line, msg, text) =>
    findings.push({ id, file, line, msg, excerpt: text == null ? '' : excerpt(text) });

  for (const { path, lines, content, before } of files) {
    const instr = isInstructionSurface(path);
    // Test fixtures carry zero-width characters on purpose (hostile-input cases).
    const strictInvisible = instr || (CODE_FILE.test(path) && !/(^|\/)tests?\//.test(path));
    const phraseExempt = allow.phraseExemptPaths.has(path);
    const urlSurface = isUrlSurface(path);
    const wf = WORKFLOW_FILE.test(path);
    const surface = instr || urlSurface || wf;

    for (const { n, text: full } of lines) {
      // The character-class checks are linear and read the whole line. The pattern
      // checks read a bounded prefix, so a line past the bound is a finding itself.
      const text = full.length > MAX_LINE ? full.slice(0, MAX_LINE) : full;
      if (full.length > MAX_LINE && surface)
        add(
          'oversize-line',
          path,
          n,
          `added line is ${full.length} characters; not read in full`,
          ''
        );
      if (BIDI_OR_TAG.test(full) && !allow.bidiExemptPaths.has(path))
        add('hidden-char', path, n, 'bidi control or Unicode tag character', '');
      else if (strictInvisible && ZERO_WIDTH.test(full))
        add('hidden-char', path, n, 'zero-width character', '');

      if (instr && !phraseExempt) {
        for (const [re, why] of PHRASES) if (re.test(text)) add('phrase', path, n, why, text);
      }

      if (urlSurface) {
        for (const { auth, host } of urlHosts(text)) {
          if (host === null)
            add('new-host', path, n, `URL authority does not parse: ${auth}`, text);
          else if (!hostAllowed(host, allow.hosts))
            add('new-host', path, n, `host not in the allowlist: ${host}`, text);
        }
      }
    }

    if (wf) scanWorkflow(path, content, new Set(lines.map((l) => l.n)), allow, add);

    if (PACKAGE_JSON.test(path) && content != null) {
      for (const c of lifecycleChanges(before, content)) {
        const idx = c.key ? content.split('\n').findIndex((l) => l.includes(`"${c.key}"`)) : -1;
        add('lifecycle', path, idx >= 0 ? idx + 1 : 1, c.why, '');
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
  // The raw line and the decoded value can both report the same host; report it once.
  const seen = new Set();
  return findings.filter((f) => {
    const k = `${f.id}|${f.file}|${f.line}|${f.msg}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Diff parsing ────────────────────────────────────────────────────────────
const C_ESCAPES = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34 };
/**
 * A path as a diff header prints it. Git C-quotes a name that holds a quote, a
 * backslash or a control character (core.quotePath=false only spares non-ASCII), so
 * a quoted name is decoded; otherwise a trailing tab (added after names with
 * spaces) is dropped.
 */
export function gitPath(field) {
  if (!field.startsWith('"')) return field.split('\t')[0];
  const body = field.slice(1, field.lastIndexOf('"'));
  const bytes = [];
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c !== '\\') {
      bytes.push(...Buffer.from(c));
      continue;
    }
    i += 1;
    const d = body[i];
    if (/[0-7]/.test(d)) {
      let oct = d;
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? '')) oct += body[(i += 1)];
      bytes.push(parseInt(oct, 8));
    } else bytes.push(d in C_ESCAPES ? C_ESCAPES[d] : d.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Added lines per file from `git diff --unified=0`. Inside a hunk every row is
 * content, counted off the hunk header, so an added line that begins `++ ` (it
 * prints as `+++ `) is never taken for a file header.
 */
export function parseAdded(diffText) {
  const files = [];
  let cur = null;
  let n = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of diffText.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (raw.startsWith('\\')) continue;
      if (raw.startsWith('+')) {
        newLeft -= 1;
        if (cur) cur.lines.push({ n, text: raw.slice(1) });
        n += 1;
      } else if (raw.startsWith('-')) {
        oldLeft -= 1;
      } else {
        oldLeft -= 1;
        newLeft -= 1;
        n += 1;
      }
      continue;
    }
    if (raw.startsWith('diff --git ')) {
      cur = null;
    } else if (raw.startsWith('+++ ')) {
      const p = gitPath(raw.slice(4));
      cur = p === '/dev/null' ? null : { path: p.replace(/^b\//, ''), lines: [] };
      if (cur) files.push(cur);
    } else if (raw.startsWith('@@')) {
      const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (m) {
        oldLeft = m[1] === undefined ? 1 : Number(m[1]);
        n = Number(m[2]);
        newLeft = m[3] === undefined ? 1 : Number(m[3]);
      }
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
const show = (rev, path) => {
  try {
    return execFileSync('git', ['show', `${rev}:${path}`], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};

function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const head = opt('--head') || 'HEAD';
  let base = opt('--base') || `${head}^1`;
  const EMPTY_TREE = argv.includes('--all') ? emptyTreeId() : null;
  if (EMPTY_TREE) base = EMPTY_TREE;

  let diff;
  let message = '';
  try {
    git(['rev-parse', '--verify', `${head}^{commit}`]);
    if (base !== EMPTY_TREE) git(['rev-parse', '--verify', `${base}^{commit}`]);
    // --text: a .gitattributes `-diff` in the change must not turn a file into a
    // "binary" notice with no lines to scan. --no-textconv: no converter runs.
    diff = git([
      'diff',
      '--unified=0',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--text',
      '--no-renames',
      '--src-prefix=a/',
      '--dst-prefix=b/',
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
  for (const f of files) {
    if (WORKFLOW_FILE.test(f.path) || PACKAGE_JSON.test(f.path)) f.content = show(head, f.path);
    if (PACKAGE_JSON.test(f.path) && base !== EMPTY_TREE) f.before = show(base, f.path);
  }
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
    for (const f of findings) out.push(`| ${f.id} | \`${f.file}:${f.line}\` | ${mdCell(f.msg)} |`);
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
