#!/bin/bash
# Temporary workaround for CLASP ignoring node_modules

echo "Moving node_modules temporarily..."
mv node_modules ../node_modules_temp

echo "Pushing to Apps Script..."
npx clasp push --force

echo "Restoring node_modules..."
mv ../node_modules_temp node_modules

echo "Done!"
