import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Users",
    required: true,
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Users",
    required: false,
  },
  messageType: {
    type: String,
    enum: ["text", "file"],
    required: true,
  },
  content: {
    type: String,
    required: function () {
      return this.messageType === "text";
    },
  },
  fileUrl: {
    type: String,
    required: function () {
      return this.messageType === "file";
    },
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  channelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Channel", 
    default: null, 
  },

   // ⭐⭐ ADD THIS NEW FIELD ⭐⭐
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    default: null,
  },
  // ⭐⭐ END NEW FIELD ⭐⭐

  reactions: [
    {
      emoji: {
        type: String,
        required: true,
      },
      user: { 
        type: mongoose.Schema.Types.ObjectId,
        ref: "Users", 
        required: true,
      },
      _id: false 
    },
  ],
 
  // ⭐ NEW FIELD FOR READ RECEIPTS ⭐
  readBy: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
    },
  ],
  // ⭐ END NEW FIELD ⭐
 
    isForwarded: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true, 
  }
);

// ADDED: For text search capabilities, if not already indexed
messageSchema.index({ content: "text" });

const Message = mongoose.models.Messages || mongoose.model("Messages", messageSchema);
export default Message;