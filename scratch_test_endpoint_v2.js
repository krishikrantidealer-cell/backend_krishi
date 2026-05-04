const axios = require('axios');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

async function testEndpoint() {
  try {
    const response = await axios.get('http://localhost:5000/api/collections/products');
    console.log('Success:', response.data.success);
    console.log('Collections count:', response.data.collections.length);
    console.log('Collections:', response.data.collections.map(c => c.name).join(', '));
  } catch (error) {
    if (error.response) {
      console.error('Server Error:', error.response.status, error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

testEndpoint();
