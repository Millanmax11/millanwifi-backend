const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true, index: true },
  routerId: { type: String, required: true, index: true },
  amount: { type: Number, required: true },
  packageName: { type: String, required: true },
  duration: { type: String, required: true },
  hotspotUsername: { type: String, required: true },
  hotspotPassword: { type: String, required: true },
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);