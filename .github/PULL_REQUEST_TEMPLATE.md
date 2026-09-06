# Pull Request

## Description

<!-- Describe what this PR does -->

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Testing Checklist

- [ ] Jest unit tests pass (`npm run test:jest`)
- [ ] Deployed to @HEAD and tested (`npm run push && sleep 30`)
- [ ] Newman smoke tests pass (`npm run test:newman:smoke`)
- [ ] Tested in browser (Admin, Public, Display pages)
- [ ] Tested on mobile viewport (if UI changes)

## Security

- [ ] All security scans pass (CodeQL + custom queries, npm audit)
- [ ] No new dependencies with copyleft licenses (GPL/AGPL)
- [ ] No hardcoded secrets or credentials
- [ ] User input is validated/sanitized at system boundaries
- [ ] If security scan fails: human reviewer has assessed and applied `security:human-override` label with justification comment (automated agents/bots CANNOT override)

## Code Quality

- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] No console.log or debug code left behind

## Documentation

- [ ] README updated (if needed)
- [ ] API documentation updated (if endpoints changed)
- [ ] CHANGELOG.md updated

## Deployment Notes

<!-- Any special considerations for deployment? -->
<!-- Does this require new OAuth scopes? -->
<!-- Does this require database/sheet structure changes? -->

## Related Issues (Linear) — OSE-1250 close-guard

<!--
  Linear auto-closes a story on merge if its OSE-### id is in the BRANCH NAME or
  PR TITLE. Pick the line that matches this PR (delete the other):

  • COMPLETING the story  →  Closes OSE-###
  • SLICE of a multi-part story  →  Part of OSE-###   (and use an id-free branch
    name + title, or CI's close-guard will fail the PR)
-->

Part of OSE-

## Screenshots (if applicable)

<!-- Add screenshots of UI changes -->
