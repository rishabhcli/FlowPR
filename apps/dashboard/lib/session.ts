import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadLocalEnv } from '@flowpr/tools/env';

export const FLOWPR_SESSION_COOKIE = 'flowpr_session';
export const LOCAL_OWNER_KEY = 'local-development';

function sessionSecret(): string | null {
  loadLocalEnv();
  const secret = process.env.FLOWPR_SESSION_SECRET?.trim();
  if (secret) return secret;
  return process.env.NODE_ENV === 'production' ? null : 'flowpr-local-session-secret';
}

export function createSessionValue(userId: string): string {
  const secret = sessionSecret();
  if (!secret) throw new Error('FLOWPR_SESSION_SECRET is required in production.');
  const encoded = Buffer.from(userId, 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifySessionValue(value: string): string | null {
  if (value === LOCAL_OWNER_KEY) return isLocalSessionEnabled() ? LOCAL_OWNER_KEY : null;
  const secret = sessionSecret();
  const [encoded, signature] = value.split('.');
  if (!secret || !encoded || !signature) return null;
  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  const receivedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) return null;
  try {
    const userId = Buffer.from(encoded, 'base64url').toString('utf8');
    return userId.trim() ? userId : null;
  } catch {
    return null;
  }
}

export function isLocalSessionEnabled(): boolean {
  loadLocalEnv();
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.FLOWPR_DATA_MODE === 'local' &&
    process.env.FLOWPR_ALLOW_LOCAL_SESSION === 'true'
  );
}

export async function getOwnerKey(): Promise<string | null> {
  const session = (await cookies()).get(FLOWPR_SESSION_COOKIE)?.value;
  if (!session || session === 'connected') return null;
  return verifySessionValue(session);
}
