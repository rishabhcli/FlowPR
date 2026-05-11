import { loadLocalEnv } from '@flowpr/tools/env';
import {
  FLOWPR_SENSO_SEED_DOCUMENTS,
  createSensoClient,
} from '@flowpr/tools/senso';

loadLocalEnv();

async function main(): Promise<void> {
  if (!process.env.SENSO_API_KEY) {
    console.log('SENSO_API_KEY is not configured; skipping ingest. Fallback policy will be used at runtime.');
    return;
  }

  const client = createSensoClient();
  let accepted = 0;
  const errors: Array<{ title: string; error: string }> = [];

  for (const document of FLOWPR_SENSO_SEED_DOCUMENTS) {
    try {
      await client.ingestRaw(document);
      accepted += 1;
      console.log(`Ingested: ${document.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ title: document.title, error: message });
      console.warn(`Failed to ingest ${document.title}: ${message}`);
    }
  }

  console.log(`Senso ingest complete. Accepted ${accepted} / ${FLOWPR_SENSO_SEED_DOCUMENTS.length}.`);

  if (errors.length > 0) {
    console.log('Errors:', JSON.stringify(errors, null, 2));
    process.exitCode = errors.length === FLOWPR_SENSO_SEED_DOCUMENTS.length ? 1 : 0;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
