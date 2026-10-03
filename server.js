const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();

// Parse JSON request bodies
app.use(express.json());

// Enable CORS for your frontend domain
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ENVIRONMENT CONFIGURATION
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const MIKROTIK_REST_URL = process.env.MIKROTIK_REST_URL || 'http://mikrofig.com/rest/ip/hotspot/user';
const MIKROTIK_AUTH = process.env.MIKROTIK_AUTH; // e.g. "Basic Base64Credentials"
const JWT_SECRET = process.env.JWT_SECRET || 'millanwifi_admin_secret_key';

// Admin Credentials Storage (Uses ENV variables or defaults)
let adminCredentials = {
  username: process.env.ADMIN_USER || 'admin',
  passwordHash: bcrypt.hashSync(process.env.ADMIN_PASS || 'admin123', 10)
};

// Map package names to MikroTik limit-uptime
const PACKAGE_UPTIME_MAP = {
  "1 HOURS UNLIMITED": "1h",
  "3 HOURS UNLIMITED": "3h",
  "6 HOURS UNLIMITED": "6h",
  "24 HOURS UNLIMITED": "24h",
  "3 DAYS UNLIMITED": "3d",
  "1 WEEK UNLIMITED": "7d",
  "2 WEEKS UNLIMITED": "14d",
  "1 MONTH UNLIMITED": "30d"
};

// MIDDLEWARE: JWT Token Authentication
function authenticateAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Unauthorized access' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ message: 'Session expired or invalid' });
    req.user = user;
    next();
  });
}

// ==========================================
// 1. PUBLIC PAYSTACK WEBHOOK & USER ROUTES
// ==========================================

// Paystack Payment Webhook
app.post('/api/paystack-webhook', async (req, res) => {
  try {
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.error('Invalid Paystack signature');
      return res.status(401).send('Unauthorized');
    }

    const event = req.body;

    if (event.event === 'charge.success') {
      const data = event.data;
      const reference = data.reference;
      
      const packageName = data.metadata?.custom_fields?.find(f => f.variable_name === 'package')?.value;
      const uptimeLimit = PACKAGE_UPTIME_MAP[packageName] || "24h";

      console.log(`Processing payment ref: ${reference} for package: ${packageName} (${uptimeLimit})`);

      const username = reference.replace(/[^A-Za-z0-9_-]/g, '');
      
      await axios.put(
        MIKROTIK_REST_URL,
        {
          "name": username,
          "password": username,
          "profile": "default",
          "limit-uptime": uptimeLimit,
          "comment": `Created via MILLANWIFI Webhook - Paystack ref ${reference}`
        },
        {
          headers: {
            'Authorization': MIKROTIK_AUTH,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      console.log(`Successfully created RouterOS user: ${username}`);
    }

    res.sendStatus(200);

  } catch (err) {
    if (err.response && err.response.status === 400 && /already have|exists/i.test(JSON.stringify(err.response.data))) {
      console.log('User already exists on MikroTik. Acknowledging webhook.');
      return res.sendStatus(200);
    }

    console.error('Webhook Error:', err.message);
    res.status(500).send('Internal Server Error');
  }
});

// Client Status Check (Polled by client landing page)
app.get('/api/check-status', async (req, res) => {
  const reference = req.query.reference;
  if (!reference) return res.status(400).json({ ready: false, message: 'Missing reference' });

  const username = reference.replace(/[^A-Za-z0-9_-]/g, '');

  try {
    const response = await axios.get(`${MIKROTIK_REST_URL}?name=${encodeURIComponent(username)}`, {
      headers: { 'Authorization': MIKROTIK_AUTH },
      timeout: 5000
    });

    if (Array.isArray(response.data) && response.data.length > 0) {
      return res.json({ ready: true, username: username });
    } else {
      return res.json({ ready: false });
    }
  } catch (err) {
    return res.json({ ready: false, error: err.message });
  }
});

// ==========================================
// 2. PROTECTED ADMIN DASHBOARD ROUTES
// ==========================================

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (username !== adminCredentials.username) {
    return res.status(400).json({ message: 'Invalid username or password' });
  }

  const validPassword = bcrypt.compareSync(password, adminCredentials.passwordHash);
  if (!validPassword) {
    return res.status(400).json({ message: 'Invalid username or password' });
  }

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// Admin Reset Password
app.post('/api/admin/reset-password', authenticateAdminToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const validPassword = bcrypt.compareSync(currentPassword, adminCredentials.passwordHash);
  if (!validPassword) {
    return res.status(400).json({ message: 'Current password is incorrect' });
  }

  adminCredentials.passwordHash = bcrypt.hashSync(newPassword, 10);
  res.json({ message: 'Password updated successfully' });
});

// Admin Fetch Hotspot Users
app.get('/api/admin/users', authenticateAdminToken, async (req, res) => {
  try {
    const response = await axios.get(MIKROTIK_REST_URL, {
      headers: { 'Authorization': MIKROTIK_AUTH },
      timeout: 10000
    });
    res.json(response.data);
  } catch (err) {
    console.error('Failed to fetch hotspot users:', err.message);
    res.status(500).json({ message: 'Failed to communicate with router' });
  }
});

// Admin Update Hotspot User
app.patch('/api/admin/users/:id', authenticateAdminToken, async (req, res) => {
  const userId = req.params.id;
  const updateData = req.body;

  try {
    const response = await axios.patch(`${MIKROTIK_REST_URL}/${userId}`, updateData, {
      headers: {
        'Authorization': MIKROTIK_AUTH,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    res.json(response.data);
  } catch (err) {
    console.error('Failed to update user:', err.message);
    res.status(500).json({ message: 'Failed to update hotspot user' });
  }
});

// Admin Delete Hotspot User
app.delete('/api/admin/users/:id', authenticateAdminToken, async (req, res) => {
  const userId = req.params.id;

  try {
    await axios.delete(`${MIKROTIK_REST_URL}/${userId}`, {
      headers: { 'Authorization': MIKROTIK_AUTH },
      timeout: 10000
    });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Failed to delete user:', err.message);
    res.status(500).json({ message: 'Failed to delete hotspot user' });
  }
});

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MILLANWIFI Unified Server listening on port ${PORT}`));