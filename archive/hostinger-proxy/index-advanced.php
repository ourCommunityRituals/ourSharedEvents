<?php
/**
 * zeventbooks.com Production Router (v3.1)
 * Complete routing solution for American Bocce Co. MVP
 *
 * Supports:
 * ✅ Admin wildcards (/admin/*)
 * ✅ Display pages with subpages (/event-display, /event-display/scores)
 * ✅ Poster pages with subpages (/event-poster, /event-poster/preview)
 * ✅ Signup pages with subpages (/event-signup, /event-signup/confirm)
 * ✅ Prefix routing (/display/event, /poster/event, /signup/event)
 * ✅ System pages (/health, /test, /api)
 * ✅ Case-insensitive routing
 * ✅ Query string preservation
 * ✅ Debug mode
 */

// ============================================================================
// CONFIGURATION - UPDATED 2025-11-16
// ============================================================================

$deploymentId = 'AKfycby355Xo-XVv3ibfYsf9SUPQo0rGvBS3ex1sNvfpiQ6g';
$baseUrl = "https://script.google.com/macros/s/$deploymentId/exec";
$debugMode = false; // Set to true for troubleshooting

// ============================================================================
// REQUEST PARSING
// ============================================================================

$requestUri = $_SERVER['REQUEST_URI'];
$path = trim(parse_url($requestUri, PHP_URL_PATH), '/');
$queryString = parse_url($requestUri, PHP_URL_QUERY);

// ============================================================================
// ROUTING LOGIC (Priority Order)
// ============================================================================

$targetUrl = null;
$routeType = 'unknown';
$eventSlug = null;
$subpage = null;

// 1. HOMEPAGE
if (empty($path)) {
    $targetUrl = "$baseUrl?p=admin";
    $routeType = 'homepage';
}

// 2. ADMIN ROUTES (Wildcard)
elseif (preg_match('#^admin(/(.*))?$#i', $path, $matches)) {
    // Matches: /admin, /admin/settings, /admin/users/edit, etc.
    $subpath = isset($matches[2]) ? $matches[2] : '';
    $targetUrl = "$baseUrl?p=admin" . ($subpath ? "&subpage=" . urlencode($subpath) : '');
    $routeType = 'admin';
}

// 3. SYSTEM ROUTES (Wildcard)
elseif (preg_match('#^(health|test|status|ping)(/(.*))?$#i', $path, $matches)) {
    $systemPage = strtolower($matches[1]);
    $subpath = isset($matches[3]) ? $matches[3] : '';
    $targetUrl = "$baseUrl?p=$systemPage" . ($subpath ? "&subpage=" . urlencode($subpath) : '');
    $routeType = 'system';
}

// 4. API ROUTES (Wildcard)
elseif (preg_match('#^api(/(.*))?$#i', $path, $matches)) {
    $apiPath = isset($matches[2]) ? $matches[2] : '';
    $targetUrl = "$baseUrl?p=api&path=" . urlencode('/' . $path);
    $routeType = 'api';
}

// 5. DISPLAY ROUTES (Suffix with optional subpage)
elseif (preg_match('#^(.+)-display(/(.*))?$#i', $path, $matches)) {
    // Matches: /event-display, /event-display/scores, /event-display/brackets
    $eventSlug = $matches[1];
    $subpage = isset($matches[3]) ? $matches[3] : '';
    $targetUrl = "$baseUrl?p=display&event=$eventSlug" . ($subpage ? "&subpage=" . urlencode($subpage) : '');
    $routeType = 'display-suffix';
}

// 6. DISPLAY ROUTES (Prefix)
elseif (preg_match('#^display/(.+)$#i', $path, $matches)) {
    // Matches: /display/event-slug, /display/event-slug/scores
    $parts = explode('/', $matches[1], 2);
    $eventSlug = $parts[0];
    $subpage = isset($parts[1]) ? $parts[1] : '';
    $targetUrl = "$baseUrl?p=display&event=$eventSlug" . ($subpage ? "&subpage=" . urlencode($subpage) : '');
    $routeType = 'display-prefix';
}

// 7. POSTER ROUTES (Suffix with optional subpage)
elseif (preg_match('#^(.+)-poster(/(.*))?$#i', $path, $matches)) {
    // Matches: /event-poster, /event-poster/preview, /event-poster/print
    $eventSlug = $matches[1];
    $subpage = isset($matches[3]) ? $matches[3] : '';
    $targetUrl = "$baseUrl?p=poster&event=$eventSlug" . ($subpage ? "&subpage=" . urlencode($subpage) : '');
    $routeType = 'poster-suffix';
}

