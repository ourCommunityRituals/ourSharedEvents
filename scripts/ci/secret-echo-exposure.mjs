/**
 * Which workflow steps print a secret (OSE-1488).
 *
 * Writing `${{ secrets.X }}` straight into a `run:` script is already refused by the
 * workflow-token-hardening test (0.5). The gap this closes is the indirect route: a secret is
 * passed through `env:` and the script then prints it. GitHub masks an exact echo of a secret in the
 * log, but not a value derived from it (base64, a substring, a reversed copy), and `set -x` or an
 * environment dump prints every value it can see.
 *
 * Pure functions over an already-parsed workflow document, so the rule can be unit-tested and
 * mutation-tested (StrykerJS) without touching the file system. The test that applies it to the real
 * workflows is tests/unit/ci/no-secret-echo.test.js.
 *
 * What counts as printing: a print command (echo, printf, cat, tee, print, Write-Host, Write-Output)
 * that names the variable and whose output reaches the log; `printenv`, a bare `env`, `export -p`,
 * `declare -p` or `set` that dumps the environment; and `set -x` / `set -o xtrace` in a step that has
 * a secret in scope.
 *
 * What does not count, on purpose: output piped or redirected onward (`echo "$T" | docker login
 * --password-stdin`, `printf '%s' "$T" > file`), existence tests (`[ -z "$T" ]`, `${T:+set}`) and a
 * different variable. Deriving a value and printing it later is out of scope; that is what
 * detect-secrets and review are for.
 */

/** The names of env entries whose value references a secret. */
export function secretEnvVars(...envs) {
  const names = new Set();
  for (const env of envs) {
    // Stryker disable next-line ConditionalExpression: Object.entries of a string, number or boolean yields no value containing "secrets.", so this guard has no observable effect; it only documents intent.
    if (!env || typeof env !== 'object') continue;
    for (const [name, value] of Object.entries(env)) {
      if (typeof value === 'string' && /secrets\./.test(value)) names.add(name);
    }
  }
  return [...names];
}

const PRINT_COMMAND = /\b(echo|printf|cat|tee|print|Write-Host|Write-Output)\b/;

/** True when a single line prints `$name` to the log (not piped or redirected onward). */
function lineEchoes(line, name) {
  // `${NAME:+...}` prints a marker, not the value, so it is not a reference to the value.
  const reference = new RegExp(String.raw`\$(\{${name}\b(?!:\+)|${name}\b)`);
  if (!PRINT_COMMAND.test(line) || !reference.test(line)) return false;
  // `>&2` and `2>&1` still reach the log; any other redirect or a pipe sends the value elsewhere.
  return !/\||>(?!&\d)/.test(line);
}

/** True when the script dumps the whole environment. */
function dumpsEnvironment(run) {
  return /(^|\n)\s*(printenv|env|set|export\s+-p|declare\s+-p)\s*(\n|$)/.test(run);
}

/** True when the script turns on command tracing. */
function tracesCommands(run) {
  return /\bset\s+-[a-zA-Z]*x|\bset\s+-o\s+xtrace/.test(run);
}

/** What a `run:` script does with the secret variables in scope; an empty list means nothing. */
export function printsSecret(run, names) {
  if (typeof run !== 'string' || names.length === 0) return [];
  const reasons = [];
  for (const name of names) {
    if (run.split('\n').some((line) => lineEchoes(line, name))) reasons.push(`prints $${name}`);
  }
  if (dumpsEnvironment(run)) reasons.push('dumps the environment');
  if (tracesCommands(run)) reasons.push('turns on set -x');
  return reasons;
}

/**
 * One line per step that prints a secret, and how many steps with a script and a secret in scope
 * were looked at (so a caller can tell a clean result from an empty one).
 */
export function secretEchoes(name, doc) {
  const findings = [];
  let examined = 0;
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    // Stryker disable next-line ArrayDeclaration: the fallback is an empty list; any placeholder element is not a step object, so the next line skips it.
    for (const [index, step] of (job?.steps ?? []).entries()) {
      if (typeof step?.run !== 'string') continue;
      const names = secretEnvVars(doc.env, job.env, step.env);
      if (names.length === 0) continue;
      examined++;
      const reasons = printsSecret(step.run, names);
      if (reasons.length > 0) {
        const label = step.name ?? `step ${index + 1}`;
        findings.push(`${name}: job "${jobName}", step "${label}" ${reasons.join(' and ')} (secret in scope: ${names.join(', ')})`);
      }
    }
  }
  return { findings, examined };
}
