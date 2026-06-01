import type { Role } from '@aero/db';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      user?: { id: string; role: Role; jti: string };
    }
  }
}

export {};
