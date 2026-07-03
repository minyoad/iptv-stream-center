import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

if (!content.includes('Settings2,')) {
    content = content.replace('Settings,', 'Settings, Settings2,');
}

fs.writeFileSync('src/App.tsx', content);
