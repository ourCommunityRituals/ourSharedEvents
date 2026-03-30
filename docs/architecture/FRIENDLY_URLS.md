# Customer-Friendly URL System

## Overview

The friendly URL system makes your app URLs easy to remember, share, and understand. Instead of technical query parameters like `?p=admin&mode=advanced&brand=abc`, users can access pages with clean, descriptive URLs like `/abc/manage` or `/events`.

**Business Benefits:**
- ✅ Easy to remember and share
- ✅ SEO-friendly structure
- ✅ Professional appearance
- ✅ Brand-specific paths per brand
- ✅ Works alongside existing query parameter URLs (backward compatible)

---

## URL Patterns

### Pattern 1: Global Aliases
```
/events        → Public events page (root brand)
/display       → TV/kiosk display (root brand)
/manage        → Admin management interface (root brand)
/posters       → Event posters (root brand)
/analytics     → Analytics dashboard (root brand)
```

### Pattern 2: Brand-Specific Aliases
```
/abc/events    → Public events for American Bocce Co.
/abc/manage    → Admin for American Bocce Co.
/cbc/display   → Display for Chicago Bocce Club
/cbc/create    → Create event (Chicago Bocce Club)
```

### Pattern 3: Custom Brand Aliases
```
/abc/tournaments  → Custom alias for ABC events
/abc/bocce        → Custom alias for ABC events
/cbc/club-events  → Custom alias for CBC events
/cbc/register     → Custom alias for CBC wizard
```

---

## Quick Reference Table

### All Global Aliases

| URL | Page File | Purpose | Auth |
|-----|-----------|---------|------|
| `/events` | Public.html | View all events | No |
| `/schedule` | Public.html | View all events (alias) | No |
| `/calendar` | Public.html | View all events (alias) | No |
| `/manage` | Admin.html | Full admin dashboard | Yes |
| `/admin` | Admin.html | Full admin dashboard (alias) | Yes |
| `/dashboard` | Admin.html | Admin dashboard | Yes |
| `/create` | Admin.html | Create event (routes to Admin) | Yes |
| `/display` | Display.html | TV/kiosk slideshow | No |
| `/tv` | Display.html | TV display (alias) | No |
| `/kiosk` | Display.html | Kiosk mode (alias) | No |
| `/screen` | Display.html | Screen display (alias) | No |
| `/posters` | Poster.html | Print marketing materials | No |
| `/poster` | Poster.html | Event poster (alias) | No |
| `/flyers` | Poster.html | Marketing flyers (alias) | No |
| `/analytics` | SharedReport.html | View reports/stats | Yes |
| `/reports` | SharedReport.html | Reports (alias) | Yes |
| `/insights` | SharedReport.html | Insights (alias) | Yes |
| `/stats` | SharedReport.html | Statistics (alias) | Yes |
| `/status` | JSON response | Health check/status | No |
| `/health` | JSON response | Health check (alias) | No |
| `/docs` | ApiDocs.html | API documentation | No |
| `/api` | ApiDocs.html | API docs (alias) | No |

### Brand Custom Aliases

| Brand | URL | Page File | Purpose | Auth |
|-------|-----|-----------|---------|------|
| abc | `/abc/tournaments` | Public.html | Tournament events | No |
| abc | `/abc/leagues` | Public.html | League events | No |
| abc | `/abc/bocce` | Public.html | Bocce events | No |
| abc | `/abc/network` | SharedReport.html | Network analytics | Yes |
| cbc | `/cbc/tournaments` | Public.html | CBC tournaments | No |
| cbc | `/cbc/club-events` | Public.html | Club events | No |
| cbc | `/cbc/register` | Admin.html | Register event | Yes |
| cbl | `/cbl/seasons` | Public.html | Seasonal events | No |
| cbl | `/cbl/league-events` | Public.html | League events | No |
| cbl | `/cbl/schedule` | Public.html | Schedule | No |

---

## Brand-Specific Custom Aliases

Configured in `Config.gs` → `ZEB.BRAND_URL_PATTERNS.customAliases`:

### American Bocce Co. (abc)
```javascript
customAliases: {
  'abc': {
    'tournaments': { page: 'public', label: 'Tournaments' },
    'bocce': { page: 'public', label: 'Bocce Events' }
  }
}
```

