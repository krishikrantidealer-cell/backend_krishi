const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=0';

async function findHerbicides() {
  try {
    const response = await axios.get(SHEET_URL);
    const stream = Readable.from(response.data);
    
    stream.pipe(csv())
      .on('data', (row) => {
        const combined = Object.values(row).join(' ').toLowerCase();
        if (combined.includes('herbicide')) {
          console.log(`Product: ${row['Product Title']} | Variants: ${row['Variant 1 (Selling Price) 10litre'] || 'NONE'}`);
        }
      })
      .on('end', () => {
        console.log('Search finished.');
      });
  } catch (error) {
    console.error(error);
  }
}

findHerbicides();
