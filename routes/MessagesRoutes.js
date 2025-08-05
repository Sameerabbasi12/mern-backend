

import { Router } from "express";
import { verifyToken } from "../middlewares/AuthMiddleware.js";
import {
    getMessages,
    uploadFile,
    sendMessage, // NEW
    getChannelMessages, // NEW
    updateMessage, // NEW
    deleteMessage // NEW
} from "../controllers/MessagesController.js";
import multer from "multer";

const messagesRoutes = Router();
const upload = multer({dest: "uploads/files"});

messagesRoutes.post("/get-messages", verifyToken, getMessages);
messagesRoutes.post("/upload-file", verifyToken, upload.single("file"), uploadFile);

// --- NEW CODE: MESSAGE SEND AND CHANNEL MESSAGE ROUTES ---
messagesRoutes.post("/send-message", verifyToken, sendMessage);
messagesRoutes.get("/get-channel-messages/:channelId", verifyToken, getChannelMessages);
// --- END NEW CODE ---

// --- NEW CODE: EDIT AND DELETE ROUTES ---
messagesRoutes.put("/update-message/:messageId", verifyToken, updateMessage);
messagesRoutes.delete("/delete-message/:messageId", verifyToken, deleteMessage);
// --- END NEW CODE ---

export default messagesRoutes;