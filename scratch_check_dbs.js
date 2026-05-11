require('dotenv').config({ path: require('path').join(__dirname, './.env') });
const mongoose = require('mongoose');

async function checkDbs() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected successfully!");
    
    const db = mongoose.connection.db;
    console.log("\n1. Active Database Name:", mongoose.connection.name);
    
    // List collections
    const collections = await db.listCollections().toArray();
    console.log(`\n2. Collections in "${mongoose.connection.name}":`);
    if (collections.length === 0) {
      console.log("   (No collections found in this database)");
    } else {
      collections.forEach(c => console.log(`   - ${c.name}`));
    }
    
    // List all databases on the cluster
    const adminDb = db.admin();
    const dbsList = await adminDb.listDatabases();
    console.log("\n3. All Databases on this Cluster:");
    dbsList.databases.forEach(d => {
      console.log(`   - Name: "${d.name}", Size: ${(d.sizeOnDisk / (1024 * 1024)).toFixed(2)} MB, Empty: ${d.empty}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Database check failed:", error);
    process.exit(1);
  }
}

checkDbs();
