import { createApp } from './app';
import { executeJob, jobForCron } from './cron';
import type { Env } from './env';
import { SubrequestBudget } from './lib/http';

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const job = jobForCron(controller.cron);
    if (!job) return;
    ctx.waitUntil(
      executeJob(job, env, new SubrequestBudget()).then((run) =>
        (run.ok ? console.log : console.error)(`cron ${job}`, JSON.stringify(run)),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
