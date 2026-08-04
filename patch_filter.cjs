const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `  const filteredChannels = useMemo(() => {
    return channels.filter(c => {
    const groupNames = c.groupIds.map(gId => groups.find(g => g.id === gId)?.name || "").filter(Boolean);
    const cleanQuery = searchQuery.toLowerCase().replace(/[-_.\\s]+/g, "");
    const matchesSearch = !cleanQuery ||
                          c.name.toLowerCase().replace(/[-_.\\s]+/g, "").includes(cleanQuery) ||
                          c.alias.some(a => a.toLowerCase().replace(/[-_.\\s]+/g, "").includes(cleanQuery)) ||
                          groupNames.some(gn => gn.toLowerCase().replace(/[-_.\\s]+/g, "").includes(cleanQuery));
      
    const matchesCategory = selectedCategory === "all" || c.groupIds.some(gId => {
      const g = groups.find(gl => gl.id === gId);
      return g && g.name === selectedCategory;
    });

    const matchesIsolation =
      channelFilterStatus === "all_with_isolated" ? true :
      channelFilterStatus === "isolated" ? !!c.isolated :
      !c.isolated;

    });
  }, [channels, groups, searchQuery, selectedCategory, channelFilterStatus]);`;

const replacement = `  const filteredChannels = useMemo(() => {
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

code = code.replace(target, replacement);
fs.writeFileSync('src/App.tsx', code);
