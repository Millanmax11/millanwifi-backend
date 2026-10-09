const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // Stores the hashed password
  routerId: { type: String, required: true }, // Isolates the dashboard data per client
  role: { type: String, enum: ['superadmin', 'client_admin', 'router_owner'], default: 'client_admin' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Admin || mongoose.model('Admin', adminSchema);