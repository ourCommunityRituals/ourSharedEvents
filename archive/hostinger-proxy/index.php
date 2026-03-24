<?php
/**
 * Hostinger Proxy to Google Apps Script
 *
 * Routes all requests from zeventbooks.com to Google Apps Script
 * while preserving query parameters and maintaining the clean URL
 *
 * Setup Instructions:
 * 1. Replace YOUR_SCRIPT_ID below with your actual Google Apps Script deployment ID
 * 2. Upload this file to your Hostinger website root (public_html/)
 * 3. Upload the accompanying .htaccess file
 * 4. Test with: https://zeventbooks.com?p=status&brand=root
 */

// ============================================================================
// CONFIGURATION - UPDATE THIS WITH YOUR GOOGLE APPS SCRIPT DEPLOYMENT ID
// ============================================================================

define('GOOGLE_SCRIPT_URL', 'https://script.google.com/macros/s/AKfycby355Xo-XVv3ibfYsf9SUPQo0rGvBS3ex1sNvfpiQ6g/exec');

// ✅ CONFIGURED: Using current deployment
// Deployment ID: AKfycby355Xo-XVv3ibfYsf9SUPQo0rGvBS3ex1sNvfpiQ6g
// Last updated: 2025-11-16
// If you need to update this, run: npx clasp deployments

// ============================================================================
// PROXY LOGIC - NO NEED TO MODIFY BELOW THIS LINE
// ============================================================================

// Get the current query string (everything after ?)
$queryString = $_SERVER['QUERY_STRING'] ?? '';

// Build the full target URL
$targetUrl = GOOGLE_SCRIPT_URL;
if ($queryString) {
    $targetUrl .= '?' . $queryString;
}

// Initialize cURL for making the proxy request
$ch = curl_init();

// Configure cURL options
curl_setopt_array($ch, [
    CURLOPT_URL => $targetUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTPHEADER => [
        'User-Agent: ' . ($_SERVER['HTTP_USER_AGENT'] ?? 'Zeventbooks-Proxy'),
        'Accept: ' . ($_SERVER['HTTP_ACCEPT'] ?? 'text/html,application/json'),
    ],
]);

// For POST requests, forward the request body
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $postData = file_get_contents('php://input');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);

    // Forward Content-Type header for JSON requests
    if (isset($_SERVER['CONTENT_TYPE'])) {
        $headers = curl_getopt($ch, CURLOPT_HTTPHEADER);
        $headers[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    }
}

// Execute the proxied request
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);

// Handle cURL errors
if (curl_errno($ch)) {
    http_response_code(502); // Bad Gateway
    header('Content-Type: application/json');
    echo json_encode([
        'ok' => false,
        'code' => 'PROXY_ERROR',
        'message' => 'Unable to connect to backend service',
        'error' => curl_error($ch)
    ]);
    curl_close($ch);
    exit;
}

curl_close($ch);

// Forward the response to the client
http_response_code($httpCode);

// Set content type from backend
if ($contentType) {
    header('Content-Type: ' . $contentType);
}

// Add CORS headers to allow cross-origin requests
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

// Handle preflight OPTIONS requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204); // No Content
    exit;
}

// Output the proxied response
echo $response;

// ============================================================================
// DEBUG MODE (uncomment to enable logging)
// ============================================================================

// Uncomment these lines to enable debug logging:
/*
$logFile = __DIR__ . '/proxy-debug.log';
$logEntry = sprintf(
    "[%s] %s %s → %s (Status: %d)\n",
    date('Y-m-d H:i:s'),
    $_SERVER['REQUEST_METHOD'],
    $_SERVER['REQUEST_URI'],
    $targetUrl,
    $httpCode
);
file_put_contents($logFile, $logEntry, FILE_APPEND);
*/
?>
