require('dotenv').config();

const express = require('express');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// 1. GLOBAL MIDDLEWARE & CONFIGURATION
// ==========================================
app.use(cors());

// Capture raw buffer for Paystack HMAC verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const MIKROTIK_REST_URL = process.env.MIKROTIK_REST_URL || 'http://192.168.88.1/rest/ip/hotspot/user';
const MIKROTIK_AUTH = process.env.MIKROTIK_AUTH;
const JWT_SECRET = process.env.JWT_SECRET || 'millanwifi_admin_secret_key';
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'supersecret123';

// Package Uptime Mapping for MikroTik
const PACKAGE_UPTIME_MAP = {
  "1 HOUR UNLIMITED": "1h",
  "3 HOURS UNLIMITED": "3h",
  "24 HOURS UNLIMITED": "24h",
  "7 DAYS UNLIMITED": "7d",
  "30 DAYS UNLIMITED": "30d"
};

// ==========================================
// 2. FIREBASE ADMIN & FIRESTORE SETUP
// ==========================================
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('✅ Loaded Firebase credentials from FIREBASE_SERVICE_ACCOUNT env var.');
  } catch (err) {
    console.error('❌ Error parsing FIREBASE_SERVICE_ACCOUNT env variable:', err.message);
  }
} else {
  try {
    serviceAccount = require('./serviceAccountKey.json');
    console.log('✅ Loaded local serviceAccountKey.json file.');
  } catch (err) {
    console.warn('⚠️ Local serviceAccountKey.json not found in backend directory.');
  }
}

if (!getApps().length) {
  if (serviceAccount) {
    initializeApp({
      credential: cert(serviceAccount)
    });
    console.log('✅ Initialized Firebase Admin SDK with Cert.');
  } else {
    initializeApp();
    console.log('✅ Initialized Default Firebase Application.');
  }
}

const db = getFirestore();

// ==========================================
// 3. PUBLIC ROUTES (For package.html)
// ==========================================