**URLs:**
- `/abc/tournaments` → Public events for ABC
- `/abc/bocce` → Public events for ABC

### Chicago Bocce Club (cbc)
```javascript
customAliases: {
  'cbc': {
    'club-events': { page: 'public', label: 'Club Events' },
    'register': { page: 'wizard', label: 'Register Event' }  // Routes to Admin.html
  }
}
```

**URLs:**
- `/cbc/club-events` → Public events for CBC
- `/cbc/register` → Admin page for CBC (auth required)

---

## Real-World Examples

### For Customers/End Users

**Before (Technical):**
```
https://eventangle.com?p=public&brand=abc
https://eventangle.com?p=display&brand=cbc
https://eventangle.com?p=admin&mode=advanced&brand=abc
```

**After (Friendly):**
```
https://eventangle.com/abc/events
https://eventangle.com/cbc/display
https://eventangle.com/abc/manage
```

### For Marketing Materials

**Print Flyers:**
```
Visit our events page:
eventangle.com/abc/events

Scan QR code or visit:
eventangle.com/abc/tournaments
```

**TV Display Setup:**
```
Setup Instructions:
1. Navigate to: eventangle.com/cbc/display
2. Let it run in fullscreen
3. Events will auto-rotate
```

**Email to Event Managers:**
```
Manage your events at:
eventangle.com/abc/manage

Create a new event:
eventangle.com/abc/create
```

---

## Configuration

### Adding Global Aliases

Edit `Config.gs` → `ZEB.URL_ALIASES`:

```javascript
URL_ALIASES: {
  // Add your custom alias
  'my-alias': {
    page: 'public',           // Technical page name
    label: 'My Alias',        // Display label
    public: true              // Requires auth? true/false
  }
}
```

### Adding Brand Custom Aliases

Edit `Config.gs` → `ZEB.BRAND_URL_PATTERNS.customAliases`:

```javascript
BRAND_URL_PATTERNS: {
  customAliases: {
    'abc': {
      'my-custom-url': {
        page: 'public',
        label: 'Custom Page'
      }
    }
  }
}
```

### Enabling/Disabling Features

```javascript
BRAND_URL_PATTERNS: {
  enableBrandPrefix: true,      // Enable /brand/alias URLs
  enableSubdomainRouting: false  // Enable subdomain routing (requires DNS)
}
```

---

## Developer Functions

### Resolve URL Alias
```javascript
// Get configuration for an alias
const config = resolveUrlAlias_('events');
// Returns: { page: 'public', label: 'Events', public: true, source: 'global' }

const config2 = resolveUrlAlias_('tournaments', 'abc');
// Returns: { page: 'public', label: 'Tournaments', source: 'brand-custom' }
```

### Generate Friendly URL
```javascript
// Generate friendly URL for a page
const url = getFriendlyUrl_('public', 'abc');
// Returns: "/abc/events"

const url2 = getFriendlyUrl_('admin', 'cbc', { mode: 'advanced' });
// Returns: "/cbc/manage"

const url3 = getFriendlyUrl_('display', 'root');
// Returns: "/display"
```

### List All Aliases
```javascript
// Get all available aliases for a brand
const aliases = listUrlAliases_('abc');
// Returns array of all global + abc custom aliases

// Get only public aliases
const publicAliases = listUrlAliases_('abc', true);
// Returns only public-facing aliases
```

---

## How It Works

### URL Processing Flow

1. **Request comes in:** `/abc/events`

2. **Router parses path:**
   - Extracts: `brand = 'abc'`, `alias = 'events'`

3. **Resolves alias:**
   - Checks brand custom aliases first
   - Falls back to global aliases
   - Returns: `{ page: 'public', label: 'Events' }`

4. **Routes to page:**
   - Calls `routePage_()` with resolved configuration
   - Renders page with brand context

5. **Page loads:** Public events page for ABC brand

### Backward Compatibility

Old query parameter URLs still work:
```
?p=admin&brand=abc&mode=advanced  ← Still works!
/abc/manage                        ← New friendly URL
```

Both route to the same page.

---

## Use Cases

