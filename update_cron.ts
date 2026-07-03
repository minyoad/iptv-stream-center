import fs from 'fs';

let content = fs.readFileSync('server.ts', 'utf-8');

const calculateFn = `
function calculateNextRun(startTime: string, intervalMinutes: number, lastRunStr: string | null): string {
  const now = new Date();
  let nextRunTime = new Date();
  
  if (startTime) {
    const [hours, minutes] = startTime.split(':').map(Number);
    nextRunTime.setHours(hours, minutes, 0, 0);
    
    // If nextRunTime is in the past, add intervals until it's in the future
    while (nextRunTime <= now) {
      if (intervalMinutes && intervalMinutes > 0) {
        nextRunTime.setTime(nextRunTime.getTime() + intervalMinutes * 60 * 1000);
      } else {
        nextRunTime.setDate(nextRunTime.getDate() + 1);
      }
    }
  } else if (intervalMinutes && intervalMinutes > 0) {
    if (lastRunStr) {
      nextRunTime = new Date(new Date(lastRunStr).getTime() + intervalMinutes * 60 * 1000);
      if (nextRunTime <= now) {
         nextRunTime = new Date(now.getTime() + intervalMinutes * 60 * 1000);
      }
    } else {
      nextRunTime = new Date(now.getTime() + intervalMinutes * 60 * 1000);
    }
  } else {
    nextRunTime.setDate(nextRunTime.getDate() + 1);
  }

  return nextRunTime.toISOString();
}

async function runCronJob(job: any) {
  const nowStr = new Date().toISOString();
  db.prepare("UPDATE cron_jobs SET lastRun = ? WHERE id = ?").run(nowStr, job.id);
  
  const insertLog = db.prepare("INSERT INTO cron_logs (id, jobId, runAt, status, message) VALUES (?, ?, ?, ?, ?)");
  const logId = Math.random().toString(36).substring(2, 10);
  
  try {
    if (job.id === "job_epg_sync") {
      let successCount = 0;
      const activeSources = epgSources.filter((s) => s.active);
      for (const source of activeSources) {
        const success = await performEpgSync(source);
        if (success) successCount++;
      }
      insertLog.run(logId, job.id, nowStr, "success", \`成功同步 \${successCount}/\${activeSources.length} 个 EPG 源\`);
    } else if (job.id === "job_github_import") {
      let successCount = 0;
      const activeConfigs = syncConfigs.filter((c) => !c.disabled);
      for (const config of activeConfigs) {
        const success = await performSync(config);
        if (success) successCount++;
      }
      insertLog.run(logId, job.id, nowStr, "success", \`成功同步 \${successCount}/\${activeConfigs.length} 个 GitHub 订阅源\`);
    } else {
      insertLog.run(logId, job.id, nowStr, "failed", "未知的定时任务 ID");
    }
  } catch (err: any) {
    insertLog.run(logId, job.id, nowStr, "failed", err.message || "执行失败");
  }
  
  // Update nextRun
  const nextRun = calculateNextRun(job.startTime, job.intervalMinutes, nowStr);
  db.prepare("UPDATE cron_jobs SET nextRun = ? WHERE id = ?").run(nextRun, job.id);
}
`;

const schedulerReplace = `
// Background Cron-like Scheduler to perform Scheduled Sync
setInterval(async () => {
  const now = new Date();
  const nowStr = now.toISOString();
  
  // Periodically check and perform daily backups to prevent accidental loss
  checkAndPerformDailyBackup();

  // Run new cron jobs
  const jobs = db.prepare("SELECT * FROM cron_jobs WHERE active = 1").all() as any[];
  for (const job of jobs) {
    if (!job.nextRun || new Date(job.nextRun) <= now) {
      console.log(\`Starting scheduled cron job: \${job.name}\`);
      await runCronJob(job);
    }
  }

}, 60 * 1000); // Check tasks every minute
`;

// Also add APIs before checkAndPerformDailyBackup, wait, inside startServer!
const apiEndpoints = `
  // ==================== CRON JOBS ENDPOINTS ====================
  app.get("/api/cron-jobs", (req, res) => {
    try {
      const jobs = db.prepare("SELECT * FROM cron_jobs").all();
      res.json({ success: true, jobs });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.put("/api/cron-jobs/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { startTime, intervalMinutes, active } = req.body;
      const nextRun = calculateNextRun(startTime, intervalMinutes, null);
      
      db.prepare("UPDATE cron_jobs SET startTime = ?, intervalMinutes = ?, active = ?, nextRun = ? WHERE id = ?")
        .run(startTime, intervalMinutes, active ? 1 : 0, nextRun, id);
        
      res.json({ success: true, message: "定时任务已更新" });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.get("/api/cron-jobs/:id/logs", (req, res) => {
    try {
      const { id } = req.params;
      const logs = db.prepare("SELECT * FROM cron_logs WHERE jobId = ? ORDER BY runAt DESC LIMIT 20").all(id);
      res.json({ success: true, logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.post("/api/cron-jobs/:id/run", async (req, res) => {
    try {
      const { id } = req.params;
      const job = db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(id) as any;
      if (!job) return res.status(404).json({ error: "Job not found" });
      
      // Run async, don't wait for completion to send response if it takes too long, but we can wait for simple
      await runCronJob(job);
      res.json({ success: true, message: "手动触发执行成功" });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });
`;

content = content.replace(/\/\/ Background Cron-like Scheduler[\s\S]*?\}, 60 \* 1000\); \/\/ Check tasks every minute/, calculateFn + schedulerReplace);
content = content.replace("app.use(express.json({ limit: \"50mb\" }));", "app.use(express.json({ limit: \"50mb\" }));\n" + apiEndpoints);

fs.writeFileSync('server.ts', content);
