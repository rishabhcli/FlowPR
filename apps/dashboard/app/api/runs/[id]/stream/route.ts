import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  getProgressHistory,
  readProgressEvents,
  readLiveStreams,
} from '@flowpr/tools/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const redis = createFlowPrRedisClient();
      let closed = false;
      const abort = () => {
        closed = true;
        if (redis.isOpen) {
          redis.quit().catch(() => undefined);
        }
      };

      try {
        await connectFlowPrRedisClient(redis);

        controller.enqueue(encoder.encode(toSSE('connected', { runId: id, at: new Date().toISOString() })));

        const [history, liveStreams] = await Promise.all([
          getProgressHistory(redis, id, 100).catch(() => []),
          readLiveStreams(redis, id).catch(() => []),
        ]);
        for (const entry of history) {
          controller.enqueue(encoder.encode(toSSE('progress', { id: entry.id, ...entry.fields })));
        }
        if (liveStreams.length > 0) {
          controller.enqueue(encoder.encode(toSSE('liveStreams', liveStreams)));
        }

        let cursor = history.length > 0 ? history[history.length - 1].id : '$';
        const heartbeatMs = 15000;
        let nextHeartbeat = Date.now() + heartbeatMs;

        while (!closed) {
          const events = await readProgressEvents(redis, id, {
            from: cursor,
            blockMs: 5000,
            count: 20,
          }).catch((): [] => []);

          if (events.length > 0) {
            for (const entry of events) {
              controller.enqueue(encoder.encode(toSSE('progress', { id: entry.id, ...entry.fields })));
              cursor = entry.id;
            }
            const fresh = await readLiveStreams(redis, id).catch(() => []);
            if (fresh.length > 0) {
              controller.enqueue(encoder.encode(toSSE('liveStreams', fresh)));
            }
          }

          if (Date.now() >= nextHeartbeat) {
            controller.enqueue(encoder.encode(toSSE('heartbeat', { at: new Date().toISOString() })));
            nextHeartbeat = Date.now() + heartbeatMs;
          }
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            toSSE('error', { message: error instanceof Error ? error.message : String(error) }),
          ),
        );
      } finally {
        abort();
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      }
    },

    cancel() {
      // runtime closes the stream on client disconnect; the polling loop observes the abort via the `closed` flag
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
