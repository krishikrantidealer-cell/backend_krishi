const bcrypt = require('bcryptjs');

const hashData = async (data) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(data, salt);
};

const compareData = async (data, hashedData) => {
  return await bcrypt.compare(data, hashedData);
};

module.exports = { hashData, compareData };
