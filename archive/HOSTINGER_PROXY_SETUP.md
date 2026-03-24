# Hostinger Proxy Setup Guide

This guide explains how to configure Hostinger to proxy requests from `zeventbooks.com` to your Google Apps Script deployment.

## Goal

Route requests from:
```
https://zeventbooks.com?p=status&brand=root
```

To your Google Apps Script URL:
```
https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?p=status&brand=root
```

While keeping `zeventbooks.com` visible in the browser (not redirecting).

## Setup Options

### Option 1: PHP Proxy Script (Recommended for Hostinger)

This is the most reliable approach for shared Hostinger hosting.

#### Step 1: Create proxy script

Create `index.php` in your Hostinger website root:

```php
<?php
/**
 * Hostinger Proxy to Google Apps Script
 * Proxies all requests to Google Apps Script while preserving query parameters
 */

// Your Google Apps Script deployment URL
define('GOOGLE_SCRIPT_URL', 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec');

// Get the current query string
$queryString = $_SERVER['QUERY_STRING'] ?? '';

// Build the full target URL
$targetUrl = GOOGLE_SCRIPT_URL;
if ($queryString) {
    $targetUrl .= '?' . $queryString;
}

// Initialize cURL
$ch = curl_init();

// Set cURL options
curl_setopt_array($ch, [
    CURLOPT_URL => $targetUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTPHEADER => [
        'User-Agent: ' . ($_SERVER['HTTP_USER_AGENT'] ?? 'Hostinger-Proxy'),
        'Accept: ' . ($_SERVER['HTTP_ACCEPT'] ?? 'text/html,application/json'),
    ],
]);

// For POST requests, forward the body
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $postData = file_get_contents('php://input');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);

    // Forward Content-Type header
    if (isset($_SERVER['CONTENT_TYPE'])) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, array_merge(
            curl_getopt($ch, CURLOPT_HTTPHEADER),
            ['Content-Type: ' . $_SERVER['CONTENT_TYPE']]
        ));
    }
}

// Execute the request
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);

// Check for errors
if (curl_errno($ch)) {
    http_response_code(502); // Bad Gateway
    header('Content-Type: application/json');
    echo json_encode([
        'ok' => false,
        'error' => 'Proxy Error',
        'message' => curl_error($ch)
    ]);
    curl_close($ch);
    exit;
}

curl_close($ch);

// Forward the response
http_response_code($httpCode);
if ($contentType) {
    header('Content-Type: ' . $contentType);
}

// Add CORS headers if needed
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

echo $response;
?>
```

#### Step 2: Configure .htaccess

Create/update `.htaccess` in the same directory:

```apache
# Rewrite engine
RewriteEngine On

# Force HTTPS
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

# Route all requests to index.php (except actual files)
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)$ index.php [QSA,L]

# Handle CORS preflight
RewriteCond %{REQUEST_METHOD} OPTIONS
RewriteRule ^(.*)$ index.php [QSA,L]
```

#### Step 3: Update your Google Apps Script deployment ID

In `index.php`, replace `YOUR_SCRIPT_ID` with your actual deployment ID:

```php
define('GOOGLE_SCRIPT_URL', 'https://script.google.com/macros/s/AKfycbXXXXXXXXXXX/exec');
```

#### Step 4: Test the setup

```bash
# Test status endpoint
curl https://zeventbooks.com?p=status&brand=root

# Test admin page
curl https://zeventbooks.com?p=admin&brand=abc

# Test POST request (create event)
curl -X POST https://zeventbooks.com?action=create \
  -H "Content-Type: application/json" \
  -d '{"brandId":"root","scope":"events",...}'
```

---

### Option 2: Hostinger Redirects (Simple but Visible)

If you just want simple redirects (URL will change in browser to show script.google.com):

**In Hostinger Panel → Redirects:**

1. **Type:** Permanent (301)
2. **From:** `zeventbooks.com`
3. **To:** `https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec`
4. **Forward Parameters:** ✅ Enabled
5. **Wildcard Redirect:** ✅ Enabled

**Pros:**
- Very easy to set up
- No coding required

**Cons:**
- ❌ URL changes in browser (users see script.google.com)
- ❌ Not a true proxy
- ❌ May affect SEO
- ❌ Less professional appearance

---

### Option 3: Reverse Proxy (Advanced - VPS Only)

If you have a VPS plan, you can set up nginx or Apache reverse proxy.

