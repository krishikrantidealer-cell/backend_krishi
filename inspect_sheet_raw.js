const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=0';

async function inspectSheet() {
  try {
    const response = await axios.get(SHEET_URL);
    const rows = [];
    const stream = Readable.from(response.data);

    stream.pipe(csv())
      .on('data', (row) => {
        rows.push(row);
      })
      .on('end', () => {
        console.log('Total rows:', rows.length);
        console.log('\n--- HEADERS ---');
        console.log(Object.keys(rows[0]).join(' | '));
        
        console.log('\n--- FINDING GROW GENIUS ---');
        let foundProduct = false;
        for (let i = 0; i < rows.length; i++) {
          const brand = rows[i]['Product Brand Name '] ? rows[i]['Product Brand Name '].trim() : '';
          const title = rows[i]['Product Title'] ? rows[i]['Product Title'].trim() : '';
          
          if (brand.toLowerCase().includes('grow genius') || title.toLowerCase().includes('grow genius')) {
            foundProduct = true;
          } else if (brand && foundProduct) {
            // Reached next product, stop
            break;
          }

          if (foundProduct) {
            console.log(`\nRow ${i}: Brand: "${brand}", Title: "${title}"`);
            console.log(`Packing Sizes: "${rows[i]['Packing Sizes']}"`);
            console.log(`Variant 1 (Selling Price): "${rows[i]['Variant 1 (Selling Price) 10litre']}" | MRP: "${rows[i]['Variant 1 (MRP)']}"`);
            console.log(`Variant 2: "${rows[i]['Variant 2 Selling Price) 30litre']}" | MRP: "${rows[i]['Variant 2 (MRP)']}"`);
            console.log(`Variant 3: "${rows[i]['Variant 3 Selling Price) 50litre']}" | MRP: "${rows[i]['Variant 3 (MRP)']}"`);
            console.log(`Variant 4: "${rows[i]['Variant 4 Selling Price)']}" | MRP: "${rows[i]['Variant 4 (MRP)']}"`);
          }
        }
        process.exit(0);
      });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

inspectSheet();
