#!/usr/bin/env node
/**
 * Compatibility entrypoint for the legacy GAS dead-code check.
 *
 * The implementation lives with the archived GAS docs. Keeping this wrapper
 * lets the repo-level CI gate continue to call the historical script name while
 * the archived checker handles the migrated/no-src-mvp case.
 */
require('../archive/gas-docs/check-dead-code.js');
