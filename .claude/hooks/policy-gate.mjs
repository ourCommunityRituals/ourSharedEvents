#!/usr/bin/env node
// OCR policy gate: a Claude Code PreToolUse hook.
//
// "Confidence is a signal. Policy is authority." These are fixed rules, so no
// model judgement (auto mode included) can approve the actions listed below.
// The owner runs any of them in their own terminal when they are intended.
//
// Contract: Claude Code sends the tool call as JSON on stdin.
//   exit 2 + stderr -> the call is blocked and the reason is shown to Claude
//   exit 0          -> the call goes ahead (normal permission rules still apply)
// Bad input fails OPEN with a warning, so a harness change cannot lock every
// session; the test file covers that path too. A missing script also fails open,
// which is why the install check (verify-hardening W1/W6) exists.
//
// How a shell call is read: it is tokenised like a shell would (quotes, escapes,
// ; & | && || newlines, redirects, $(...) and backticks, heredocs). Each simple
// command becomes a unit, and a unit that hands text to an interpreter or a
// wrapper (bash -c, powershell -Command, cmd /c, eval, iex, env, sudo, timeout,
// xargs, find -exec) is unwrapped and read again. Quoted text is data (a commit
// message, an echo) unless it is given to an interpreter. Rules then look at
// the program and its arguments, so `git commit -m "git push --tags"` is fine
// and `bash -c "git push --tags"` is not.
//
// Limits: this is text analysis. It does not stop a program that makes its own
// network or file calls, a command assembled from pieces at run time, or an
// encoded command it cannot read (those are refused only where they can be
// recognised). It sits alongside the permission deny rules and auto mode. The
// control that holds against the rest is on the GitHub side: a tag ruleset and
// required reviews against an agent identity that is not an admin.
//
// Each Bash/PowerShell call is appended, with secrets redacted, to
// ~/.claude/audit/policy-YYYY-MM-DD.jsonl (OCR_POLICY_AUDIT_DIR overrides).
//
// Tests: node --test .claude/hooks/policy-gate.test.mjs

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix, resolve } from 'node:path';

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor']);
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep']);

// ------------------------------------------------------------- limits -----

// Analysis limits. Past any of them the call is refused, never allowed: a gate that gives up
// quietly is a gate that can be made to give up.
const BUDGET_MS = 3000;
const MAX_UNITS = 2500;
const MAX_DEPTH = 6;
const MAX_COMMAND_CHARS = 1500000;
let deadline = Infinity;
let unitCount = 0;
function guard(depth = 0) {
  if (Date.now() > deadline) throw new Error('the analysis time limit was reached');
  if (depth > MAX_DEPTH) throw new Error('commands are nested too deeply');
  unitCount += 1;
  if (unitCount > MAX_UNITS) throw new Error('the call contains too many commands');
}

// ---------------------------------------------------------------- paths -----

// Files that hold credentials. Templates (.env.example, .env.sample) are allowed.
const SENSITIVE_PATH =
  /(\.claude[\\/](config|\.credentials)\.json|\.claude\.json$|\.dev\.vars\b|\.wrangler[\\/]config|actions-runner[^\\/\s"']*[\\/]\.(credentials|runner)\b|\.git-credentials|\.npmrc\b|id_(rsa|ed25519|ecdsa|dsa)\b|[\\/]\.config[\\/]gh[\\/]hosts\.yml|[\\/]GitHub[ `]*CLI[\\/]hosts\.yml|[\\/]User Data[\\/](?:[^\\/]+[\\/])?(Login Data|Cookies|Web Data|Local State)|[\\/]\.aws[\\/]credentials|[\\/]\.netrc\b|[\\/]\.docker[\\/]config\.json|(^|[\\/\s"'=])\.env(\.(?!example\b|sample\b)[\w-]+)?(?=$|[\s"';|&)]))/i;

// Programs that only check that a path exists, or move around; they print no content.
const EXISTENCE_OR_NAV = new Set([
  'ls',
  'dir',
  'test-path',
  'stat',
  'get-item',
  'cd',
  'pushd',
  'popd',
  'set-location',
  'sl',
  'chdir',
]);

function resolveExisting(p) {
  // Follows junctions, symlinks and 8.3 short names when the file (or its folder) exists.
  // A Windows path on Linux is left alone: it is not absolute there, and resolving it would
  // prepend the working directory.
  if (!isAbsolute(p)) return p;
  // never touch the network: a UNC path would make this hook wait on SMB, DNS and NTLM
  if (/^[\\/]{2}/.test(p) || p.length > 1024) return p;
  try {
    return realpathSync.native(p);
  } catch {
    try {
      return join(realpathSync.native(dirname(p)), basename(p));
    } catch {
      return p;
    }
  }
}

// One spelling for one file: prefixes (\\?\, \\.\, \\localhost\C$\), ~ and common home
// variables, "..", doubled separators, trailing dots or spaces, ADS suffix, lower case.
// A relative path is resolved against `base` (the working directory the call would use).
function canonicalPathRaw(p, base) {
  let s = String(p).trim();
  const home = homedir();
  s = s
    .replace(/^\\\\\?\\/, '')
    .replace(/^\\\\\.\\/, '')
    .replace(/^\\\\(?:localhost|127\.0\.0\.1)\\([a-z])\$\\/i, '$1:\\')
    .replace(/::\$data$/i, '')
    .replace(/^~(?=$|[\\/])/, home)
    .replace(/^\$\{?(HOME|USERPROFILE)\}?(?=$|[\\/])/, home)
    .replace(/^\$env:(HOME|USERPROFILE)(?=$|[\\/])/i, home)
    .replace(/^%USERPROFILE%(?=$|[\\/])/i, home);
  const windowsForm = /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\');
  if (!windowsForm && !isAbsolute(s) && base) s = join(base, s);
  s = resolveExisting(s);
  s = s.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  s = posix
    .normalize(s)
    .replace(/[. ]+$/, '')
    .replace(/\/+$/, '');
  return s.toLowerCase();
}

const CANON_CACHE = new Map();
function canonicalPath(p, base) {
  const key = `${base ?? ''}\u0000${p}`;
  let v = CANON_CACHE.get(key);
  if (v === undefined) {
    v = canonicalPathRaw(p, base);
    CANON_CACHE.set(key, v);
  }
  return v;
}

const USER_HOME = '(?:[a-z]:/users/[^/]+|/home/[^/]+|/users/[^/]+|/root)';
const HOME_CLAUDE_RE = new RegExp(`^${USER_HOME}/\\.claude(?:/(.*))?$`);
const HOME_FILES_RE = new RegExp(
  `^${USER_HOME}/(?:\\.claude\\.json|\\.gitconfig|\\.bashrc|\\.zshrc|\\.profile|\\.bash_profile|\\.npmrc|\\.netrc|\\.ssh/|\\.config/gh/|\\.aws/|documents/(?:windowspowershell|powershell)/[^/]*profile\\.ps1)`
);
const CLAUDE_SENSITIVE_SUB =
  /^(?:settings(?:\.local)?\.json|hooks(?:\/|$)|audit(?:\/|$)|skills(?:\/|$)|commands(?:\/|$)|agents(?:\/|$)|plugins(?:\/|$)|output-styles(?:\/|$)|\.credentials|config\.json|claude\.md|statusline|keybindings|history\.jsonl)/;
const PROJECT_PROTECTED =
  /(?:^|\/)\.claude\/settings(?:\.local)?\.json$|(?:^|\/)\.mcp\.json$|(?:^|\/)\.git\/(?:hooks\/|config$)|\/claude_desktop_config\.json$|\/microsoft\.powershell_profile\.ps1$/;
// The repo's own hook copy and the files the owner installs from: not written through a shell.
const GUARD_SOURCE =
  /(?:^|\/)\.claude\/hooks\/|(?:^|\/)policy-gate\.mjs$|settings\.user\.proposed\.json$|\/scripts\/hardening\//;

/** True when writing, moving or deleting this canonical path is the owner's. */
function protectedWrite(c, { shell }) {
  const hc = c.match(HOME_CLAUDE_RE);
  if (hc) {
    const sub = hc[1] ?? '';
    return sub === '' || CLAUDE_SENSITIVE_SUB.test(sub);
  }
  if (HOME_FILES_RE.test(c) || PROJECT_PROTECTED.test(c)) return true;
  return shell && GUARD_SOURCE.test(c);
}

// ------------------------------------------------------------ tokenizer -----

