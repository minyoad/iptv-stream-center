import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Add "cron" to type activeTab
content = content.replace(
  'const [activeTab, setActiveTab] = useState<"dashboard" | "channels" | "sync" | "export" | "epg" | "backup">("dashboard");',
  'const [activeTab, setActiveTab] = useState<"dashboard" | "channels" | "sync" | "export" | "epg" | "backup" | "cron">("dashboard");'
);

// Add sidebar icon
const sidebarItem = `
            <button
              onClick={() => setActiveTab("cron")}
              className={\`w-full flex items-center p-3 sm:px-4 sm:py-3.5 rounded-xl transition-all font-medium text-[13px] \${
                activeTab === "cron" 
                  ? "bg-gradient-to-r from-blue-50 to-indigo-50/50 text-indigo-700 shadow-sm border border-indigo-100/50 relative" 
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }\`}
            >
              <Clock className={\`w-5 h-5 mr-3 \${activeTab === "cron" ? "text-indigo-600" : "text-slate-400"}\`} />
              定时系统任务
              {activeTab === "cron" && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-indigo-600 rounded-r-full shadow-sm" />}
            </button>
            <button
              onClick={() => setActiveTab("backup")}
`;
content = content.replace('<button\n              onClick={() => setActiveTab("backup")}', sidebarItem);

// Add Tab Title
content = content.replace('{activeTab === "backup" && "数据备份与系统完整恢复"}', '{activeTab === "backup" && "数据备份与系统完整恢复"}\n              {activeTab === "cron" && "自动化定时任务管理 (EPG & 订阅源)"}');

fs.writeFileSync('src/App.tsx', content);
