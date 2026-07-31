const fs = require('fs');
const db = JSON.parse(fs.readFileSync('data/db.json'));
db.channels.forEach(ch => {
  if (ch.name.includes("动作")) {
     console.log(ch.name);
     ch.sources.forEach(s => {
       console.log("  ", s.isp, s.url);
     });
  }
});