function readParen(src, i) {
  // src[i] is the first character after "(" ; returns [inner, indexAfterClosingParen]
  let depth = 1;
  let j = i;
  while (j < src.length && depth > 0) {
    const ch = src[j];
    if (ch === "'" || ch === '"') {
      const k = src.indexOf(ch, j + 1);
      j = k < 0 ? src.length : k + 1;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    j += 1;
  }
  return [src.slice(i, Math.max(i, j - 1)), j];
}

const PS_ESCAPABLE = /[\s"'$`nrt0abfv(){}[\]<>|&;,#]/;

/** Splits a command string into simple commands: words, redirects and nested substitutions. */
function tokenize(input) {
  // ${IFS} and $IFS are whitespace to the shell that expands them
  const src = input.replace(/\$\{IFS\}|\$IFS(?![A-Za-z_0-9])/g, ' ');
  const cmds = [];
  let cur = { words: [], redirs: [], subs: [] };
  let pendingPipe = false;
  const flush = () => {
    if (cur.words.length || cur.redirs.length || cur.subs.length) {
      // remember what a command pipes into, so `printenv | grep NODE` can be told from `printenv`
      if (pendingPipe && cmds.length) {
        cmds[cmds.length - 1].pipeNext = cur;
        pendingPipe = false;
      }
      cmds.push(cur);
    }
    cur = { words: [], redirs: [], subs: [] };
  };
  const n = src.length;
  let i = 0;

  const readWord = () => {
    const start = i;
    let text = '';
    let quoted = false;
    while (i < n) {
      const ch = src[i];
      if (/\s/.test(ch) || ch === '|' || ch === ';' || ch === '&' || ch === '<' || ch === '>')
        break;
      if (ch === '(' || ch === ')') break;
      if (ch === '$' && src[i + 1] === "'") {
        quoted = true; // ANSI-C quoting: $'...'
        i += 2;
        while (i < n && src[i] !== "'") {
          if (src[i] === '\\' && i + 1 < n) {
            const e = src[i + 1];
            if (e === 'x' && /^[0-9a-fA-F]{2}/.test(src.slice(i + 2, i + 4))) {
              text += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16));
              i += 4;
              continue;
            }
            text += e === 'n' ? '\n' : e === 't' ? '\t' : e;
            i += 2;
            continue;
          }
          text += src[i];
          i += 1;
        }
        i += 1;
        continue;
      }
      if (ch === "'") {
        quoted = true;
        const j = src.indexOf("'", i + 1);
        text += j < 0 ? src.slice(i + 1) : src.slice(i + 1, j);
        i = j < 0 ? n : j + 1;
        continue;
      }
      if (ch === '"') {
        quoted = true;
        i += 1;
        while (i < n && src[i] !== '"') {
          if (src[i] === '\\' && i + 1 < n && '"\\$`'.includes(src[i + 1])) {
            text += src[i + 1];
            i += 2;
            continue;
          }
          if (src[i] === '$' && src[i + 1] === '(') {
            const [inner, end] = readParen(src, i + 2);
            cur.subs.push(inner);
            text += src.slice(i, end);
            i = end;
            continue;
          }
          if (src[i] === '`') {
            const j = src.indexOf('`', i + 1);
            if (j > 0) {
              cur.subs.push(src.slice(i + 1, j));
              text += src.slice(i, j + 1);
              i = j + 1;
              continue;
            }
          }
          text += src[i];
          i += 1;
        }
        i += 1;
        continue;
      }
      if (ch === '$' && src[i + 1] === '(') {
        const [inner, end] = readParen(src, i + 2);
        cur.subs.push(inner);
        text += src.slice(i, end);
        i = end;
        continue;
      }
      if (ch === '`') {
        const nx = src[i + 1];
        if (nx !== undefined && PS_ESCAPABLE.test(nx)) {
          text += nx; // PowerShell escape: the next character is literal
          i += 2;
          continue;
        }
        const close = src.indexOf('`', i + 1);
        if (close > 0 && close - i - 1 === 1 && /[A-Za-z]/.test(nx ?? '')) {
          text += nx; // PowerShell escape of a letter: g`i`t is git
          i = close + 1;
          continue;
        }
        const j = src.indexOf('`', i + 1);
        if (j > 0) {
          cur.subs.push(src.slice(i + 1, j));
          text += src.slice(i, j + 1);
          i = j + 1;
          continue;
        }
        i += 1;
        continue;
      }
      if (
        ch === '@' &&
        (src[i + 1] === "'" || src[i + 1] === '"') &&
        /[\r\n]/.test(src[i + 2] ?? '')
      ) {
        quoted = true; // PowerShell here-string
        const close = `\n${src[i + 1]}@`;
        const j = src.indexOf(close, i + 2);
        text += j < 0 ? src.slice(i + 2) : src.slice(i + 2, j);
        i = j < 0 ? n : j + close.length;
        continue;
      }
      if (ch === '\\' && (src[i + 1] === '\n' || src[i + 1] === '\r')) {
        i += src[i + 1] === '\r' && src[i + 2] === '\n' ? 3 : 2; // line continuation
        continue;
      }
      text += ch;
      i += 1;
    }
    const raw = src.slice(start, i);
    // unquoted backslash escapes (g\it, pu\sh, -\-force): the shell reads these as the letter.
    // Windows paths keep their backslashes, so this is an extra reading, not a replacement.
    let alt;
    if (!quoted && /\\[A-Za-z-]/.test(text) && !/^(?:[A-Za-z]:\\|\\\\|\.{1,2}\\)/.test(text)) {
      alt = text.replace(/\\(?=[A-Za-z-])/g, '');
    }
    return { text, raw, quoted, alt };
  };

  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n' || c === ';') {
      flush();
      i += 1;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(src[i - 1]))) {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '&') {
      if (src[i + 1] === '>') {
        i += src[i + 2] === '>' ? 3 : 2;
        while (i < n && src[i] === ' ') i += 1;
        const t = readWord();
        cur.redirs.push({ op: '&>', target: t.text });
        continue;
      }
      flush();
      i += src[i + 1] === '&' ? 2 : 1;
      continue;
    }
    if (c === '|') {
      flush();
      if (src[i + 1] !== '|') pendingPipe = true; // a pipe, not a logical or
      i += src[i + 1] === '|' || src[i + 1] === '&' ? 2 : 1;
      continue;
    }
    if (c === '(' || c === ')') {
      flush();
      i += 1;
      continue;
    }
    if (c === '<' || c === '>') {
      if ((c === '<' || c === '>') && src[i + 1] === '(') {
        const [inner, end] = readParen(src, i + 2);
        cur.subs.push(inner);
        i = end;
        continue;
      }
      let op = c;
      i += 1;
      while (i < n && (src[i] === c || src[i] === '|' || src[i] === '&')) {
        op += src[i];
        i += 1;
      }
      // "2>" and "1>": the digit word just read is the file descriptor, not an argument
      const last = cur.words[cur.words.length - 1];
      if (last && /^\d$/.test(last.text) && last.raw === last.text) cur.words.pop();
      while (i < n && (src[i] === ' ' || src[i] === '\t')) i += 1;
      if (src[i] === '&' && /\d|-/.test(src[i + 1] ?? '')) {
        i += 2;
        continue;
      }
      const t = readWord();
      cur.redirs.push({ op, target: t.text });
      continue;
    }
    const w = readWord();
    if (w.raw === '') {
      i += 1;
      continue;
    }
    if (!w.quoted && (w.text === '{' || w.text === '}')) continue;
    const bm = !w.quoted && w.text.match(/^([^{}]*)\{([^{}]*,[^{}]*)\}([^{}]*)$/);
    if (bm) {
      // brace expansion: {git,push,v1.2.3} is three words, --{force,} is two
      for (const part of bm[2].split(',').slice(0, 32)) {
        cur.words.push({ text: bm[1] + part + bm[3], raw: w.raw, quoted: false });
      }
      continue;
    }
    cur.words.push(w);
  }
  flush();
  return cmds;
}

// -------------------------------------------------------------- units -------

const KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'elseif',
  'fi',
  'do',
  'done',
  'while',
  'until',
  'for',
  'in',
  'case',
  'esac',
  'time',
  '!',
  'function',
  'select',
  'try',
  'catch',
  'finally',
  'begin',
  'process',
  'end',
]);
const SH = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const PWSH = new Set(['pwsh', 'powershell']);
const EVALS = new Set(['eval', 'iex', 'invoke-expression', 'source', '.', 'call']);
// Programs that run another program: find it among their arguments and read it again.
const WRAPPERS = new Set([
  'env',
  'sudo',
  'doas',
  'timeout',
  'nohup',
  'nice',
  'ionice',
  'command',
  'exec',
  'xargs',
  'watch',
  'stdbuf',
  'setsid',
  'unbuffer',
  'parallel',
  'runas',
  'busybox',
  'strace',
  'su',
  'flock',
  'unshare',
  'chroot',
  'script',
  'at',
  'nsenter',
  'sg',
  'newgrp',
  'runuser',
  'pkexec',
  'fakeroot',
  'start',
  'foreach-object',
  '%',
  'where-object',
  '?',
  'invoke-command',
  'icm',
  'start-job',
]);
const WATCHED = new Set([
  'git',
  'gh',
  'curl',
  'wget',
  'iwr',
  'irm',
  'invoke-webrequest',
  'invoke-restmethod',
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'wrangler',
  'node',
  'python',
  'python3',
  'py',
  'ruby',
  'perl',
  'php',
  'deno',
  'bun',
  'claude',
  'scp',
  'ssh',
  'sftp',
  'nc',
  'ncat',
  'netcat',
  'rsync',
  'telnet',
  'ftp',
  'certutil',
  'bitsadmin',
  'cat',
  'type',
  'get-content',
  'gc',
  'cp',
  'mv',
  'copy',
  'move',
  'rm',
  'del',
  'tar',
  'zip',
  '7z',
  'robocopy',
  'xcopy',
  'tee',
  'sed',
  'powershell',
  'pwsh',
  'bash',
  'sh',
  'zsh',
  'cmd',
  'eval',
  'iex',
  'invoke-expression',
  'cmdkey',
  'vaultcmd',
  'schtasks',
  'crontab',
  'reg',
  'ln',
  'mklink',
  'touch',
  'chmod',
  'dd',
  'install',
  'find',
  'grep',
  'rg',
  'printenv',
  'env',
  'set-content',
  'add-content',
  'out-file',
  'remove-item',
  'rename-item',
  'copy-item',
  'move-item',
  'new-item',
  'head',
  'tail',
  'base64',
  'ls',
  'dir',
]);

const prog = (w) =>
  w
    .replace(/^.*[\\/]/, '')
    .replace(/\.(exe|cmd|bat|ps1)$/i, '')
    .toLowerCase();

function makeUnit(words, redirs, subs, via) {
  const env = [];
  let k = 0;
  while (
    k < words.length &&
    /^[A-Za-z_]\w*=/.test(words[k].text) &&
    !words[k].raw.startsWith('-')
  ) {
    env.push(words[k].text);
    k += 1;
  }
  const rest = words.slice(k);
  let program = rest.length ? prog(rest[0].text) : '';
  // g\it and the like: use the unescaped reading when it names a program we watch
  if (rest[0]?.alt && !WATCHED.has(program) && WATCHED.has(prog(rest[0].alt)))
    program = prog(rest[0].alt);
  const argText = (w) =>
    w.alt && (/^-/.test(w.alt) || /^[a-z][a-z-]*$/.test(w.alt)) ? w.alt : w.text;
  return {
    program,
    words: rest,
    args: rest.slice(1).map(argText),
    argRaw: rest.slice(1).map((w) => w.raw),
    env,
    redirs,
    subs: subs ?? [],
    via: via ?? null,
    raw: words.map((w) => w.raw).join(' '),
    text: rest.map((w) => w.text).join(' '),
  };
}

