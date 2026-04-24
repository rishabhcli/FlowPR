create table if not exists runs (
  id uuid primary key,
  repo_url text not null,
  owner text not null,
  repo text not null,
  base_branch text not null default 'main',
  working_branch text,
  preview_url text not null,
  flow_goal text not null,
  status text not null check (
    status in (
      'queued',
      'loading_repo',
      'running_browser_qa',
      'triaging_failure',
      'retrieving_policy',
      'patching_code',
      'running_local_tests',
      'running_live_verification',
      'creating_pr',
      'done',
      'failed'
    )
  ),
  risk_level text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
  agent_name text not null,
  agent_version text not null,
  guild_trace_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists runs_created_at_idx on runs (created_at desc);
create index if not exists runs_status_idx on runs (status);
create index if not exists runs_repo_idx on runs (owner, repo);

create table if not exists timeline_events (
  id uuid primary key,
  run_id uuid not null references runs (id) on delete cascade,
  status text not null check (
    status in (
      'queued',
      'loading_repo',
      'running_browser_qa',
      'triaging_failure',
      'retrieving_policy',
      'patching_code',
      'running_local_tests',
      'running_live_verification',
      'creating_pr',
      'done',
      'failed'
    )
  ),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index if not exists timeline_events_run_id_created_at_idx
  on timeline_events (run_id, created_at asc);

create table if not exists provider_artifacts (
  id uuid primary key,
  run_id uuid not null references runs (id) on delete cascade,
  sponsor text not null,
  artifact_type text not null,
  provider_id text,
  artifact_url text,
  request_summary jsonb not null default '{}'::jsonb,
  response_summary jsonb not null default '{}'::jsonb,
  raw jsonb,
  created_at timestamptz not null
);

create index if not exists provider_artifacts_run_id_created_at_idx
  on provider_artifacts (run_id, created_at asc);
create index if not exists provider_artifacts_sponsor_idx
  on provider_artifacts (sponsor);

create table if not exists browser_observations (
  id uuid primary key,
  run_id uuid not null references runs (id) on delete cascade,
  provider text not null check (provider in ('tinyfish', 'playwright')),
  provider_id text,
  status text not null check (status in ('queued', 'passed', 'failed', 'errored')),
  failed_step text,
  expected_behavior text,
  observed_behavior text,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  screenshot_url text,
  raw jsonb,
  created_at timestamptz not null
);

create index if not exists browser_observations_run_id_created_at_idx
  on browser_observations (run_id, created_at asc);
create index if not exists browser_observations_provider_id_idx
  on browser_observations (provider_id);
