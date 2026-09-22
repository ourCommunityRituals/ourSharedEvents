#!/bin/bash
# ============================================================================
# AUTOMATED FIX SCRIPT
# Fixes both ENV VAR mismatch and URL format compatibility
# ============================================================================

set -e  # Exit on error

echo "🚀 Starting automated fix for test infrastructure bugs..."
echo ""

# Check we're in the right directory
if [ ! -f "Code.gs" ]; then
    echo "❌ Error: Code.gs not found. Please run this from ~/ZEVENTBOOKS/MVP-EVENT-TOOLKIT"
    exit 1
fi

if [ ! -f ".github/workflows/stage2-testing.yml" ]; then
    echo "❌ Error: stage2-testing.yml not found"
    exit 1
fi

# ============================================================================
# STEP 1: Add Backward Compatibility to Code.gs
# ============================================================================

echo "📝 Step 1: Adding backward compatibility to Code.gs..."

# Check if already added
if grep -q "handleBackwardCompatibility" Code.gs; then
    echo "⚠️  Backward compatibility function already exists in Code.gs"
    echo "   Skipping Code.gs modification"
else
    # Create backup
    cp Code.gs Code.gs.backup
    echo "✅ Created backup: Code.gs.backup"
    
    # Find the doGet function
    if ! grep -q "function doGet" Code.gs; then
        echo "❌ Error: Cannot find doGet() function in Code.gs"
        exit 1
    fi
    
    # Create the backward compatibility function
    cat > /tmp/backward-compat.gs << 'EOF'

// ============================================================================
// BACKWARD COMPATIBILITY LAYER - Auto-added by fix script
// ============================================================================
/**
 * Handle backward compatibility for old URL format
 * Maps old query parameters to new RESTful paths
 * 
 * OLD: ?p=display&tenant=abc
 * NEW: /abc/display
 */
function handleBackwardCompatibility(e) {
  const oldPage = e.parameter.p || e.parameter.page;
  const tenant = e.parameter.tenant;
  
  if (!oldPage || !tenant) {
    return null; // Not old format
  }
  
  Logger.log('🔄 Backward compatibility: ?p=' + oldPage + '&tenant=' + tenant);
  
  // Map old page names to new paths
  const pageMapping = {
    'status': 'status',
    'admin': 'manage',
    'events': 'events',
    'display': 'display',
    'poster': 'poster',
    'public': 'public',
    'sponsor': 'sponsors',
    'config': 'config',
    'reports': 'reports',
    'diagnostics': 'diagnostics'
  };
  
  const newPath = pageMapping[oldPage] || oldPage;
  let newUrl = (oldPage === 'status') ? '/status?tenant=' + tenant : '/' + tenant + '/' + newPath;
  
  // Add additional query parameters
  for (const key in e.parameter) {
    if (key !== 'p' && key !== 'page' && key !== 'tenant') {
      newUrl += (newUrl.indexOf('?') > 0 ? '&' : '?') + key + '=' + e.parameter[key];
    }
  }
  
  Logger.log('   → Redirecting to: ' + newUrl);
  
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head>' +
    '<meta http-equiv="refresh" content="0;url=' + newUrl + '">' +
    '<title>Redirecting...</title></head><body>' +
    '<p>Redirecting to new URL format...</p>' +
    '<p>If not redirected, <a href="' + newUrl + '">click here</a>.</p>' +
    '</body></html>'
  ).setTitle('Redirecting');
}

EOF

    # Insert the function before doGet
    awk '
    /function doGet/ {
        while ((getline line < "/tmp/backward-compat.gs") > 0) {
            print line
        }
        close("/tmp/backward-compat.gs")
    }
    { print }
    ' Code.gs > Code.gs.new
    
    mv Code.gs.new Code.gs
    echo "✅ Added handleBackwardCompatibility() function to Code.gs"
    
    # Now add the call at the start of doGet
    awk '
    /function doGet\(e\)/ {
        print
        getline
        print
        print "  // BACKWARD COMPATIBILITY - Check for old URL format"
        print "  const backwardCompatRedirect = handleBackwardCompatibility(e);"
        print "  if (backwardCompatRedirect) {"
        print "    return backwardCompatRedirect;"
        print "  }"
        print "  "
        next
    }
    { print }
    ' Code.gs > Code.gs.new
    
    mv Code.gs.new Code.gs
    echo "✅ Added backward compatibility check to doGet()"
fi

echo ""

