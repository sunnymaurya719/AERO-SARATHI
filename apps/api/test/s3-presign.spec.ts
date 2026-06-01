import { describe, it, expect } from 'vitest';
import {
  buildDocKey,
  isAllowedDocMime,
  presignPut,
  presignGet,
  ALLOWED_DOC_MIME,
  MAX_DOC_BYTES,
} from '../src/integrations/s3.js';

describe('buildDocKey', () => {
  it('namespaces by driver and doc type', () => {
    const key = buildDocKey('drv_123', 'LICENSE', 'uuid-abc', 'My License.pdf');
    expect(key).toBe('drivers/drv_123/LICENSE/uuid-abc-my-license.pdf');
  });

  it('slugifies unsafe filename characters', () => {
    const key = buildDocKey('d', 'RC', 'u', 'Rëgïstratïon @#$.PNG');
    expect(key).toMatch(/^drivers\/d\/RC\/u-/);
    expect(key).not.toMatch(/[@#$ ]/);
  });
});

describe('isAllowedDocMime', () => {
  it('accepts the configured MIME types', () => {
    for (const mime of ALLOWED_DOC_MIME) {
      expect(isAllowedDocMime(mime)).toBe(true);
    }
  });

  it('rejects disallowed MIME types', () => {
    expect(isAllowedDocMime('text/html')).toBe(false);
    expect(isAllowedDocMime('application/octet-stream')).toBe(false);
    expect(isAllowedDocMime('image/gif')).toBe(false);
  });
});

describe('document size limit', () => {
  it('caps documents at 10 MB', () => {
    expect(MAX_DOC_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('presigning', () => {
  it('produces a signed PUT URL pinning content-type and length', async () => {
    const url = await presignPut('drivers/d/LICENSE/u-file.pdf', 'application/pdf', 1024);
    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain('X-Amz-Expires=300');
  });

  it('produces a short-lived signed GET URL', async () => {
    const url = await presignGet('drivers/d/LICENSE/u-file.pdf');
    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain('X-Amz-Expires=300');
  });
});
