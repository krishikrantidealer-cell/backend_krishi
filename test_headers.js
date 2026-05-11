const axios = require('axios');
const csv = require('csv-parser');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=0';

async function test() {
  const response = await axios.get(SHEET_URL, { responseType: 'stream' });
  let count = 0;
  response.data
    .pipe(csv())
    .on('data', (row) => {
      if (count < 3) {
        console.log(`ROW ${count + 1}:`, row);
        count++;
      } else {
        process.exit(0);
      }
    })
    .on('error', (err) => {
      console.error(err);
    });
}
test();
