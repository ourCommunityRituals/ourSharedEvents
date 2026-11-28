/**
 * GET /api/v2/admin/competitions/:id/score-screen — the host's score screen
 * (OSE-529; phase 1 of the leagues design).
 *
 * The host on the floor with a phone, between rounds: tonight's matches, two
 * number boxes each, Save. One hand, big targets (44 px and up), 16 px input
 * text so a phone does not zoom. A Postpone button moves a match to the makeup
 * pool for the host to place later.
 *
 * Spotty wifi (OSE-529): a save that cannot reach the server waits in this
 * browser's own storage and is sent again when the phone is back online. The
 * screen says which matches are waiting. Nothing about a person is stored there:
 * a match id and two scores.
 *
 * HOST ONLY. The path sits under /api/v2/admin/* (Cloudflare Access at the
 * edge); the router runs requireAdmin, and guardAdminObjectScope answers 404 for
 * a competition outside the caller's brands before this runs. The page posts to
 * the same-origin admin API as JSON, so the admin write guard passes it.
 *
 * `?round=N` opens another round; without it, the first round with a match
 * still to play.
 */

import { html, renderErrorPage } from './pages';
import { escapeHtml as esc } from '../lib/html-escape';
import { readCompetition, readEntries, readFixtures } from './competitions';
import { limitOf, rulesetOf } from '../lib/competitions';
import { shortTime } from '../lib/competition-page-render';

