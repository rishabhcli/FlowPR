'use client';

import { FormEvent, useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import type { RiskLevel } from '@flowpr/schemas';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const defaults = {
  repoUrl: 'https://github.com/rishabhcli/FlowPR',
  previewUrl: 'http://localhost:3100',
  baseBranch: 'main',
  flowGoal:
    'On mobile, choose Pro on pricing, complete checkout, and reach success.',
  riskLevel: 'medium' as RiskLevel,
};

interface RunFormProps {
  onStart: (input: {
    repoUrl: string;
    previewUrl: string;
    baseBranch: string;
    flowGoal: string;
    riskLevel: RiskLevel;
  }) => Promise<void> | void;
  isStarting?: boolean;
}

export function RunForm({ onStart, isStarting = false }: RunFormProps) {
  const [repoUrl, setRepoUrl] = useState(defaults.repoUrl);
  const [previewUrl, setPreviewUrl] = useState(defaults.previewUrl);
  const [baseBranch, setBaseBranch] = useState(defaults.baseBranch);
  const [flowGoal, setFlowGoal] = useState(defaults.flowGoal);
  const [riskLevel, setRiskLevel] = useState<RiskLevel>(defaults.riskLevel);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onStart({ repoUrl, previewUrl, baseBranch, flowGoal, riskLevel });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="flow-goal">Flow goal</Label>
        <Textarea
          id="flow-goal"
          value={flowGoal}
          onChange={(e) => setFlowGoal(e.target.value)}
          rows={3}
          placeholder="Describe the user journey in plain English."
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="repo-url">Repository</Label>
          <Input
            id="repo-url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="base-branch">Base branch</Label>
          <Input
            id="base-branch"
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            placeholder="main"
            required
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="preview-url">Preview URL</Label>
          <Input
            id="preview-url"
            value={previewUrl}
            onChange={(e) => setPreviewUrl(e.target.value)}
            placeholder="https://preview.example.com"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="risk-level">Risk level</Label>
          <Select value={riskLevel} onValueChange={(value) => setRiskLevel(value as RiskLevel)}>
            <SelectTrigger id="risk-level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="submit" disabled={isStarting} size="lg" className="mt-1">
        {isStarting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Starting run…
          </>
        ) : (
          <>
            <Play className="h-4 w-4" /> Start autonomous run
          </>
        )}
      </Button>
    </form>
  );
}
