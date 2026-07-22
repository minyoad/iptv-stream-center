import fs from 'fs';
let content = fs.readFileSync('src/types.ts', 'utf-8');
content = content.replace('clientProvinceReported?: string;', 'clientProvinceReported?: string;\n  isolated?: boolean;');
fs.writeFileSync('src/types.ts', content);