// Fetch Captive Portal Configuration
app.get('/api/portal-config', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { routerId } = req.query;

    let configDoc = null;

    // 1. Search by requested routerId
    if (routerId) {
      const snap = await db.collection('routers').where('routerId', '==', routerId).limit(1).get();
      if (!snap.empty) configDoc = snap.docs[0].data();
    }

    // 2. Fallback to 'default'
    if (!configDoc) {
      const snap = await db.collection('routers').where('routerId', '==', 'default').limit(1).get();
      if (!snap.empty) configDoc = snap.docs[0].data();
    }

    // 3. Fallback to first document in routers collection
    if (!configDoc) {
      const snap = await db.collection('routers').limit(1).get();
      if (!snap.empty) configDoc = snap.docs[0].data();
    }

    if (!configDoc) {
      return res.status(404).json({ 
        error: 'No router configuration found in database. Please seed your Firestore routers collection.' 
      });
    }

    // Check subscription expiration date
    const endDate = configDoc.subscriptionEndDate?.toDate 
      ? configDoc.subscriptionEndDate.toDate() 
      : new Date(configDoc.subscriptionEndDate);

    const isExpired = endDate ? new Date() > endDate : false;

    if (isExpired || configDoc.systemActive === false) {
      return res.json({
        systemActive: false,
        message: 'System suspended due to expired subscription. Please contact support.',
        supportPhone: configDoc.supportPhone || '254707792548'
      });
    }

    res.json({
      systemActive: true,
      wifiDisplayName: configDoc.wifiDisplayName || 'MILLANWIFI',
      supportPhone: configDoc.supportPhone || '254707792548',
      packages: configDoc.packages || []
    });

  } catch (error) {
    console.error('Error fetching portal config:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Client Status Check (Polled during payment processing)
app.get('/api/check-status', async (req, res) => {
  const reference = req.query.reference;
  if (!reference) return res.status(400).json({ ready: false, message: 'Missing reference' });

  const username = reference.replace(/[^A-Za-z0-9_-]/g, '');

  try {
    // 1. Check Firestore transaction record first
    const txDoc = await db.collection('transactions').doc(reference).get();
    if (txDoc.exists && txDoc.data().status === 'success') {
      const data = txDoc.data();
      return res.json({ 
        ready: true, 
        username: data.hotspotUsername || username,
        password: data.hotspotPassword || data.hotspotUsername || username
      });
    }

    // 2. Fallback: Query MikroTik REST API directly
    const response = await axios.get(`${MIKROTIK_REST_URL}?name=${encodeURIComponent(username)}`, {
      headers: { 'Authorization': MIKROTIK_AUTH },
      timeout: 5000
    });

    if (Array.isArray(response.data) && response.data.length > 0) {
      return res.json({ ready: true, username: username, password: username });
    } else {
      return res.json({ ready: false });
    }
  } catch (err) {
    console.error("Router Status Check Error:", err.message);
    return res.json({ ready: false, error: err.message });
  }
});

// ==========================================
// 4. PAYSTACK WEBHOOK
// ==========================================
app.post('/api/paystack-webhook', async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY || '')
      .update(req.rawBody)
      .digest('hex');

    if (PAYSTACK_SECRET_KEY && hash !== signature && process.env.NODE_ENV === 'production') {
      return res.status(401).send('Invalid signature');
    }

    const { event, data } = req.body;

    if (event === 'charge.success') {
      const reference = data.reference;
      
      const txDoc = await db.collection('transactions').doc(reference).get();
      if (txDoc.exists) {
        console.log(`Duplicate webhook received for reference: ${reference}`);
        return res.status(200).json({ status: true, message: 'Transaction already processed' });
      }
      
      const customFields = data.metadata?.custom_fields || [];
      const pkgField = customFields.find(f => f.variable_name === 'package');
      const packageName = pkgField ? pkgField.value : '24 HOURS UNLIMITED';

      const routerId = data.metadata?.routerId || 'kisumu_cbd_01';

      console.log(`Processing payment ref: ${reference} for package: ${packageName}`);

      const generatedPassword = 'pass_' + Math.floor(1000 + Math.random() * 9000);
      const limitUptime = PACKAGE_UPTIME_MAP[packageName] || '24h';

      // 1. Attempt Hotspot User Creation (Graceful error handling for cloud unreachable router IP)
      let routerProvisioned = false;
      try {
        await createHotspotUser(reference, generatedPassword, 'default', limitUptime);
        routerProvisioned = true;
      } catch (routerErr) {
        console.error(`⚠️ Router API call failed (${routerErr.message}). Recording transaction to Firestore anyway...`);
      }

      // 2. Save transaction to Firestore ('transactions' collection)
      await db.collection('transactions').doc(reference).set({
        routerId: routerId,
        reference: reference,
        amount: data.amount / 100,
        packageName: packageName,
        duration: limitUptime,
        hotspotUsername: reference,
        hotspotPassword: generatedPassword,
        status: 'success',
        routerProvisioned: routerProvisioned,
        createdAt: FieldValue.serverTimestamp()
      });

      return res.status(200).json({ status: true, message: 'User provisioned and transaction recorded' });
    }

    res.status(200).json({ status: true });
  } catch (error) {
    console.error('Webhook Error:', error.message);
    res.status(500).json({ status: false, error: error.message });
  }
});

// ==========================================
// 5. DASHBOARD STATISTICS API (Firestore)
// ==========================================

// 1. Fetch Transaction History
app.get('/api/transactions', async (req, res) => {
  try {
    const snapshot = await db.collection('transactions')
      .where('status', '==', 'success')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const transactions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate() : doc.data().createdAt
    }));

    res.status(200).json({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
  }
});

// 2. Fetch Revenue Stats for Charts
app.get('/api/revenue-stats', async (req, res) => {
  try {
    const snapshot = await db.collection('transactions')
      .where('status', '==', 'success')
      .get();

    let totalRevenue = 0;
    snapshot.forEach(doc => {
      totalRevenue += (doc.data().amount || 0);
    });

    res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        transactionCount: snapshot.size
      }
    });
  } catch (error) {
    console.error('Error fetching revenue stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch revenue statistics' });
  }
});

