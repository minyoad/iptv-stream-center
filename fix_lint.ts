import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

const stateVariables = `
  // Cron Jobs State
  const [cronJobs, setCronJobs] = useState<any[]>([]);
  const [cronLogs, setCronLogs] = useState<any[]>([]);
  const [selectedCronJob, setSelectedCronJob] = useState<any>(null);

  const fetchCronJobs = async () => {
    try {
      const res = await fetch("/api/cron-jobs");
      const data = await res.json();
      if (data.success) {
        setCronJobs(data.jobs || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchCronLogs = async (jobId: string) => {
    try {
      const res = await fetch(\`/api/cron-jobs/\${jobId}/logs\`);
      const data = await res.json();
      if (data.success) {
        setCronLogs(data.logs || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const updateCronJob = async (job: any) => {
    try {
      const res = await fetch(\`/api/cron-jobs/\${job.id}\`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job),
      });
      if (res.ok) {
        toast("定时任务更新成功");
        fetchCronJobs();
      }
    } catch (e) {
      console.error(e);
      toast("更新失败");
    }
  };

  const runCronJobManual = async (jobId: string) => {
    try {
      toast("已触发执行...");
      const res = await fetch(\`/api/cron-jobs/\${jobId}/run\`, { method: "POST" });
      if (res.ok) {
        toast("手动执行完成");
        fetchCronJobs();
        if (selectedCronJob?.id === jobId) fetchCronLogs(jobId);
      }
    } catch (e) {
      console.error(e);
      toast("执行出错");
    }
  };

  useEffect(() => {
    if (activeTab === "cron") {
      fetchCronJobs();
    }
  }, [activeTab]);

  useEffect(() => {
    if (selectedCronJob) {
      fetchCronLogs(selectedCronJob.id);
    }
  }, [selectedCronJob]);
`;

// Insert it right after: const [activeTab, setActiveTab]
content = content.replace(
  'const [activeTab, setActiveTab] = useState<string>("dashboard"); // dashboard, channels, sync, export, epg',
  'const [activeTab, setActiveTab] = useState<string>("dashboard"); // dashboard, channels, sync, export, epg\n' + stateVariables
);

fs.writeFileSync('src/App.tsx', content);
