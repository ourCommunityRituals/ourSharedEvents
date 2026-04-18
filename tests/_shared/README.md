# tests/\_shared

**VENDORED — DO NOT EDIT IN PLACE.**

`security_gate.py` is a vendored copy of the canonical at
`OCR-docs/shared/security_gate.py`.

To update: edit the canonical, then run from OCR-docs:

```
py shared/sync_to_repos.py
```

CI in OCR-docs runs `shared/check_drift.py` which fails if any consumer
repo's vendored copy diverges from the canonical.
