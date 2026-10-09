require('dotenv').config();
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// ==========================================
// 1. FIREBASE ADMIN INITIALIZATION
// ==========================================
let serviceAccount;
const keyPath = path.join(__dirname, 'serviceAccountKey.json');

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('✅ Loaded credentials from FIREBASE_SERVICE_ACCOUNT env variable.');
  } catch (err) {
    console.error('❌ Error parsing FIREBASE_SERVICE_ACCOUNT env variable:', err.message);
  }
} else if (fs.existsSync(keyPath)) {
  serviceAccount = require('./serviceAccountKey.json');
  console.log('✅ Loaded local serviceAccountKey.json file.');
} else {
  console.error('❌ ERROR: serviceAccountKey.json not found in backend folder!');
  console.error('👉 Please move your downloaded key to: ' + keyPath);
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore();

// ==========================================
// 2. INITIAL SEED DATA
// ==========================================

const routerSeedData = [
  {
    routerId: 'kisumu_cbd_01',
    ownerEmail: 'cbd_owner@millanwifi.com',
    wifiDisplayName: 'MILLANWIFI CBD',
    supportPhone: '254707792548',
    hotspotGateway: 'http://millansystem.login/login',
    systemActive: true,
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 Days from today
    packages: [
      { packageId: '1h',  name: '1 HOUR UNLIMITED',   duration: '1h',  price: 10, popular: false },
      { packageId: '3h',  name: '3 HOURS UNLIMITED',  duration: '3h',  price: 20, popular: false },
      { packageId: '6h',  name: '6 HOURS UNLIMITED',  duration: '6h',  price: 35, popular: false },
      { packageId: '12h', name: '12 HOURS UNLIMITED', duration: '12h', price: 45, popular: false },
      { packageId: '24h', name: '24 HOURS UNLIMITED', duration: '1d',  price: 50, popular: true  },
      { packageId: '2d',  name: '2 DAYS UNLIMITED',   duration: '2d',  price: 90, popular: false },
      { packageId: '7d',  name: '7 DAYS UNLIMITED',   duration: '7d',  price: 250, popular: true },
      { packageId: '14d', name: '14 DAYS UNLIMITED',  duration: '14d', price: 450, popular: false },
      { packageId: '30d', name: '30 DAYS UNLIMITED',  duration: '30d', price: 750, popular: false }
    ]
  },
  {
    routerId: 'kisumu_estate_02',
    ownerEmail: 'estate_owner@millanwifi.com',
    wifiDisplayName: 'MILLANWIFI ESTATE',
    supportPhone: '254707792548',
    hotspotGateway: 'http://millansystem.login/login',
    systemActive: true,
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    packages: [
      { packageId: '1h',  name: '1 HOUR UNLIMITED',   duration: '1h',  price: 15, popular: false },
      { packageId: '3h',  name: '3 HOURS UNLIMITED',  duration: '3h',  price: 20, popular: false },
      { packageId: '6h',  name: '6 HOURS UNLIMITED',  duration: '6h',  price: 35, popular: false },
      { packageId: '12h', name: '12 HOURS UNLIMITED', duration: '12h', price: 45, popular: false },
      { packageId: '24h', name: '24 HOURS UNLIMITED', duration: '1d',  price: 50, popular: true  },
      { packageId: '2d',  name: '2 DAYS UNLIMITED',   duration: '2d',  price: 90, popular: false },
      { packageId: '7d',  name: '7 DAYS UNLIMITED',   duration: '7d',  price: 250, popular: true },
      { packageId: '14d', name: '14 DAYS UNLIMITED',  duration: '14d', price: 450, popular: false },
      { packageId: '30d', name: '30 DAYS UNLIMITED',  duration: '30d', price: 800, popular: false }
    ]
  },
  {
    routerId: 'kisumu_estate_04',
    ownerEmail: 'estate_owners@millanwifi.com',
    wifiDisplayName: 'MILLANWIFI TOM MBOYA',
    supportPhone: '254737792548',
    hotspotGateway: 'http://millansystem.login/login',
    systemActive: true,
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    packages: [
      { packageId: '1h',  name: '1 HOUR UNLIMITED',   duration: '1h',  price: 15, popular: false },
      { packageId: '3h',  name: '3 HOURS UNLIMITED',  duration: '3h',  price: 25, popular: false },
      { packageId: '6h',  name: '6 HOURS UNLIMITED',  duration: '6h',  price: 35, popular: false },
      { packageId: '12h', name: '12 HOURS UNLIMITED', duration: '12h', price: 45, popular: false },
      { packageId: '24h', name: '24 HOURS UNLIMITED', duration: '1d',  price: 50, popular: true  },
      { packageId: '2d',  name: '2 DAYS UNLIMITED',   duration: '2d',  price: 90, popular: false },
      { packageId: '7d',  name: '7 DAYS UNLIMITED',   duration: '7d',  price: 250, popular: true },
      { packageId: '14d', name: '14 DAYS UNLIMITED',  duration: '14d', price: 450, popular: false },
      { packageId: '30d', name: '30 DAYS UNLIMITED',  duration: '30d', price: 800, popular: false }
    ]
  },
  {
    routerId: 'kisumu_estate_05',
    ownerEmail: 'OJIJO_owner@millanwifi.com',
    wifiDisplayName: 'OJIJOWIFI ESTATE',
    supportPhone: '254707792542',
    hotspotGateway: 'http://millansystem.login/login',
    systemActive: true,
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    packages: [
      { packageId: '1h',  name: '1 HOUR UNLIMITED',   duration: '1h',  price: 15, popular: false },
      { packageId: '3h',  name: '3 HOURS UNLIMITED',  duration: '3h',  price: 20, popular: false },
      { packageId: '6h',  name: '6 HOURS UNLIMITED',  duration: '6h',  price: 35, popular: false },
      { packageId: '12h', name: '12 HOURS UNLIMITED', duration: '12h', price: 45, popular: false },
      { packageId: '24h', name: '24 HOURS UNLIMITED', duration: '1d',  price: 50, popular: true  },
      { packageId: '2d',  name: '2 DAYS UNLIMITED',   duration: '2d',  price: 90, popular: false },
      { packageId: '7d',  name: '7 DAYS UNLIMITED',   duration: '7d',  price: 250, popular: true },
      { packageId: '14d', name: '14 DAYS UNLIMITED',  duration: '14d', price: 450, popular: false },
      { packageId: '30d', name: '30 DAYS UNLIMITED',  duration: '30d', price: 800, popular: false }
    ]
  }
];

// Helper: Clear existing collection documents
async function clearCollection(collectionName) {
  const collectionRef = db.collection(collectionName);
  const snapshot = await collectionRef.get();
  
  if (snapshot.empty) return;

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
}

// ==========================================
// 3. EXECUTE SEEDING
// ==========================================

async function seedDatabase() {
  try {
    console.log('⏳ Preparing to seed Firestore collections...');

    // 1. Seed Routers Collection
    console.log('🧹 Clearing old router configurations...');
    await clearCollection('routers');

    console.log('🌱 Seeding router configurations...');
    for (const router of routerSeedData) {
      await db.collection('routers').doc(router.routerId).set({
        ...router,
        createdAt: FieldValue.serverTimestamp()
      });
    }
    console.log('✅ Routers seeded successfully!');

    // 2. Seed Admin Credentials Collection
    console.log('🧹 Clearing old admin credentials...');
    await clearCollection('admins');

    const defaultPasswordHash = await bcrypt.hash('admin123', 10);

    const adminSeedData = [
      {
        username: 'admin',
        password: defaultPasswordHash,
        routerId: 'kisumu_cbd_01'
      },
      {
        username: 'admin_estate',
        password: defaultPasswordHash,
        routerId: 'kisumu_estate_02'
      }
    ];

    console.log('🌱 Seeding admin accounts...');
    for (const adminUser of adminSeedData) {
      await db.collection('admins').doc(adminUser.username).set({
        ...adminUser,
        createdAt: FieldValue.serverTimestamp()
      });
    }

    console.log('✅ Admin accounts created successfully!');
    console.log('--------------------------------------------------');
    console.log('🔐 Admin Login Credentials:');
    console.log('   Username: admin        | Password: admin123 (kisumu_cbd_01)');
    console.log('   Username: admin_estate | Password: admin123 (kisumu_estate_02)');
    console.log('--------------------------------------------------');

  } catch (error) {
    console.error('❌ Error seeding Firestore database:', error.message);
  } finally {
    process.exit(0);
  }
}

seedDatabase();