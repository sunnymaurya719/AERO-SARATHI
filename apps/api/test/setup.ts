// Provide the minimum env required by src/env.ts so modules that import it
// (e.g. the Razorpay client) can be loaded inside unit tests.
process.env.DATABASE_URL ??= 'postgresql://aero:aero@localhost:5432/aero_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.MONGO_URL ??= 'mongodb://localhost:27017/aero_test';
process.env.JWT_SECRET ??= 'test-jwt-secret-test-jwt-secret-1234';
process.env.NODE_ENV ??= 'test';
