const mongoose = require('mongoose');

const routerSchema = new mongoose.Schema({
  routerId: { type: String, required: true, unique: true, index: true },
  ownerEmail: { type: String, required: true },
  wifiDisplayName: { type: String, default: 'MILLANWIFI' },
  supportPhone: { type: String, default: '254707792548' },
  systemActive: { type: Boolean, default: true },
  subscriptionEndDate: { 
    type: Date, 
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days default
  },
  packages: [{
    name: { type: String, required: true },
    duration: { type: String, required: true }, // e.g., '1h', '24h', '7d'
    price: { type: Number, required: true },    // in KES
    popular: { type: Boolean, default: false }
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Router || mongoose.model('Router', routerSchema);