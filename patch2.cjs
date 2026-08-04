const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /const filteredChannels = useMemo\(\(\) => \{[\s\S]*?\}, \[channels, groups, searchQuery, selectedCategory, channelFilterStatus\]\);\n  \}\);/;

const replacement = `const filteredChannels = useMemo(() => {
    const groupIdToName = new Map<string, string>();
    groups.forEach(g => groupIdToName.set(g.id, g.name));

    const cleanQuery = searchQuery.toLowerCase().replace(/[-_.\\s]+/g, "");

    return channels.filter(c => {
      const groupNames = c.groupIds.map(gId => groupIdToName.get(gId) || "").filter(Boolean);
      
      const matchesSearch = !cleanQuery ||
                            c.name.toLowerCase().replace(/[-_.\\s]+/g, "").includes(cleanQuery) ||
                            c.alias.some(a => a.toLowerCase().replace(/[-_.\\s]+/g, "").includes(cleanQuery)) ||
                            groupNames.some(gn => gn.toLowerCase().replace(/[-_.\\s]+/g, "").includes(cleanQuery));
      
      const matchesCategory = selectedCategory === "all" || groupNames.includes(selectedCategory);

      const matchesIsolation =
        channelFilterStatus === "all_with_isolated" ? true :
        channelFilterStatus === "isolated" ? !!c.isolated :
        !c.isolated;

      return matchesSearch && matchesCategory && matchesIsolation;
    });
  }, [channels, groups, searchQuery, selectedCategory, channelFilterStatus]);`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/App.tsx', code);