// A heredoc body is text (a commit message, a PR body, a file) unless something on the line
// that opens it can run it; then it stays and is read as commands.
const CAN_EXECUTE =
  /\b(bash|sh|zsh|dash|ksh|fish|pwsh|powershell|cmd|python3?|py|node|nodejs|ruby|perl|php|lua|deno|bun|eval|source|xargs|env|sudo|doas|su|ssh|osascript|rscript|awk|sqlite3|psql|mysql|invoke-expression|iex)\b|\.\s+\/dev\/stdin/i;

function stripHeredocs(src) {
  if (!src.includes('<<')) return src;
  const re = /(?<!<)<<-?[ \t]*(['"]?)([A-Za-z_][\w-]*)\1/g;
  let out = '';
  let pos = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index < pos) continue;
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    let lineEnd = src.indexOf('\n', m.index);
    if (lineEnd < 0) lineEnd = src.length;
    const head = src.slice(lineStart, lineEnd);
    // the terminator: a line that is only the delimiter
    const delim = m[2];
    let searchFrom = lineEnd + 1;
    let termStart = -1;
    let termEnd = -1;
    while (searchFrom <= src.length) {
      let e = src.indexOf('\n', searchFrom);
      if (e < 0) e = src.length;
      if (src.slice(searchFrom, e).trim() === delim) {
        termStart = searchFrom;
        termEnd = e;
        break;
      }
      if (e >= src.length) break;
      searchFrom = e + 1;
    }
    if (termStart < 0) continue; // no terminator: keep everything, read as commands
    if (CAN_EXECUTE.test(head)) continue; // a shell or interpreter reads it: keep the body
    out += src.slice(pos, lineEnd + 1);
    pos = termEnd;
    re.lastIndex = termEnd;
  }
  return out + src.slice(pos);
}

