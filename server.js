const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());

// CONFIGURATION
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_live_e9c194bde9f9d170a30afb08005ab97c2017fd40';
const MIKROTIK_REST_URL = 'http://mikrofig.com/rest/ip/hotspot/user';
const MIKROTIK_AUTH = 'Basic bWlrcm9iaWxsX2JpbGxpbmc6NDI2YWEwMDE4YzM5ZDRkOWM2MDE4NzgwMjYxYmY1ZDU0Yjk5';

// Map package names or metadata to MikroTik limit-uptime
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

// 1. WEBHOOK ENDPOINT
app.post('/api/paystack-webhook', async (req, res) => {
  try {
    // Verify Paystack HMAC Signature
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.error('Invalid Paystack signature');
      return res.status(401).send('Unauthorized');
    }

    const event = req.body;

    // Process successful payment events
    if (event.event === 'charge.success') {
      const data = event.data;
      const reference = data.reference;
      
      // Extract package details from custom metadata
      const packageName = data.metadata?.custom_fields?.find(f => f.variable_name === 'package')?.value;
      const uptimeLimit = PACKAGE_UPTIME_MAP[packageName] || "24h";

      console.log(`Processing payment ref: ${reference} for package: ${packageName} (${uptimeLimit})`);

      // Provision user on MikroTik RouterOS via REST API
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

    // Acknowledge receipt to Paystack instantly
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

// 2. STATUS CHECK ENDPOINT (Polled by client browser)
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MILLANWIFI Server listening on port ${PORT}`));