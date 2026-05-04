const axios = require('axios');
const csv = require('csv-parser');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=0';

async function checkHeaders() {
  try {
    const response = await axios.get(SHEET_URL);
    const lines = response.data.split('\n');
    console.log('Headers:');
    console.log(lines[0]);
    console.log('First 5 rows:');
    for (let i = 1; i < 6; i++) {
      console.log(`Row ${i}: ${lines[i]}`);
    }
  } catch (error) {
    console.error(error);
  }
}

checkHeaders();
