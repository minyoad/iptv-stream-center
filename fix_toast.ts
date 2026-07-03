import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

content = content.replace(/toast\(/g, 'alert(');

fs.writeFileSync('src/App.tsx', content);