// Global Helper: Create Hotspot User on Real Router
async function createHotspotUser(username, password, profile, limitUptime) {
  try {
    const endpointUrl = MIKROTIK_REST_URL.endsWith('/add') 
      ? MIKROTIK_REST_URL 
      : `${MIKROTIK_REST_URL.replace(/\/$/, '')}/add`;

    const response = await axios.post(
      endpointUrl,
      {
        name: username,
        password: password,
        profile: profile,
        'limit-uptime': limitUptime,
        comment: 'MILLANWIFI - Paystack'
      },
      {
        headers: { 
          'Authorization': MIKROTIK_AUTH,
          'Content-Type': 'application/json'
        },
        timeout: 15000 // 15 second timeout for slower router connections
      }
    );

    return response.data;
  } catch (error) {
    const errorDetail = error.response?.data?.detail || error.response?.data?.message || '';

    // If user already exists on MikroTik, treat as success
    if (typeof errorDetail === 'string' && errorDetail.toLowerCase().includes('already have user')) {
      console.log(`ℹ️ Hotspot user '${username}' already exists on MikroTik. Proceeding...`);
      return { status: 'already_exists', name: username };
    }

    console.error("Router API Error:", error.response?.data || error.message);
    throw error;
  }
}

// ==========================================
// 6. ADMIN LOGIN & MANAGEMENT (Firestore)
// ==========================================

// --- AUTH MIDDLEWARE ---
const verifyAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(403).json({ error: 'Access denied. No token provided.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded; 
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// --- ADMIN LOGIN ENDPOINT ---
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const snapshot = await db.collection('admins').where('username', '==', username).limit(1).get();
    if (snapshot.empty) return res.status(401).json({ error: 'Invalid credentials' });

    const adminDoc = snapshot.docs[0];
    const adminData = adminDoc.data();

    const validPassword = await bcrypt.compare(password, adminData.password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { adminId: adminDoc.id, routerId: adminData.routerId }, 
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, routerId: adminData.routerId });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// --- DASHBOARD STATS ENDPOINT (Isolated by routerId) ---
app.get('/api/admin/dashboard', verifyAdmin, async (req, res) => {
  try {
    const routerId = req.admin.routerId;

    const snapshot = await db.collection('transactions')
      .where('routerId', '==', routerId)
      .where('status', '==', 'success')
      .get();

    let totalRevenue = 0;
    snapshot.forEach(doc => {
      totalRevenue += (doc.data().amount || 0);
    });

    const recentSnap = await db.collection('transactions')
      .where('routerId', '==', routerId)
      .where('status', '==', 'success')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const recentTransactions = recentSnap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        reference: d.reference,
        amount: d.amount,
        packageName: d.packageName,
        hotspotUsername: d.hotspotUsername,
        createdAt: d.createdAt?.toDate ? d.createdAt.toDate() : d.createdAt
      };
    });

    res.json({
      totalRevenue,
      totalUsers: snapshot.size,
      recentTransactions
    });
  } catch (err) {
    console.error('Error fetching admin dashboard:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// ==========================================
// 7. ADMIN ROUTES (SaaS Management)
// ==========================================
app.post('/api/admin/renew-subscription', async (req, res) => {
  const { adminSecret, routerId, daysToAdd } = req.body;

  if (adminSecret !== ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const days = daysToAdd || 30;
    const newExpiration = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const snap = await db.collection('routers').where('routerId', '==', routerId).limit(1).get();

    if (snap.empty) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const routerDocRef = snap.docs[0].ref;
    await routerDocRef.update({
      systemActive: true,
      subscriptionEndDate: newExpiration
    });

    res.json({ 
      message: `Router ${routerId} renewed successfully until ${newExpiration}`, 
      routerId, 
      subscriptionEndDate: newExpiration 
    });
  } catch (err) {
    console.error('Failed to renew subscription:', err);
    res.status(500).json({ error: 'Failed to renew subscription' });
  }
});

// ==========================================
// 8. MIKROTIK ROUTER PROXY API (REAL LIVE MODE)
// ==========================================

// 1. Fetch Real Hotspot Users from MikroTik
app.get('/api/router/users', async (req, res) => {
  try {
    const response = await axios.get(MIKROTIK_REST_URL, {
      headers: { 
        'Authorization': MIKROTIK_AUTH,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });

    res.status(200).json(response.data);
  } catch (error) {
    console.error("Error fetching router users:", error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch users from router' });
  }
});

// 2. Fetch Real System Status from MikroTik
app.get('/api/router/system', async (req, res) => {
  try {
    const resourceUrl = MIKROTIK_REST_URL.replace(/\/ip\/hotspot\/user\/?$/, '/system/resource');

    const response = await axios.get(resourceUrl, {
      headers: { 
        'Authorization': MIKROTIK_AUTH,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });

    res.status(200).json(response.data);
  } catch (error) {
    console.error("Error fetching router system status:", error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch system status from router' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 MILLANWIFI SaaS Backend running on port ${PORT}`);
});