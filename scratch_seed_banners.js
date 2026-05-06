require('dotenv').config();
const mongoose = require('mongoose');
const Banner = require('./models/Banner');

const banners = [
  {
    title: 'Spring Season Offer',
    imageUrl: 'https://images.unsplash.com/photo-1592982537447-6f23f815cefc?auto=format&fit=crop&q=80&w=800',
    priority: 1,
    isActive: true,
    redirectType: 'none'
  },
  {
    title: 'New Fungicides Arrived',
    imageUrl: 'https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?auto=format&fit=crop&q=80&w=800',
    priority: 2,
    isActive: true,
    redirectType: 'category',
    redirectTarget: 'Fungicides'
  },
  {
    title: 'Protect Your Crops',
    imageUrl: 'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?auto=format&fit=crop&q=80&w=800',
    priority: 3,
    isActive: true,
    redirectType: 'none'
  }
];

async function seedBanners() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Clear existing
    await Banner.deleteMany({});
    console.log('Cleared existing banners');

    // Insert new
    await Banner.insertMany(banners);
    console.log('Successfully seeded banners');

    process.exit(0);
  } catch (error) {
    console.error('Error seeding banners:', error);
    process.exit(1);
  }
}

seedBanners();
