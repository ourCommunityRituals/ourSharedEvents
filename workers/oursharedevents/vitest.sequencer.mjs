// vitest.sequencer.mjs — `--shard=i/N` by measured time, not by file count.
//
// Wired in vitest.config.mts (sequence.sequencer). vitest calls shard() only
// when --shard is given (the CI worker-d1-schema slices); every other run and
// the file order inside a slice are BaseSequencer's own. The plan itself is in
// vitest-shard-plan.mjs; the times are in vitest-shard-durations.json, read
// fresh on each run. A missing or unreadable times file fails the run: a
// silent fall-back to count-based slices would hide a broken balance.
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseSequencer } from 'vitest/node';
import { DURATIONS_FILE, planShards } from './vitest-shard-plan.mjs';

export default class TimeBalancedSequencer extends BaseSequencer {
  async shard(files) {
    const { config } = this.ctx;
    const { index, count } = config.shard;
    const durations = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), DURATIONS_FILE), 'utf8')
    );
    const specs = files.map((spec) => ({
      project: spec.project.name,
      file: relative(config.root, spec.moduleId).split('\\').join('/'),
    }));
    const plan = planShards(specs, count, durations);
    return files.filter((_, i) => plan[i] === index);
  }
}
