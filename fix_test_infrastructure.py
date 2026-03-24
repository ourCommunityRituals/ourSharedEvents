#!/usr/bin/env python3
"""Fully Automated Test Infrastructure Fix"""
import os, sys, subprocess, re

def run(cmd, desc):
    print(f"  {desc}...")
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  ❌ Error: {r.stderr}")
        return False
    print(f"  ✅ {desc} complete")
    return True

print("=" * 60)
print("🚀 AUTOMATED TEST INFRASTRUCTURE FIX")
print("=" * 60)
print()

# Check environment
print("🔍 Checking environment...")
if not os.path.exists("Code.gs"):
    print("❌ Error: Code.gs not found")
    sys.exit(1)
if not os.path.exists(".github/workflows/stage2-testing.yml"):
    print("❌ Error: stage2-testing.yml not found")
    sys.exit(1)
print("✅ Environment check passed\n")

# Step 1: Code.gs
print("📝 Step 1: Adding backward compatibility to Code.gs...")
with open("Code.gs", "r") as f:
    code = f.read()

if "handleBackwardCompatibility" in code:
    print("⚠️  Backward compatibility already exists\n")
else:
    with open("Code.gs.backup", "w") as f:
        f.write(code)
    print("✅ Created backup: Code.gs.backup")
    
    func = '''
// BACKWARD COMPATIBILITY LAYER
function handleBackwardCompatibility(e) {
  const oldPage = e.parameter.p || e.parameter.page;
  const tenant = e.parameter.tenant;
  if (!oldPage || !tenant) return null;
  Logger.log('🔄 Backward compat: ?p=' + oldPage + '&tenant=' + tenant);
  const pageMapping = {'status':'status','admin':'manage','events':'events','display':'display','poster':'poster','public':'public','sponsor':'sponsors','config':'config','reports':'reports','diagnostics':'diagnostics'};
  const newPath = pageMapping[oldPage] || oldPage;
  let newUrl = (oldPage === 'status') ? '/status?tenant=' + tenant : '/' + tenant + '/' + newPath;
  for (const key in e.parameter) {
    if (key !== 'p' && key !== 'page' && key !== 'tenant') {
      newUrl += (newUrl.indexOf('?') > 0 ? '&' : '?') + key + '=' + e.parameter[key];
    }
  }
  Logger.log('   → Redirecting to: ' + newUrl);
  return HtmlService.createHtmlOutput('<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=' + newUrl + '"></head><body>Redirecting...</body></html>').setTitle('Redirecting');
}

'''
    
    match = re.search(r'(function doGet\s*\(\s*e\s*\)\s*\{)', code)
    if not match:
        print("❌ Could not find doGet() function")
        sys.exit(1)
    
    insert_pos = match.start()
    code = code[:insert_pos] + func + code[insert_pos:]
    
    doget_start = code.find('function doGet(e) {')
    brace_pos = code.find('{', doget_start) + 1
    try_pos = code.find('try', brace_pos)
    
    if try_pos != -1 and try_pos < brace_pos + 100:
        insert_pos = code.find('{', try_pos) + 1
    else:
        insert_pos = brace_pos
    
    call = '\n  const backwardCompatRedirect = handleBackwardCompatibility(e);\n  if (backwardCompatRedirect) return backwardCompatRedirect;\n  \n'
    code = code[:insert_pos] + call + code[insert_pos:]
    
    with open("Code.gs", "w") as f:
        f.write(code)
    print("✅ Added backward compatibility to Code.gs\n")

# Step 2: Workflow
print("📝 Step 2: Fixing stage2-testing.yml...")
with open(".github/workflows/stage2-testing.yml", "r") as f:
    workflow = f.read()

if "BASE_URL: ${{ needs.setup.outputs.deployment_url }}" in workflow:
    print("⚠️  BASE_URL already set in workflow\n")
else:
    with open(".github/workflows/stage2-testing.yml.backup", "w") as f:
        f.write(workflow)
    print("✅ Created backup: stage2-testing.yml.backup")
    
    workflow = re.sub(
        r'(\s+)(GOOGLE_SCRIPT_URL: \$\{\{ needs\.setup\.outputs\.deployment_url \}\})',
        r'\1BASE_URL: ${{ needs.setup.outputs.deployment_url }}\n\1\2',
        workflow
    )
    
    with open(".github/workflows/stage2-testing.yml", "w") as f:
        f.write(workflow)
    print("✅ Added BASE_URL to workflow\n")

# Step 3: Commit and push
print("📝 Step 3: Committing and pushing...")
if not run("git add Code.gs .github/workflows/stage2-testing.yml", "Stage files"):
    sys.exit(1)

msg = """fix: Two critical test infrastructure bugs

Bug 1: ENV VAR mismatch
- Tests looked for BASE_URL but workflow only set GOOGLE_SCRIPT_URL
- Now setting both env vars in stage2-testing.yml

Bug 2: URL format incompatibility
- Tests use old format: ?p=page&tenant=id
- App now uses new format: /tenant/page
- Added backward compatibility in Code.gs

Result: Tests can now hit actual deployment URLs!"""

if not run(f'git commit -m "{msg}"', "Commit changes"):
    sys.exit(1)
if not run("git push origin main", "Push to GitHub"):
    sys.exit(1)

print("=" * 60)
print("✅ AUTOMATED FIX COMPLETE!")
print("=" * 60)
print("\nMonitor: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions")
print("=" * 60)
