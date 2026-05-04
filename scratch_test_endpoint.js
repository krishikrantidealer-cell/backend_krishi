const axios = require('axios');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

async function testEndpoint() {
  try {
    const response = await axios.get('http://localhost:5000/api/collections/products');
    console.log('Success:', response.data.success);
    console.log('Collections count:', response.data.collections.length);
    if (response.data.collections.length > 0) {
      console.log('First collection products count:', response.data.collections[0].products.length);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testEndpoint();
