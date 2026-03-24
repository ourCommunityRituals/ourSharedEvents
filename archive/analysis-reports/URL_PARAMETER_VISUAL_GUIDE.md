# URL Parameter Handling - Visual Guide & Quick Reference

## The Critical Issue at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│                    WHITE SCREEN ROOT CAUSE                       │
├─────────────────────────────────────────────────────────────────┤
│ File: HeaderInit.html, Line 8                                    │
│                                                                  │
│ CURRENT (BROKEN):                                               │
│ const logoUrl = '<?= findBrand_(brandId)?.logoUrl || "..." ?>';  │
│                      ↑                                           │
│          Function not available in template scope               │
│                                                                  │
│ FIXED (SAFE):                                                   │
│ const logoUrl = '<?= brand?.logoUrl || "..." ?>';               │
│                      ↑                                           │
│          Uses object passed in template context                 │
│                                                                  │
│ Why it matters:                                                  │
│  - Templates included via include() have limited scope           │
│  - Only receives variables passed in context object             │
│  - findBrand_() function is NOT in context                      │
│  - brand object IS in context (passed at Code.gs:420)           │
└─────────────────────────────────────────────────────────────────┘
```

## Parameter Flow Chart

```
                         ┌──────────────────┐
                         │  HTTP Request    │
                         └────────┬─────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
              Query Parameter            Friendly URL
              (?p=admin&brand=abc)       (/abc/manage)
                    │                           │
                    └──────────────┬────────────┘
                                   │
                         ┌─────────▼──────────┐
                         │  doGet() Function  │
                         │  Code.gs:233-362   │
                         └─────────┬──────────┘
                                   │
                ┌──────────────────┼──────────────────┐
                │                  │                  │
         Extract Parameters    Route Decision     Validate Brand
         - page/p             - Check action         - By hostname
         - brand             - Check alias          - By param
         - scope             - Check special page   - Default to root
         - action
                │                  │                  │
                └──────────────┬───┴──────────────────┘
                               │
                    ┌──────────▼────────────┐
                    │ Call routePage_()     │
                    │ Code.gs:375-429       │
                    └──────────┬─────────────┘
                               │
                    ┌──────────▼────────────┐
                    │ Load HTML Template    │
                    │ pageFile_(page) →     │
                    │ createTemplateFromFile│
                    └──────────┬─────────────┘
                               │
         ┌─────────────────────┴─────────────────────┐
         │                                           │
    Set Variables                            Set Context
    - appTitle                                - For include()
    - brandId                                 - Pass to globals
    - scope                              global_setTemplateContext_()
    - execUrl                                 │
    - ZEB                          ┌──────────▼────────┐
    - demoMode                     │ Template renders  │
    - brand ◄─────────────────────┤ <?= brand.logoUrl │
                                   │    works! ✓       │
                                   └──────────────────┘
                               │
                    ┌──────────▼─────────────┐
                    │ Return HTML to Browser │
                    └───────────────────────┘