// 8. POSTER ROUTES (Prefix)
elseif (preg_match('#^poster/(.+)$#i', $path, $matches)) {
    // Matches: /poster/event-slug, /poster/event-slug/preview
    $parts = explode('/', $matches[1], 2);
    $eventSlug = $parts[0];
    $subpage = isset($parts[1]) ? $parts[1] : '';
    $targetUrl = "$baseUrl?p=poster&event=$eventSlug" . ($subpage ? "&subpage=" . urlencode($subpage) : '');
    $routeType = 'poster-prefix';
}

// 9. SIGNUP/FORM ROUTES (Suffix with optional subpage)
elseif (preg_match('#^(.+)-(signup|register)(/(.*))?$#i', $path, $matches)) {
    // Matches: /event-signup, /event-register, /event-signup/confirm
    $eventSlug = $matches[1];
    $subpage = isset($matches[4]) ? $matches[4] : '';
    $targetUrl = "$baseUrl?p=form&event=$eventSlug" . ($subpage ? "&subpage=" . urlencode($subpage) : '');
    $routeType = 'signup-suffix';
}

// 10. SIGNUP/FORM ROUTES (Prefix)
elseif (preg_match('#^(signup|register)/(.+)$#i', $path, $matches)) {
    // Matches: /signup/event-slug, /register/event-slug
    $parts = explode('/', $matches[2], 2);
    $eventSlug = $parts[0];
    $subpage = isset($parts[1]) ? $parts[1] : '';
    $targetUrl = "$baseUrl?p=form&event=$eventSlug" . ($subpage ? "&subpage=" . urlencode($subpage) : '');
    $routeType = 'signup-prefix';
}

// 11. INFO SUFFIX
elseif (preg_match('#^(.+)-info$#i', $path, $matches)) {
    $eventSlug = $matches[1];
    $targetUrl = "$baseUrl?p=public&event=$eventSlug";
    $routeType = 'info-suffix';
}

// 12. EVENTS PREFIX
elseif (preg_match('#^events?/(.+)$#i', $path, $matches)) {
    // Matches: /events/event-slug, /event/event-slug
    $eventSlug = $matches[1];
    $targetUrl = "$baseUrl?p=public&event=$eventSlug";
    $routeType = 'events-prefix';
}

// 13. DEFAULT: PUBLIC EVENT PAGE
else {
    $eventSlug = $path;
    $targetUrl = "$baseUrl?p=public&event=$eventSlug";
    $routeType = 'public-event';
}

// ============================================================================
// APPEND QUERY STRING
// ============================================================================

if (!empty($queryString)) {
    $separator = (strpos($targetUrl, '?') !== false) ? '&' : '?';
    $targetUrl .= $separator . $queryString;
}

// ============================================================================
// DEBUG MODE
// ============================================================================

if ($debugMode) {
    echo "<!DOCTYPE html><html><head><title>zeventbooks.com Router Debug</title>";
    echo "<style>body{font-family:system-ui;max-width:800px;margin:2rem auto;padding:0 1rem;}";
    echo "h1{color:#c8102e;}h2{color:#00a651;margin-top:2rem;}";
    echo "table{border-collapse:collapse;width:100%;margin:1rem 0;}";
    echo "th,td{text-align:left;padding:0.5rem;border:1px solid #ddd;}";
    echo "th{background:#f5f1e8;font-weight:600;}";
    echo ".success{color:#00a651;}.warning{color:#fdb913;}.error{color:#c8102e;}";
    echo "code{background:#f5f1e8;padding:0.2rem 0.4rem;border-radius:3px;font-size:0.9em;}";
    echo "</style></head><body>";

    echo "<h1>🎯 zeventbooks.com Router Debug</h1>";

    echo "<h2>Request Info</h2>";
    echo "<table>";
    echo "<tr><th>Property</th><th>Value</th></tr>";
    echo "<tr><td><strong>Full Request URI</strong></td><td><code>$requestUri</code></td></tr>";
    echo "<tr><td><strong>Parsed Path</strong></td><td><code>/$path</code></td></tr>";
    echo "<tr><td><strong>Query String</strong></td><td><code>" . ($queryString ?: '(none)') . "</code></td></tr>";
    echo "</table>";

    echo "<h2>Routing Decision</h2>";
    echo "<table>";
    echo "<tr><th>Property</th><th>Value</th></tr>";
    echo "<tr><td><strong>Route Type</strong></td><td><span class='success'>$routeType</span></td></tr>";
    if ($eventSlug) echo "<tr><td><strong>Event Slug</strong></td><td><code>$eventSlug</code></td></tr>";
    if ($subpage) echo "<tr><td><strong>Subpage</strong></td><td><code>$subpage</code></td></tr>";
    echo "<tr><td><strong>Target URL</strong></td><td><a href='$targetUrl' target='_blank'>$targetUrl</a></td></tr>";
    echo "</table>";

    echo "<h2>Supported Patterns</h2>";
    echo "<ul>";
    echo "<li><strong>Admin:</strong> <code>/admin</code>, <code>/admin/settings</code></li>";
    echo "<li><strong>Display (Suffix):</strong> <code>/event-display</code>, <code>/event-display/scores</code></li>";
    echo "<li><strong>Display (Prefix):</strong> <code>/display/event</code>, <code>/display/event/scores</code></li>";
    echo "<li><strong>Poster (Suffix):</strong> <code>/event-poster</code>, <code>/event-poster/preview</code></li>";
    echo "<li><strong>Poster (Prefix):</strong> <code>/poster/event</code>, <code>/poster/event/preview</code></li>";
    echo "<li><strong>Signup (Suffix):</strong> <code>/event-signup</code>, <code>/event-signup/confirm</code></li>";
    echo "<li><strong>Signup (Prefix):</strong> <code>/signup/event</code>, <code>/signup/event/confirm</code></li>";
    echo "<li><strong>Public Event:</strong> <code>/event-slug</code>, <code>/events/event-slug</code></li>";
    echo "</ul>";

    echo "<h2>Continue</h2>";
    echo "<p><a href='$targetUrl' style='display:inline-block;background:#c8102e;color:white;padding:0.75rem 1.5rem;";
    echo "text-decoration:none;border-radius:8px;font-weight:600;'>→ Go to Target URL</a></p>";

    echo "</body></html>";
    exit;
}

