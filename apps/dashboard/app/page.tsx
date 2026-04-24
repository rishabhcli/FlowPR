'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { FlowPrRun, RunDetail, RiskLevel } from '@flowpr/schemas';

interface SponsorStatus {
  sponsor: string;
  state: 'live' | 'not_configured' | 'failed' | 'local_artifact';
  summary: string;
  checkedAt: string;
  metadata?: Record<string, unknown>;
}

const defaultInput = {
  repoUrl: 'https://github.com/rishabhcli/FlowPR',
  previewUrl: 'http://localhost:3100',
  baseBranch: 'main',
  flowGoal: 'On mobile, choose Pro on pricing, complete checkout, and reach success.',
  riskLevel: 'medium' as RiskLevel,
};

function formatTime(value?: string) {
  if (!value) return 'Pending';

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function stateLabel(state: SponsorStatus['state']) {
  if (state === 'not_configured') return 'not configured';
  if (state === 'local_artifact') return 'local artifact';

  return state;
}

export default function DashboardPage() {
  const [repoUrl, setRepoUrl] = useState(defaultInput.repoUrl);
  const [previewUrl, setPreviewUrl] = useState(defaultInput.previewUrl);
  const [baseBranch, setBaseBranch] = useState(defaultInput.baseBranch);
  const [flowGoal, setFlowGoal] = useState(defaultInput.flowGoal);
  const [riskLevel, setRiskLevel] = useState<RiskLevel>(defaultInput.riskLevel);
  const [runs, setRuns] = useState<FlowPrRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [sponsorStatuses, setSponsorStatuses] = useState<SponsorStatus[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  async function loadRuns() {
    const response = await fetch('/api/runs', { cache: 'no-store' });
    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error ?? 'Failed to load runs');
    }

    setRuns(body.runs);
    setSelectedRunId((current) => current ?? body.runs[0]?.id);
  }

  async function loadSponsorStatuses() {
    const response = await fetch('/api/sponsors/status', { cache: 'no-store' });
    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error ?? 'Failed to load sponsor status');
    }

    setSponsorStatuses(body.statuses);
  }

  async function loadRunDetail(runId: string) {
    const response = await fetch(`/api/runs/${runId}`, { cache: 'no-store' });
    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error ?? 'Failed to load run detail');
    }

    setRunDetail(body);
  }

  useEffect(() => {
    loadRuns().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    });

    loadSponsorStatuses().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;

    loadRunDetail(selectedRunId).catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    });

    const interval = window.setInterval(() => {
      loadRunDetail(selectedRunId).catch(() => undefined);
      loadRuns().catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [selectedRunId]);

  const liveCount = useMemo(
    () => sponsorStatuses.filter((status) => status.state === 'live').length,
    [sponsorStatuses],
  );
  const redisArtifacts = useMemo(
    () => runDetail?.providerArtifacts.filter((artifact) => artifact.sponsor === 'redis') ?? [],
    [runDetail],
  );

  async function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsStarting(true);
    setError(undefined);
    setNotice(undefined);

    try {
      const response = await fetch('/api/runs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl,
          previewUrl,
          baseBranch,
          flowGoal,
          riskLevel,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to start run');
      }

      setSelectedRunId(body.run.id);
      setNotice(
        body.warnings?.length
          ? `Run created with warnings: ${body.warnings.join(' ')}`
          : 'Run created and queued through Redis.',
      );
      await loadRuns();
      await loadRunDetail(body.run.id);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">FlowPR command center</p>
          <h1>Run real frontend QA against a live app.</h1>
        </div>
        <div className="health-pill">
          <strong>{liveCount}</strong>
          <span>live sponsor checks</span>
        </div>
      </header>

      {(notice || error) && (
        <section className={error ? 'banner error' : 'banner'}>
          <span>{error ?? notice}</span>
        </section>
      )}

      <section className="workspace">
        <form className="run-form" onSubmit={startRun}>
          <h2>Start Run</h2>
          <label>
            <span>GitHub repository</span>
            <input value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} />
          </label>
          <label>
            <span>Production or preview URL</span>
            <input value={previewUrl} onChange={(event) => setPreviewUrl(event.target.value)} />
          </label>
          <div className="field-row">
            <label>
              <span>Base branch</span>
              <input value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} />
            </label>
            <label>
              <span>Risk</span>
              <select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value as RiskLevel)}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </label>
          </div>
          <label>
            <span>Flow goal</span>
            <textarea value={flowGoal} onChange={(event) => setFlowGoal(event.target.value)} rows={4} />
          </label>
          <button disabled={isStarting} type="submit">
            {isStarting ? 'Starting...' : 'Start run'}
          </button>
        </form>

        <section className="live-panel">
          <div className="panel-heading">
            <h2>Current Run</h2>
            <span>{runDetail?.run.status ?? 'No run selected'}</span>
          </div>

          {runDetail ? (
            <>
              <dl className="run-facts">
                <div>
                  <dt>Repo</dt>
                  <dd>{runDetail.run.owner}/{runDetail.run.repo}</dd>
                </div>
                <div>
                  <dt>Preview</dt>
                  <dd>{runDetail.run.previewUrl}</dd>
                </div>
                <div>
                  <dt>Flow</dt>
                  <dd>{runDetail.run.flowGoal}</dd>
                </div>
              </dl>

              <div className="timeline">
                {runDetail.timelineEvents.length === 0 ? (
                  <p>No timeline events have been recorded yet.</p>
                ) : (
                  runDetail.timelineEvents.map((eventItem) => (
                    <div className="timeline-item" key={eventItem.id}>
                      <time>{formatTime(eventItem.createdAt)}</time>
                      <div>
                        <strong>#{eventItem.sequence} {eventItem.title}</strong>
                        <span>{eventItem.actor} / {eventItem.phase} / {eventItem.status}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="evidence-grid">
                <section>
                  <h3>Provider Artifacts</h3>
                  <ul>
                    {runDetail.providerArtifacts.map((artifact) => (
                      <li key={artifact.id}>
                        <strong>{artifact.sponsor}</strong>
                        <span>{artifact.artifactType}</span>
                        <code>{artifact.providerId ?? 'recorded'}</code>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3>Redis Runtime</h3>
                  <ul>
                    {redisArtifacts.map((artifact) => (
                      <li key={artifact.id}>
                        <strong>{artifact.artifactType}</strong>
                        <span>
                          {String(artifact.requestSummary.stream ?? artifact.requestSummary.lockKey ?? 'redis')}
                        </span>
                        <code>{artifact.providerId ?? 'recorded'}</code>
                      </li>
                    ))}
                    {redisArtifacts.length === 0 && (
                      <li>
                        <strong>Waiting</strong>
                        <span>No Redis runtime artifacts yet.</span>
                        <code>queued</code>
                      </li>
                    )}
                  </ul>
                </section>
                <section>
                  <h3>Browser Evidence</h3>
                  <ul className="browser-evidence-list">
                    {runDetail.browserObservations.map((observation) => (
                      <li className={`browser-evidence ${observation.status}`} key={observation.id}>
                        <div className="browser-evidence-header">
                          <strong>{observation.provider}</strong>
                          <code>{observation.status}</code>
                        </div>
                        <span>{observation.failedStep ?? 'full flow'}</span>
                        <p>{observation.observedBehavior ?? 'Evidence recorded.'}</p>
                        <div className="evidence-links">
                          {observation.screenshotUrl && (
                            <a href={observation.screenshotUrl} rel="noreferrer" target="_blank">
                              Screenshot
                            </a>
                          )}
                          {observation.traceUrl && (
                            <a href={observation.traceUrl} rel="noreferrer" target="_blank">
                              Trace
                            </a>
                          )}
                        </div>
                        <code>{observation.providerRunId ?? observation.severity}</code>
                      </li>
                    ))}
                    {runDetail.browserObservations.length === 0 && (
                      <li>
                        <strong>Waiting</strong>
                        <span>No TinyFish or Playwright browser evidence yet.</span>
                        <code>queued</code>
                      </li>
                    )}
                  </ul>
                </section>
                <section>
                  <h3>Policy Hits</h3>
                  <ul>
                    {runDetail.policyHits.map((policyHit) => (
                      <li key={policyHit.id}>
                        <strong>{policyHit.provider}</strong>
                        <span>{policyHit.title ?? 'policy context'}</span>
                        <code>{policyHit.score ?? 'recorded'}</code>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3>Agent Control</h3>
                  <ul>
                    {runDetail.agentSessions.map((session) => (
                      <li key={session.id}>
                        <strong>{session.sponsor}</strong>
                        <span>{session.status}</span>
                        <code>{session.providerSessionId ?? 'session'}</code>
                      </li>
                    ))}
                    {runDetail.actionGates.map((gate) => (
                      <li key={gate.id}>
                        <strong>{gate.gateType}</strong>
                        <span>{gate.status}</span>
                        <code>{gate.riskLevel}</code>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3>Verification</h3>
                  <ul>
                    {runDetail.verificationResults.map((result) => (
                      <li key={result.id}>
                        <strong>{result.provider}</strong>
                        <span>{result.status}</span>
                        <code>{result.artifacts.length} artifacts</code>
                      </li>
                    ))}
                    {runDetail.benchmarkEvaluations.map((evaluation) => (
                      <li key={evaluation.id}>
                        <strong>{evaluation.benchmarkName}</strong>
                        <span>{evaluation.status}</span>
                        <code>{evaluation.score ?? 'n/a'}</code>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3>Fix Records</h3>
                  <ul>
                    {runDetail.bugHypotheses.map((hypothesis) => (
                      <li key={hypothesis.id}>
                        <strong>{hypothesis.severity}</strong>
                        <span>{hypothesis.summary}</span>
                        <code>{hypothesis.confidence}</code>
                      </li>
                    ))}
                    {runDetail.patches.map((patch) => (
                      <li key={patch.id}>
                        <strong>{patch.status}</strong>
                        <span>{patch.summary}</span>
                        <code>{patch.branchName ?? 'patch'}</code>
                      </li>
                    ))}
                    {runDetail.pullRequests.map((pullRequest) => (
                      <li key={pullRequest.id}>
                        <strong>{pullRequest.provider}</strong>
                        <span>{pullRequest.status}</span>
                        <code>{pullRequest.number ?? pullRequest.branchName}</code>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </>
          ) : (
            <p className="empty">Start a run or select one from recent runs.</p>
          )}
        </section>
      </section>

      <section className="lower-grid">
        <section>
          <div className="panel-heading">
            <h2>Recent Runs</h2>
            <button className="small-button" type="button" onClick={() => loadRuns()}>
              Refresh
            </button>
          </div>
          <div className="run-list">
            {runs.map((run) => (
              <button
                className={selectedRunId === run.id ? 'run-row selected' : 'run-row'}
                key={run.id}
                type="button"
                onClick={() => setSelectedRunId(run.id)}
              >
                <span>{run.owner}/{run.repo}</span>
                <strong>{run.status}</strong>
                <time>{formatTime(run.createdAt)}</time>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="panel-heading">
            <h2>Sponsor Proof</h2>
            <button className="small-button" type="button" onClick={() => loadSponsorStatuses()}>
              Check
            </button>
          </div>
          <ul className="sponsor-list">
            {sponsorStatuses.map((status) => (
              <li key={status.sponsor}>
                <div>
                  <strong>{status.sponsor}</strong>
                  <span>{status.summary}</span>
                </div>
                <code className={status.state}>{stateLabel(status.state)}</code>
              </li>
            ))}
          </ul>
        </section>
      </section>
    </main>
  );
}
