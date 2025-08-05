
import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import mongoose from "mongoose";
import "./models/UserModel.js";
import "./models/ChannelModel.js"; // This is the problematic one
import "./models/MessagesModel.js";
import authRoutes from "./routes/AuthRoutes.js";
import contactsRoutes from "./routes/ContactRoute.js";
import setupSocket from "./socket.js"; // Your socket setup file
import messagesRoutes from "./routes/MessagesRoutes.js";
import channelRoutes from "./routes/ChannelRoutes.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const database = process.env.DATABASE_URL;

app.use(
  cors({
    origin: [process.env.ORIGIN],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  })
);

app.use("/uploads/profiles", express.static("uploads/profiles"));
app.use("/uploads/files", express.static("uploads/files"));

app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/contacts", contactsRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/channel", channelRoutes);

const server = app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

// --- CRUCIAL PART ---
// Capture the io instance returned by setupSocket
const ioInstance = setupSocket(server);

// Make the io instance available to all Express routes/controllers
app.set('socketio', ioInstance);
// --- END CRUCIAL PART ---

mongoose.connect(database)
  .then(() => console.log("DB Connection Successfull"))
  .catch(err => console.log(err.message));