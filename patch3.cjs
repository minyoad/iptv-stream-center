const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /const categoryCounts = useMemo\(\(\) => \{[\s\S]*?\}, \[channels, groups\]\);/;

const replacement = `const categoryCounts = useMemo(() => {
    const map: Record<string, number> = { all: channels.length };
    
    // Initialize group counts to 0
    groups.forEach((g) => { map[g.name] = 0; });
    
    // Map group id to group name for fast lookup
    const groupIdToName = new Map<string, string>();
    groups.forEach(g => groupIdToName.set(g.id, g.name));

    // Count channels for each group
    channels.forEach(c => {
      c.groupIds.forEach(gId => {
        const name = groupIdToName.get(gId);
        if (name && map[name] !== undefined) {
          map[name]++;
        }
      });
    });

    return map;
  }, [channels, groups]);`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/App.tsx', code);
