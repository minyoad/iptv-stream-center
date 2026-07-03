import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

const cronTabButton = `          <button 
            onClick={() => setActiveTab("cron")}
            className={\`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition text-xs font-semibold \${
              activeTab === "cron" 
              ? "bg-blue-50/75 text-blue-700 font-bold" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }\`}
            id="nav_cron"
          >
            <Clock className={\`w-4 h-4 \${activeTab === "cron" ? "text-blue-500" : "text-slate-400"}\`} />
            定时任务设置
          </button>
`;

if (!content.includes('id="nav_cron"')) {
    content = content.replace(
        '<button \n            onClick={() => setActiveTab("backup")}',
        cronTabButton + '\n          <button \n            onClick={() => setActiveTab("backup")}'
    );
}

fs.writeFileSync('src/App.tsx', content);
