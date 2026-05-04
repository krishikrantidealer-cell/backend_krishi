const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=0';

async function searchMadeup() {
  try {
    const response = await axios.get(SHEET_URL);
    const stream = Readable.from(response.data);
    
    stream.pipe(csv())
      .on('data', (row) => {
        const colStr = row['Assigned Collections'] || '';
        if (colStr.toLowerCase().includes('madeup') || colStr.toLowerCase().includes('shop')) {
          console.log(`Found matching collection for ${row['Product Title']}: ${colStr}`);
        }
      })
      .on('end', () => {
        console.log('Search finished.');
      });
  } catch (error) {
    console.error(error);
  }
}

searchMadeup();
