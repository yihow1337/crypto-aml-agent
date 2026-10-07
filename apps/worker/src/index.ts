import { createApp } from './app';
import { jobForCron, runJob } from './cron';
import type { Env } from './env';
import { SubrequestBudget } from './lib/http';

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const job = jobForCron(controller.cron);
    if (!job) return;
    ctx.waitUntil(
      runJob(job, env, new SubrequestBudget()).then(
        (stats) => console.log(`cron ${job}`, JSON.stringify(stats)),
        (err) => console.error(`cron ${job} failed`, err),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
