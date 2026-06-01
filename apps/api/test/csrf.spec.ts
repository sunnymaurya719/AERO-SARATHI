import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  generateCsrfToken,
  csrfDoubleSubmit,
  CSRF_COOKIE,
  CSRF_HEADER,
} from '../src/modules/admin/auth/csrf.js';
import { AppError } from '../src/errors.js';

function mockReq(opts: {
  method: string;
  header?: string;
  cookie?: string;
  csrfToken?: string;
}): Request {
  return {
    method: opts.method,
    header: (name: string) => (name.toLowerCase() === CSRF_HEADER ? opts.header : undefined),
    cookies: opts.cookie ? { [CSRF_COOKIE]: opts.cookie } : {},
    admin: opts.csrfToken ? { csrfToken: opts.csrfToken } : undefined,
  } as unknown as Request;
}

const res = {} as Response;

describe('generateCsrfToken', () => {
  it('produces a 64-char hex token', () => {
    const t = generateCsrfToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unique per call', () => {
    expect(generateCsrfToken()).not.toBe(generateCsrfToken());
  });
});

describe('csrfDoubleSubmit', () => {
  it('passes through safe methods without a token', () => {
    const next = vi.fn();
    csrfDoubleSubmit(mockReq({ method: 'GET' }), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('accepts matching header + cookie + session token', () => {
    const token = generateCsrfToken();
    const next = vi.fn();
    csrfDoubleSubmit(mockReq({ method: 'POST', header: token, cookie: token, csrfToken: token }), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects when the header token is missing', () => {
    const token = generateCsrfToken();
    const next = vi.fn();
    csrfDoubleSubmit(mockReq({ method: 'POST', cookie: token, csrfToken: token }), res, next);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(AppError);
  });

  it('rejects when the header does not match the session token', () => {
    const token = generateCsrfToken();
    const next = vi.fn();
    csrfDoubleSubmit(
      mockReq({ method: 'POST', header: generateCsrfToken(), cookie: token, csrfToken: token }),
      res,
      next,
    );
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(AppError);
  });

  it('rejects when the cookie does not match', () => {
    const token = generateCsrfToken();
    const next = vi.fn();
    csrfDoubleSubmit(
      mockReq({ method: 'POST', header: token, cookie: generateCsrfToken(), csrfToken: token }),
      res,
      next,
    );
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(AppError);
  });
});
