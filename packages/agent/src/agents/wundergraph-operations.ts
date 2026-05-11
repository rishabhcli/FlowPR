import {
  executeWunderGraphOperation,
  type WunderGraphOperationRequest,
  type WunderGraphOperationResult,
  type WunderGraphSafeOperation,
} from '@flowpr/tools/wundergraph';

export interface SafeOperationInput<T> {
  operation: WunderGraphSafeOperation;
  runId: string;
  input: Record<string, unknown>;
  actorSessionId?: string;
  executor: () => Promise<T>;
}

export interface SafeOperationResult<T> {
  result: T;
  artifact: WunderGraphOperationResult;
}

export async function executeSafeOperation<T>(input: SafeOperationInput<T>): Promise<SafeOperationResult<T>> {
  const request: WunderGraphOperationRequest = {
    operation: input.operation,
    runId: input.runId,
    input: input.input,
    actorSessionId: input.actorSessionId,
  };

  return executeWunderGraphOperation(request, input.executor);
}
