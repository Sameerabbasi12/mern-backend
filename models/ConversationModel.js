
import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  messages: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
});

conversationSchema.index({ participants: 1 }, { unique: true });

conversationSchema.pre('save', function (next) {
  if (this.isModified('participants') && this.participants.length === 2) {
    this.participants = this.participants.map(id => id.toString()).sort().map(id => new mongoose.Types.ObjectId(id));
  }
  this.updatedAt = Date.now();
  next();
});
const Conversation = mongoose.model('Conversation', conversationSchema);

export default Conversation;