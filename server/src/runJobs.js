// One-off run of the scheduled jobs (for a Render cron job or manual use).
import { runJobs } from './jobs.js';
import { pool, migrate } from './db.js';

await migrate();
await runJobs();
await pool.end();
