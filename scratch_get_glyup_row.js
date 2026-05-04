const axios = require('axios');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=0';

async function getGlyupRow() {
  try {
    const response = await axios.get(SHEET_URL);
    const lines = response.data.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('GLYUP')) {
        start = i;
        break;
      }
    }
    if (start !== -1) {
      // Get a few lines around it to make sure we have the full row if it has newlines
      console.log('GLYUP Data:');
      console.log(lines.slice(start, start + 10).join('\n'));
    }
  } catch (error) {
    console.error(error);
  }
}

getGlyupRow();
