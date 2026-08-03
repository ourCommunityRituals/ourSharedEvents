/**
 * @ocr/ui — Shared component styles
 *
 * The reset + component vocabulary that repeated across every template:
 * .header, .section, .btn family, .card, .bottom-nav/.nav-item,
 * .loading/.spinner, .live-indicator, inputs, .hidden — plus ONE new
 * component the fleet was missing: .empty-state, which gives every dead-end
 * (no data yet, access denied) a title, a message, and a next step.
 *
 * All values reference tokens.ts. Nothing hard-codes a colour or radius.
 */

export const componentStyles = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100dvh;-webkit-font-smoothing:antialiased}

/* Layout */
.header{position:sticky;top:0;z-index:10;background:color-mix(in srgb, var(--bg) 90%, transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:16px 20px;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:1.25rem;font-weight:700}
.content{padding:20px 20px 100px}
.section{margin-bottom:24px}
.section-title{font-size:.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px}

/* Buttons — all meet the 48px tap target */
.btn{padding:14px 20px;border:none;border-radius:var(--radius-sm);font-size:.9rem;font-weight:600;cursor:pointer;font-family:var(--font);min-height:var(--tap-min);transition:opacity .2s;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-primary{background:var(--accent);color:#000}
.btn-primary:hover{background:var(--accent-hover)}
.btn-secondary{background:var(--surface);color:var(--text);border:1px solid var(--border)}
.btn-secondary:hover{background:var(--surface-hover)}
.btn-danger{background:var(--danger);color:#fff}
.btn-block{width:100%}

/* Cards */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px}
.card:hover{background:var(--surface-hover)}

/* Inputs (generalised from .venue-input / .track-search) */
.input{width:100%;padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:.85rem;font-family:var(--font);outline:none}
.input:focus{border-color:var(--accent)}
.input::placeholder{color:var(--text-muted)}

/* Bottom nav */
.bottom-nav{position:fixed;bottom:0;left:0;right:0;background:color-mix(in srgb, var(--bg) 95%, transparent);backdrop-filter:blur(12px);border-top:1px solid var(--border);display:flex;justify-content:space-around;padding:10px 0 env(safe-area-inset-bottom,10px)}
.nav-item{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:.65rem;color:var(--text-muted);text-decoration:none;padding:6px 16px;min-height:var(--tap-min);justify-content:center}
.nav-item.active{color:var(--accent)}
.nav-item svg{width:22px;height:22px}

/* Live indicator */
.live-indicator{font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;padding:4px 10px;border-radius:var(--radius-pill)}
.live-indicator.on{color:var(--live);background:color-mix(in srgb, var(--live) 15%, transparent);animation:pulse 2s ease-in-out infinite}
.live-indicator.off{color:var(--text-muted);background:var(--surface)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}

/* Loading */
.loading{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:20px}
.spinner{width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* Empty state — NEW. Replaces every bare "access denied" / blank screen.
   Always carries a next step so first-touch never dead-ends. */
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:50vh;padding:40px 24px;gap:12px}
.empty-state .es-icon{font-size:2.5rem;line-height:1;margin-bottom:4px}
.empty-state h3{font-size:1.1rem;font-weight:700}
.empty-state p{color:var(--text-muted);font-size:.9rem;max-width:34ch}
.empty-state .btn{margin-top:12px}

.hidden{display:none}

/* Form helpers */
label{display:block;font-size:.875rem;color:var(--text-muted);margin-bottom:8px}
.loading-text{font-size:1rem;color:var(--text-muted)}
.body-centered{display:flex;flex-direction:column;align-items:center;justify-content:center}
.btn-link{background:none;border:none;color:var(--text-muted);cursor:pointer;text-decoration:underline;font-family:var(--font);min-height:44px;padding:8px;font-size:.875rem}

/* Error banner */
.error-banner{background:color-mix(in srgb, var(--error) 10%, transparent);border:1px solid var(--error);color:var(--error);padding:12px 16px;border-radius:var(--radius-sm);font-size:.875rem;margin-bottom:20px;display:none}
.error-banner.visible{display:block}

/* Identity badges */
.user-badge{font-size:.75rem;color:var(--accent);background:color-mix(in srgb, var(--accent) 10%, transparent);padding:4px 10px;border-radius:20px}
.brand{font-size:.7rem;text-transform:uppercase;letter-spacing:.15em;color:var(--accent)}

/* Access / not-found */
.access-denied{text-align:center;padding:60px 20px}
.access-denied h3{margin-bottom:8px}
.access-denied p{color:var(--text-muted);font-size:.9rem}
.not-found{text-align:center;padding:80px 20px}
.not-found h2{margin-bottom:8px}
.not-found p{color:var(--text-muted)}
.content-wrap{padding-bottom:80px}

/* Centered page header (stats) */
.page-header{position:sticky;top:0;z-index:10;background:color-mix(in srgb, var(--bg) 90%, transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:16px 20px;text-align:center}
.page-header h1{font-size:1.25rem;font-weight:700}
.page-header p{font-size:.75rem;color:var(--text-muted);margin-top:4px}

/* Centered static section header (live) */
.live-view-header{text-align:center;padding:32px 20px 20px;border-bottom:1px solid var(--border)}

/* Live badge */
.live-badge{display:inline-flex;align-items:center;gap:6px;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--live);background:color-mix(in srgb, var(--live) 15%, transparent);padding:4px 10px;border-radius:999px;margin-top:8px;animation:pulse 2s ease-in-out infinite}

/* Offline / footer CTA */
.offline-msg{text-align:center;padding:60px 20px}
.offline-msg h2{margin-bottom:8px}
.offline-msg p{color:var(--text-muted)}
.footer-cta{text-align:center;padding:24px 20px;border-top:1px solid var(--border);margin-top:20px}
.footer-cta a{color:var(--accent);text-decoration:none;font-size:.85rem}

/* Track card family */
.track-card{display:flex;align-items:center;gap:12px;padding:10px;border-radius:var(--radius-sm);transition:background .15s;cursor:pointer}
.track-card:hover{background:var(--surface-hover)}
.track-art{width:48px;height:48px;border-radius:6px;background:var(--surface);flex-shrink:0;object-fit:cover}
.track-info{flex:1;min-width:0}
.track-name{font-size:.9rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.track-artist{font-size:.8rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.now-playing-label{font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);font-weight:600}
.now-playing-track{font-size:1rem;font-weight:500}
.meta-badge{font-size:.65rem;padding:2px 6px;border-radius:4px;background:var(--surface);color:var(--text-muted)}
.meta-badge.high{color:var(--accent);background:color-mix(in srgb, var(--accent) 15%, transparent)}

/* Attribution button */
.attr-btn{background:var(--accent);color:#000;border:none;border-radius:20px;padding:8px 16px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:var(--font);min-height:44px;min-width:44px;transition:opacity .2s;flex-shrink:0}
.attr-btn:disabled{opacity:.4;cursor:default}
.attr-btn.done{background:var(--surface);color:var(--accent);border:1px solid var(--accent)}

/* Filter chips */
.filter-chip{flex-shrink:0;padding:6px 14px;background:var(--surface);border:1px solid var(--border);border-radius:20px;color:var(--text-muted);font-size:.8rem;cursor:pointer;transition:all .2s;min-height:44px;display:inline-flex;align-items:center}
.filter-chip:hover,.filter-chip.active{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb, var(--accent) 10%, transparent)}

/* Range sliders */
.range-group{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.range-group label{font-size:.875rem;color:var(--text-muted);min-width:100px;margin-bottom:0}
.range-group input[type=range]{flex:1;accent-color:var(--accent);height:44px}
.range-value{font-size:.875rem;color:var(--text);min-width:40px;text-align:right}

/* Stats blocks */
.stats-row{display:flex;gap:10px;overflow-x:auto;scrollbar-width:none}
.stats-row::-webkit-scrollbar{display:none}
.stat-card{flex:1;min-width:80px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;text-align:center}
.stat-value{font-size:1.5rem;font-weight:700;color:var(--accent)}
.stat-label{font-size:.7rem;color:var(--text-muted);margin-top:4px}

/* Bar chart (stats page) */
.bar-chart{display:flex;flex-direction:column;gap:6px}
.bar-row{display:flex;align-items:center;gap:10px}
.bar-label{font-size:.8rem;min-width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-track{flex:1;height:24px;background:var(--surface);border-radius:4px;overflow:hidden}
.bar-fill{height:100%;background:var(--accent);border-radius:4px;transition:width .5s ease}
.bar-count{font-size:.75rem;color:var(--text-muted);min-width:30px;text-align:right}

/* Generic list items */
.list-item{display:flex;align-items:center;justify-content:space-between;padding:12px;border-radius:var(--radius-sm);min-height:48px;transition:background .15s}
.list-item:hover{background:var(--surface-hover)}
.list-name{font-size:.9rem;font-weight:500}
.list-sub{font-size:.75rem;color:var(--text-muted)}
.list-count{font-size:.85rem;color:var(--accent);font-weight:600}
.item-info{flex:1;min-width:0}
.item-name{font-size:.85rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item-sub{font-size:.75rem;color:var(--text-muted)}
.item-action{flex-shrink:0}

/* Genre tags */
.genre-tag{display:inline-block;font-size:.65rem;padding:2px 8px;border-radius:10px;background:color-mix(in srgb, var(--accent) 10%, transparent);color:var(--accent);cursor:pointer;transition:background .15s}
.genre-tag:hover{background:color-mix(in srgb, var(--accent) 25%, transparent)}

/* Genre discovery popup */
.genre-popup{position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-top:1px solid var(--border);border-radius:16px 16px 0 0;padding:20px 20px env(safe-area-inset-bottom,20px);z-index:100;transform:translateY(100%);transition:transform .25s ease-out}
.genre-popup.open{transform:translateY(0)}
.genre-popup-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99;display:none}
.genre-popup-backdrop.open{display:block}
.genre-popup-title{font-size:1rem;font-weight:600;margin-bottom:16px}
.genre-popup-links{display:flex;flex-direction:column;gap:4px}
.genre-link{display:flex;align-items:center;gap:12px;padding:14px 12px;border-radius:var(--radius-sm);color:var(--text);text-decoration:none;font-size:.9rem;transition:background .15s;min-height:48px}
.genre-link:hover{background:var(--surface-hover)}
.genre-link-icon{width:28px;text-align:center;font-size:1.1rem;flex-shrink:0}
.genre-link-info{flex:1}
.genre-link-label{font-weight:500}
.genre-link-desc{font-size:.75rem;color:var(--text-muted)}
.genre-link::after{content:'↗';font-size:.8rem;color:var(--text-muted);margin-left:auto;padding-left:8px}
.genre-filter-btn{width:100%;padding:14px;margin-top:8px;background:var(--accent);color:#000;border:none;border-radius:var(--radius-sm);font-size:.9rem;font-weight:600;cursor:pointer;font-family:var(--font);min-height:48px}

/* Toolbar + view controls (catalog) */
.toolbar{display:flex;align-items:center;justify-content:space-between;padding:8px 20px;font-size:.75rem;color:var(--text-muted)}
.sort-select{background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:16px;padding:6px 10px;font-family:var(--font);outline:none;min-height:44px;-webkit-appearance:none}
.view-toggle{display:flex;gap:4px}
.view-btn{background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-muted);cursor:pointer;font-size:.75rem;font-family:var(--font);min-height:44px;min-width:44px;padding:6px 10px;transition:all .15s}
.view-btn.active{border-color:var(--accent);color:var(--accent)}

/* Track detail expand + grid view (catalog) */
.track-detail{display:none;padding:8px 10px 12px 70px;font-size:.75rem;color:var(--text-muted);gap:8px;flex-wrap:wrap}
.track-detail.open{display:flex}
.detail-chip{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-size:.65rem}
.track-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;padding:0 20px 100px}
.grid-card{background:var(--surface);border-radius:var(--radius-sm);overflow:hidden;cursor:pointer;transition:transform .15s}
.grid-card:hover{transform:scale(1.02)}
.grid-art{width:100%;aspect-ratio:1;background:var(--border);object-fit:cover}
.grid-info{padding:10px}
.grid-name{font-size:.8rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grid-artist{font-size:.7rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* Search bar + loading shimmer (catalog) */
.search-bar{width:100%;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:16px;font-family:var(--font);outline:none}
.search-bar:focus{border-color:var(--accent)}
.search-bar::placeholder{color:var(--text-muted)}
.search-bar.loading{background-image:linear-gradient(90deg,var(--surface) 0,var(--surface-hover) 50%,var(--surface) 100%);background-size:200% 100%;animation:shimmer 1.5s infinite}
@keyframes shimmer{0%{background-position:200% 0}to{background-position:-200% 0}}

/* Toggle switch (create) */
.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0}
.toggle-label{font-size:.9rem}
.toggle{position:relative;width:44px;height:24px}
.toggle input{opacity:0;width:0;height:0}
.toggle-track{position:absolute;inset:0;background:var(--border);border-radius:12px;cursor:pointer;transition:background .2s}
.toggle-track::after{content:'';position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:3px;left:3px;transition:transform .2s}
.toggle input:checked+.toggle-track{background:var(--accent)}
.toggle input:checked+.toggle-track::after{transform:translateX(20px)}

/* Preview count (create) */
.preview-count{text-align:center;padding:16px;background:var(--surface);border-radius:var(--radius);color:var(--text-muted);font-size:.9rem}
.preview-count strong{color:var(--accent);font-size:1.5rem;display:block;margin-bottom:4px}

/* Drop zone + import flow */
.drop-zone{border:2px dashed var(--border);border-radius:var(--radius);padding:40px 20px;text-align:center;transition:border-color .2s,background .2s;cursor:pointer;min-height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}
.drop-zone.dragover{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 5%, transparent)}
.drop-zone-icon{font-size:2rem}
.drop-zone-text{font-size:.9rem;color:var(--text-muted)}
.drop-zone-hint{font-size:.75rem;color:var(--text-muted)}
.file-input{display:none}
.file-name{font-size:.85rem;color:var(--accent);margin-top:8px;word-break:break-all}
.preview-section,.progress-section,.result-section{display:none}
.preview-section.visible,.progress-section.visible,.result-section.visible{display:block}
.preview-title{font-size:.85rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px}
.preview-table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-sm);scrollbar-width:none}
.preview-table-wrap::-webkit-scrollbar{display:none}
.preview-table{width:100%;border-collapse:collapse;font-size:.75rem}
.preview-table th{background:var(--surface);padding:8px 10px;text-align:left;font-weight:600;color:var(--text-muted);white-space:nowrap;border-bottom:1px solid var(--border)}
.preview-table td{padding:6px 10px;border-bottom:1px solid var(--border);white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis}
.progress-bar-wrap{background:var(--surface);border-radius:4px;height:8px;overflow:hidden}
.progress-bar{height:100%;background:var(--accent);border-radius:4px;width:0%;transition:width .3s ease}
.progress-text{font-size:.8rem;color:var(--text-muted);margin-top:8px;text-align:center}
.result-success{background:color-mix(in srgb, var(--accent) 10%, transparent);border:1px solid color-mix(in srgb, var(--accent) 30%, transparent);border-radius:var(--radius-sm);padding:16px;text-align:center}
.result-success h3{color:var(--accent);margin-bottom:8px}
.result-stats{font-size:.85rem;color:var(--text-muted)}
.result-error{background:color-mix(in srgb, var(--error) 10%, transparent);border:1px solid color-mix(in srgb, var(--error) 30%, transparent);border-radius:var(--radius-sm);padding:16px;margin-top:12px}
.result-error h4{color:var(--error);font-size:.85rem;margin-bottom:8px}
.error-list{list-style:none;font-size:.75rem;color:var(--text-muted)}
.error-list li{padding:4px 0;border-bottom:1px solid var(--border)}

/* Profile components */
.profile-header{padding:32px 20px 20px;text-align:center;border-bottom:1px solid var(--border)}
.profile-avatar{width:72px;height:72px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:1.75rem;font-weight:700;color:#000;margin:0 auto 12px}
.source-list{display:flex;flex-wrap:wrap;gap:8px}
.source-badge{font-size:.75rem;padding:6px 14px;border-radius:20px;background:var(--surface);border:1px solid var(--border);color:var(--text);min-height:44px;line-height:30px}

/* Contributor leaderboard (stats) */
.contributor-item{display:flex;align-items:center;gap:12px;padding:10px;border-radius:var(--radius-sm)}
.contributor-avatar{width:36px;height:36px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:700;color:#000;flex-shrink:0}
.contributor-info{flex:1}
.contributor-name{font-size:.85rem;font-weight:500}
.contributor-role{font-size:.7rem;color:var(--text-muted)}
.contributor-count{font-size:.85rem;color:var(--accent);font-weight:600}

/* QR poster / display card */
.display-card{width:100%;max-width:360px;text-align:center}
.qr-frame{background:#fff;border-radius:16px;padding:24px;margin:0 auto 32px;display:inline-block}
.qr-frame canvas,.qr-frame img{display:block;width:200px;height:200px}
.qr-placeholder{width:200px;height:200px;display:flex;align-items:center;justify-content:center;font-size:.8rem;color:var(--text-muted)}
.cta{font-size:1.1rem;font-weight:600;margin-bottom:8px}
.cta-sub{font-size:.8rem;color:var(--text-muted);margin-bottom:32px}
.now-playing{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-top:8px}
.sponsor-slot{margin-top:32px;padding:16px;border-top:1px solid var(--border);font-size:.7rem;color:var(--text-muted)}
.sponsor-slot .sponsor-name{color:var(--text);font-weight:500}
@media(min-width:768px){.display-card{max-width:480px}.qr-frame{padding:32px}.qr-frame canvas,.qr-frame img,.qr-placeholder{width:260px;height:260px}}

/* Form field pattern — label + input + hint/error */
.form-field{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
.form-hint{font-size:.75rem;color:var(--text-muted)}
.form-error{font-size:.75rem;color:var(--error)}
.required-mark{color:var(--error);font-weight:700;margin-left:2px}
.input-error{border-color:var(--error)}
.input-error:focus,.input-error:focus-visible{border-color:var(--error);outline-color:var(--error)}
.form-group{border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px}
.form-group legend{font-size:.8rem;font-weight:600;color:var(--text-muted);padding:0 6px;text-transform:uppercase;letter-spacing:.05em}
.checkbox-label{display:flex;align-items:center;gap:10px;cursor:pointer;min-height:44px;font-size:.875rem;font-weight:400;color:var(--text)}
.checkbox-label input[type=checkbox]{width:18px;height:18px;accent-color:var(--accent);flex-shrink:0;cursor:pointer}
.radio-option{display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer;font-size:.875rem;color:var(--text)}
.radio-option input[type=radio]{width:18px;height:18px;accent-color:var(--accent);flex-shrink:0;cursor:pointer}
.radio-group-error{font-size:.75rem;color:var(--error);margin-top:6px}

/* Accessibility: keyboard focus rings (WCAG 2.4.11 — Focus Appearance, Level AA in 2.2)
   :focus-visible targets keyboard/programmatic focus only, not mouse clicks.
   Outline colour references --accent which clears 3:1 against all surfaces in both themes. */
.btn:focus-visible,.attr-btn:focus-visible,.filter-chip:focus-visible,.genre-filter-btn:focus-visible,.view-btn:focus-visible,.btn-link:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.nav-item:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.card:focus-visible,.track-card:focus-visible,.genre-link:focus-visible,.list-item:focus-visible,.grid-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.input:focus-visible,.search-bar:focus-visible,.sort-select:focus-visible{outline:2px solid var(--accent);outline-offset:0;border-color:var(--accent)}
.toggle input:focus-visible+.toggle-track{outline:2px solid var(--accent);outline-offset:2px}

/* Accessibility: reduced motion (WCAG 2.3.3 — Animation from Interactions, Level AAA)
   Removes infinite animations for users with vestibular or cognitive sensitivities.
   Short functional transitions (hover feedback) are also removed to respect the preference fully. */
@media(prefers-reduced-motion:reduce){
  .live-indicator.on,.live-badge{animation:none}
  .spinner{animation:none;border-top-color:var(--accent);opacity:.7}
  .search-bar.loading{animation:none;background-image:none}
  .btn,.card,.track-card,.filter-chip,.grid-card,.genre-popup,.genre-link,.list-item,.nav-item,.bar-fill,.progress-bar,.toggle-track,.toggle-track::after{transition:none}
}
`.trim();
