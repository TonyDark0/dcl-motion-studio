import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text());
});
await page.goto('http://127.0.0.1:5173/');
await page.getByText('Avatar listo', { exact: true }).waitFor({ timeout: 45000 });
await page.screenshot({ path: '../../work/editor-first.png', fullPage: true });
console.log((await page.locator('body').innerText()).slice(0, 5000));
await browser.close();