**Nginx Configuration:**

```nginx
server {
    listen 80;
    server_name zeventbooks.com www.zeventbooks.com;

    # Force HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name zeventbooks.com www.zeventbooks.com;

    # SSL Configuration (Hostinger provides this)
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Proxy to Google Apps Script
    location / {
        proxy_pass https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec;
        proxy_set_header Host script.google.com;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Handle redirects
        proxy_redirect off;

        # Timeouts
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
}
```

**Note:** This requires VPS/Cloud hosting, not available on shared hosting.

---

## Configuration for Multi-brand Setup

Your application already supports multi-brand URLs correctly:

### URL Structure

```
https://zeventbooks.com?p={page}&brand={brand}
```

### All Pages Work Automatically

| Page | Example URL |
|------|-------------|
| Status | `https://zeventbooks.com?p=status&brand=root` |
| Admin | `https://zeventbooks.com?p=admin&brand=abc` |
| Events | `https://zeventbooks.com?p=events&brand=cbc` |
| Display | `https://zeventbooks.com?p=display&brand=root` |
| Poster | `https://zeventbooks.com?p=poster&brand=abc` |
| Report | `https://zeventbooks.com?p=report&brand=cbc` |

### All Brands Work Automatically

No additional configuration needed! The proxy passes all query parameters:

```bash
# Root brand
https://zeventbooks.com?p=admin&brand=root
  → https://script.google.com/.../exec?p=admin&brand=root

# ABC brand
https://zeventbooks.com?p=status&brand=abc
  → https://script.google.com/.../exec?p=status&brand=abc

# CBC brand
https://zeventbooks.com?p=events&brand=cbc
  → https://script.google.com/.../exec?p=events&brand=cbc
```

---

## Deployment Steps (PHP Proxy - Recommended)

### 1. Access Hostinger File Manager

1. Log into Hostinger
2. Go to **Websites** → **zeventbooks.com**
3. Click **File Manager**
4. Navigate to `public_html/` (or your website root)

### 2. Upload Files

**Create `index.php`:**
- Click **New File**
- Name: `index.php`
- Paste the PHP proxy code above
- Update `YOUR_SCRIPT_ID` with your actual script ID
- Save

**Create/Update `.htaccess`:**
- If exists: Edit it
- If not: Create new file named `.htaccess`
- Paste the htaccess code above
- Save

### 3. Set Permissions

- Right-click `index.php` → Permissions → `644`
- Right-click `.htaccess` → Permissions → `644`

### 4. Get Your Script ID

Find your Google Apps Script deployment ID:

```bash
# From your CI/CD deployment logs
# Look for: "Created deployment: AKfycb..."

# Or from clasp deployments:
npx clasp deployments
# Example output: AKfycbXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 5. Update index.php

Replace this line:
```php
define('GOOGLE_SCRIPT_URL', 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec');
```

With your actual URL:
```php
define('GOOGLE_SCRIPT_URL', 'https://script.google.com/macros/s/AKfycbXXXXXXXXXXXXXXXXXXXXXXXXX/exec');
```

### 6. Test

```bash
# Test in browser
https://zeventbooks.com?p=status&brand=root

# Or with curl
curl -i https://zeventbooks.com?p=status&brand=root
```

Expected response:
```json
{
  "ok": true,
  "value": {
    "build": "triangle-extended-v1.3",
    "brand": "root",
    ...
  }
}
```

---

## Automated Testing After Setup

Once configured, run tests against Hostinger:

```bash
# Print environment (should detect Hostinger)
npm run test:env:print

# Run API tests
npm run test:hostinger:api

# Run smoke tests
npm run test:hostinger:smoke

# Run all E2E tests
npm run test:hostinger:all
```

---

## Troubleshooting

### 1. 500 Internal Server Error

**Check PHP error logs:**
- Hostinger Panel → **Advanced** → **Error Logs**
- Look for PHP errors

**Common fixes:**
- Ensure cURL is enabled in PHP
- Check file permissions (644 for files)
- Verify `.htaccess` syntax

### 2. 404 Not Found

**Check:**
- `.htaccess` is in the correct directory
- Rewrite rules are correct
- `index.php` exists

**Fix:**
```apache
# Add to .htaccess if missing
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)$ index.php [QSA,L]
```

### 3. Blank Page

**Check:**
- PHP version (should be 7.4+)
- Error logs for PHP errors
- That your Google Apps Script URL is correct

**Debug:**
Add to top of `index.php`:
```php
ini_set('display_errors', 1);
error_reporting(E_ALL);
```

### 4. CORS Errors

**Add to index.php (before the echo):**
```php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
```

### 5. Query Parameters Not Working

**Verify .htaccess has QSA flag:**
```apache
RewriteRule ^(.*)$ index.php [QSA,L]
#                              ^^^
#                         Query String Append
```

### 6. POST Requests Fail

**Check that PHP is reading input:**
```php
// In index.php, add debug logging
$postData = file_get_contents('php://input');
error_log('POST data: ' . $postData);
```

---

## Security Considerations

### 1. Rate Limiting

Add to `index.php` before the proxy logic:

```php
// Simple rate limiting (100 requests per minute per IP)
$ip = $_SERVER['REMOTE_ADDR'];
$rateLimit = 100;
$timeWindow = 60; // seconds

