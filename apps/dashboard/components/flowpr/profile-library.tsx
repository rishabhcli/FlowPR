'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  Check,
  FolderKanban,
  Loader2,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type {
  FlowProfile,
  FlowProfileInput,
  PermissionProfile,
  RiskLevel,
} from '@flowpr/schemas';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { StateBadge } from '@/components/flowpr/state-badge';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ProfileLibraryProps {
  onRun: (profile: FlowProfile) => Promise<void> | void;
  busy?: boolean;
}

interface ProfileDraft {
  name: string;
  description: string;
  repoUrl: string;
  previewUrl: string;
  baseBranch: string;
  flowGoal: string;
  riskLevel: RiskLevel;
  permissionProfile: PermissionProfile;
  tags: string;
}

const initialDraft: ProfileDraft = {
  name: '',
  description: '',
  repoUrl: 'https://github.com/rishabhcli/FlowPR',
  previewUrl: 'http://localhost:3100',
  baseBranch: 'main',
  flowGoal: 'On mobile, choose Pro on pricing, complete checkout, and reach success.',
  riskLevel: 'medium',
  permissionProfile: 'draft-pr-only',
  tags: 'checkout, mobile',
};

function draftFromProfile(profile: FlowProfile): ProfileDraft {
  return {
    name: profile.name,
    description: profile.description ?? '',
    repoUrl: profile.repoUrl,
    previewUrl: profile.previewUrl,
    baseBranch: profile.baseBranch,
    flowGoal: profile.flowGoal,
    riskLevel: profile.riskLevel,
    permissionProfile: profile.permissionProfile,
    tags: profile.tags.join(', '),
  };
}

function inputFromDraft(draft: ProfileDraft): FlowProfileInput {
  return {
    name: draft.name,
    description: draft.description,
    repoUrl: draft.repoUrl,
    previewUrl: draft.previewUrl,
    baseBranch: draft.baseBranch,
    flowGoal: draft.flowGoal,
    riskLevel: draft.riskLevel,
    permissionProfile: draft.permissionProfile,
    tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    enabled: true,
  };
}

