const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=0';

async function listAssignedCollections() {
  try {
    const response = await axios.get(SHEET_URL);
    const stream = Readable.from(response.data);
    const collections = new Set();
    
    stream.pipe(csv())
      .on('data', (row) => {
        const colStr = row['Assigned Collections'] || '';
        colStr.split(',').forEach(c => {
          if (c.trim()) collections.add(c.trim());
        });
      })
      .on('end', () => {
        console.log('Collections found in Sheet:');
        collections.forEach(c => console.log(`- ${c}`));
      });
  } catch (error) {
    console.error(error);
  }
}

listAssignedCollections();