// Implementation depends on your storage (file, Redis, etc.)
// This is a basic file-based example
$rateLimitFile = sys_get_temp_dir() . '/rate_limit_' . md5($ip);
$requests = file_exists($rateLimitFile) ? json_decode(file_get_contents($rateLimitFile), true) : [];
$now = time();

// Clean old requests
$requests = array_filter($requests, function($timestamp) use ($now, $timeWindow) {
    return ($now - $timestamp) < $timeWindow;
});

// Check limit
if (count($requests) >= $rateLimit) {
    http_response_code(429); // Too Many Requests
    die(json_encode(['ok' => false, 'code' => 'RATE_LIMITED']));
}

// Add current request
$requests[] = $now;
file_put_contents($rateLimitFile, json_encode($requests));
```

### 2. Logging

Add request logging:

```php
// Log all requests
$logFile = '/path/to/logs/proxy.log';
$logEntry = sprintf(
    "[%s] %s %s?%s from %s\n",
    date('Y-m-d H:i:s'),
    $_SERVER['REQUEST_METHOD'],
    $_SERVER['REQUEST_URI'],
    $_SERVER['QUERY_STRING'],
    $_SERVER['REMOTE_ADDR']
);
file_put_contents($logFile, $logEntry, FILE_APPEND);
```

### 3. HTTPS Only

Enforce HTTPS in `.htaccess`:

```apache
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

---

## Performance Optimization

### 1. Enable Caching

Add to `.htaccess`:

```apache
# Cache static assets (if any)
<IfModule mod_expires.c>
    ExpiresActive On
    ExpiresByType image/jpg "access plus 1 year"
    ExpiresByType image/jpeg "access plus 1 year"
    ExpiresByType image/png "access plus 1 year"
    ExpiresByType image/gif "access plus 1 year"
    ExpiresByType text/css "access plus 1 month"
    ExpiresByType application/javascript "access plus 1 month"
</IfModule>
```

### 2. Enable Compression

Add to `.htaccess`:

```apache
# Gzip compression
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css application/javascript application/json
</IfModule>
```

### 3. Connection Keep-Alive

In `index.php` cURL options:

```php
CURLOPT_TCP_KEEPALIVE => 1,
CURLOPT_TCP_KEEPIDLE => 120,
CURLOPT_TCP_KEEPINTVL => 60,
```

---

## Monitoring

### Check Proxy Health

Create `health.php`:

```php
<?php
$scriptUrl = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?p=status&brand=root';
$ch = curl_init($scriptUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$healthy = ($httpCode === 200);

http_response_code($healthy ? 200 : 503);
header('Content-Type: application/json');

echo json_encode([
    'healthy' => $healthy,
    'script_status_code' => $httpCode,
    'timestamp' => date('c')
]);
?>
```

Test: `https://zeventbooks.com/health.php`

---

## Next Steps

1. ✅ Set up PHP proxy script on Hostinger
2. ✅ Update Google Apps Script URL in `index.php`
3. ✅ Test all brand URLs manually
4. ✅ Run automated test suite: `npm run test:hostinger:all`
5. ✅ Set up monitoring/alerts
6. ✅ Configure custom error pages
7. ✅ Add rate limiting and security measures

## Related Documentation

- [Multi-Environment Testing](./TESTING_MULTI_ENVIRONMENT.md)
- [Hostinger Deployment Strategy](./HOSTINGER_DEPLOYMENT_STRATEGY.md)
- [Testing Environment Variables](./TESTING_ENV_VARIABLES.md)
