import { createDraftRun } from '@flowpr/schemas';

export default function DashboardPage() {
  const run = createDraftRun({
    repoUrl: 'https://github.com/rishabhcli/FlowPR',
    previewUrl: 'http://localhost:3100',
    flowGoal: 'On mobile, choose Pro on pricing, complete checkout, and reach success.',
  });

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">FlowPR command center</p>
        <h1>Autonomous frontend QA with live browser proof.</h1>
        <p>
          TinyFish runs the user flow. Redis moves the autonomous state machine. InsForge stores the
          evidence. Guild.ai governs the agent gates. FlowPR opens the verified pull request.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Current run contract</h2>
          <dl>
            <div>
              <dt>Repository</dt>
              <dd>{run.repoUrl}</dd>
            </div>
            <div>
              <dt>Preview</dt>
              <dd>{run.previewUrl}</dd>
            </div>
            <div>
              <dt>Flow</dt>
              <dd>{run.flowGoal}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{run.status}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <h2>Sponsor readiness</h2>
          <ul className="checks">
            {['TinyFish', 'Redis', 'InsForge', 'WunderGraph', 'Guild.ai', 'Senso', 'Shipables', 'Chainguard', 'Akash'].map(
              (name) => (
                <li key={name}>
                  <span>{name}</span>
                  <strong>configured in .env</strong>
                </li>
              ),
            )}
          </ul>
        </article>
      </section>
    </main>
  );
}

