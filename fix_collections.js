require('dotenv').config();
const connectDB = require('./config/db');
const Product = require('./models/Product');
const Collection = require('./models/Collection');

async function fixCollections() {
  await connectDB();
  console.log("Connected to DB");

  const collections = await Collection.find({});
  const idToNameMap = {};
  
  collections.forEach(col => {
    idToNameMap[col._id.toString()] = col.name;
    if (col.subCollections) {
      col.subCollections.forEach(sub => {
        idToNameMap[sub._id.toString()] = sub.name;
      });
    }
  });

  console.log("Built ID to Name Map");

  const products = await Product.find({ assignedCollections: { $exists: true, $not: { $size: 0 } } });
  let updatedCount = 0;

  for (let p of products) {
    let changed = false;
    const newAssignments = [];
    for (let c of p.assignedCollections) {
      // Check if c is a valid MongoDB ObjectID string
      if (/^[0-9a-fA-F]{24}$/.test(c)) {
        if (idToNameMap[c]) {
          newAssignments.push(idToNameMap[c]);
          changed = true;
        } else {
          // If ID not found, just keep the old ID to be safe
          newAssignments.push(c);
        }
      } else {
        newAssignments.push(c);
      }
    }
    
    // Remove duplicates
    const uniqueAssignments = [...new Set(newAssignments)];
    
    if (changed || uniqueAssignments.length !== p.assignedCollections.length) {
      p.assignedCollections = uniqueAssignments;
      await p.save();
      console.log(`Updated Product: ${p.title} - Set to ${uniqueAssignments.join(', ')}`);
      updatedCount++;
    }
  }

  console.log(`Successfully updated ${updatedCount} products.`);
  process.exit(0);
}

fixCollections().catch(console.error);
