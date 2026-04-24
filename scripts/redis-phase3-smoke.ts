import {
  acquireRedisLock,
  connectFlowPrRedisClient,
  createBugSignatureHash,
  createFlowPrRedisClient,
  ensureFlowPrConsumerGroups,
  flowPrReadableStreams,
  flowPrStreams,
  getRedisStreamStats,
  lookupBugSignatureMemory,
  redisLockKeys,
  releaseRedisLock,
  storeBugSignatureMemory,
} from '@flowpr/tools';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const redis = createFlowPrRedisClient();
const lockKey = redisLockKeys.patch('phase3-smoke');
const owner = `phase3-smoke:${process.pid}`;

async function main() {
  try {
    await connectFlowPrRedisClient(redis);
    await ensureFlowPrConsumerGroups(redis);

    const stats = await getRedisStreamStats(redis);
    const expectedStreams = [...flowPrReadableStreams, flowPrStreams.deadLetter];

    for (const stream of expectedStreams) {
      const stat = stats.find((candidate) => candidate.stream === stream);
      assert(stat, `Missing Redis stream stat for ${stream}`);

      if (stream !== flowPrStreams.deadLetter) {
        assert(stat.groups.some((group) => group.name === 'flowpr-workers'), `Missing flowpr-workers group on ${stream}`);
      }
    }

    const locked = await acquireRedisLock(redis, lockKey, owner, 30000);
    assert(locked, `Could not acquire ${lockKey}`);
    const released = await releaseRedisLock(redis, lockKey, owner);
    assert(released, `Could not release ${lockKey}`);

    const hash = createBugSignatureHash({
      repo: 'phase3-smoke',
      flowGoal: 'verify redis memory',
      observedBehavior: 'smoke',
    });
    await storeBugSignatureMemory(redis, hash, {
      runId: 'phase3-smoke',
      repo: 'phase3-smoke',
      flowGoal: 'verify redis memory',
      updatedAt: new Date().toISOString(),
    }, 300);
    const memory = await lookupBugSignatureMemory(redis, hash);
    assert(memory.runId === 'phase3-smoke', 'Redis bug-signature memory did not round-trip');

    console.log(JSON.stringify({
      ok: true,
      streams: Object.fromEntries(stats.map((stat) => [stat.stream, stat.length])),
      memoryHash: hash,
      lockKey,
    }, null, 2));
  } finally {
    if (redis.isOpen) {
      await redis.quit();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
