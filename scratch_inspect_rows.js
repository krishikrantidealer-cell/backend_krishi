const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=0';

async function inspectRows() {
  try {
    const response = await axios.get(SHEET_URL);
    const stream = Readable.from(response.data);
    let rowNum = 0;

    stream.pipe(csv())
      .on('data', (row) => {
        rowNum++;
        const brand = row['Product Brand Name '] ? row['Product Brand Name '].trim() : '';
        const size = row['Packing Sizes'] ? row['Packing Sizes'].trim() : '';
        const v1Price = row['Variant 1 (Selling Price) 10litre'] || '';
        const v2Price = row['Variant 2 Selling Price) 30litre'] || '';
        const v3Price = row['Variant 3 Selling Price) 50litre'] || '';
        const v4Price = row['Variant 4 Selling Price)'] || '';

        console.log(`Row ${rowNum}: Brand: "${brand}", Size: "${size}", V1: "${v1Price}", V2: "${v2Price}", V3: "${v3Price}", V4: "${v4Price}"`);
      })
      .on('end', () => {
        console.log('Finished inspection.');
      });
  } catch (error) {
    console.error(error);
  }
}

inspectRows();
