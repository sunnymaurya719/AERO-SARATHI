import { SignJWT, jwtVerify } from 'jose';
import { randomBytes, randomUUID } from 'node:crypto';
import { env } from '../../env.js';
import type { Role } from '@aero/db';

const secret = new TextEncoder().encode(env.JWT_SECRET);

export interface AccessClaims {
  sub: string;
  role: Role;
  jti: string;
}

export async function signAccessToken(sub: string, role: Role): Promise<{ token: string; jti: string }> {
  const jti = randomUUID();
  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_ACCESS_TTL}s`)
    .sign(secret);
  return { token, jti };
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  return { sub: payload.sub as string, role: payload.role as Role, jti: payload.jti as string };
}

/** Opaque refresh token, returned to client; only its hash is persisted. */
export function generateRefreshToken(): string {
  return `rk_${randomBytes(32).toString('base64url')}`;
}