export function ProfileLibrary({ onRun, busy = false }: ProfileLibraryProps) {
  const [profiles, setProfiles] = useState<FlowProfile[]>([]);
  const [draft, setDraft] = useState<ProfileDraft>(initialDraft);
  const [editingId, setEditingId] = useState<string>();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function loadProfiles() {
    setLoading(true);
    try {
      const response = await fetch('/api/profiles', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not load flow profiles');
      setProfiles(body.profiles ?? []);
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfiles().catch(() => undefined);
  }, []);

  function beginCreate() {
    setEditingId(undefined);
    setDraft(initialDraft);
    setNotice(undefined);
    setError(undefined);
    setIsOpen(true);
  }

  function beginEdit(profile: FlowProfile) {
    setEditingId(profile.id);
    setDraft(draftFromProfile(profile));
    setNotice(undefined);
    setError(undefined);
    setIsOpen(true);
  }

  function closeEditor() {
    setIsOpen(false);
    setEditingId(undefined);
    setDraft(initialDraft);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch(editingId ? `/api/profiles/${editingId}` : '/api/profiles', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputFromDraft(draft)),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not save flow profile');
      await loadProfiles();
      setNotice(editingId ? 'Profile updated.' : 'Profile saved to this workspace.');
      closeEditor();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function toggleProfile(profile: FlowProfile) {
    setActionId(profile.id);
    setError(undefined);
    try {
      const response = await fetch(`/api/profiles/${profile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !profile.enabled }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not update profile');
      setProfiles((current) => current.map((item) => item.id === profile.id ? body.profile : item));
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    } finally {
      setActionId(undefined);
    }
  }

  async function deleteProfile(profile: FlowProfile) {
    if (!window.confirm(`Delete the "${profile.name}" profile?`)) return;
    setActionId(profile.id);
    setError(undefined);
    try {
      const response = await fetch(`/api/profiles/${profile.id}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not delete profile');
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      setNotice('Profile deleted.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setActionId(undefined);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              <FolderKanban className="h-3.5 w-3.5 text-primary" /> Saved flows
            </p>
            <p className="mt-1 text-lg font-semibold tracking-tight">QA playbooks</p>
            <p className="mt-1 text-xs text-muted-foreground">Run the same journey with an auditable, owner-scoped definition.</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={beginCreate} title="Create a saved flow profile">
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {notice && <Alert variant="success"><AlertDescription>{notice}</AlertDescription></Alert>}

        {isOpen && (
          <form onSubmit={saveProfile} className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{editingId ? 'Edit playbook' : 'New playbook'}</p>
              <Button type="button" variant="ghost" size="icon" onClick={closeEditor} title="Close profile editor" aria-label="Close profile editor">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="profile-name">Name</Label><Input id="profile-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Mobile checkout" required /></div>
              <div className="grid gap-1.5"><Label htmlFor="profile-tags">Tags</Label><Input id="profile-tags" value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="mobile, checkout" /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="profile-description">Description</Label><Input id="profile-description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="What this playbook protects" /></div>
            <div className="grid gap-1.5"><Label htmlFor="profile-goal">Flow goal</Label><Textarea id="profile-goal" rows={3} value={draft.flowGoal} onChange={(event) => setDraft({ ...draft, flowGoal: event.target.value })} required /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="profile-repo">Repository</Label><Input id="profile-repo" value={draft.repoUrl} onChange={(event) => setDraft({ ...draft, repoUrl: event.target.value })} required /></div>
              <div className="grid gap-1.5"><Label htmlFor="profile-preview">Preview URL</Label><Input id="profile-preview" value={draft.previewUrl} onChange={(event) => setDraft({ ...draft, previewUrl: event.target.value })} required /></div>
              <div className="grid gap-1.5"><Label htmlFor="profile-branch">Base branch</Label><Input id="profile-branch" value={draft.baseBranch} onChange={(event) => setDraft({ ...draft, baseBranch: event.target.value })} required /></div>
              <div className="grid gap-1.5"><Label htmlFor="profile-risk">Risk</Label><Select value={draft.riskLevel} onValueChange={(value) => setDraft({ ...draft, riskLevel: value as RiskLevel })}><SelectTrigger id="profile-risk"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="profile-permission">Permission profile</Label><Select value={draft.permissionProfile} onValueChange={(value) => setDraft({ ...draft, permissionProfile: value as PermissionProfile })}><SelectTrigger id="profile-permission"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="investigation-only">Investigation only</SelectItem><SelectItem value="draft-pr-only">Draft PR only</SelectItem><SelectItem value="verified-pr">Verified PR</SelectItem></SelectContent></Select></div>
            <Button type="submit" disabled={saving} className="w-full">{saving ? <Loader2 className="animate-spin" /> : <Save />} {saving ? 'Saving…' : 'Save playbook'}</Button>
          </form>
        )}

        {loading ? (
          <div className="flex items-center gap-2 px-1 py-5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading saved flows…</div>
        ) : profiles.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">No saved playbooks yet. Create one for a recurring journey.</div>
        ) : (
          <ul className="space-y-2">
            {profiles.map((profile) => (
              <li key={profile.id} className={cn('rounded-md border border-border/80 bg-background/40 p-3', !profile.enabled && 'opacity-60')}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{profile.name}</p>
                      <StateBadge state={profile.enabled ? 'ready' : 'skipped'} label={profile.enabled ? 'Enabled' : 'Disabled'} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{profile.description || profile.flowGoal}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      {profile.tags.map((tag) => <span key={tag} className="rounded border border-border/70 px-1.5 py-0.5">{tag}</span>)}
                      <span>{profile.runCount} {profile.runCount === 1 ? 'run' : 'runs'}</span>
                      {profile.lastRunAt && <span>· {formatRelativeTime(profile.lastRunAt)}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" size="icon" variant="ghost" onClick={() => onRun(profile)} disabled={busy || !profile.enabled || actionId === profile.id} title={`Run ${profile.name}`} aria-label={`Run ${profile.name}`}><Play className="h-3.5 w-3.5" /></Button>
                    <Button type="button" size="icon" variant="ghost" onClick={() => beginEdit(profile)} title={`Edit ${profile.name}`} aria-label={`Edit ${profile.name}`}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button type="button" size="icon" variant="ghost" onClick={() => toggleProfile(profile)} disabled={actionId === profile.id} title={profile.enabled ? `Disable ${profile.name}` : `Enable ${profile.name}`} aria-label={profile.enabled ? `Disable ${profile.name}` : `Enable ${profile.name}`}><Check className={cn('h-3.5 w-3.5', profile.enabled ? 'text-success' : 'text-muted-foreground')} /></Button>
                    <Button type="button" size="icon" variant="ghost" onClick={() => deleteProfile(profile)} disabled={actionId === profile.id} title={`Delete ${profile.name}`} aria-label={`Delete ${profile.name}`}><Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" /></Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
