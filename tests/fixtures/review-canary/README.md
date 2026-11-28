# Review check fixtures

Five small handlers read by `.github/workflows/review-canary.yml`. They are plain
text (`.txt`): never imported, built or deployed.

Some are correct and some carry one known bug. Which is which, and the line
each bug sits on, lives only in `scripts/ci/review-canary-check.mjs`, so the
reviewer cannot read the answers next to the files. If you edit a fixture, keep
its marker text in that script in step (a unit test checks it).
