// server/controllers/MessagesController.js
import Message from "../models/MessagesModel.js"; // Correct import path relative to controller
import fs from "fs";
import { mkdirSync, renameSync } from "fs";

export const getMessages = async (request, response, next) => {
    try {
        const user1 = request.userId;
        const user2 = request.body.id;

        if (!user1 || !user2) {
            return response.status(400).send("Both user ID's are required.");
        }

        const messages = await Message.find({
            $or: [
                { sender: user1, recipient: user2 },
                { sender: user2, recipient: user1 },
            ],
            channelId: null
        }).sort({ timestamp: 1 });

        return response.status(200).json({ messages });
    } catch (error) {
        console.error("Error in getMessages controller:", error);
        return response.status(500).send("Internal Server Error");
    }
};

export const uploadFile = async (request, response, next) => {
    try {
        if (!request.file) {
            return response.status(400).send("File is required");
        }

        const date = Date.now();
        let fileDir = `uploads/files/${date}`;
        let fileName = `${fileDir}/${request.file.originalname}`;

        mkdirSync(fileDir, { recursive: true });
        renameSync(request.file.path, fileName);

        return response.status(200).json({ filePath: fileName });
    } catch (error) {
        console.error("Error in uploadFile controller:", error);
        return response.status(500).send("Internal Server Error");
    }
};

export const sendMessage = async (req, res) => {
    try {
        const senderId = req.userId;
        const { message, receiverId, type, channelId, fileUrl, messageType } = req.body;

        if (!senderId || (!message && !fileUrl) || !type) {
            return res.status(400).json({ msg: "Missing required fields" });
        }

        let newMessage;
        if (type === "channel" && channelId) {
            newMessage = await Message.create({
                sender: senderId,
                channelId: channelId,
                content: messageType === "text" ? message : undefined,
                messageType: messageType,
                fileUrl: messageType === "file" ? fileUrl : undefined,
                timestamp: new Date(),
            });

            await newMessage.populate("sender", "id email firstName lastName image color");
            await newMessage.populate("channelId", "id name description");

            const io = req.app.get('socketio');
            const plainMessage = newMessage.toObject();

            plainMessage._id = plainMessage._id?.toString();
            if (plainMessage.channelId?._id) {
                plainMessage.channelId._id = plainMessage.channelId._id.toString();
            }
            if (plainMessage.sender?._id) {
                plainMessage.sender._id = plainMessage.sender._id.toString();
            }

            io.to(channelId.toString()).emit("receive-message", plainMessage);
        } else if (type === "contact" && receiverId) {
            newMessage = await Message.create({
                sender: senderId,
                recipient: receiverId,
                content: messageType === "text" ? message : undefined,
                messageType: messageType,
                fileUrl: messageType === "file" ? fileUrl : undefined,
                timestamp: new Date(),
            });

            await newMessage.populate("sender", "id email firstName lastName image color");
            await newMessage.populate("recipient", "id email firstName lastName image color");

            const io = req.app.get('socketio');
            const plainMessage = newMessage.toObject();

            plainMessage._id = plainMessage._id?.toString();
            if (plainMessage.sender?._id) {
                plainMessage.sender._id = plainMessage.sender._id.toString();
            }
            if (plainMessage.recipient?._id) {
                plainMessage.recipient._id = plainMessage.recipient._id.toString();
            }

            io.to(senderId.toString()).emit("receive-message", plainMessage);
            io.to(receiverId.toString()).emit("receive-message", plainMessage);
        } else {
            return res.status(400).json({ msg: "Invalid message type or missing recipient/channelId" });
        }

        res.status(201).json({ message: newMessage });
    } catch (error) {
        console.error("sendMessage error", error);
        res.status(500).send("Internal server error");
    }
};

export const getChannelMessages = async (req, res, next) => {
    try {
        const { channelId } = req.params;

        if (!channelId) {
            return res.status(400).send("Channel ID is required.");
        }

        const messages = await Message.find({ channelId: channelId })
            .sort({ timestamp: 1 })
            .populate("sender", "id email firstName lastName image color")
            .lean();

        return res.status(200).json({ messages });
    } catch (error) {
        console.error("Error in getChannelMessages controller:", error);
        next(error);
    }
};