// ============================================================================
// PRODUCTION REDIRECT
// ============================================================================

// Optional logging
// error_log("[zeventbooks.com] $routeType: /$path → $targetUrl");

header("Location: $targetUrl", true, 302);
exit;

// ============================================================================
// ROUTING EXAMPLES
// ============================================================================
/*

ADMIN ROUTES:
✅ /admin                           → ?p=admin
✅ /admin/settings                  → ?p=admin&subpage=settings
✅ /admin/users/edit/123            → ?p=admin&subpage=users/edit/123
✅ /ADMIN                           → ?p=admin (case-insensitive)

DISPLAY ROUTES (Both patterns supported):
✅ /fall-league-display             → ?p=display&event=fall-league
✅ /fall-league-display/scores      → ?p=display&event=fall-league&subpage=scores
✅ /fall-league-display/brackets    → ?p=display&event=fall-league&subpage=brackets
✅ /display/fall-league             → ?p=display&event=fall-league
✅ /display/fall-league/scores      → ?p=display&event=fall-league&subpage=scores

POSTER ROUTES (Both patterns supported):
✅ /fall-league-poster              → ?p=poster&event=fall-league
✅ /fall-league-poster/preview      → ?p=poster&event=fall-league&subpage=preview
✅ /fall-league-poster/print        → ?p=poster&event=fall-league&subpage=print
✅ /poster/fall-league              → ?p=poster&event=fall-league
✅ /poster/fall-league/preview      → ?p=poster&event=fall-league&subpage=preview

SIGNUP ROUTES (Both patterns supported):
✅ /fall-league-signup              → ?p=form&event=fall-league
✅ /fall-league-register            → ?p=form&event=fall-league (alias)
✅ /fall-league-signup/confirm      → ?p=form&event=fall-league&subpage=confirm
✅ /fall-league-signup/success      → ?p=form&event=fall-league&subpage=success
✅ /signup/fall-league              → ?p=form&event=fall-league
✅ /signup/fall-league/confirm      → ?p=form&event=fall-league&subpage=confirm
✅ /register/fall-league            → ?p=form&event=fall-league

PUBLIC EVENT ROUTES:
✅ /fall-league-2024                → ?p=public&event=fall-league-2024
✅ /events/spring-tournament        → ?p=public&event=spring-tournament
✅ /event/championship              → ?p=public&event=championship

SYSTEM ROUTES:
✅ /health                          → ?p=health
✅ /health/detailed                 → ?p=health&subpage=detailed
✅ /test                            → ?p=test
✅ /status                          → ?p=status

API ROUTES:
✅ /api                             → ?p=api&path=/api
✅ /api/events                      → ?p=api&path=/api/events
✅ /api/events/123                  → ?p=api&path=/api/events/123

BRAND SUPPORT (via query params):
✅ /admin?brand=root               → ?p=admin&brand=root
✅ /admin?brand=abc                → ?p=admin&brand=abc
✅ /admin/settings?brand=cbc       → ?p=admin&subpage=settings&brand=cbc

*/
?>
