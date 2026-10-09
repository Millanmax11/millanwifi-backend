require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Admin = require('./models/Admin');

async function seedAdmins() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const hashedPassword = await bcrypt.hash('password123', 10);

  const admins = [
    { username: 'admin_cbd', password: hashedPassword, routerId: 'kisumu_cbd_01' },
    { username: 'admin_estate', password: hashedPassword, routerId: 'kisumu_estate_02' }
  ];

  await Admin.deleteMany({});
  await Admin.insertMany(admins);
  console.log('✅ Admins seeded! Passwords are: password123');
  process.exit();
}
seedAdmins();