export const updateMessage = async (req, res, next) => {
    try {
        const { messageId } = req.params;
        const { content } = req.body;
        const userId = req.userId;

        if (!messageId || !content) {
            return res.status(400).send("Message ID and new content are required.");
        }

        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).send("Message not found.");
        }

        if (message.sender.toString() !== userId) {
            return res.status(403).send("You are not authorized to edit this message.");
        }

        if (message.messageType !== "text") {
            return res.status(400).send("Only text messages can be edited.");
        }

        message.content = content;
        message.isEdited = true;
        message.timestamp = new Date();

        await message.save();

        const updatedMessage = await Message.findById(message._id)
            .populate("sender", "id email firstName lastName image color")
            .populate("recipient", "id email firstName lastName image color")
            .populate("channelId", "id name description")
            .exec();

        const io = req.app.get('socketio');
        console.log('Is Socket.IO instance available in updateMessage controller?', !!io);

        if (!io) {
            console.error("Socket.IO instance is NOT available for real-time update in updateMessage controller.");
            return res.status(200).json({ updatedMessage: updatedMessage, warning: "Real-time update skipped due to Socket.IO issue." });
        }

        if (updatedMessage.channelId) {
            io.to(updatedMessage.channelId.toString()).emit("message-edited", updatedMessage.toObject());
            console.log(`Emitted 'message-edited' to channel ${updatedMessage.channelId._id}`);
        } else if (updatedMessage.sender && updatedMessage.recipient) {
            io.to(updatedMessage.sender.toString()).emit("message-edited", updatedMessage.toObject());
            io.to(updatedMessage.recipient.toString()).emit("message-edited", updatedMessage.toObject());
            console.log(`Emitted 'message-edited' to sender ${updatedMessage.sender._id} and recipient ${updatedMessage.recipient._id}`);
        } else {
            console.warn("Updated message has neither a recipient nor a channelId. Cannot emit real-time update.");
        }

        return res.status(200).json({ updatedMessage: updatedMessage });
    } catch (error) {
        console.error("Error in updateMessage controller:", error);
        next(error);
    }
};

export const deleteMessage = async (req, res, next) => {
    try {
        const { messageId } = req.params;
        const userId = req.userId;

        if (!messageId) {
            return res.status(400).send("Message ID is required.");
        }

        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).send("Message not found.");
        }

        if (message.sender.toString() !== userId) {
            return res.status(403).send("You are not authorized to delete this message.");
        }

        let chatIdForSocket = null;
        let chatTypeForSocket = "contact";
        if (message.channelId) {
            chatIdForSocket = message.channelId.toString();
            chatTypeForSocket = "channel";
        } else if (message.recipient) {
            chatIdForSocket = message.recipient.toString();
        } else {
            chatIdForSocket = message.sender.toString();
        }

        await message.deleteOne();

        const io = req.app.get('socketio');
        console.log('Is Socket.IO instance available in deleteMessage controller?', !!io);

        if (!io) {
            console.error("Socket.IO instance is NOT available for real-time update in deleteMessage controller.");
            return res.status(200).json({ message: "Message deleted successfully.", warning: "Real-time update skipped due to Socket.IO issue." });
        }

        if (message.channelId) {
            io.to(message.channelId.toString()).emit("message-deleted", { messageId: messageId, chatId: chatIdForSocket, chatType: chatTypeForSocket });
            console.log(`Emitted 'message-deleted' to channel ${message.channelId._id}`);
        } else if (message.sender && message.recipient) {
            io.to(message.sender.toString()).emit("message-deleted", { messageId: messageId, chatId: chatIdForSocket, chatType: chatTypeForSocket });
            io.to(message.recipient.toString()).emit("message-deleted", { messageId: messageId, chatId: chatIdForSocket, chatType: chatTypeForSocket });
            console.log(`Emitted 'message-deleted' to sender ${message.sender._id} and recipient ${message.recipient._id}`);
        } else {
            console.warn("Deleted message has neither a recipient nor a channelId. Cannot emit real-time delete update.");
        }

        return res.status(200).json({ message: "Message deleted successfully." });
    } catch (error) {
        console.error("Error in deleteMessage controller:", error);
        next(error);
    }
};
