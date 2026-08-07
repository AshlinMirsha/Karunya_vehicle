import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));

  // We need to serve the directory first, or use file:// protocol.
  // Using file:// protocol might run into CORS issues with modules.
  // Let's just run a quick server and hit it.
  
  await browser.close();
})();
