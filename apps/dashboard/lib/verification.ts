import type { VerificationResult } from '@flowpr/schemas';

/**
 * A patch verification is recorded as `local`; a no-patch browser proof is
 * recorded as `playwright`. Prefer the former when both exist.
 */
export function selectLocalVerification(
  results: VerificationResult[],
): VerificationResult | undefined {
  return (
    results.find((result) => result.provider === 'local') ??
    results.find((result) => result.provider === 'playwright')
  );
}

export function selectFinalVerificationResults(
  results: VerificationResult[],
): VerificationResult[] {
  const local = selectLocalVerification(results);
  const live = results.find((result) => result.provider === 'tinyfish-live');

  return [local, live].filter(
    (result): result is VerificationResult => Boolean(result),
  );
}
