import fs from 'fs';

let content = fs.readFileSync('server.ts', 'utf-8');

const target = `        {
          id: "epg_fanmingming",
          name: "Fanmingming 高速公开 EPG XML 源",
          url: "https://live.fanmingming.com/e.xml",
          active: true,
          status: "never",
        },
        {
          id: "epg_51zmt",
          name: "51zmt 经典公开 EPG XML 源",
          url: "http://epg.51zmt.top:11111/e.xml",
          active: true,
          status: "never",
        }
      ];
      saveData();
    }

    // Run Migration: if groups collection or channel groupIds are missing
    let updated = false;
    if (groups.length === 0) {`;

const replace = `        {
          id: "epg_fanmingming",
          name: "Fanmingming 高速公开 EPG XML 源",
          url: "https://live.fanmingming.com/e.xml",
          active: true,
          status: "never",
        },
        {
          id: "epg_pw",
          name: "EPG.pw 公开 XML 源",
          url: "https://epg.pw/xmltv/epg_CN.xml",
          active: true,
          status: "never",
        }
      ];
      saveData();
    }

    // Run Migration: if groups collection or channel groupIds are missing
    let updated = false;
    
    // Migrate dead EPG sources
    epgSources.forEach((s) => {
      if (s.url === "http://epg.51zmt.top:11111/e.xml" || s.id === "epg_51zmt") {
        s.url = "https://epg.pw/xmltv/epg_CN.xml";
        s.name = "EPG.pw 公开 XML 源";
        s.id = "epg_pw";
        updated = true;
      }
    });

    if (groups.length === 0) {`;

content = content.replace(target, replace);
fs.writeFileSync('server.ts', content);
