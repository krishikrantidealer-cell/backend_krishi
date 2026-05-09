const axios = require('axios');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=0';

async function findGlyup() {
  try {
    const response = await axios.get(SHEET_URL);
    const lines = response.data.split('\n');
    console.log('Searching for Grow Genius...');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes('grow genius')) {
        console.log(`Found Grow Genius at line ${i}:`);
        console.log(lines[i]);
      }
    }
  } catch (error) {
    console.error(error);
  }
}

findGlyup();
