create extension if not exists pgcrypto;

do $$
declare
  legacy_name text;
begin
  if to_regclass('public.timeline_events') is not null
    and not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'timeline_events'
        and column_name = 'sequence'
    )
  then
    legacy_name := 'timeline_events_legacy_phase1';

    if to_regclass('public.' || legacy_name) is not null then
      legacy_name := 'timeline_events_legacy_phase1_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
    end if;

    execute format('alter table public.timeline_events rename to %I', legacy_name);
  end if;

  if to_regclass('public.provider_artifacts') is not null
    and not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'provider_artifacts'
        and column_name = 'storage_key'
    )
  then
    legacy_name := 'provider_artifacts_legacy_phase1';

    if to_regclass('public.' || legacy_name) is not null then
      legacy_name := 'provider_artifacts_legacy_phase1_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
    end if;

    execute format('alter table public.provider_artifacts rename to %I', legacy_name);
  end if;

  if to_regclass('public.browser_observations') is not null
    and not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'browser_observations'
        and column_name = 'provider_run_id'
    )
  then
    legacy_name := 'browser_observations_legacy_phase1';

    if to_regclass('public.' || legacy_name) is not null then
      legacy_name := 'browser_observations_legacy_phase1_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
    end if;

    execute format('alter table public.browser_observations rename to %I', legacy_name);
  end if;
end $$;

create or replace function public.flowpr_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists projects (
  id uuid constraint flowpr_projects_pkey primary key default gen_random_uuid(),
  repo_url text not null,
  owner text not null,
  repo text not null,
  default_branch text not null default 'main',
  production_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_owner_repo_key unique (owner, repo)
);

drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at
  before update on projects
  for each row
  execute function public.flowpr_set_updated_at();

create table if not exists qa_runs (
  id uuid constraint flowpr_qa_runs_pkey primary key default gen_random_uuid(),
  project_id uuid not null constraint qa_runs_project_id_fkey references projects (id) on delete cascade,
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
  started_at timestamptz,
  completed_at timestamptz,
  failure_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists qa_runs_created_at_idx on qa_runs (created_at desc);
create index if not exists qa_runs_status_idx on qa_runs (status);
create index if not exists qa_runs_project_created_at_idx on qa_runs (project_id, created_at desc);
create index if not exists qa_runs_repo_idx on qa_runs (owner, repo);

drop trigger if exists qa_runs_set_updated_at on qa_runs;
create trigger qa_runs_set_updated_at
  before update on qa_runs
  for each row
  execute function public.flowpr_set_updated_at();

do $$
begin
  if to_regclass('public.runs') is not null then
    insert into projects (repo_url, owner, repo, default_branch, created_at, updated_at)
    select
      min(repo_url) as repo_url,
      owner,
      repo,
      min(base_branch) as default_branch,
      min(created_at) as created_at,
      max(updated_at) as updated_at
    from runs
    group by owner, repo
    on conflict (owner, repo) do update
    set
      repo_url = excluded.repo_url,
      default_branch = excluded.default_branch,
      updated_at = greatest(projects.updated_at, excluded.updated_at);

    insert into qa_runs (
      id,
      project_id,
      repo_url,
      owner,
      repo,
      base_branch,
      working_branch,
      preview_url,
      flow_goal,
      status,
      risk_level,
      agent_name,
      agent_version,
      guild_trace_id,
      started_at,
      completed_at,
      created_at,
      updated_at
    )
    select
      runs.id,
      projects.id,
      runs.repo_url,
      runs.owner,
      runs.repo,
      runs.base_branch,
      runs.working_branch,
      runs.preview_url,
      runs.flow_goal,
      runs.status,
      runs.risk_level,
      runs.agent_name,
      runs.agent_version,
      runs.guild_trace_id,
      runs.created_at,
      case when runs.status in ('done', 'failed') then runs.updated_at else null end,
      runs.created_at,
      runs.updated_at
    from runs
    join projects on projects.owner = runs.owner and projects.repo = runs.repo
    on conflict (id) do nothing;
  end if;
end $$;

create table if not exists flow_specs (
  id uuid constraint flowpr_flow_specs_pkey primary key default gen_random_uuid(),
  project_id uuid not null constraint flow_specs_project_id_fkey references projects (id) on delete cascade,
  run_id uuid not null constraint flow_specs_run_id_fkey references qa_runs (id) on delete cascade,
  name text not null,
  goal text not null,
  entry_url text not null,
  viewport jsonb not null default '{"width":390,"height":844}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  success_criteria jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists flow_specs_run_id_idx on flow_specs (run_id);
create index if not exists flow_specs_project_id_idx on flow_specs (project_id);

create table if not exists timeline_events (
  id uuid constraint flowpr_timeline_events_pkey primary key default gen_random_uuid(),
  run_id uuid not null constraint timeline_events_qa_run_id_fkey references qa_runs (id) on delete cascade,
  sequence integer not null,
  actor text not null check (
    actor in (
      'user',
      'system',
      'worker',
      'agent',
      'insforge',
      'github',
      'redis',
      'tinyfish',
      'senso',
      'guildai',
      'shipables',
      'akash',
      'wundergraph',
      'playwright'
    )
  ),
  phase text not null,
  status text not null check (status in ('started', 'completed', 'failed', 'skipped', 'info')),
  title text not null,
  detail text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint timeline_events_run_sequence_key unique (run_id, sequence)
);

create index if not exists flowpr_timeline_events_run_sequence_idx on timeline_events (run_id, sequence asc);
create index if not exists flowpr_timeline_events_run_created_at_idx on timeline_events (run_id, created_at asc);

create or replace function public.flowpr_assign_timeline_sequence()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.run_id::text));

  if new.sequence is null or new.sequence < 1 then
    select coalesce(max(sequence), 0) + 1
    into new.sequence
    from timeline_events
    where run_id = new.run_id;
  end if;

  return new;
