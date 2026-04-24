export type SponsorName =
  | 'tinyfish'
  | 'redis'
  | 'insforge'
  | 'wundergraph'
  | 'guildai'
  | 'senso'
  | 'shipables'
  | 'chainguard'
  | 'akash'
  | 'github'
  | 'playwright';

export interface ProviderArtifactInput {
  runId: string;
  sponsor: SponsorName;
  artifactType: string;
  providerId?: string;
  artifactUrl?: string;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

