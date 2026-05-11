const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=0';

async function checkPrices() {
  try {
    const response = await axios.get(SHEET_URL);
    const rows = [];
    const stream = Readable.from(response.data);

    stream.pipe(csv())
      .on('data', (row) => {
        rows.push(row);
      })
      .on('end', () => {
        console.log('Total spreadsheet rows:', rows.length);
        
        let checked = 0;
        rows.forEach((row, i) => {
          const cleanRow = {};
          Object.keys(row).forEach(key => {
            cleanRow[key.trim()] = row[key];
          });

          const keys = Object.keys(cleanRow);
          const v1Key = keys.find(k => k.includes('Variant 1 (Selling Price)'));
          const v2Key = keys.find(k => k.includes('Variant 2 (Selling Price)'));
          const v3Key = keys.find(k => k.includes('Variant 3 (Selling Price)'));
          const mrpKey = keys.find(k => k.includes('Variant (MRP)'));
          
          const brand = cleanRow['Product Brand Name'] || '';
          const size = cleanRow['Packing Sizes'] || '';

          if (v1Key && cleanRow[v1Key] && checked < 15) {
            checked++;
            console.log(`\nRow ${i} [${brand} - ${size}]:`);
            console.log(`  v1: "${cleanRow[v1Key]}"`);
            console.log(`  v2: "${cleanRow[v2Key]}"`);
            console.log(`  v3: "${cleanRow[v3Key]}"`);
            console.log(`  mrp: "${cleanRow[mrpKey]}"`);
          }
        });
        
        process.exit(0);
      });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

checkPrices();
