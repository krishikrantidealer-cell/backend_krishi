const mongoose = require('mongoose');
require('dotenv').config();

const token = 'ePDLxuPZRNmkUl_WIKbug1:APA91bEctToFROn2keZzWR1Ho-je6j-I35MPWzphpV2U_W5nHX-3bpFMsZrvZ7Yxa-u0nhukLXnWcr3v4p8AcVFwA0wckQpXOWEy6Fn_Avm022XE6FuUzZM';

async function inject() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB...");

    // Update the first user found (typically your test user)
    const res = await mongoose.connection.db.collection('users').updateOne(
      {}, 
      { $set: { fcmToken: token } }
    );

    console.log("Token Injected successfully!", res);
  } catch (err) {
    console.error("Injection failed:", err);
  } finally {
    mongoose.connection.close();
    process.exit();
  }
}

inject();
