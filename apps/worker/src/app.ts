import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from './env';
import { ApiError, errorBody, toApiError } from './lib/errors';
import { DEFAULT_SUBREQUEST_LIMIT, SubrequestBudget } from './lib/http';
import { isAllowedOrigin } from './middleware';
import { registerAgentRoutes } from './routes/agent';
import { registerCoreRoutes } from './routes/core';
import { registerMonitorRoutes } from './routes/monitor';

export interface AppOptions {
  /** Injected fetch for tests; defaults to the global fetch. */
  fetcher?: typeof fetch;
}

export function createApp(opts: AppOptions = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const newBudget = () => new SubrequestBudget(DEFAULT_SUBREQUEST_LIMIT, opts.fetcher);

  app.use(
    '/api/*',
    cors({
      origin: (origin, c) => (isAllowedOrigin(origin, c.env as Env) ? origin : null),
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['content-type', 'x-admin-token'],
      exposeHeaders: ['Retry-After'],
      maxAge: 86400,
    }),
  );

  app.get('/', (c) =>
    c.json({ name: 'Crypto AML Agent API', docs: '/api/health', note: '請透過前端網站使用本服務。' }),
  );

  registerCoreRoutes(app, newBudget);
  registerAgentRoutes(app, newBudget);
  registerMonitorRoutes(app, newBudget);

  app.notFound((c) => c.json(errorBody(new ApiError(404, 'NOT_FOUND', '找不到此 API 路徑。')), 404));
  app.onError((err, c) => {
    const e = toApiError(err);
    if (e.code === 'INTERNAL') console.error(err);
    if (e.retryAfter) c.header('Retry-After', String(e.retryAfter));
    return c.json(errorBody(e), e.status as ContentfulStatusCode);
  });
  return app;
}
