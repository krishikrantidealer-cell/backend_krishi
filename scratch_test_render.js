const axios = require('axios');

async function testRender() {
  try {
    const response = await axios.get('https://backend-krishi.onrender.com/api/collections/products');
    console.log('Render Success:', response.data.success);
    console.log('Collections count:', response.data.collections.length);
  } catch (error) {
    if (error.response) {
      console.error('Render Error:', error.response.status, error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

testRender();
