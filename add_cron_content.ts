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

  // EPG Auto Refresh State (Just above it in the original code, but we can put this anywhere after other states)
`;

content = content.replace('// EPG Source REST Endpoints', stateVariables + '\n  // EPG Source REST Endpoints');

// Add Clock import if not exists
if (!content.includes('Clock,')) {
    content = content.replace('Calendar,', 'Calendar, Clock,');
}

const tabContent = `
          {activeTab === "cron" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col h-full">
                  <div className="mb-6 flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800 tracking-tight flex items-center">
                        <Clock className="w-5 h-5 mr-2 text-indigo-500" />
                        定时任务列表
                      </h2>
                      <p className="text-sm text-slate-500 mt-1">系统内置自动化任务，支持按时间间隔执行</p>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3">
                    {cronJobs.map((job) => (
                      <div 
                        key={job.id} 
                        onClick={() => setSelectedCronJob(job)}
                        className={\`p-4 rounded-xl border transition-colors cursor-pointer flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 \${selectedCronJob?.id === job.id ? 'border-indigo-400 bg-indigo-50/20' : 'border-slate-100 hover:border-slate-300'}\`}
                      >
                        <div className="flex items-start gap-4">
                          <div className={\`p-2.5 rounded-lg \${job.active ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}\`}>
                            <Clock className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                              {job.name}
                              {job.active === 1 ? (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase">激活</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black uppercase">未激活</span>
                              )}
                            </h3>
                            <p className="text-xs font-medium text-slate-500 mt-1">
                              开始时间: {job.startTime || "未设置"} | 间隔: {job.intervalMinutes || 0} 分钟
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              下次执行: {job.nextRun ? new Date(job.nextRun).toLocaleString() : "未知"}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={(e) => { e.stopPropagation(); runCronJobManual(job.id); }}
                            className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 font-semibold text-xs rounded-lg transition-colors"
                          >
                            立即执行
                          </button>
                        </div>
                      </div>
                    ))}
                    
                    {cronJobs.length === 0 && (
                      <div className="text-center py-12 text-slate-400 text-sm">暂无定时任务数据</div>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col h-full">
                  {selectedCronJob ? (
                    <>
                      <div className="mb-6">
                        <h2 className="text-xl font-bold text-slate-800 tracking-tight flex items-center">
                          <Settings2 className="w-5 h-5 mr-2 text-indigo-500" />
                          配置任务: {selectedCronJob.name}
                        </h2>
                      </div>
                      
                      <div className="space-y-4 mb-8 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                        <div>
                          <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">是否启用定时执行</label>
                          <label className="flex items-center cursor-pointer relative">
                            <input type="checkbox" className="sr-only peer" checked={selectedCronJob.active === 1} onChange={(e) => updateCronJob({...selectedCronJob, active: e.target.checked ? 1 : 0})} />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                            <span className="ml-3 text-sm font-semibold text-slate-700">{selectedCronJob.active === 1 ? "已启用" : "已禁用"}</span>
                          </label>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">初始每天开始时间 (HH:MM)</label>
                          <input 
                            type="time" 
                            value={selectedCronJob.startTime || ""}
                            onChange={(e) => updateCronJob({...selectedCronJob, startTime: e.target.value})}
                            className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 font-medium shadow-sm transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">重复间隔 (分钟)</label>
                          <input 
                            type="number" 
                            min="0"
                            value={selectedCronJob.intervalMinutes || 0}
                            onChange={(e) => updateCronJob({...selectedCronJob, intervalMinutes: parseInt(e.target.value) || 0})}
                            className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 font-medium shadow-sm transition-all"
                          />
                          <p className="text-[10px] text-slate-400 mt-1">例如: 1440 为每天一次，720 为每天两次。</p>
                        </div>
                      </div>

                      <div className="mb-4">
                        <h3 className="text-sm font-bold text-slate-800">执行历史记录 (最近 20 条)</h3>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto space-y-2 max-h-60">
                        {cronLogs.map((log) => (
                          <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-start gap-3">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                {log.status === "success" ? (
                                  <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase">成功</span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 text-[9px] font-black uppercase">失败</span>
                                )}
                                <span className="text-xs font-bold text-slate-600">{new Date(log.runAt).toLocaleString()}</span>
                              </div>
                              <p className="text-xs text-slate-500 font-medium break-all">{log.message}</p>
                            </div>
                          </div>
                        ))}
                        {cronLogs.length === 0 && (
                          <div className="text-center py-8 text-slate-400 text-xs font-medium">暂无运行日志</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-400 text-sm font-medium">
                      请在左侧选择一个定时任务查看详情
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {activeTab === "backup" && (
`;

content = content.replace('{activeTab === "backup" && (', tabContent);

fs.writeFileSync('src/App.tsx', content);
