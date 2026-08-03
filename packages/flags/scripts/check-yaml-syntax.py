#!/usr/bin/env python3
"""
Fast YAML syntax check for the flags contract.

Runs as the first step of Level 0 so a malformed contract fails with a
clean error message instead of a cryptic generator or vitest trace.

Exit 0: YAML parses.
Exit 1: YAML does not parse; prints line:column and context.
"""
from __future__ import annotations
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
REPO_ROOT = PKG.parent.parent
CONTRACT = REPO_ROOT / 'OCR-docs' / 'ocr-docs-brain' / 'flags-contract.yaml'


def main() -> int:
    try:
        import yaml  # type: ignore
    except ImportError:
        print('[SKIP] PyYAML not installed; YAML syntax check cannot run.')
        return 0
    if not CONTRACT.exists():
        print(f'[FAIL] contract not found at {CONTRACT}')
        return 1
    try:
        yaml.safe_load(CONTRACT.read_text(encoding='utf-8'))
    except yaml.YAMLError as e:
        print(f'[FAIL] YAML parse error in {CONTRACT}')
        mark = getattr(e, 'problem_mark', None)
        if mark is not None:
            print(f'       line {mark.line + 1}, col {mark.column + 1}')
        if getattr(e, 'problem', None):
            print(f'       problem: {e.problem}')
        if getattr(e, 'context', None):
            print(f'       context: {e.context}')
        return 1
    print(f'[PASS] YAML syntax clean: {CONTRACT.name}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
