import { hash, verify, Algorithm } from '@node-rs/argon2';
import { env } from '../../../env.js';

/**
 * Argon2id parameters per Phase 3 §6.1:
 * memoryCost = 64 MB, timeCost = 3, parallelism = 1.
 */
const ARGON_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65_536, // 64 MiB in KiB
  timeCost: 3,
  parallelism: 1,
} as const;

/** Append the env-loaded pepper to the password before hashing/verifying. */
function pepper(password: string): string {
  return env.ADMIN_PASSWORD_PEPPER ? `${password}${env.ADMIN_PASSWORD_PEPPER}` : password;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(pepper(password), ARGON_OPTS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, pepper(password));
  } catch {
    return false;
  }
}