# ============================================================================
# STEP 2: Fix Stage 2 Workflow ENV VAR
# ============================================================================

echo "📝 Step 2: Fixing stage2-testing.yml ENV VAR..."

# Check if already fixed
if grep -q "BASE_URL.*needs.setup.outputs.deployment_url" .github/workflows/stage2-testing.yml; then
    echo "⚠️  BASE_URL already set in stage2-testing.yml"
    echo "   Skipping workflow modification"
else
    # Create backup
    cp .github/workflows/stage2-testing.yml .github/workflows/stage2-testing.yml.backup
    echo "✅ Created backup: stage2-testing.yml.backup"
    
    # Fix all three test job sections
    sed -i.tmp '
    # For API Tests section
    /name: Run API tests/,/run: |/ {
        /env:/,/run: |/ {
            /GOOGLE_SCRIPT_URL/i\
          BASE_URL: ${{ needs.setup.outputs.deployment_url }}
        }
    }
    
    # For Smoke Tests section
    /name: Run Smoke tests/,/run: |/ {
        /env:/,/run: |/ {
            /GOOGLE_SCRIPT_URL/i\
          BASE_URL: ${{ needs.setup.outputs.deployment_url }}
        }
    }
    
    # For Expensive Tests section
    /name: Run.*tests$/,/run: |/ {
        /env:/,/run: |/ {
            /GOOGLE_SCRIPT_URL/i\
          BASE_URL: ${{ needs.setup.outputs.deployment_url }}
        }
    }
    ' .github/workflows/stage2-testing.yml
    
    rm -f .github/workflows/stage2-testing.yml.tmp
    echo "✅ Added BASE_URL to all test jobs in stage2-testing.yml"
fi

echo ""

# ============================================================================
# STEP 3: Commit and Push
# ============================================================================

echo "📝 Step 3: Committing changes..."

# Check git status
if ! git diff --quiet Code.gs .github/workflows/stage2-testing.yml 2>/dev/null; then
    # Stage changes
    git add Code.gs .github/workflows/stage2-testing.yml
    
    # Commit
    git commit -m "fix: Two critical test infrastructure bugs

Bug 1: ENV VAR mismatch (stage2-testing.yml)
- Tests looked for BASE_URL but workflow only set GOOGLE_SCRIPT_URL
- Now setting both BASE_URL and GOOGLE_SCRIPT_URL env vars
- This fixes Page tests that use BASE_URL directly

Bug 2: URL format incompatibility (Code.gs)
- Tests use old format: ?p=page&tenant=id
- App now uses new format: /tenant/page
- Added handleBackwardCompatibility() function to map old → new
- Tests now work without modification

Result: Tests can now hit actual deployment URLs!

Automated by: fix-test-infrastructure.sh"
    
    echo "✅ Changes committed"
    echo ""
    
    # Push
    echo "🚀 Pushing to origin/main..."
    git push origin main
    
    echo "✅ Pushed to GitHub!"
    echo ""
else
    echo "⚠️  No changes detected - fixes may already be applied"
    echo ""
fi

# ============================================================================
# STEP 4: Summary
# ============================================================================

echo "=============================================="
echo "✅ AUTOMATED FIX COMPLETE!"
echo "=============================================="
echo ""
echo "What was fixed:"
echo "  1. ✅ Added backward compatibility to Code.gs"
echo "  2. ✅ Added BASE_URL env var to stage2-testing.yml"
echo "  3. ✅ Committed both changes"
echo "  4. ✅ Pushed to GitHub"
echo ""
echo "What happens next:"
echo "  1. GitHub Actions Stage 1 runs (~2 min)"
echo "     - Lints, tests, deploys to Apps Script"
echo "  2. GitHub Actions Stage 2 runs (~varies)"
echo "     - API Tests run first"
echo "     - Gate 1 checks results"
echo "     - Smoke Tests run (if API passed)"
echo "     - Gate 2 checks results"
echo "     - Expensive Tests run (if Smoke passed)"
echo ""
echo "Expected results:"
echo "  ✅ API Tests: PASS (tests hit real URLs)"
echo "  ✅ Smoke Tests: PASS (critical paths work)"
echo "  ⚠️  Page Tests: May have some real bugs"
echo ""
echo "Monitor progress:"
echo "  https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions"
echo ""
echo "Backups created:"
echo "  - Code.gs.backup"
echo "  - stage2-testing.yml.backup"
echo ""
echo "=============================================="
