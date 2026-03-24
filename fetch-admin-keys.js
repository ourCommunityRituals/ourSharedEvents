// Run this in Apps Script to get your admin keys
function logAdminKeys() {
  const props = PropertiesService.getScriptProperties();
  const brands = ['ROOT', 'ABC', 'CBC', 'CBL'];
  
  console.log('=== Admin Keys ===');
  brands.forEach(brand => {
    const key = `ADMIN_SECRET_${brand}`;
    const value = props.getProperty(key);
    console.log(`${key}: ${value || 'NOT SET'}`);
  });
}
