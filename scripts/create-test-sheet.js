#!/usr/bin/env node
/**
 * Create TEST sheet for connectivity testing
 */

const { google } = require('googleapis');

async function main() {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  await auth.authorize();
  const sheets = google.sheets({ version: 'v4', auth });

  console.log('Creating TEST sheet...');

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.SHEETS_SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: 'TEST'
            }
          }
        }]
      }
    });
    console.log('✓ TEST sheet created successfully!');
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('TEST sheet already exists.');
    } else {
      console.error('✗ Failed:', error.message);
      process.exit(1);
    }
  }
}

main();