export interface ScoreScreenEnv {
  DB?: D1Database;
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/** Layout only, no colour. Under the 400-character inline budget. */
export const SCORE_SCREEN_CSS =
  'main{max-width:520px;margin:0 auto;padding:1rem 16px 3rem}' +
  '.ss-m{margin-top:1rem}.ss-row{display:flex;gap:.5rem;align-items:center}' +
  '.ss-row input{width:5rem;min-height:48px;font-size:1.5rem;text-align:center}' +
  '.ss-row span{flex:1}.ss-b,.ss-n{display:flex;gap:.5rem;margin-top:.5rem}.ss-b .btn{flex:1;min-height:48px}' +
  '.ss-n{align-items:center;flex-wrap:wrap}.ss-n .btn{min-width:44px;padding:0 .8rem}';

/** The page's script: save, postpone, and a queue for when the phone is offline. */
const SCORE_SCREEN_JS = `(function(){
var base=document.body.getAttribute('data-api');var KEY='ose-score-queue:'+base;
function q(){try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch(e){return[]}}
function setQ(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}}
function say(id,t){var el=document.querySelector('[data-status-for="'+id+'"]');if(el)el.textContent=t;}
function send(item){return fetch(base+'/fixtures/'+encodeURIComponent(item.id)+item.path,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(item.body)}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})});}
function run(item){say(item.id,'Saving...');return send(item).then(function(x){say(item.id,x.ok?item.done:(x.j&&x.j.error)||'Not saved');return true},function(){var l=q().filter(function(i){return i.id!==item.id});l.push(item);setQ(l);say(item.id,'Offline. Saved on this phone; it will send when you are back online.');return false});}
function flush(){var l=q();if(!l.length)return;setQ([]);l.reduce(function(p,i){return p.then(function(){return run(i)})},Promise.resolve());}
document.addEventListener('click',function(e){var b=e.target.closest('[data-act]');if(!b)return;var id=b.getAttribute('data-fixture');var card=b.closest('[data-match]');
if(b.getAttribute('data-act')==='save'){var a=card.querySelector('[name=a]').value,c=card.querySelector('[name=b]').value;if(a===''||c===''){say(id,'Enter both scores.');return}run({id:id,path:'/result',body:{score_a:Number(a),score_b:Number(c)},done:'Saved'});}
else{run({id:id,path:'',body:{status:'postponed'},done:'Postponed. Place it on a new night from the admin.'});}});
var cards=[].slice.call(document.querySelectorAll('[data-match]')),tabs=[].slice.call(document.querySelectorAll('[data-show]'));
function show(i){cards.forEach(function(c,j){c.hidden=j!==i});tabs.forEach(function(t,j){t.className='btn '+(j===i?'btn-primary':'btn-secondary');t.setAttribute('aria-pressed',String(j===i))})}
tabs.forEach(function(t,j){t.addEventListener('click',function(){show(j)})});if(tabs.length)show(0);
window.addEventListener('online',flush);flush();
})();`;

interface ScreenMatch {
  id: string;
  a: string;
  b: string;
  where: string;
  score_a: number | null;
  score_b: number | null;
  final: boolean;
}

export function renderScoreScreen(input: {
  competitionId: string;
  name: string;
  round: number | null;
  rounds: number[];
  matches: ScreenMatch[];
  allowsDraw: boolean;
  /** The game's must-know limit, e.g. "Play to 12, or 20 minutes." Null: none. */
  limit: string | null;
}): string {
  const api = `/api/v2/admin/competitions/${encodeURIComponent(input.competitionId)}`;
  const nav = input.rounds
    .map((r) =>
      r === input.round
        ? `<strong class="btn btn-primary" aria-current="page" aria-label="Round ${r}">${r}</strong>`
        : `<a class="btn btn-secondary" aria-label="Round ${r}" href="${esc(`${api}/score-screen?round=${r}`)}">${r}</a>`
    )
    .join('');
  const cards = input.matches
    .map(
      (m) => `<section class="card ss-m" data-match data-testid="score-match">
        <p class="detail-card-sub">${esc(m.where) || '&nbsp;'}</p>
        <div class="ss-row"><span>${esc(m.a)}</span><input name="a" type="number" inputmode="numeric" min="0" max="999" aria-label="${esc(m.a)} score" value="${m.score_a ?? ''}"${m.final ? ' disabled' : ''}></div>
        <div class="ss-row"><span>${esc(m.b)}</span><input name="b" type="number" inputmode="numeric" min="0" max="999" aria-label="${esc(m.b)} score" value="${m.score_b ?? ''}"${m.final ? ' disabled' : ''}></div>
        ${
          m.final
            ? '<p class="detail-card-sub">Final</p>'
            : `<div class="ss-b"><button type="button" class="btn btn-primary" data-act="save" data-fixture="${esc(m.id)}">Save</button><button type="button" class="btn btn-secondary" data-act="postpone" data-fixture="${esc(m.id)}">Postpone</button></div>`
        }
        <p class="detail-card-sub" role="status" data-status-for="${esc(m.id)}"></p>
      </section>`
    )
    .join('');
  // One game per screen (owner, 2026-11-27: no scrolling): a button per court
  // shows that game's card. Without the script every card shows, as before.
  const courts =
    input.matches.length > 1
      ? `<nav class="ss-n" aria-label="Games">${input.matches
          .map(
            (m, i) =>
              `<button type="button" class="btn btn-secondary" data-show="${i}">${esc(m.where.split(' · ')[0] || `Game ${i + 1}`)}</button>`
          )
          .join('')}</nav>`
      : '';
  return `<!DOCTYPE html>
<html lang="en" data-surface="ose-score-screen">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Scores · ${esc(input.name)}</title>
    <link rel="stylesheet" href="/ui.css" />
    <style>${SCORE_SCREEN_CSS}</style>
  </head>
  <body data-api="${esc(api)}">
    <main id="main-content" data-testid="score-screen">
      <h1>${esc(input.name)}</h1>
      <nav class="ss-n" aria-label="Rounds"><span>Round</span>${nav}</nav>${input.round ? '' : '<p class="detail-card-sub">No match left to score</p>'}${input.allowsDraw ? '' : '<p class="detail-card-sub"><strong>No ties.</strong> One team must win.</p>'}${input.limit ? `<p class="detail-card-sub"><strong>${esc(input.limit)}</strong></p>` : ''}${courts}
      ${cards || '<p class="detail-card-sub ss-m">Every match of this round has a score, or none is set yet.</p>'}
    </main>
    <script>${SCORE_SCREEN_JS}</script>
  </body>
</html>`;
}

export async function handleScoreScreen(
  request: Request,
  env: ScoreScreenEnv,
  id: string
): Promise<Response> {
  if (!env.DB) {
    const res = renderErrorPage(
      503,
      'Database not available',
      'Try again in a minute.',
      '/admin',
      'Back to admin'
    );
    return res;
  }
  const db = env.DB;
  const c = await readCompetition(db, id);
  if (!c) {
    return renderErrorPage(
      404,
      'Competition not found',
      'Check the link.',
      '/admin',
      'Back to admin'
    );
  }
  const entries = await readEntries(db, c.id);
  const labels = new Map(entries.map((e) => [e.id, e.label]));
  const fixtures = await readFixtures(db, c.id);
  const rounds = [...new Set(fixtures.map((f) => f.round))].sort((a, b) => a - b);
  const asked = Number(new URL(request.url).searchParams.get('round'));
  const open = fixtures.filter((f) => f.status === 'scheduled');
  const round =
    Number.isInteger(asked) && rounds.includes(asked)
      ? asked
      : open.length
        ? Math.min(...open.map((f) => f.round))
        : null;
  const matches: ScreenMatch[] = fixtures
    .filter((f) => f.round === round && f.status !== 'postponed')
    .map((f) => ({
      id: f.id,
      a: labels.get(f.entry_a) ?? 'Team',
      b: labels.get(f.entry_b) ?? 'Team',
      where: [f.slot_label, shortTime(f.slot_time)].filter(Boolean).join(' · '),
      score_a: f.score_a,
      score_b: f.score_b,
      final: f.state === 'final' || c.status === 'finished',
    }));
  const rules = rulesetOf(c.ruleset, c.rules);
  const res = html(
    renderScoreScreen({
      competitionId: c.id,
      name: c.name,
      round,
      rounds,
      matches,
      allowsDraw: rules.draw !== null,
      limit: limitOf(rules),
    })
  );
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}