```

## Parameter Reference Table

```
┌─────────────────────────────────────────────────────────────────┐
│              QUERY PARAMETER REFERENCE                           │
├──────────┬─────────────────────┬──────────────────────────────────┤
│Parameter │ Values              │ Example                          │
├──────────┼─────────────────────┼──────────────────────────────────┤
│ p/page   │ public, admin, etc. │ ?p=admin                         │
│ brand    │ root, abc, cbc, cbl │ ?brand=abc                       │
│ action   │ status, docs, etc.  │ ?action=status                   │
│ scope    │ events, sponsors    │ ?scope=sponsors                  │
│ mode     │ advanced, enhanced  │ ?mode=advanced                   │
│ demo     │ true               │ ?demo=true                       │
│ test     │ true               │ ?test=true                       │
│ t/token  │ shortlink token     │ ?p=redirect&t=abc123             │
└──────────┴─────────────────────┴──────────────────────────────────┘
```

## URL Pattern Examples

```
┌─────────────────────────────────────────────────────────────────┐
│                 QUERY PARAMETER PATTERNS                         │
├─────────────────────────────────────────────────────────────────┤
│ /                          → Public page, root brand             │
│ /?p=public                 → Explicit public page                │
│ /?p=admin                  → Admin (→ wizard mode)               │
│ /?p=admin&mode=advanced    → Admin advanced mode                 │
│ /?p=admin&brand=abc        → Admin for brand 'abc'               │
│ /?brand=abc                → Public for brand 'abc'              │
│ /?scope=sponsors           → Sponsors scope                      │
│ /?p=status                 → API status (JSON)                   │
│ /?p=docs                   → API documentation                   │
│ /?action=status            → API status endpoint                 │
│ /?action=status&brand=abc  → API status for brand 'abc'          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  FRIENDLY URL PATTERNS                           │
├─────────────────────────────────────────────────────────────────┤
│ /events                    → Public events, root brand           │
│ /abc/events                → Public events, brand 'abc'          │
│ /manage                    → Admin (advanced), root brand        │
│ /abc/manage                → Admin (advanced), brand 'abc'       │
│ /abc/tournaments           → Custom alias for brand 'abc'        │
│ /abc/leagues               → Custom alias for brand 'abc'        │
│ /docs                      → API documentation                   │
│ /display                   → TV/Kiosk display mode               │
└─────────────────────────────────────────────────────────────────┘
```

## Page Mapping Reference

```
┌─────────────────────────────────────────────────────────────────┐
│         PAGE PARAMETER → HTML FILE MAPPING                       │
│              Code.gs:812-827                                     │
├─────────────────────┬──────────────────┬────────────────────────┤
│ ?p=value            │ HTML File        │ Purpose                │
├─────────────────────┼──────────────────┼────────────────────────┤
│ public (default)    │ Public.html      │ Event listings         │
│ admin               │ Admin.html       │ Advanced admin         │
│ wizard              │ AdminWizard.html │ Simplified admin       │
│ admin-enhanced      │ AdminEnhanced.html│ Component-based admin  │
│ planner             │ PlannerCards.html│ Event planner          │
│ poster              │ Poster.html      │ Poster generator       │
│ test                │ Test.html        │ Testing interface      │
│ display             │ Display.html     │ TV/Kiosk display       │
│ report/analytics    │ SharedReport.html│ Analytics/reporting    │
│ sponsor             │ Sponsor.html     │ Sponsor management     │
│ sponsor-roi         │ SponsorDashboard │ Sponsor ROI dashboard  │
│ diagnostics         │ Diagnostics.html │ System diagnostics     │
│ signup              │ Signup.html      │ User signup            │
│ config              │ ConfigHtml.html  │ Configuration          │
│ docs/api            │ ApiDocs.html     │ API documentation      │
└─────────────────────┴──────────────────┴────────────────────────┘
```

## Template Context Variables

```
┌─────────────────────────────────────────────────────────────────┐
│         VARIABLES PASSED TO TEMPLATES                            │
│        Via global_setTemplateContext_() [Code.gs:413-423]        │
├─────────────────┬──────────────────────────────────────────────┤
│ Variable        │ Type    │ Example                            │
├─────────────────┼─────────┼────────────────────────────────────┤
│ appTitle        │ string  │ "Zeventbook · events"              │
│ brandId         │ string  │ "abc"                              │
│ scope           │ string  │ "events"                           │
│ execUrl         │ string  │ "https://script.google.com/..."    │
│ ZEB             │ object  │ { BUILD_ID, URL_ALIASES, ... }     │
│ demoMode        │ boolean │ false                              │
│ brand           │ object  │ { id, name, logoUrl, ... }         │
│ friendlyUrl     │ boolean │ false                              │
│ urlAlias        │ string  │ ""                                 │
└─────────────────┴─────────┴────────────────────────────────────┘

                    ⬇ AVAILABLE IN: ⬇
         ┌──────────────────┬──────────────────┐
         │                  │                  │
    Main Templates     Included Templates
         │                  │
    Direct usage        Via include()
    <?= appTitle ?>     <?= appTitle ?>
    <?= brand.name ?>   <?= brand.name ?>
         │                  │
         └──────────────────┴──────────────────┘
                    ✓ Both can access!
```

## Critical Sections to Review

### 1. Brand Resolution (Code.gs:237-245)
```javascript
// Determines which brand to use
// 1. Try hostname lookup
// 2. Fall back to 'root'
// 3. Override with ?brand param
```

### 2. Page Routing (Code.gs:358)
```javascript
// Converts page parameter to valid page type
// If invalid → defaults to 'public'
```

### 3. Template Loading (Code.gs:395)
```javascript
// CRITICAL: No error handling here!
// If template file doesn't exist → silent failure
```

### 4. Template Context (Code.gs:413-423)
```javascript
// Variables made available to included templates
// ⚠️ findBrand_() is NOT passed here
// ✓ brand object IS passed here
```

### 5. Include Function (Code.gs:861-878)
```javascript
// Issues:
// - Servers functions not available in template scope
// - Only receives variables from context object
// - Functions must be called differently or passed as objects
```

## Scope Validation Flow

```
                    Request with scope
                           │
                           ▼
                  Check brand.scopesAllowed
                           │
                    ┌──────┴──────┐
                    │             │
                Allowed      Not Allowed
                    │             │
                    ▼             ▼
              Show Page      Auto-Redirect
                    │        (meta refresh)
                    │             │
                    │        ?p=FIRST_SCOPE
                    │        &brand=BRAND_ID
                    │             │
                    └──────┬──────┘
                           │
                           ▼
                    User Sees Content
```

## Request Processing Timeline

```
T0: Browser sends HTTP request
    └─ GET /?p=admin&brand=abc

