import { getMissingRecommendedEnv, getMissingRequiredEnv, loadLocalEnv } from '@flowpr/tools';
import { flowPrStreams } from './providers/redis';

loadLocalEnv();
const missing = getMissingRequiredEnv();
const recommended = getMissingRecommendedEnv();

if (missing.length > 0) {
  console.log(`FlowPR worker setup check: missing ${missing.join(', ')}`);
} else {
  console.log('FlowPR worker setup check: required environment is present');
}

if (recommended.length > 0) {
  console.log(`Recommended integrations still pending: ${recommended.join(', ')}`);
}

console.log(`Worker scaffold ready. Redis streams: ${Object.values(flowPrStreams).join(', ')}`);