const SHELL_OR_IEX = new Set([...SH, ...PWSH, 'cmd', 'iex', 'invoke-expression']);
const SHELL_OUT =
  /(child_process|execSync|spawnSync|\bexec\s*\(|\bspawn\s*\(|os\.system|subprocess|popen|Runtime\.getRuntime|\bsystem\s*\(|shell_exec|passthru)/i;

// True when a program reads commands from its standard input (no -c, no script file).
function readsStdinAsCode(n) {
  if (!n || !SHELL_OR_IEX.has(n.program)) return false;
  const positional = n.args.filter((a) => !a.startsWith('-'));
  if (n.program === 'iex' || n.program === 'invoke-expression') return n.args.length === 0;
  if (SH.has(n.program))
    return !n.args.some((a) => /^-[a-zA-Z]*c/.test(a)) && positional.length === 0;
  if (PWSH.has(n.program))
    return !n.args.some((a) => /^-(c|command|cmd|f|file)$/i.test(a)) && positional.length === 0;
  return n.program === 'cmd' && n.args.length === 0;
}

function markerUnit(program, source) {
  return {
    program,
    words: [],
    args: [],
    argRaw: [],
    env: [],
    redirs: [],
    subs: [],
    via: null,
    raw: source.raw ?? '',
    text: source.text ?? '',
  };
}

function unitsOf(command, depth = 0) {
  guard(depth);
  const out = [];
  // A heredoc body is text only at the top, where its whole opening line is visible. Inside a
  // substitution or an unwrapped string it is kept, because the parent may execute it.
  const text = depth === 0 ? stripHeredocs(command) : command;
  for (const cmd of tokenize(text)) {
    guard(depth);
    let words = cmd.words;
    while (words.length && KEYWORDS.has(words[0].text) && !words[0].quoted) words = words.slice(1);
    const u = makeUnit(words, cmd.redirs, cmd.subs);
    const next = cmd.pipeNext ? makeUnit(cmd.pipeNext.words, [], []) : null;
    if (next) u.next = next;
    out.push(u);
    // text piped into a shell, or a download piped into one, is code that cannot be read first
    if (next && readsStdinAsCode(next)) {
      if (['echo', 'printf', 'write-output', 'write-host'].includes(u.program)) {
        out.push(...unitsOf(u.args.join(' '), depth + 1));
      } else if (!u.redirs.some((r) => r.op.startsWith('<<'))) {
        out.push(markerUnit('<pipe-to-shell>', u));
      }
    }
    out.push(...expand(u, depth));
    for (const sub of cmd.subs) out.push(...unitsOf(sub, depth + 1));
  }
  return out;
}

function expand(u, depth) {
  guard(depth);
  const out = [];
  const p = u.program;
  const a = u.args;
  const inner = (s, via) => {
    for (const x of unitsOf(s, depth + 1)) {
      x.via ??= via;
      out.push(x);
    }
  };
  // a here-string given to a shell is code
  if (SH.has(p) || PWSH.has(p)) {
    for (const r of u.redirs) if (r.op === '<<<' && r.target) inner(r.target, p);
  }
  if (SH.has(p)) {
    const i = a.findIndex((x) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(x));
    if (i >= 0 && a[i + 1] != null) inner(a.slice(i + 1).join(' '), p);
  } else if (PWSH.has(p)) {
    const i = a.findIndex((x) => /^-(c|command|cmd)$/i.test(x));
    if (a.some((x) => /^-(e|ec|enc|encodedcommand)$/i.test(x))) {
      out.push(markerUnit('<encoded>', u));
    }
    if (i >= 0) inner(a.slice(i + 1).join(' '), p);
    else {
      const pos = a.filter((x) => !x.startsWith('-'));
      if (pos.length && !a.some((x) => /^-file$/i.test(x))) inner(pos.join(' '), p);
    }
  } else if (p === 'cmd') {
    const i = a.findIndex((x) => /^\/[ck]$/i.test(x));
    if (i >= 0) inner(a.slice(i + 1).join(' '), p);
  } else if (p === 'start-process' || p === 'saps') {
    const fi = a.findIndex((x) => /^-(filepath|f)$/i.test(x));
    const file = fi >= 0 ? a[fi + 1] : a.find((x) => !x.startsWith('-'));
    const ai = a.findIndex((x) => /^-(argumentlist|args)$/i.test(x));
    const argv = ai >= 0 ? String(a[ai + 1] ?? '').split(',') : [];
    if (file) inner([file, ...argv].join(' '), p);
  } else if (EVALS.has(p)) {
    if (a.length) inner(a.join(' '), p);
  } else if (
    WRAPPERS.has(p) ||
    (/^(npm|pnpm|yarn|npx)$/.test(p) && a.some((x) => /^(exec|dlx|x|-c|--call)$/.test(x)))
  ) {
    const j = a.findIndex((x) => WATCHED.has(prog(x)));
    if (j >= 0) {
      const sub = makeUnit(u.words.slice(1 + j), [], [], p);
      out.push(sub);
      out.push(...expand(sub, depth + 1));
    }
    // a quoted argument that is a whole command line: watch "git push …", su -c "…", script -qc "…"
    for (const x of a) if (x.length > 3 && /\s/.test(x.trim())) inner(x, p);
  } else if (p === 'find') {
    const j = a.findIndex((x) => /^-(exec|execdir|ok|okdir)$/.test(x));
    if (j >= 0) {
      const rest = u.words.slice(2 + j);
      const stop = rest.findIndex((w) => w.text === ';' || w.text === '+' || w.text === '\\;');
      const sub = makeUnit(stop >= 0 ? rest.slice(0, stop) : rest, [], [], 'find');
      out.push(sub);
      out.push(...expand(sub, depth + 1));
    }
  } else if (p === 'git') {
    const g = gitInfo(u);
    if (g) {
      if (g.sub === 'rebase') {
        const i = g.rest.findIndex((x) => /^(-x|--exec)$/.test(x));
        if (i >= 0 && g.rest[i + 1]) inner(g.rest[i + 1], p);
      }
      if (g.sub === 'submodule' && g.rest[0] === 'foreach') {
        inner(
          g.rest
            .filter((x) => !x.startsWith('-'))
            .slice(1)
            .join(' '),
          p
        );
      }
      if (g.sub === 'bisect' && g.rest[0] === 'run') inner(g.rest.slice(1).join(' '), p);
      if (g.sub === 'filter-branch') for (const x of g.rest) if (/\s/.test(x)) inner(x, p);
    }
  } else if (INTERPRETERS.has(p) && a.some((x) => INLINE_FLAG.test(x))) {
    // inline code that shells out: read its string literals as commands
    const code = a.join(' ');
    if (SHELL_OUT.test(code)) {
      for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
        if (/\s/.test(m[2])) inner(m[2], p);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------ git / gh ------

const GIT_VALUE_OPTS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
]);

function gitInfo(u) {
  if (u.program !== 'git') return null;
  const a = u.args;
  const globals = [];
  let i = 0;
  while (i < a.length && a[i].startsWith('-')) {
    if (GIT_VALUE_OPTS.has(a[i])) {
      globals.push(a[i], a[i + 1] ?? '');
      i += 2;
    } else {
      globals.push(a[i]);
      i += 1;
    }
  }
  return { sub: (a[i] ?? '').toLowerCase(), rest: a.slice(i + 1), globals };
}

// gh accepts glued short flags (-XPUT, -fkey=v) and --flag=value; read them as separate words.
function ghWords(args) {
  const out = [];
  for (const a of args) {
    let m;
    if ((m = a.match(/^(--[A-Za-z][\w-]*)=([\s\S]*)$/))) out.push(m[1], m[2]);
    else if (!a.startsWith('--') && (m = a.match(/^-([XfFHqRt])([\s\S]+)$/)))
      out.push(`-${m[1]}`, m[2]);
    else out.push(a);
  }
  return out;
}

function ghInfo(u) {
  if (u.program !== 'gh') return null;
  const a = ghWords(u.args);
  let i = 0;
  while (i < a.length && a[i].startsWith('-')) i += /^(-R|--repo|--hostname)$/.test(a[i]) ? 2 : 1;
  return {
    noun: (a[i] ?? '').toLowerCase(),
    verb: (a[i + 1] ?? '').toLowerCase(),
    rest: a.slice(i + 2),
    all: a.slice(i),
  };
}

// A prefix is enough for git ("--follow", "--forc").
const longOpt = (arg, full, min) =>
  arg.startsWith('--') && arg.length >= min && full.startsWith(arg);

const TAG_GLOB = /^\+?(refs\/tags\/)?v.*\..*\..*$/i; // the workflow trigger is v*.*.*
function branchNotTag(name, cwd) {
  const has = (ref) =>
    spawnSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd: cwd || undefined }).status ===
    0;
  try {
    return has(`refs/heads/${name}`) && !has(`refs/tags/${name}`);
  } catch {
    return false;
  }
}

function pushedTagLike(gi, ctx) {
  const names = gi.rest.filter((x) => !x.startsWith('-'));
  return names.some((t) => {
    if (/refs\/tags\//i.test(t)) return true;
    if (/[*?[]/.test(t)) return true; // a glob refspec (refs/*:refs/*) can carry refs/tags
    return t
      .split(':')
      .some((part) => TAG_GLOB.test(part) && !branchNotTag(part.replace(/^\+/, ''), ctx.cwd));
  });
}

const SAFE_SUBST =
  /^\s*git\s+(branch\s+--show-current|rev-parse\s+--abbrev-ref\s+HEAD|symbolic-ref\s+--short\s+HEAD)\s*$/;

// ------------------------------------------------------------ network -------

const ALLOWED_GET =
  /^(localhost|127\.0\.0\.1|\[?::1\]?|([\w-]+\.)*oursharedevents\.com|api\.github\.com|github\.com|registry\.npmjs\.org|raw\.githubusercontent\.com)$/i;
const ALLOWED_SEND = /^(localhost|127\.0\.0\.1|\[?::1\]?|([\w-]+\.)*oursharedevents\.com)$/i;
const FILE_EXT = new Set([
  'json',
  'txt',
  'csv',
  'md',
  'mjs',
  'cjs',
  'js',
  'ts',
  'tsx',
  'jsx',
  'yml',
  'yaml',
  'toml',
  'zip',
  'gz',
  'tgz',
  'tar',
  'sql',
  'log',
  'html',
  'htm',
  'sh',
  'xml',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'pdf',
  'ps1',
  'bat',
  'cmd',
  'exe',
  'lock',
  'env',
  'conf',
  'cfg',
  'ini',
  'map',
  'wasm',
  'rs',
  'py',
  'rb',
  'go',
  'java',
  'c',
  'h',
  'bin',
  'dat',
]);
const CURL_VALUE = new Set([
  '-H',
  '--header',
  '-o',
  '--output',
  '-u',
  '--user',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '-b',
  '--cookie',
  '-c',
  '--cookie-jar',
  '-w',
  '--write-out',
  '-m',
  '--max-time',
  '--connect-timeout',
  '-X',
  '--request',
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-urlencode',
  '-F',
  '--form',
  '--form-string',
  '-T',
  '--upload-file',
  '-K',
  '--config',
  '-x',
  '--proxy',
  '--connect-to',
  '--resolve',
  '-D',
  '--dump-header',
  '--retry',
  '--retry-delay',
  '-r',
  '--range',
  '--cacert',
  '--cert',
  '--key',
  '--json',
  '-z',
  '--limit-rate',
  '-C',
  '-E',
  '-t',
  '-O',
  '-P',
  '-U',
  '-i',
]);
const CURL_VALUE_LETTERS = new Set('dHouAebcwmXFTKDrCEzt'.split(''));
const PS_VALUE = new Set([
  '-method',
  '-headers',
  '-contenttype',
  '-outfile',
  '-infile',
  '-body',
  '-useragent',
  '-timeoutsec',
  '-credential',
  '-form',
  '-proxy',
]);

function hostOf(tok) {
  const t = tok.replace(/^['"]|['"]$/g, '');
  if (!t || t.startsWith('@') || t.startsWith('-')) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
    try {
      const x = new URL(t);
      return { host: x.hostname, path: x.pathname };
    } catch {
      return { host: '?invalid', path: '' };
    }
  }
  // scheme-less: host[:port][/path], any top-level domain, or a bare name with a port or path
  const m = t.match(
    /^((?:[\w-]+\.)+[A-Za-z][\w-]*|localhost|\[::1\]|\d{1,3}(?:\.\d{1,3}){3}|[\w-]+)(?::(\d+))?([/?#].*)?$/
  );
  if (!m) return null;
  const host = m[1];
  const dotted = host.includes('.');
  const last = host.split('.').pop().toLowerCase();
  if (dotted && FILE_EXT.has(last) && !m[2] && !m[3]) return null; // out.json
  if (!dotted && !m[2] && !m[3] && !/^localhost$/i.test(host)) return null; // a bare word
  if (/^\d+$/.test(host)) return null;
  return { host, path: (m[3] ?? '/').split(/[?#]/)[0] };
}

function webEgress(u, ctx) {
  const isCurlLike = u.program === 'curl' || u.program === 'wget';
  const isPs = ['iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod'].includes(u.program);
  if (!isCurlLike && !isPs) return false;
  const a = u.args;
  const proxied =
    a.some(
      (x) =>
        x === '-x' ||
        /^(--proxy[\w-]*|--preproxy|--socks[\w]*|--connect-to|--resolve)(=|$)/i.test(x) ||
        /^-proxy$/i.test(x)
    ) || u.env.some((e) => /^(https?|all|ftp)_proxy=/i.test(e));
  if (proxied) return true;
  let sends = false;
  const candidates = [];
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    if (isPs) {
      const lx = x.toLowerCase();
      if (lx === '-method') {
        if (/^(post|put|patch|delete)$/i.test(a[i + 1] ?? '')) sends = true;
        i += 1;
        continue;
      }
      if (lx === '-body' || lx === '-infile' || lx === '-form') sends = true;
      if (PS_VALUE.has(lx)) {
        i += 1;
        continue;
      }
      if (lx === '-uri') {
        candidates.push(a[i + 1] ?? '');
        i += 1;
        continue;
      }
      if (!x.startsWith('-')) candidates.push(x);
      continue;
    }
    if (x === '--url') {
      candidates.push(a[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (/^--url=/.test(x)) {
      candidates.push(x.slice(6));
      continue;
    }
    if (x.startsWith('--')) {
      if (
        /^--(data|data-\w+|form|form-string|upload-file|json|post-data|post-file|body-data|body-file|config)(=|$)/.test(
          x
        )
      )
        sends = true;
      if (/^--(method|request)=(post|put|patch|delete)$/i.test(x)) sends = true;
      if (CURL_VALUE.has(x)) i += 1;
      continue;
    }
    if (x.startsWith('-') && x.length > 1) {
      const letters = x.slice(1);
      if (/[dFTK]/.test(letters) && u.program === 'curl') sends = true;
      if (/[X]/.test(letters) && /^(post|put|patch|delete)$/i.test(a[i + 1] ?? '')) sends = true;
      if (CURL_VALUE.has(x) || CURL_VALUE_LETTERS.has(letters[letters.length - 1])) i += 1;
      continue;
    }
    candidates.push(x);
  }
  const hosts = candidates.map(hostOf).filter(Boolean);
  const unknownVar = candidates.some((c) => /^\$/.test(c) && !hostOf(c));
  for (const h of hosts) {
    if (sends) {
      const okSend = ALLOWED_SEND.test(h.host);
      const ghPath = h.path.replace(/^\/+/, '');
      const okGh =
        ((/^api\.github\.com$/i.test(h.host) && /^repos\/ourcommunityrituals\//i.test(ghPath)) ||
          (/^github\.com$/i.test(h.host) && /^ourcommunityrituals\//i.test(ghPath))) &&
        !GH_SENSITIVE_PATH.test(ghPath);
      if (!okSend && !okGh) return true;
    } else if (!ALLOWED_GET.test(h.host)) return true;
  }
  if (hosts.length > 0) return false;
  // no literal host: an address held in a variable is fine only if it is one of the platform's
  // base URLs and this same command did not assign it
  if (unknownVar || sends) {
    const first = candidates.find((c) => /^\$/.test(c)) ?? '';
    const name = (first.match(/^\$\{?(?:env:)?(\w+)/) ?? [])[1];
    const platformVar = /^(STG_BASE_URL|PROD_BASE_URL|BASE_URL|API_BASE|WORKER_URL|STG_URL)$/.test(
      name ?? ''
    );
    if (platformVar && !ctx.assigned.has(name)) return false;
    return true;
  }
  return a.some((x) => /\$\(|`/.test(x));
}

// ------------------------------------------------------------ rules --------

function isWrangler(s) {
  return /\bwrangler(\.cmd)?\b/i.test(s);
}
function targetsProduction(s) {
  return /(--env[ =](production|prod)\b|-e\s+(production|prod)\b)/i.test(s);
}
const PROD_READ_ONLY =
  /\bwrangler(\.cmd)?\s+(deployments\s+list|versions\s+(list|view)|secret\s+list|whoami)\b|\bwrangler(\.cmd)?\s+--version\b/i;
function d1StagingReadOnly(s) {
  if (/--file\b/i.test(s)) return false;
  const m = s.match(/--command[ =](["'])([\s\S]*?)\1/i);
  if (!m) return false;
  const sql = m[2].trim();
  if (!/^(select|pragma|explain)\b/i.test(sql)) return false;
  return !/;\s*\S/.test(sql);
}

const GH_SENSITIVE_PATH =
  /(branches\/[^\s/]+\/protection|\/rulesets\b|actions\/(secrets|variables|runners|permissions)\b|\/hooks\b|\/collaborators\b|\/environments\b|\/keys\b|\/git\/(refs|tags)\b|\/releases\b|\/pending_deployments\b|\/contents\/|\/dispatches\b|\/statuses\/|\/check-runs\b|\/check-suites\b|\/approve\b|\/merge\b|\/reviews\b|\/(disable|enable)\b|\/transfer\b|^repos\/[^/]+\/[^/]+\/?$)/i;
const GRAPHQL_DANGER =
  /\b(createRef|updateRef|deleteRef|mergePullRequest|enablePullRequestAutoMerge|\w*BranchProtectionRule|\w*Ruleset|(create|delete)Release|deleteRepository|transferRepository|createCommitOnBranch|addPullRequestReview|submitPullRequestReview|approve\w*|updateRepository|archiveRepository|updateIssueComment)\b/i;
const NET_TOOLS = new Set([
  'nc',
  'ncat',
  'netcat',
  'scp',
  'sftp',
  'ssh',
  'rsync',
  'telnet',
  'ftp',
  'certutil',
  'bitsadmin',
]);
const INLINE_FLAG = /^(-e|-c|-p|-E|--eval|--print|-pe|-ne|-M\w*|-r|-)$/;
const INTERPRETERS = new Set([
  'node',
  'nodejs',
  'python',
  'python3',
  'py',
  'ruby',
  'perl',
  'deno',
  'bun',
  'php',
  'lua',
]);
const NET_API =
  /(fetch\s*\(|https?\b|urllib|requests\b|socket|XMLHttpRequest|http\.request|WebSocket|net\.connect|LWP|Net::|HTTP::)/i;
const PS_NET =
  /(Net\.WebClient|System\.Net\.|HttpClient|Send-MailMessage|Start-BitsTransfer|\.Upload(File|String|Data)\b)/i;

const SHELL_RULES = [
  [
    'wrangler-deploy',
    'Deploys go through CI (T1 / deploy-production), never from a workstation.',
    (u) =>
      isWrangler(u.raw) &&
      /\b(deploy|publish|rollback|versions\s+(deploy|upload))\b/i.test(u.raw) &&
      !/--dry-run\b/i.test(u.raw),
  ],
  [
    'wrangler-production',
    'Production is changed through CI and runbooks only; read-only wrangler commands are allowed.',
    (u) =>
      isWrangler(u.raw) &&
      targetsProduction(u.raw) &&
      !PROD_READ_ONLY.test(u.raw) &&
      !/--dry-run\b/i.test(u.raw),
  ],
  [
    'wrangler-secret',
    'Secrets are set by the owner in a separate terminal (feedback: secrets handling).',
    (u) => isWrangler(u.raw) && /\bsecret(:bulk\b|\s+(put|delete|bulk)\b)/i.test(u.raw),
  ],
  [
    'wrangler-destroy',
    'Deleting, restoring or writing Cloudflare resources remotely is a break-glass step for the owner.',
    (u) =>
      isWrangler(u.raw) &&
      (/\b(d1\s+(delete|time-travel\s+restore)|r2\s+(bucket|object)\s+delete|kv\s+(namespace|key|bulk)\s+delete|queues\s+delete)\b/i.test(
        u.raw
      ) ||
        /\bwrangler(\.cmd)?\s+delete\b/i.test(u.raw) ||
        (/\b(r2\s+object\s+put|kv[\s:](key|bulk)\s+put|d1\s+export)\b/i.test(u.raw) &&
          /--remote\b/i.test(u.raw))),
  ],
  [
    'd1-remote-migrate',
    'Remote D1 migrations are applied by CI.',
    (u) =>
      isWrangler(u.raw) && /\bd1\s+migrations\s+apply\b/i.test(u.raw) && /--remote\b/i.test(u.raw),
  ],
  [
    'd1-remote-write',
    'Remote D1 from a workstation is read-only: one SELECT/PRAGMA/EXPLAIN via --command.',
    (u) =>
      isWrangler(u.raw) &&
      /\bd1\s+execute\b/i.test(u.raw) &&
      /--remote\b/i.test(u.raw) &&
      !d1StagingReadOnly(u.raw),
  ],
  [
    'git-force-push',
    'Force pushes rewrite shared history.',
    (u) => {
      const g = gitInfo(u);
      return (
        g?.sub === 'push' &&
        g.rest.some(
          (a) =>
            longOpt(a, '--force', 6) ||
            /^--force-/.test(a) ||
            /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) ||
            /^\+\S+/.test(a) ||
            a === '--fo'
        )
      );
    },
  ],
  [
    'git-delete-main',
    'The default branch is never deleted.',
    (u) => {
      const g = gitInfo(u);
      if (g?.sub !== 'push') return false;
      const del = g.rest.some((a) => a === '-d' || longOpt(a, '--delete', 5));
      const names = g.rest.filter((a) => !a.startsWith('-'));
      const isMain = (x) => /^(refs\/heads\/)?(main|master)$/.test(x);
      return (
        (del && names.some(isMain)) || names.some((x) => x.startsWith(':') && isMain(x.slice(1)))
      );
    },
  ],
  [
    'gh-admin-merge',
    'Admin merges bypass branch protection.',
    (u) => {
      const c = ghInfo(u);
      return (
        c?.noun === 'pr' &&
        c.verb === 'merge' &&
        c.rest.some((a) => /^--(admin|auto)(=true)?$/.test(a))
      );
    },
  ],
  [
    'gh-secret-variable',
    'Repository secrets and variables are set by the owner.',
    (u) => {
      const c = ghInfo(u);
      return (
        (c?.noun === 'secret' || c?.noun === 'variable') && /^(set|delete|remove)$/.test(c.verb)
      );
    },
  ],
  [
    'gh-repo-destructive',
    'Repository-level destructive or visibility changes are owner-only.',
    (u) => {
      const c = ghInfo(u);
      if (!c) return false;
      return (
        (c.noun === 'repo' && /^(delete|archive|rename|edit)$/.test(c.verb)) ||
        (c.noun === 'release' && c.verb === 'delete') ||
        (c.noun === 'ruleset' && c.verb === 'delete') ||
        (c.noun === 'workflow' && /^(disable|enable)$/.test(c.verb))
      );
    },
  ],
  [
    'gh-api-protected',
    'Branch protection, rulesets, runners, secrets, hooks, environments, refs, releases, contents, statuses, approvals and deployments are owner-only; any DELETE is owner-only.',
    (u) => {
      const c = ghInfo(u);
      if (c?.noun !== 'api') return false;
      const a = c.all.slice(1);
      const mi = a.findIndex((x) => /^(-X|--method)$/i.test(x));
      const method = (mi >= 0 ? a[mi + 1] : '') ?? '';
      const mutating =
        /^(post|put|patch|delete)$/i.test(method) ||
        a.some((x) => /^(-f|-F|--field|--raw-field|--input)$/.test(x)) ||
        u.redirs.some((r) => r.op.startsWith('<'));
      if (!mutating) return false;
      if (/^delete$/i.test(method)) return true;
      const path = a.find((x) => !x.startsWith('-') && /\//.test(x)) ?? '';
      return GH_SENSITIVE_PATH.test(path.replace(/^\/+/, ''));
    },
  ],
  // ---- 2026-10-12 hardening (agent workstation review). Each reason names the path it closes.
  [
    'git-tag-push',
    'A pushed v*.*.* tag starts the production deploy chain; the owner pushes release tags.',
    (u, ctx) => {
      const g = gitInfo(u);
      if (g?.sub === 'config' || g?.sub === 'push') {
        if (g.sub === 'config' && g.rest.some((a) => /^push\.followtags$/i.test(a))) return true;
      }
      if (g?.globals.some((x) => /^push\.followtags=/i.test(x))) return true;
      if (g?.sub !== 'push') return false;
      if (g.rest.some((a) => a === '--dry-run' || a === '-n')) return false;
      if (
        g.rest.some(
          (a) =>
            longOpt(a, '--tags', 5) ||
            longOpt(a, '--follow-tags', 5) ||
            longOpt(a, '--mirror', 4) ||
            a === '--tag'
        )
      )
        return true;
      return pushedTagLike(g, ctx);
    },
  ],
  [
    'git-push-dynamic',
    'A push whose target is built at run time (variable, subshell, xargs) cannot be checked, so it is the owner’s.',
    (u) => {
      const g = gitInfo(u);
      if (g?.sub !== 'push') return false;
      if (u.via === 'xargs') return true;
      return u.argRaw.some((raw, i) => {
        const text = u.args[i] ?? '';
        if (!/(\$[A-Za-z_{(]|%[A-Za-z_]+%|`)/.test(raw)) return false;
        const sub = text.match(/^\$\((.*)\)$/s);
        return !(sub && SAFE_SUBST.test(sub[1]));
      });
    },
  ],
  [
    'credential-store',
    'The OS credential store and git credential helpers are never queried by an agent.',
    (u) => {
      const g = gitInfo(u);
      return (
        (g?.sub ?? '').startsWith('credential') ||
        /^git-credential/.test(u.program) ||
        u.program === 'git-credential-manager' ||
        ['cmdkey', 'vaultcmd', 'get-storedcredential'].includes(u.program) ||
        /\[Windows\.Security\.Credentials/i.test(u.raw)
      );
    },
  ],
  [
    'git-config-escape',
    'Git aliases, remote URLs, push settings, hooksPath and credential helpers redirect later commands past these rules.',
    (u) => {
      const g = gitInfo(u);
      if (!g) return false;
      const key =
        /^(alias\.|remote\.[^.]+\.(push|pushurl|url)$|url\..*\.(push)?insteadof|push\.(followtags|default|pushoption)|core\.(sshcommand|hookspath|fsmonitor|editor|pager|askpass)|credential\.|http\.(proxy|extraheader)|include(if)?\.|filter\.|gpg\.program)/i;
      const viaGlobal = g.globals.some((x) => key.test(x.replace(/=.*$/, '')));
      if (
        u.env.some((e) =>
          /^GIT_(CONFIG_(COUNT|KEY_\d+|PARAMETERS|GLOBAL|SYSTEM)|ASKPASS|EXTERNAL_DIFF|PAGER)=/i.test(
            e
          )
        )
      )
        return true;
      if (viaGlobal) return true;
      if (g.sub !== 'config') return false;
      const rest = g.rest;
      if (rest.some((a) => /^--(get|get-all|unset|unset-all)$/.test(a))) return false;
      const hooks = rest.findIndex((a) => /^core\.hookspath$/i.test(a));
      if (hooks >= 0) return !/^\.(husky|githooks)\/?$/.test(rest[hooks + 1] ?? '');
      return rest.some((a) => key.test(a));
    },
  ],
  [
    'git-config-list',
    'Listing the whole git configuration prints remote URLs and helpers that can carry tokens.',
    (u) => {
      const g = gitInfo(u);
      if (g?.sub !== 'config') return false;
      if (g.rest.includes('--local')) return false;
      return g.rest.some((a) => /^(--list|-l|--get-regexp|--show-origin|--get-urlmatch)$/.test(a));
    },
  ],
  [
    'git-remote-redirect',
    'Adding a remote or pushing to a raw URL or path sends the repository somewhere the owner has not chosen.',
    (u) => {
      const g = gitInfo(u);
      if (!g) return false;
      const own = /github\.com[:/]ourCommunityRituals\//i;
      if (g.sub === 'send-pack' || g.sub === 'send-email') return true;
      if (g.sub === 'remote' && /^(add|set-url)$/.test(g.rest[0] ?? '')) {
        return !g.rest.slice(1).some((a) => own.test(a));
      }
      if (g.sub === 'push') {
        if (g.rest.some((a) => /^--repo(=|$)/.test(a))) return true;
        const target = g.rest.find((a) => !a.startsWith('-'));
        return (
          Boolean(target) &&
          /[\\/@:]|^\.\.?$/.test(target) &&
          !own.test(target) &&
          !target.startsWith('refs/') &&
          !target.includes(':refs/')
        );
      }
      return false;
    },
  ],
  [
    'gh-release-create',
    'Creating or editing a release creates a tag, which starts the production deploy chain.',
    (u) => {
      const c = ghInfo(u);
      return c?.noun === 'release' && /^(create|upload|edit)$/.test(c.verb);
    },
  ],
  [
    'gh-graphql-mutation',
    'GraphQL can create or delete refs, merge and change protection; the REST rules cannot see it.',
    (u) => {
      const c = ghInfo(u);
      if (c?.noun !== 'api') return false;
      const a = c.all.slice(1);
      if (!a.some((x) => /(^|\/)graphql$/i.test(x))) return false;
      const text = a.join(' ');
      const readsFile =
        a.some((x) => x === '--input' || /(^|=)@/.test(x)) ||
        u.redirs.some((r) => r.op.startsWith('<'));
      if (readsFile) return true;
      const mutation = /\bmutation\b/i.test(text);
      const reviewThreadOnly = /\b(un)?resolveReviewThread\b/i.test(text);
      return GRAPHQL_DANGER.test(text) || (mutation && !reviewThreadOnly);
    },
  ],
  [
    'gh-review-approve',
    'An agent does not approve pull requests or workflow runs: that is the human review.',
    (u) => {
      const c = ghInfo(u);
      return (
        c?.noun === 'pr' && c.verb === 'review' && c.rest.some((a) => /^(--approve|-a)$/.test(a))
      );
    },
  ],
  [
    'gh-config',
    'gh aliases, extensions and config change what later gh commands do.',
    (u) => {
      const c = ghInfo(u);
      if (!c) return false;
      return (
        (c.noun === 'alias' && /^(set|import|delete)$/.test(c.verb)) ||
        (c.noun === 'extension' && /^(install|upgrade|remove|create)$/.test(c.verb)) ||
        (c.noun === 'config' && c.verb === 'set')
      );
    },
  ],
  [
    'prod-dispatch',
    'Production deploys are dispatched by the owner, with the typed confirmation.',
    (u) => {
      const c = ghInfo(u);
      if (c?.noun === 'workflow' && c.verb === 'run') {
        return (
          /PRODUCTION\b|_production|(oursharedevents-)?ci\.yml/i.test(c.rest.join(' ')) ||
          u.redirs.some((r) => r.op.startsWith('<'))
        );
      }
      return (
        /deploy_production/i.test(u.raw) &&
        ['gh', 'curl', 'iwr', 'irm', 'invoke-restmethod', 'invoke-webrequest'].includes(u.program)
      );
    },
  ],
  [
    'npm-deploy',
    'A package script that deploys or publishes is a workstation deploy by another name.',
    (u) => {
      if (!/^(npm|pnpm|yarn)$/.test(u.program)) return false;
      const dd = u.args.indexOf('--');
      const head = (dd >= 0 ? u.args.slice(0, dd) : u.args).filter((a) => !a.startsWith('-'));
      const script = /^(run|run-script)$/.test(head[0] ?? '') ? head[1] : head[0];
      if (!script || /^(test|t|build|lint|check|start|dev|install|ci|i)$/.test(script))
        return false;
      if (/publish/i.test(script) && u.args.includes('--dry-run')) return false;
      return (
        /deploy|publish/i.test(script) &&
        !/:(check|dry|dry-run|plan|test|lint|status|history|verify|list|info|help)$/i.test(script)
      );
    },
  ],
  [
    'gh-auth-token',
    'Printing or changing the GitHub token hands an agent the owner identity.',
    (u) => {
      const c = ghInfo(u);
      if (c?.noun !== 'auth') return false;
      return (
        /^(token|refresh|login|logout|setup-git|switch)$/.test(c.verb) ||
        (c.verb === 'status' && c.rest.some((a) => /^(--show-token|-[a-z]*t[a-z]*)$/i.test(a)))
      );
    },
  ],
  [
    'env-dump',
    'Environment variables hold tokens; printing them or the whole environment is the owner’s.',
    (u) => {
      const p = u.program;
      const a = u.args;
      // `printenv | grep NODE` filters the output; anything else prints it all
      const filtered =
        u.next &&
        ['grep', 'egrep', 'rg', 'findstr', 'select-string'].includes(u.next.program) &&
        !u.next.args.some((x) => /(token|secret|key|pass|cred|auth|api)/i.test(x)) &&
        !u.next.pipeNext;
      if (
        p === 'env' &&
        a.filter((x) => !/^[A-Za-z_]\w*=/.test(x) && !x.startsWith('-')).length === 0
      ) {
        return !filtered;
      }
      if (p === 'printenv') {
        if (a.some((x) => /(TOKEN|SECRET|KEY|PASSWORD|PASS|CRED)/i.test(x))) return true;
        return a.length === 0 && !filtered;
      }
      if (p === 'set' && a.length === 0) return true;
      if (
        ['get-childitem', 'gci', 'ls', 'dir'].includes(p) &&
        a.some((x) => /^env:?\\?$/i.test(x) || /^env:/i.test(x))
      )
        return true;
      if (['echo', 'printf', 'write-output', 'write-host'].includes(p)) {
        return u.argRaw.some((r) =>
          /\$\{?(env:)?\w*(TOKEN|SECRET|PASSWORD|API_?KEY|CRED)\w*\}?/i.test(r)
        );
      }
      return false;
    },
  ],
  [
    'net-upload',
    'Web requests only go to localhost, *.oursharedevents.com, api.github.com and github.com.',
    (u, ctx) => webEgress(u, ctx),
  ],
  [
    'net-tool',
    'Raw network tools, gists, new repositories and inline network code are the owner’s.',
    (u) => {
      const c = ghInfo(u);
      if (NET_TOOLS.has(u.program)) {
        return !(u.program === 'ssh' && u.args.length === 1 && /^-(V|-version)$/.test(u.args[0]));
      }
      if (
        (c?.noun === 'gist' && c.verb === 'create') ||
        (c?.noun === 'repo' && c.verb === 'create')
      )
        return true;
      if (INTERPRETERS.has(u.program) && u.args.some((a) => INLINE_FLAG.test(a))) {
        const code = u.args.join(' ');
        if (!NET_API.test(code)) return false;
        const hosts = [...code.matchAll(/https?:\/\/([^/\s'"`:?#)]+)/gi)].map((m) => m[1]);
        return hosts.length === 0 || hosts.some((h) => !ALLOWED_GET.test(h));
      }
      return (
        PS_NET.test(u.raw) ||
        /\/dev\/(tcp|udp)\//i.test(u.raw) ||
        u.redirs.some((r) => /\/dev\/(tcp|udp)\//i.test(r.target))
      );
    },
  ],
  [
    'bypass-permissions',
    'A nested agent with permissions bypassed or a different config folder is outside every rule here.',
    (u) => {
      if (/\bCLAUDE_CONFIG_DIR\b|\bIS_SANDBOX\b/.test(u.raw)) return true;
      const isClaude =
        u.program === 'claude' ||
        u.program === 'claude-code' ||
        /@anthropic-ai\/claude-code/.test(u.raw);
      return (
        isClaude &&
        u.args.some((a) =>
          /^--(allow-)?dangerously-skip-permissions$|^--permission-mode|^--settings|^--allowed-?tools|^--mcp-config/i.test(
            a
          )
        )
      );
    },
  ],
  [
    'owner-script',
    'The hardening apply scripts change security settings; the owner runs them in a terminal.',
    (u) =>
      /scripts[\\/]hardening[\\/]apply-\w+(\.mjs)?/i.test(u.raw) &&
      (/--apply\b/.test(u.raw) || INTERPRETERS.has(u.program)),
  ],
  [
    'git-env',
    'Environment variables that change how git runs commands (config injection, ssh, editors, proxies) redirect later commands past these rules.',
    (u) => {
      const dangerous =
        /^GIT_(CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS|GLOBAL|SYSTEM|NOSYSTEM)|ASKPASS|EXTERNAL_DIFF|PAGER|SSH(_COMMAND)?|PROXY_COMMAND|EDITOR|SEQUENCE_EDITOR|EXEC_PATH|DIR|WORK_TREE|TEMPLATE_DIR)=/i;
      const setters = ['export', 'set', 'setenv', 'declare', 'typeset', 'readonly', 'env'];
      return (
        u.env.some((e) => dangerous.test(e)) ||
        (setters.includes(u.program) && u.args.some((x) => dangerous.test(x))) ||
        /\$env:GIT_(CONFIG_|ASKPASS|SSH|PROXY_COMMAND|EDITOR|SEQUENCE_EDITOR|EXEC_PATH|EXTERNAL_DIFF|PAGER)/i.test(
          u.raw
        )
      );
    },
  ],
  [
    'pipe-to-shell',
    'Text or a download piped into a shell or Invoke-Expression runs code that cannot be read first.',
    (u) => u.program === '<pipe-to-shell>',
  ],
  [
    'gh-foreign-repo',
    'gh is pointed at a repository or host outside the organisation.',
    (u) => {
      if (u.program !== 'gh') return false;
      if (u.env.some((e) => /^GH_(HOST|ENTERPRISE_TOKEN|REPO)=/i.test(e))) return true;
      const w = ghWords(u.args);
      for (let i = 0; i < w.length; i += 1) {
        if (/^(-R|--repo)$/.test(w[i]) && !/^ourCommunityRituals\//i.test(w[i + 1] ?? ''))
          return true;
        if (w[i] === '--hostname') return true;
      }
      return false;
    },
  ],
  [
    'encoded-command',
    'An encoded command cannot be read, so it cannot be checked.',
    (u) => u.program === '<encoded>',
  ],
];

// Rules that look at paths, evaluated for every unit before SHELL_RULES.
const BULK_READERS = new Set([
  'cat',
  'type',
  'get-content',
  'gc',
  'head',
  'tail',
  'more',
  'less',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'findstr',
  'select-string',
  'find',
  'tar',
  'zip',
  '7z',
  'cp',
  'copy',
  'copy-item',
  'cpi',
  'robocopy',
  'xcopy',
  'rsync',
  'base64',
  'certutil',
  'xxd',
  'od',
  'strings',
  'sort',
  'awk',
  'sed',
  'cut',
  'tee',
]);
const WRITE_ALL = new Set([
  'tee',
  'tee-object',
  'out-file',
  'set-content',
  'add-content',
  'sc',
  'ac',
  'rm',
  'del',
  'erase',
  'rd',
  'rmdir',
  'remove-item',
  'ri',
  'rename-item',
  'ren',
  'rni',
  'new-item',
  'ni',
  'touch',
  'chmod',
  'chown',
  'attrib',
  'icacls',
  'truncate',
  'unlink',
  'mkdir',
  'md',
]);
const WRITE_LAST = new Set([
  'cp',
  'copy',
  'copy-item',
  'cpi',
  'mv',
  'move',
  'move-item',
  'mi',
  'install',
  'ln',
  'mklink',
  'robocopy',
  'xcopy',
  'rsync',
  'scp',
]);
const DATA_ONLY = new Set([
  'echo',
  'printf',
  'write-output',
  'write-host',
  'write-error',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'select-string',
  'findstr',
  'ag',
  'ack',
]);

function dataScrubbed(u) {
  // the argument values that are message text, not paths or commands
  const a = u.args;
  // echo f | xargs cat: what is echoed becomes an argument of the next program, so it is not data
  if (
    DATA_ONLY.has(u.program) &&
    u.next &&
    ['xargs', 'cat', 'type', 'get-content', 'gc', 'tee'].includes(u.next.program)
  ) {
    return a;
  }
  if (DATA_ONLY.has(u.program))
    return u.program.match(/^(echo|printf|write-)/)
      ? []
      : a.filter((_, i) => !u.words[i + 1]?.quoted);
  const g = gitInfo(u);
  if (g && ['commit', 'tag', 'notes', 'stash', 'merge', 'revert'].includes(g.sub)) {
    const out = [];
    for (let i = 0; i < a.length; i += 1) {
      if (/^(-m|--message|-[a-zA-Z]*m)$/.test(a[i]) || /^--message=/.test(a[i])) {
        i += /=/.test(a[i]) ? 0 : 1;
        continue;
      }
      out.push(a[i]);
    }
    return out;
  }
  const c = ghInfo(u);
  if (c && ['pr', 'issue', 'release', 'gist', 'discussion'].includes(c.noun)) {
    const out = [];
    for (let i = 0; i < a.length; i += 1) {
      if (/^(--body|-b|--title|-t|--notes|-n|--message|--description|-d)$/.test(a[i])) {
        i += 1;
        continue;
      }
      if (/^--(body|title|notes|message|description)=/.test(a[i])) continue;
      out.push(a[i]);
    }
    return out;
  }
  return a;
}

for (const x of ['shred', 'sponge']) WRITE_ALL.add(x);
const DOTNET_FILE = /\[(?:system\.)?io\.(?:file|directory)\]::/i;

function pathVerdict(u, ctx) {
  if (EXISTENCE_OR_NAV.has(u.program) || u.program === '') {
    // cd and friends only move the virtual working directory
    if (['cd', 'pushd', 'set-location', 'sl', 'chdir'].includes(u.program) && u.args[0]) {
      ctx.vcwd = canonicalPath(u.args.find((x) => !x.startsWith('-')) ?? u.args[0], ctx.vcwd);
    }
  }
  const scrubbed = dataScrubbed(u);
  const base = ctx.vcwd;
  const canon = (t) => canonicalPath(t, base);
  // A path in program position ([IO.File]::ReadAllText("~/.claude/.credentials.json") splits
  // into a program word that is a path) is inspected like an argument.
  const progWord = u.words[0]?.text ?? '';
  const progIsPath = /[\\/]|^~|^\$/.test(progWord) && !WATCHED.has(u.program);
  const tokens = progIsPath ? [progWord, ...scrubbed] : scrubbed;

  // .NET file calls: the paths in this and the following units are being read or written
  if (DOTNET_FILE.test(u.raw)) {
    ctx.dotnet = {
      write: /writeall|append|delete|move|copy|create|replace|setattr|open/i.test(u.raw),
    };
  }

  // credential files and stores, by name, whatever the spelling
  // an existence check is exempt, unless its output is piped on (ls f | xargs cat reads f)
  if (!EXISTENCE_OR_NAV.has(u.program) || u.next) {
    for (const t of [...tokens, ...u.redirs.map((r) => r.target)]) {
      if (!t || t.startsWith('-')) continue;
      if (SENSITIVE_PATH.test(t) || SENSITIVE_PATH.test(canon(t))) {
        return ['credential-file', 'Credential files are never read or copied by an agent.'];
      }
    }
  }
  // wildcards that reach credential stems, and bulk reads or copies of the .claude folder
  for (const t of tokens) {
    if (/[*?[]/.test(t) && !t.startsWith('-')) {
      const stem = t.slice(0, t.search(/[*?[]/));
      if (
        /(^|[\\/])\.(env|dev\.v|cred|netrc|npmrc|git-cred|cl)[^\\/]*$/i.test(stem) ||
        /\.claude([\\/]|$)/i.test(stem)
      ) {
        return [
          'credential-glob',
          'A wildcard over credential names or ~/.claude can reach .credentials.json.',
        ];
      }
    }
  }
  const BULK =
    BULK_READERS.has(u.program) ||
    u.program === 'compress-archive' ||
    (u.program === 'get-childitem' && u.args.some((x) => /^-r(ecurse)?$/i.test(x)));
  if (BULK) {
    for (const t of tokens) {
      if (t.startsWith('-')) continue;
      const c = canon(t);
      const hc = c.match(HOME_CLAUDE_RE);
      if (hc && (hc[1] ?? '') === '') {
        return [
          'credential-search',
          'Reading, searching or copying the whole ~/.claude folder reaches credential files.',
        ];
      }
      if (
        new RegExp(`^${USER_HOME}$`).test(c) &&
        [
          'grep',
          'egrep',
          'rg',
          'find',
          'tar',
          'zip',
          '7z',
          'findstr',
          'select-string',
          'get-childitem',
          'compress-archive',
        ].includes(u.program)
      ) {
        return [
          'credential-search',
          'Searching or archiving a whole home folder reaches credential files.',
        ];
      }
    }
  }
  // writes, moves and deletes of the guard's own files, settings, profiles and git hooks
  const dests = [];
  for (const r of u.redirs) if (/^(>|>>|&>|>\||>&)/.test(r.op)) dests.push(r.target);
  const nonFlag = u.args.filter((x) => !x.startsWith('-'));
  if (WRITE_ALL.has(u.program)) dests.push(...nonFlag);
  if (WRITE_LAST.has(u.program) && nonFlag.length) dests.push(nonFlag[nonFlag.length - 1]);
  // moving or renaming a protected file removes it: the sources count too
  if (['mv', 'move', 'move-item', 'mi', 'ren', 'rename', 'rename-item', 'rni'].includes(u.program))
    dests.push(...nonFlag);
  if (u.program === 'sed' && u.args.some((x) => /^(-[a-zA-Z]*i|--in-place(=.*)?)$/.test(x)))
    dests.push(...nonFlag);
  if (u.program === 'perl' && u.args.some((x) => /^-[a-zA-Z]*i/.test(x))) dests.push(...nonFlag);
  if (u.program === 'awk' && u.args.includes('inplace')) dests.push(...nonFlag);
  if (u.program === 'find' && u.args.includes('-delete')) {
    const stop = u.args.findIndex((x) => x.startsWith('-') || x === '(' || x === '!');
    dests.push(...(stop >= 0 ? u.args.slice(0, stop) : u.args));
  }
  if (u.program === 'dd')
    dests.push(...u.args.filter((x) => x.startsWith('of=')).map((x) => x.slice(3)));
  if (u.program === 'curl') {
    const i = u.args.findIndex((x) => x === '-o' || x === '--output');
    if (i >= 0 && u.args[i + 1]) dests.push(u.args[i + 1]);
  }
  if (u.program === 'wget') {
    const i = u.args.findIndex((x) => x === '-O');
    if (i >= 0 && u.args[i + 1]) dests.push(u.args[i + 1]);
  }
  if (u.program === 'ln' || u.program === 'mklink' || /new-item/.test(u.program)) {
    // a link to a protected folder is a way to write through it later
    for (const t of nonFlag) {
      if (protectedWrite(canon(t), { shell: true })) return ['self-config', SELF_CONFIG_WHY];
    }
  }
  if (ctx.dotnet?.write) dests.push(...tokens, ...u.redirs.map((r) => r.target));
  for (const d of dests) {
    if (!d || d === '/dev/null' || /^nul$/i.test(d)) continue;
    if (protectedWrite(canon(d), { shell: true })) return ['self-config', SELF_CONFIG_WHY];
  }
  // inline code that names a protected path may write it: it cannot be read, so it is refused
  if (INTERPRETERS.has(u.program) && u.args.some((x) => INLINE_FLAG.test(x))) {
    const code = u.args.join(' ');
    if (
      /\.claude|\.mcp\.json|\.git[\\/]+hooks|\.gitconfig|\.bashrc|\.zshrc/i.test(code) &&
      /(write|append|copy|rename|unlink|rm|open\s*\(|mkdir|symlink)/i.test(code)
    ) {
      return ['self-config', SELF_CONFIG_WHY];
    }
  }
  return null;
}

const SELF_CONFIG_WHY =
  'An agent does not change its own MCP servers, permissions, hooks, audit log or the files that run later; the owner does that.';

function persistenceVerdict(u) {
  const a = u.args.map((x) => x.toLowerCase());
  const p = u.program;
  const hit =
    (p === 'schtasks' && a.some((x) => /^\/(create|change)$/.test(x))) ||
    (p === 'crontab' && !a.includes('-l')) ||
    (p === 'reg' && a[0] === 'add' && /\\run(once)?\b/i.test(u.raw)) ||
    ([
      'register-scheduledtask',
      'new-scheduledtask',
      'register-scheduledjob',
      'set-itemproperty',
    ].includes(p) &&
      /\\run\b|scheduled/i.test(u.raw)) ||
    (p === 'npm' && a[0] === 'config' && a[1] === 'set' && /registry$/.test(a[2] ?? '')) ||
    (['set-content', 'add-content', 'out-file', 'tee-object'].includes(p) &&
      u.args.some((x) => /^\$profile(\.|$)/i.test(x)));
  return hit
    ? [
        'persistence',
        'Scheduled tasks, run keys, crontabs and package registries run or install things later; they are the owner’s.',
      ]
    : null;
}

function selfConfigClaudeVerdict(u) {
  const a = u.args.map((x) => x.toLowerCase());
  const claude =
    u.program === 'claude' ||
    u.program === 'claude-code' ||
    /@anthropic-ai\/claude-code/.test(u.raw);
  if (!claude) return null;
  const i = a.findIndex(
    (x) => x === 'mcp' || x === 'plugin' || x === 'plugins' || x === 'marketplace'
  );
  if (i < 0) return null;
  return /^(add|add-json|add-from-claude-desktop|remove|install|uninstall|enable|update)$/.test(
    a[i + 1] ?? ''
  )
    ? ['self-config', SELF_CONFIG_WHY]
    : null;
}

function checkShell(rawCommand, cwd) {
  const command = String(rawCommand);
  if (command.length > MAX_COMMAND_CHARS)
    throw new Error('the command is larger than the analysis limit');
  const units = unitsOf(command);
  const assigned = new Set();
  for (const m of command.matchAll(/(?:^|[\s;&|(])\$?([A-Za-z_]\w*)\s*=/g)) assigned.add(m[1]);
  const ctx = { cwd, vcwd: cwd ? canonicalPath(cwd) : '', assigned, dotnet: null };
  for (const u of units) {
    const p = pathVerdict(u, ctx) ?? selfConfigClaudeVerdict(u) ?? persistenceVerdict(u);
    if (p) return p;
    for (const [id, why, blocks] of SHELL_RULES) {
      if (blocks(u, ctx)) return [id, why];
    }
  }
  return null;
}

// ---------------------------------------------------------------- MCP -------

const MCP_RULES = [
  [
    'mcp-cloudflare-write',
    'Cloudflare changes go through CI and the owner’s terminal, not an agent tool call.',
    /^mcp__cloudflare__(worker_(deploy|put|delete)|secret_(put|delete)|env_var_(set|bulk_set|delete)|d1_(create|delete)_database|d1_query|r2_(create|delete)_bucket|r2_(put|delete)_object|kv_(put|delete)|route_(create|update|delete)|version_rollback|wfp_|service_binding_(create|update|delete)|do_(create|delete)_|do_alarm_|queue_(create|delete|send|update)|workflow_(create|delete|update|execute)|cron_(create|update|delete)|wrangler_config_update|template_create_worker)/,
  ],
  [
    'mcp-session-control',
    'Permission mode, remote control, connector toggles, session messaging, scheduled tasks and auto-merge are the owner’s.',
    /^mcp__(ccd_(settings__set_setting|session_mgmt__(set_session_permission_mode|set_remote_control|delete_session|send_message|stop_session|set_session_model|set_session_output_style)|connectors__set_session_connector_enabled|host__(discard_kept_worktree|clean_up_worktrees)|directory__change_directory|pr__set_auto_merge)|scheduled-tasks__(create_scheduled_task|update_scheduled_task|delete_scheduled_task|run_scheduled_task))/,
  ],
];

MCP_RULES.push([
  'mcp-code-execution',
  'Tools that run arbitrary SQL, script or deploys on a connected service are the owner’s.',
  /^mcp__[0-9a-f-]{36}__d1_database_query$|^mcp__[\w-]+__(browser_run_code_unsafe|javascript_tool|firebase_deploy|firebase_login|firebase_logout)$/,
]);

function checkMcp(tool, input, cwd) {
  for (const [id, why, re] of MCP_RULES) if (re.test(tool)) return [id, why];
  if (tool === 'mcp__terminal__run_in_terminal')
    return checkShell(String(input.command ?? ''), cwd);
  return null;
}

// -------------------------------------------------------------- files -------

function checkFile(tool, input, cwd) {
  const path = input.file_path ?? input.notebook_path ?? input.path ?? '';
  if (!path) return null;
  const canon = canonicalPath(path, cwd ? canonicalPath(cwd) : '');
  if (SENSITIVE_PATH.test(path) || SENSITIVE_PATH.test(canon)) {
    return ['credential-file', 'Credential files are never read or edited by an agent.'];
  }
  // Writes only: reading settings is how an inventory gets done. An agent that can edit its own
  // permissions, hooks, MCP servers, audit log or the files that run later can switch every
  // other rule off. (The repo's own hook is edited through review, so it is not listed here.)
  if (tool !== 'Read' && tool !== 'Grep') {
    if (protectedWrite(canon, { shell: false }) || /\/\.gitconfig$/.test(canon)) {
      return ['self-config', SELF_CONFIG_WHY];
    }
    if (/\/\.claude\/[^/]*~\d/.test(canon)) return ['self-config', SELF_CONFIG_WHY];
  }
  // A content search over a folder that holds credential stores would print matches from them.
  if (tool === 'Grep') {
    const home = canonicalPath(homedir());
    const broad = new RegExp(
      `^(?:[a-z]:|/users|/home|[a-z]:/users|${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/\\.claude|/\\.ssh|/\\.wrangler|/\\.aws|/\\.config|/\\.docker|/appdata(?:/local|/roaming)?(?:/github cli|/google)?)?|${USER_HOME}(?:/\\.claude|/\\.ssh|/\\.wrangler|/\\.aws|/\\.config)?)$`
    );
    if (broad.test(canon)) {
      return [
        'credential-search',
        'Searching the whole home folder, ~/.claude or another credential folder would reach credential files; search a narrower folder.',
      ];
    }
  }
  return null;
}

// ------------------------------------------------------------- output -------

function redact(text) {
  return text
    .replace(/sk-ant-[\w-]+/g, 'sk-ant-[REDACTED]')
    .replace(/gh[pousr]_\w{20,}/g, 'gh_[REDACTED]')
    .replace(/github_pat_\w+/g, 'gh_[REDACTED]')
    .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA[REDACTED]')
    .replace(/(Authorization:\s*)\S+(\s+\S+)?/gi, '$1[REDACTED]')
    .replace(/(X-OCR-Internal:\s*)\S+/gi, '$1[REDACTED]')
    .replace(/(CF-Access-Client-(?:Id|Secret):\s*)\S+/gi, '$1[REDACTED]')
    .replace(/(\/\/[^\s:@/]+:)[^\s@/]+@/g, '$1[REDACTED]@')
    .replace(/(\s-u\s+[^\s:]+:)\S+/g, '$1[REDACTED]')
    .replace(/(Bearer\s+)[\w.~+/=-]+/gi, '$1[REDACTED]')
    .replace(/(--(?:token|password|secret|api-key)[ =])\S+/gi, '$1[REDACTED]')
    .replace(
      /(\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|INTERNAL)\s*=\s*)\S+/g,
      '$1[REDACTED]'
    );
}

function audit(entry) {
  try {
    const dir = process.env.OCR_POLICY_AUDIT_DIR || join(homedir(), '.claude', 'audit');
    mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(join(dir, `policy-${day}.jsonl`), JSON.stringify(entry) + '\n');
  } catch {
    // Auditing never blocks work.
  }
}

let call;
try {
  call = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.stderr.write('policy-gate: could not read the hook input; allowing this call.\n');
  process.exit(0);
}

const tool = call.tool_name ?? '';
const input = call.tool_input ?? {};
const callCwd = call.cwd && String(call.cwd) !== '' ? String(call.cwd) : '';
let verdict = null;

function analyse() {
  deadline = Date.now() + BUDGET_MS;
  unitCount = 0;
  if (SHELL_TOOLS.has(tool)) return checkShell(String(input.command ?? ''), callCwd);
  if (FILE_TOOLS.has(tool)) return checkFile(tool, input, callCwd);
  if (tool.startsWith('mcp__')) return checkMcp(tool, input, callCwd);
  return null;
}

try {
  verdict = analyse();
} catch (err) {
  // A call that cannot be analysed is refused, not allowed: otherwise an input built to make the
  // analysis slow, deep or crash it would be a way past every rule.
  verdict = [
    'analysis-failed',
    `The call could not be analysed (${err instanceof Error ? err.message : 'error'}), so it is refused.`,
  ];
}

if (SHELL_TOOLS.has(tool)) {
  audit({
    ts: new Date().toISOString(),
    session: call.session_id ?? null,
    cwd: call.cwd ?? null,
    tool,
    decision: verdict ? 'block' : 'allow',
    rule: verdict ? verdict[0] : null,
    command: redact(String(input.command ?? '').slice(0, 4000)),
  });
} else if (verdict) {
  audit({
    ts: new Date().toISOString(),
    session: call.session_id ?? null,
    tool,
    decision: 'block',
    rule: verdict[0],
  });
}

if (verdict) {
  process.stderr.write(
    `Blocked by the OCR policy gate [${verdict[0]}]: ${verdict[1]} ` +
      'If this is intended, ask the owner to run it in their own terminal.\n'
  );
  process.exit(2);
}
process.exit(0);