### 1. Marketing & Promotions
```
Print materials: eventangle.com/abc/events
QR codes: eventangle.com/abc/tournaments
Social media: eventangle.com/cbc/schedule
```

### 2. TV/Kiosk Displays
```
Simple setup URL: eventangle.com/cbc/display
Easy to type, no query parameters needed
```

### 3. Admin Training
```
"Just go to /manage to create events"
"View analytics at /analytics"
Clear, memorable instructions
```

### 4. Multi-brand Branding
```
Each brand gets branded URLs:
- americanbocceco.com → eventangle.com/abc/events
- chicagoboccclub.org → eventangle.com/cbc/events
```

---

## Testing

### Test Friendly URLs

```bash
# Public events
curl https://eventangle.com/abc/events

# Admin interface
curl https://eventangle.com/abc/manage

# Display page
curl https://eventangle.com/cbc/display

# Custom brand alias
curl https://eventangle.com/abc/tournaments

# With demo mode
curl https://eventangle.com/abc/events?demo=true
```

### Verify Alias Resolution

```javascript
// In Apps Script console or test
Logger.log(resolveUrlAlias_('events'));
Logger.log(resolveUrlAlias_('tournaments', 'abc'));
Logger.log(getFriendlyUrl_('public', 'abc'));
Logger.log(listUrlAliases_('abc', true));
```

---

## Best Practices

### ✅ Do's

- **Use descriptive aliases:** `/events`, `/manage`, `/display`
- **Keep URLs short:** `/abc/events` better than `/abc/event-schedule-calendar`
- **Be consistent:** Use same patterns across brands
- **Document custom aliases:** Add comments in Config.gs
- **Test thoroughly:** Verify all aliases work before sharing

### ❌ Don'ts

- **Don't use special characters:** Stick to letters, numbers, hyphens
- **Don't duplicate aliases:** Each alias should be unique per brand
- **Don't break old URLs:** Keep backward compatibility
- **Don't make them too long:** Keep URLs under 50 characters
- **Don't use technical jargon:** "events" not "api-get-events-list"

---

## Troubleshooting

### URL Not Working?

1. **Check alias exists:** Look in `ZEB.URL_ALIASES` or brand `customAliases`
2. **Verify brand ID:** Make sure brand exists in `BRANDS` array
3. **Test with query params:** Try `?p=public&brand=abc` to isolate routing
4. **Check console logs:** Look for routing errors in Apps Script logs

### How to Debug

```javascript
// Add to doGet for debugging
Logger.log('Path Info:', e.pathInfo);
Logger.log('Resolved Alias:', resolveUrlAlias_(aliasFromPath, brand.id));
Logger.log('Final Page:', page);
```

---

## Migration from Query Parameters

### Gradual Rollout

1. **Add aliases** to Config.gs
2. **Test thoroughly** with new URLs
3. **Update marketing materials** gradually
4. **Keep old URLs working** (automatic)
5. **Monitor analytics** for adoption

### Communication Template

```
Subject: New Easier URLs!

We've simplified our event URLs:

OLD: eventangle.com?p=public&brand=abc
NEW: eventangle.com/abc/events ✨

Both URLs work - use whichever you prefer!

New URLs for quick access:
- View events: /abc/events
- Manage events: /abc/manage
- Display on TV: /abc/display

Bookmarks and old links still work!
```

---

## Future Enhancements

### Subdomain Routing (Planned)
```
abc.eventangle.com/events
cbc.eventangle.com/display
```

Requires DNS configuration - set `enableSubdomainRouting: true` when ready.

### Short Link Integration
```
eventangle.com/e/summer-tournament → Event detail page
eventangle.com/s/abc123 → Shortlink redirect
```

Already supported via `/e/` and `/s/` patterns.

---

## Summary

**Customer-friendly URLs are now live in production!**

✅ Easy to remember: `/abc/events`
✅ Easy to share: `/abc/manage`
✅ Easy to brand: `/abc/tournaments`
✅ Fully backward compatible
✅ Configurable per brand

**Next Steps:**
1. Test your aliases: [https://eventangle.com/abc/events](https://eventangle.com/abc/events)
2. Add custom aliases for your brands in `Config.gs`
3. Update marketing materials with new URLs
4. Enjoy cleaner, more professional URLs!
