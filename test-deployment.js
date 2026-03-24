const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const url = 'https://script.google.com/macros/s/AKfycbyFSdlFOFWm80Vt0DMLrxgNGwuK5KO9_PbWcb4nk_iYl-n6jL-wQaB3vzLxvZbibOML/exec?p=status';

  console.log(`Testing: ${url}`);

  try {
    const response = await page.goto(url);
    console.log('\n✅ Response Status:', response.status());
    console.log('Response Headers:', response.headers());

    const content = await page.content();
    console.log('\n📄 Page Content (first 500 chars):');
    console.log(content.substring(0, 500));

    const text = await page.textContent('body');
    console.log('\n📝 Body Text:');
    console.log(text);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }

  await browser.close();
})();
