const mongoose = require('mongoose');

const estimateItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: Number, required: true },
  unit: { type: String, required: true },
  price: { type: Number, required: true },
  gst: { type: Number, required: true },
  amount: { type: Number, required: true }
});

const estimateSchema = new mongoose.Schema({
  estimateNo: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  estimateDate: {
    type: String,
    required: true
  },
  companyName: { type: String, required: true },
  companyGst: { type: String },
  companyState: { type: String },
  companyPhone: { type: String },
  companyEmail: { type: String },
  companyAddress: { type: String },
  
  clientName: { type: String, required: true },
  clientAddress: { type: String },
  clientPhone: { type: String },

  items: [estimateItemSchema],
  grandTotal: { type: Number, required: true },
  totalQty: { type: Number, required: true }
}, {
  timestamps: true
});

const Estimate = mongoose.model('Estimate', estimateSchema);

module.exports = Estimate;