T1: doGet() begins
    ├─ Extract pageParam = 'admin'
    ├─ Extract actionParam = ''
    ├─ Extract brandParam = 'abc'
    └─ Extract scope = 'events'

T2: Route decision
    ├─ Is it an action? No
    ├─ Is it a special page? No
    └─ Is it a valid page? Yes → page = 'admin'

T3: Brand lookup
    ├─ Find brand where id === 'abc'
    └─ Returns brand object

T4: Call routePage_()
    ├─ Check if page is 'admin' → redirect to 'wizard'
    └─ page = 'wizard'

T5: Template loading
    ├─ pageFile_('wizard') → 'AdminWizard'
    ├─ Load AdminWizard.html
    └─ Set template variables

T6: Template context setup
    ├─ global_setTemplateContext_({
    │    appTitle: '...',
    │    brandId: 'abc',
    │    scope: 'events',
    │    brand: { id: 'abc', name: '...', ... }
    │  })
    └─ Make available to included templates

T7: Template evaluation
    ├─ Evaluate <?= ... ?> tags
    ├─ Call include() for included files
    └─ Generate HTML

T8: Return to browser
    ├─ HtmlOutput sent
    └─ Browser renders AdminWizard page

T9: Page loaded
    └─ User sees admin wizard for brand 'abc'
```

## Debugging Checklist

```
┌─────────────────────────────────────────────────────────────────┐
│                  TROUBLESHOOTING GUIDE                           │
├─────────────────────────────────────────────────────────────────┤
│ Symptom: White/blank screen                                      │
│   → Check browser console for errors                             │
│   → Verify HeaderInit.html uses brand.logoUrl (not findBrand_)   │
│   → Check if template file exists in pageFile_()                │
│                                                                  │
│ Symptom: Wrong page displayed                                    │
│   → Verify page parameter is in the valid list                   │
│   → Check if page defaults to 'public' (expected for invalid)    │
│   → Ensure friendly URL alias is defined in Config.gs           │
│                                                                  │
│ Symptom: Brand not switching                                     │
│   → Verify brand ID exists in BRANDS array                       │
│   → Check if ?brand parameter is being passed                    │
│   → Inspect brand lookup logic in findBrand_()                   │
│                                                                  │
│ Symptom: Scope redirect loop                                     │
│   → Check brand.scopesAllowed configuration                      │
│   → Verify scope value is valid                                  │
│   → Look for redirect meta tags in HTML                          │
│                                                                  │
│ Symptom: Template variables undefined                            │
│   → Check if variable is passed in context at Code.gs:413-423   │
│   → Verify template variable names match exactly                 │
│   → Check if trying to call function from template (won't work)  │
│                                                                  │
│ Symptom: API endpoint returns error                              │
│   → Check if ?action parameter is valid                          │
│   → Verify brand ID is correct                                   │
│   → Look for CSRF token requirement                              │
└─────────────────────────────────────────────────────────────────┘
```

## File Dependency Map

```
HTTP Request
    │
    └─→ Code.gs (doGet entry point)
        │
        ├─→ Config.gs
        │   ├─ BRANDS array
        │   ├─ ZEB configuration
        │   ├─ findBrand_()
        │   └─ resolveUrlAlias_()
        │
        ├─→ pageFile_() → HTML file selection
        │
        └─→ routePage_()
            │
            ├─→ HtmlService.createTemplateFromFile()
            │   │
            │   └─→ HTML File (e.g., AdminWizard.html)
            │       │
            │       └─→ include() calls
            │           │
            │           └─→ Included files (e.g., HeaderInit.html)
            │               │
            │               └─→ template.evaluate()
            │
            └─→ tpl.evaluate()
                │
                └─→ Return HtmlOutput to browser
```

## Performance Considerations

```
┌─────────────────────────────────────────────────────────────────┐
│ Operation              │ Impact  │ Notes                         │
├────────────────────────┼─────────┼───────────────────────────────┤
│ Parameter parsing      │ Fast    │ Simple string operations      │
│ Brand lookup           │ Fast    │ Array.find() on small array   │
│ Hostname lookup        │ Medium  │ Only if using subdomain routing
│ Template loading       │ Slow    │ File I/O from Google Drive    │
│ Template evaluation    │ Slow    │ <?= ... ?> processing         │
│ Include processing     │ Slow    │ Each include() is a template  │
│ Global context setup   │ Fast    │ Simple object assignment      │
└────────────────────────┴─────────┴───────────────────────────────┘
```

## Next Steps

1. Fix HeaderInit.html (CRITICAL)
   - Change line 8 to use `brand?.logoUrl`
   
2. Add error handling
   - Wrap Code.gs:395 in try-catch
   
3. Add logging
   - Log parameter values for debugging
   - Log template loading errors
   
4. Add tests
   - Test all parameter combinations
   - Test friendly URL patterns
   - Test brand switching
   
5. Consider improvements
   - Cache template files?
   - Add comprehensive logging
   - Improve error messages
   - Add parameter validation

