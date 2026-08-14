const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.stack || error.message));
  
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  
  // Click System Backup & Restore tab
  console.log('--- Navigating to Backup tab ---');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(x => x.textContent.includes('备份与恢复') || x.id === 'nav_backup');
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Create a dummy backup json
  const sampleBackup = {
    groups: [{ id: "test_g1", name: "测试恢复分组", isolated: false }],
    channels: [{ id: "test_ch1", name: "测试恢复频道", groupIds: ["test_g1"], alias: ["Test"], sources: [] }]
  };
  fs.writeFileSync('/tmp/test_backup.json', JSON.stringify(sampleBackup, null, 2));

  console.log('--- Uploading backup file ---');
  const inputEl = await page.$('#backup_file_upload_input');
  if (!inputEl) {
    console.error('Input #backup_file_upload_input not found!');
  } else {
    await inputEl.uploadFile('/tmp/test_backup.json');
    await new Promise(r => setTimeout(r, 1000));

    // Check if confirm modal popped up
    const modalText = await page.evaluate(() => document.body.innerText);
    console.log('Modal check - body text sample:', modalText.substring(modalText.indexOf('上传并还原'), modalText.indexOf('上传并还原') + 300));

    // Click confirm button if present
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const confirmBtn = btns.find(b => b.textContent.includes('确认') || b.textContent.includes('确定'));
      if (confirmBtn) {
        console.log('Clicking confirm button:', confirmBtn.textContent);
        confirmBtn.click();
      } else {
        console.log('Confirm button not found!');
      }
    });

    await new Promise(r => setTimeout(r, 2000));
    const afterRestoreText = await page.evaluate(() => document.body.innerText);
    console.log('After restore text sample:', afterRestoreText.substring(0, 500));
  }

  await browser.close();
})();