end;
$$;

drop trigger if exists timeline_events_assign_sequence on timeline_events;
create trigger timeline_events_assign_sequence
  before insert on timeline_events
  for each row
  execute function public.flowpr_assign_timeline_sequence();

create table if not exists provider_artifacts (
  id uuid constraint flowpr_provider_artifacts_pkey primary key default gen_random_uuid(),
  run_id uuid not null constraint provider_artifacts_qa_run_id_fkey references qa_runs (id) on delete cascade,
  sponsor text not null,
  artifact_type text not null,
  provider_id text,
  artifact_url text,
  storage_bucket text,
  storage_key text,
  request_summary jsonb not null default '{}'::jsonb,
  response_summary jsonb not null default '{}'::jsonb,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists flowpr_provider_artifacts_run_created_at_idx on provider_artifacts (run_id, created_at asc);
create index if not exists flowpr_provider_artifacts_sponsor_idx on provider_artifacts (sponsor);
create index if not exists flowpr_provider_artifacts_provider_id_idx on provider_artifacts (provider_id);

create table if not exists browser_observations (
  id uuid constraint flowpr_browser_observations_pkey primary key default gen_random_uuid(),
  run_id uuid not null constraint browser_observations_qa_run_id_fkey references qa_runs (id) on delete cascade,
  provider text not null check (provider in ('tinyfish', 'playwright')),
  provider_run_id text,
  status text not null check (status in ('queued', 'passed', 'failed', 'errored')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  failed_step text,
  expected_behavior text,
  observed_behavior text,
  viewport jsonb not null default '{}'::jsonb,
  screenshot_url text,
  screenshot_key text,
  trace_url text,
  trace_key text,
  dom_summary text,
  console_errors jsonb not null default '[]'::jsonb,
  network_errors jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists flowpr_browser_observations_run_created_at_idx on browser_observations (run_id, created_at asc);
create index if not exists flowpr_browser_observations_provider_run_id_idx on browser_observations (provider_run_id);

create table if not exists bug_hypotheses (
  id uuid constraint flowpr_bug_hypotheses_pkey primary key default gen_random_uuid(),
  run_id uuid not null constraint bug_hypotheses_run_id_fkey references qa_runs (id) on delete cascade,
  summary text not null,
  affected_flow text not null,
  suspected_cause text,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  acceptance_criteria jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bug_hypotheses_run_id_idx on bug_hypotheses (run_id);

create table if not exists patches (
  id uuid constraint flowpr_patches_pkey primary key default gen_random_uuid(),
  run_id uuid not null constraint patches_run_id_fkey references qa_runs (id) on delete cascade,
  hypothesis_id uuid constraint patches_hypothesis_id_fkey references bug_hypotheses (id) on delete set null,
  branch_name text,
  commit_sha text,
  status text not null check (status in ('planned', 'generated', 'applied', 'tested', 'failed', 'abandoned')),
  summary text not null,
  diff_stat jsonb not null default '{}'::jsonb,
  files_changed jsonb not null default '[]'::jsonb,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists patches_run_id_idx on patches (run_id);
create index if not exists patches_hypothesis_id_idx on patches (hypothesis_id);

drop trigger if exists patches_set_updated_at on patches;
create trigger patches_set_updated_at
  before update on patches
  for each row
  execute function public.flowpr_set_updated_at();

create table if not exists verification_results (
  id uuid constraint flowpr_verification_results_pkey primary key default gen_random_uuid(),
  run_id uuid not null constraint verification_results_run_id_fkey references qa_runs (id) on delete cascade,
  patch_id uuid constraint verification_results_patch_id_fkey references patches (id) on delete set null,
  provider text not null,
  status text not null check (status in ('queued', 'passed', 'failed', 'errored', 'skipped')),
  summary text not null,
  test_command text,
  artifacts jsonb not null default '[]'::jsonb,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists verification_results_run_id_idx on verification_results (run_id);
create index if not exists verification_results_patch_id_idx on verification_results (patch_id);

create table if not exists pull_requests (
  id uuid constraint flowpr_pull_requests_pkey primary key default gen_random_uuid(),
  run_id uuid not null constraint pull_requests_run_id_fkey references qa_runs (id) on delete cascade,
  patch_id uuid constraint pull_requests_patch_id_fkey references patches (id) on delete set null,
  provider text not null default 'github',
  number integer,
  title text not null,
  branch_name text not null,
  base_branch text not null,
  url text,
  status text not null check (status in ('draft', 'open', 'merged', 'closed', 'failed')),
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pull_requests_run_id_idx on pull_requests (run_id);
create index if not exists pull_requests_patch_id_idx on pull_requests (patch_id);
create index if not exists pull_requests_provider_number_idx on pull_requests (provider, number);

drop trigger if exists pull_requests_set_updated_at on pull_requests;
create trigger pull_requests_set_updated_at
  before update on pull_requests
  for each row
  execute function public.flowpr_set_updated_at();

create table if not exists policy_hits (
  id uuid constraint flowpr_policy_hits_pkey primary key default gen_random_uuid(),
  run_id uuid not null constraint policy_hits_run_id_fkey references qa_runs (id) on delete cascade,
  provider text not null,
  query text not null,
  title text,
  source_url text,
  summary text,
  score numeric,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists policy_hits_run_id_idx on policy_hits (run_id);
create index if not exists policy_hits_provider_idx on policy_hits (provider);

create table if not exists agent_memories (
  id uuid constraint flowpr_agent_memories_pkey primary key default gen_random_uuid(),
  project_id uuid not null constraint agent_memories_project_id_fkey references projects (id) on delete cascade,
  run_id uuid constraint agent_memories_run_id_fkey references qa_runs (id) on delete set null,
  scope text not null,
  key text not null,
  value jsonb not null,
  confidence numeric not null default 1.0,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_memories_project_scope_key_key unique (project_id, scope, key)
);

create index if not exists agent_memories_run_id_idx on agent_memories (run_id);

drop trigger if exists agent_memories_set_updated_at on agent_memories;
create trigger agent_memories_set_updated_at
  before update on agent_memories
  for each row
  execute function public.flowpr_set_updated_at();

create table if not exists agent_sessions (
  id uuid constraint flowpr_agent_sessions_pkey primary key default gen_random_uuid(),
  run_id uuid not null constraint agent_sessions_run_id_fkey references qa_runs (id) on delete cascade,
  sponsor text not null default 'guildai',
  provider_session_id text,
  status text not null check (status in ('created', 'running', 'completed', 'failed')),
  goal text not null,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_sessions_run_id_idx on agent_sessions (run_id);
create index if not exists agent_sessions_provider_session_id_idx on agent_sessions (provider_session_id);

drop trigger if exists agent_sessions_set_updated_at on agent_sessions;
create trigger agent_sessions_set_updated_at
  before update on agent_sessions
  for each row
  execute function public.flowpr_set_updated_at();

create table if not exists action_gates (
  id uuid constraint flowpr_action_gates_pkey primary key default gen_random_uuid(),
  run_id uuid not null constraint action_gates_run_id_fkey references qa_runs (id) on delete cascade,
  session_id uuid constraint action_gates_session_id_fkey references agent_sessions (id) on delete set null,
  gate_type text not null,
  risk_level text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
  status text not null check (status in ('pending', 'allowed', 'blocked', 'approved', 'rejected')),
  reason text not null,
  requested_by text not null,
  resolved_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists action_gates_run_id_idx on action_gates (run_id);
create index if not exists action_gates_session_id_idx on action_gates (session_id);
create index if not exists action_gates_status_idx on action_gates (status);

create table if not exists benchmark_evaluations (
  id uuid constraint flowpr_benchmark_evaluations_pkey primary key default gen_random_uuid(),
  run_id uuid not null constraint benchmark_evaluations_run_id_fkey references qa_runs (id) on delete cascade,
  sponsor text not null default 'guildai',
  benchmark_name text not null,
  score numeric,
  status text not null check (status in ('passed', 'failed', 'errored', 'skipped')),
  metrics jsonb not null default '{}'::jsonb,
  artifact_url text,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists benchmark_evaluations_run_id_idx on benchmark_evaluations (run_id);
create index if not exists benchmark_evaluations_sponsor_idx on benchmark_evaluations (sponsor);

do $$
begin
  if to_regclass('public.timeline_events_legacy_phase1') is not null then
    insert into timeline_events (id, run_id, sequence, actor, phase, status, title, data, created_at)
    select
      id,
      run_id,
      row_number() over (partition by run_id order by created_at asc, id asc)::integer as sequence,
      'system' as actor,
      status as phase,
      case when status = 'failed' then 'failed' when status = 'queued' then 'started' else 'completed' end as status,
      message as title,
      metadata as data,
      created_at
    from timeline_events_legacy_phase1
    where exists (select 1 from qa_runs where qa_runs.id = timeline_events_legacy_phase1.run_id)
    on conflict (id) do nothing;
  end if;

  if to_regclass('public.provider_artifacts_legacy_phase1') is not null then
    insert into provider_artifacts (
      id,
      run_id,
      sponsor,
      artifact_type,
      provider_id,
      artifact_url,
      request_summary,
      response_summary,
      raw,
      created_at
    )
    select
      id,
      run_id,
      sponsor,
      artifact_type,
      provider_id,
      artifact_url,
      request_summary,
      response_summary,
      raw,
      created_at
    from provider_artifacts_legacy_phase1
    where exists (select 1 from qa_runs where qa_runs.id = provider_artifacts_legacy_phase1.run_id)
    on conflict (id) do nothing;
  end if;

  if to_regclass('public.browser_observations_legacy_phase1') is not null then
    insert into browser_observations (
      id,
      run_id,
      provider,
      provider_run_id,
      status,
      severity,
      failed_step,
      expected_behavior,
      observed_behavior,
      screenshot_url,
      raw,
      created_at
    )
    select
      id,
      run_id,
      provider,
      provider_id,
      status,
      severity,
      failed_step,
      expected_behavior,
      observed_behavior,
      screenshot_url,
      raw,
      created_at
    from browser_observations_legacy_phase1
    where exists (select 1 from qa_runs where qa_runs.id = browser_observations_legacy_phase1.run_id)
    on conflict (id) do nothing;
  end if;
end $$;
