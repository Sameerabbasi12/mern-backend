import { Server as SocketIOServer } from "socket.io";
import mongoose from "mongoose";
import Message from "./models/MessagesModel.js";
import Channel from "./models/ChannelModel.js";
import Conversation from "./models/ConversationModel.js";

const setupSocket = (server) => {
  const io = new SocketIOServer(server, {
    cors: {
      origin: process.env.ORIGIN,
      methods: ["GET", "POST", "PUT", "DELETE"],
      credentials: true,
    },
  });

  const userSocketMap = new Map();
  const onlineUsers = new Set();
  const getSocketId = (userId) => userSocketMap.get(userId);

  const disconnect = (socket) => {
    console.log(`Client disconnected: [${socket.id}]`);
    for (const [userId, socketId] of userSocketMap.entries()) {
      if (socketId === socket.id) {
        userSocketMap.delete(userId);
        onlineUsers.delete(userId);
        console.log(`User ${userId} went offline`);
        io.emit("user offline", userId);
        break;
      }
    }
  };

  const findOrCreateDMConversation = async (p1, p2) => {
    try {
      const p1Id = new mongoose.Types.ObjectId(p1);
      const p2Id = new mongoose.Types.ObjectId(p2);
      const sortedIds = [p1Id.toString(), p2Id.toString()].sort();

      let conversation = await Conversation.findOne({
        participants: { $all: sortedIds, $size: 2 },
      });

      if (!conversation) {
        conversation = await Conversation.create({
          participants: sortedIds,
          messages: [],
        });
      }

      return conversation;
    } catch (err) {
      console.error("Error in findOrCreateDMConversation:", err);
      throw err;
    }
  };

  const sendMessage = async (message) => {
    try {
      const { sender: senderId, recipient: recipientId } = message;
      if (!senderId || !recipientId) return;

      const conversation = await findOrCreateDMConversation(senderId, recipientId);
      message.conversationId = conversation._id;

      const createdMessage = await Message.create({ ...message, readBy: [senderId] });

      await Conversation.findByIdAndUpdate(
        conversation._id,
        { $push: { messages: createdMessage._id } },
        { new: true }
      );

      const messageData = await Message.findById(createdMessage._id)
        .populate("sender", "id email firstName lastName image color")
        .populate("recipient", "id email firstName lastName image color")
        .populate("conversationId")
        .populate("readBy", "id email firstName lastName image color");

      const recipientSocket = getSocketId(recipientId);
      const senderSocket = getSocketId(senderId);
      if (recipientSocket) io.to(recipientSocket).emit("receiveMessage", messageData);
      if (senderSocket) io.to(senderSocket).emit("receiveMessage", messageData);
    } catch (err) {
      console.error("Error in sendMessage:", err);
    }
  };

  const sendChannelMessage = async (message) => {
    try {
      const { channelId, sender, content, messageType, fileUrl } = message;
      if (!channelId || !sender) return;

      const createdMessage = await Message.create({
        sender,
        channelId,
        content,
        messageType,
        timestamp: new Date(),
        fileUrl,
        recipient: null,
        conversationId: null,
        readBy: [sender],
      });

      const messageData = await Message.findById(createdMessage._id)
        .populate("sender", "id email firstName lastName image color")
        .populate("channelId")
        .populate("readBy", "id email firstName lastName image color");

      await Channel.findByIdAndUpdate(channelId, {
        $push: { messages: createdMessage._id },
      });

      io.to(channelId).emit("receive-channel-message", messageData);
    } catch (err) {
      console.error("Error in sendChannelMessage:", err);
    }
  };

  const handleForwardMessage = async ({ originalMessage, senderId, recipients }) => {
    try {
      for (const recipient of recipients) {
        const msg = {
          sender: senderId,
          messageType: originalMessage.messageType,
          content: originalMessage.content,
          fileUrl: originalMessage.fileUrl,
          isForwarded: true,
          timestamp: new Date(),
          readBy: [senderId],
        };

        if (recipient.type === "contact") {
          msg.recipient = recipient.id;
          const conversation = await findOrCreateDMConversation(senderId, recipient.id);
          msg.conversationId = conversation._id;

          const created = await Message.create(msg);
          await Conversation.findByIdAndUpdate(conversation._id, {
            $push: { messages: created._id },
          });

          const populated = await Message.findById(created._id)
            .populate("sender", "id email firstName lastName image color")
            .populate("recipient", "id email firstName lastName image color")
            .populate("conversationId")
            .populate("readBy", "id email firstName lastName image color");

          const recipientSocket = getSocketId(recipient.id);
          const senderSocket = getSocketId(senderId);
          if (recipientSocket) io.to(recipientSocket).emit("receiveMessage", populated);
          if (senderSocket) io.to(senderSocket).emit("receiveMessage", populated);
        } else if (recipient.type === "channel") {
          msg.channelId = recipient.id;
          msg.recipient = null;
          msg.conversationId = null;

          const created = await Message.create(msg);
          await Channel.findByIdAndUpdate(recipient.id, {
            $push: { messages: created._id },
          });

          const populated = await Message.findById(created._id)
            .populate("sender", "id email firstName lastName image color")
            .populate("channelId")
            .populate("readBy", "id email firstName lastName image color");

          const channel = await Channel.findById(recipient.id).populate("members");
          channel?.members.forEach((member) => {
            const memberSocketId = getSocketId(member._id.toString());
            if (memberSocketId) io.to(memberSocketId).emit("receive-channel-message", populated);
          });
        }
      }
    } catch (err) {
      console.error("Error in handleForwardMessage:", err);
    }
  };

  const handleAddReaction = async ({ messageId, emoji, userId, chatId, chatType }) => {
    try {
      const message = await Message.findById(messageId);
      if (!message) return;

      const userIdStr = userId.toString();
      const existingReaction = message.reactions.findIndex(
        (r) => r.emoji === emoji && r.user.toString() === userIdStr
      );

      if (existingReaction !== -1) message.reactions.splice(existingReaction, 1);
      else {
        const userReaction = message.reactions.findIndex(
          (r) => r.user.toString() === userIdStr
        );
        if (userReaction !== -1) message.reactions[userReaction].emoji = emoji;
        else message.reactions.push({ emoji, user: userId });
      }

      await message.save();

      const updated = await Message.findById(message._id)
        .populate("sender", "id email firstName lastName image color")
        .populate("recipient", "id email firstName lastName image color")
        .populate("channelId")
        .populate("conversationId")
        .populate("reactions.user", "id email firstName lastName image color")
        .populate("readBy", "id email firstName lastName image color");

      const emitToParticipants = (participants) => {
        participants.forEach((pid) => {
          const socketId = getSocketId(pid.toString());
          if (socketId) io.to(socketId).emit("message-reacted", updated);
        });
      };

      if (chatType === "contact") {
        emitToParticipants([updated.sender?._id, updated.recipient?._id]);
      } else if (chatType === "channel") {
        const channel = await Channel.findById(updated.channelId._id).populate("members");
        if (channel?.members) emitToParticipants(channel.members.map((m) => m._id));
      } else {
        io.emit("message-reacted", updated);
      }
    } catch (err) {
      console.error("Error in handleAddReaction:", err);
    }
  };

  const handleEditMessage = async ({ messageId, newContent, chatType }) => {
    try {
      const updated = await Message.findByIdAndUpdate(
        messageId,
        { content: newContent, isEdited: true },
        { new: true }
      )
        .populate("sender", "id email firstName lastName image color")
        .populate("recipient", "id email firstName lastName image color")
        .populate("channelId")
        .populate("conversationId")
        .populate("readBy", "id email firstName lastName image color");

      if (!updated) return;

      const emitToParticipants = (participants) => {
        participants.forEach((pid) => {
          const socketId = getSocketId(pid.toString());
          if (socketId) io.to(socketId).emit("message-edited", updated);
        });
      };

      if (chatType === "contact") {
        emitToParticipants([updated.sender?._id, updated.recipient?._id]);
      } else if (chatType === "channel") {
        const channel = await Channel.findById(updated.channelId._id).populate("members");
        if (channel?.members) emitToParticipants(channel.members.map((m) => m._id));
      } else {
        io.emit("message-edited", updated);
      }
    } catch (err) {
      console.error("Error in handleEditMessage:", err);
    }
  };

  const handleDeleteMessage = async ({ messageId, chatId, chatType }) => {
    try {
      const deleted = await Message.findByIdAndDelete(messageId);
      if (!deleted) return;

      if (chatType === "contact" && deleted.conversationId)
        await Conversation.findByIdAndUpdate(deleted.conversationId, {
          $pull: { messages: messageId },
        });
      else if (chatType === "channel")
        await Channel.findByIdAndUpdate(chatId, {
          $pull: { messages: messageId },
        });

      const emitPayload = { messageId, chatId, chatType };
      if (chatType === "contact") {
        [deleted.sender, deleted.recipient].forEach((id) => {
          const sid = getSocketId(id?.toString());
          if (sid) io.to(sid).emit("message-deleted", emitPayload);
        });
      } else if (chatType === "channel") {
        const channel = await Channel.findById(chatId).populate("members");
        if (channel?.members)
          channel.members.forEach((m) => {
            const sid = getSocketId(m._id.toString());
            if (sid) io.to(sid).emit("message-deleted", emitPayload);
          });
      } else io.emit("message-deleted", emitPayload);
    } catch (err) {
      console.error("Error in handleDeleteMessage:", err);
    }
  };

  const handleMarkMessagesAsRead = async ({ messageIds, readerId, chatId, chatType }) => {
    try {
      await Message.updateMany(
        { _id: { $in: messageIds }, readBy: { $ne: readerId } },
        { $addToSet: { readBy: readerId } }
      );

      const emitReadTo = new Set();
      if (chatType === "contact") {
        const convo = await Conversation.findOne({
          participants: { $all: [readerId, chatId], $size: 2 },
        });
        convo?.participants.forEach((p) => emitReadTo.add(p.toString()));
      } else if (chatType === "channel") {
        const channel = await Channel.findById(chatId).select("members");
        channel?.members.forEach((m) => emitReadTo.add(m.toString()));
      }

      emitReadTo.forEach((pid) => {
        const sid = getSocketId(pid);
        if (sid) io.to(sid).emit("messages-read", { messageIds, readerId, chatId });
      });
    } catch (err) {
      console.error("Error in handleMarkMessagesAsRead:", err);
    }
  };

  io.on("connection", (socket) => {
    const userId = socket.handshake.query.userId;
    if (!userId) return socket.disconnect(true);

    userSocketMap.set(userId, socket.id);
    onlineUsers.add(userId);
    socket.emit("online users", Array.from(onlineUsers));
    socket.broadcast.emit("user online", userId);

    socket.on("sendMessage", sendMessage);
    socket.on("send-channel-message", sendChannelMessage);
    socket.on("edit-message", handleEditMessage);
    socket.on("delete-message", handleDeleteMessage);
    socket.on("add-reaction", handleAddReaction);
    socket.on("forward-message", handleForwardMessage);
    socket.on("mark-messages-as-read", handleMarkMessagesAsRead);

    socket.on("typing", ({ senderId, recipientId, channelId }) => {
      if (channelId) socket.to(channelId).emit("typing", { senderId, channelId });
      else if (recipientId) {
        const sid = getSocketId(recipientId);
        if (sid) io.to(sid).emit("typing", { senderId, recipientId });
      }
    });

    socket.on("stopTyping", ({ senderId, recipientId, channelId }) => {
      if (channelId) socket.to(channelId).emit("stopTyping", { senderId, channelId });
      else if (recipientId) {
        const sid = getSocketId(recipientId);
        if (sid) io.to(sid).emit("stopTyping", { senderId, recipientId });
      }
    });

    socket.on("join-channel", (channelId) => {
      console.log(`User ${userId} joined channel: ${channelId}`);
      socket.join(channelId);
    });

    socket.on("leave-channel", (channelId) => {
      console.log(`User ${userId} left channel: ${channelId}`);
      socket.leave(channelId);
    });

    socket.on("disconnect", () => disconnect(socket));
  });

  return io;
};

export default setupSocket;
