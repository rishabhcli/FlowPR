const SECRET_PATTERNS: Array<{ pattern: RegExp; replace: (match: string) => string }> = [
  {
    pattern: /(api[_-]?key|token|secret|password)(\s*[:=]\s*)(["']?)([^\s"',]+)\3/gi,
    replace: (match) => match.replace(/([:=]\s*)(["']?)([^\s"',]+)\2$/u, '$1$2[redacted]$2'),
  },
  {
    pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/g,
    replace: () => 'Bearer [redacted]',
  },
  {
    pattern: /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
    replace: () => '[redacted.jwt]',
  },
  {
    pattern: /(sk[-_])[A-Za-z0-9_-]{16,}/g,
    replace: (match) => `${match.slice(0, 6)}[redacted]`,
  },
  {
    pattern: /(gh[pousr]_)[A-Za-z0-9]{20,}/g,
    replace: (match) => `${match.slice(0, 4)}[redacted]`,
  },
];

export function redactSecrets(value: string): string {
  let result = value;

  for (const rule of SECRET_PATTERNS) {
    result = result.replace(rule.pattern, (match) => rule.replace(match));
  }

  return result;
}

export function redactObject<T>(value: T): T {
  if (typeof value === 'string') {
    return redactSecrets(value) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactObject(entry)) as unknown as T;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(record)) {
      if (/api[_-]?key|token|secret|password/i.test(key)) {
        output[key] = '[redacted]';
        continue;
      }

      output[key] = redactObject(entry);
    }

    return output as unknown as T;
  }

  return value;
}
