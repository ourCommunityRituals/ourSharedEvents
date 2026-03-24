# Hostinger Proxy Files

> **DEPRECATED**: This proxy has been replaced by Cloudflare Workers.
> For new deployments, use `/cloudflare-proxy/` instead.
> See `/cloudflare-proxy/CLOUDFLARE_SETUP.md` for setup instructions.
>
> This directory is kept for reference only.

---

These files configure Hostinger to proxy requests from `zeventbooks.com` to your Google Apps Script deployment.

## Quick Start

### 1. Get Your Google Apps Script Deployment ID

```bash
# Option A: From clasp
npx clasp deployments

# Option B: From CI/CD logs
# Look for: "Created deployment: AKfycb..."

# Option C: From Stage 1 deployment summary in GitHub Actions
```

Example deployment ID: `AKfycbXXXXXXXXXXXXXXXXXXXXXXXXX`

### 2. Update index.php

Edit `index.php` and replace `YOUR_SCRIPT_ID`:

```php
// Before:
define('GOOGLE_SCRIPT_URL', 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec');

// After:
define('GOOGLE_SCRIPT_URL', 'https://script.google.com/macros/s/AKfycbXXXXXXXXXXXXXXXXXXXXXXXXX/exec');
```

### 3. Upload to Hostinger

**Via File Manager:**
1. Log into Hostinger
2. Go to **Websites** → **zeventbooks.com** → **File Manager**
3. Navigate to `public_html/` (or your website root)
4. Upload:
   - `index.php`
   - `.htaccess`
5. Set permissions to `644` for both files

**Via FTP:**
1. Connect to Hostinger via FTP
2. Navigate to `public_html/`
3. Upload both files
4. Set permissions to `644`

### 4. Test

```bash
# Test in browser
https://zeventbooks.com?p=status&brand=root

# Or with curl
curl -i https://zeventbooks.com?p=status&brand=root

# Expected: 200 OK with JSON response
{
  "ok": true,
  "value": {
    "build": "triangle-extended-v1.3",
    "brand": "root",
    ...
  }
}
```

### 5. Run Automated Tests

```bash
# From your local machine
npm run test:hostinger:api
npm run test:hostinger:smoke
npm run test:hostinger:all
```

## What Each File Does

### index.php
- Receives all requests to zeventbooks.com
- Forwards them to your Google Apps Script URL
- Preserves all query parameters (?p=status&brand=root)
- Handles GET and POST requests
- Returns responses back to the client

### .htaccess
- Routes all requests to index.php
- Forces HTTPS (security)
- Enables compression (performance)
- Sets security headers
- Handles CORS preflight requests

## Supported URLs

All these URLs work automatically:

```bash
# Status pages
https://zeventbooks.com?p=status&brand=root
https://zeventbooks.com?p=status&brand=abc
https://zeventbooks.com?p=status&brand=cbc

# Admin pages
https://zeventbooks.com?p=admin&brand=root
https://zeventbooks.com?p=admin&brand=abc
https://zeventbooks.com?p=admin&brand=cbc

# Events pages
https://zeventbooks.com?p=events&brand=root
https://zeventbooks.com?p=events&brand=abc
https://zeventbooks.com?p=events&brand=cbc

# Display pages
https://zeventbooks.com?p=display&brand=root
https://zeventbooks.com?p=display&brand=abc

# API endpoints
https://zeventbooks.com?p=api&action=list&brandId=root&scope=events
```

## Troubleshooting

### "500 Internal Server Error"

**Check PHP version:**
- Hostinger Panel → **Advanced** → **PHP Configuration**
- Set to PHP 7.4 or higher

**Check error logs:**
- Hostinger Panel → **Advanced** → **Error Logs**

**Enable debug mode:**
Uncomment the debug section at bottom of `index.php`:

```php
// Enable this:
$logFile = __DIR__ . '/proxy-debug.log';
$logEntry = sprintf(...);
file_put_contents($logFile, $logEntry, FILE_APPEND);
```

Then check `proxy-debug.log` in File Manager.

### "404 Not Found"

**Check file locations:**
- `index.php` should be in website root (usually `public_html/`)
- `.htaccess` should be in same directory

**Check .htaccess is enabled:**
- Hostinger usually has this enabled by default
- If not working, contact Hostinger support

### "Blank Page / No Response"

**Check that cURL is enabled:**
1. Create `phpinfo.php`:
```php
<?php phpinfo(); ?>
```
2. Upload to website root
3. Visit `https://zeventbooks.com/phpinfo.php`
4. Search for "cURL" - should show "enabled"
5. Delete `phpinfo.php` when done (security)

**Check Google Apps Script URL:**
- Make sure deployment ID is correct
- Test the script URL directly in browser
- Should return JSON, not HTML error page

### Query Parameters Not Working

**Verify .htaccess has QSA flag:**
```apache
RewriteRule ^(.*)$ index.php [QSA,L]
#                              ^^^
#                    Query String Append
```

**Test parameter passing:**
Add to `index.php` before cURL:
```php
error_log('Query string: ' . $queryString);
error_log('Target URL: ' . $targetUrl);
```

Check error logs to see what's being sent.

## Performance Tips

### Enable caching (if your API supports it)

Add cache headers in `index.php`:

```php
// After checking HTTP code, before echo:
if ($httpCode === 200) {
    header('Cache-Control: public, max-age=300'); // 5 minutes
}
```

### Monitor response times

Add timing to debug log:

```php
$startTime = microtime(true);
// ... cURL execution ...
$duration = round((microtime(true) - $startTime) * 1000, 2);
error_log("Request took {$duration}ms");
```

## Security Checklist

- ✅ HTTPS enforced (.htaccess)
- ✅ Security headers set (.htaccess)
- ✅ Directory listing disabled (.htaccess)
- ✅ Sensitive files protected (.htaccess)
- ✅ CORS properly configured (index.php)
- ✅ Error messages don't expose sensitive info
- ⚠️ Consider adding rate limiting (see main docs)
- ⚠️ Consider IP whitelisting for admin operations

## Next Steps

1. ✅ Upload files to Hostinger
2. ✅ Update Google Apps Script URL
3. ✅ Test all brand URLs
4. ✅ Run automated test suite
5. ⏭️ Set up monitoring
6. ⏭️ Configure custom error pages
7. ⏭️ Add rate limiting

## Need Help?

**Note**: Hostinger setup documentation has been archived. See [docs/archived/](../docs/archived/) for historical reference.

For current deployment, use Cloudflare Workers: [cloudflare-proxy/CLOUDFLARE_SETUP.md](../cloudflare-proxy/CLOUDFLARE_SETUP.md)
