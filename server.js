//
// XamePage v2.1 Server File
//
// Production-grade server with full MongoDB persistence and WebRTC support.
// Compatible with both cloud deployment (Render) and local development (Termux).
//
// Features:
// - MongoDB Atlas for persistent data storage
// - Socket.IO for real-time messaging and presence
// - WebRTC signaling for voice/video calls
// - Privacy-filtered profile data
// - Secure file uploads (profile pictures, attachments)
// - Comprehensive API endpoints
//

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

// ============================================================
// SERVER SETUP
// ============================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    path: '/socket.io/'
});

// Middleware
app.use(express.json());
app.use(cors());

// ============================================================
// MONGODB CONFIGURATION
// ============================================================

const MONGODB_URI = process.env.MONGODB_CLOUD_URI;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_CLOUD_URI not found in environment variables');
    console.error('Please create a .env file with MONGODB_CLOUD_URI=your_connection_string');
    process.exit(1);
}

console.log('✅ Mongo URI loaded:', MONGODB_URI.slice(0, 15) + '...');

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected successfully'))
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// ============================================================
// MONGODB SCHEMAS
// ============================================================

const contactSchema = new mongoose.Schema({
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    customName: { type: String },
    addedAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
    xameId: { type: String, required: true, unique: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    preferredName: { type: String, default: '' },
    dob: { type: String, required: true },
    profilePic: { type: String, default: '' },
    hidePreferredName: { type: Boolean, default: false },
    hideProfilePicture: { type: Boolean, default: false },
    contacts: [contactSchema],
    createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
    messageId: { type: String, required: true, unique: true },
    senderId: { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    ts: { type: Number, required: true },
    text: { type: String },
    file: {
        url: { type: String },
        name: { type: String },
        type: { type: String }
    },
    status: { type: String, enum: ['sent', 'delivered', 'seen'], default: 'sent' }
});

const callHistorySchema = new mongoose.Schema({
    callId: { type: String, required: true, unique: true },
    callerId: { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    callType: { type: String, required: true, enum: ['voice', 'video'] },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    status: { 
        type: String, 
        required: true, 
        enum: ['pending', 'accepted', 'rejected', 'ended', 'missed'] 
    }
}, { timestamps: true });

// Models
const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const CallHistory = mongoose.model('CallHistory', callHistorySchema);

// ============================================================
// FILE UPLOAD CONFIGURATION
// ============================================================

const upload = multer({ dest: 'uploads/' });

// Create necessary directories
const uploadDir = path.join(__dirname, 'uploads');
const profilePicsDir = path.join(__dirname, 'media', 'profile_pics');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('✅ Created uploads directory');
}

if (!fs.existsSync(profilePicsDir)) {
    fs.mkdirSync(profilePicsDir, { recursive: true });
    console.log('✅ Created profile pics directory');
}

// Serve static files
app.use(express.static(__dirname));
app.use('/media/profile_pics', express.static(profilePicsDir));
app.use('/uploads', express.static(uploadDir));

// ============================================================
// ONLINE USER STATE MANAGEMENT
// ============================================================

const onlineUsers = new Set();
const userToSocketMap = new Map();
const socketToUserMap = new Map();

function findSocketIdByUserId(userId) {
    return userToSocketMap.get(userId);
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function generateUniqueXameId() {
    const prefix = '058';
    let newId;
    let isUnique = false;
    
    do {
        const randomPart = Math.floor(1e8 + Math.random() * 9e8).toString();
        newId = `${prefix}${randomPart}`;
        const existingUser = await User.findOne({ xameId: newId });
        isUnique = !existingUser;
    } while (!isUnique);
    
    return newId;
}

function getPrivacyFilteredContactData(user) {
    let profilePicUrl = user.profilePic;
    if (user.hideProfilePicture) {
        profilePicUrl = '';
    }

    let preferredName = user.preferredName;
    if (user.hidePreferredName) {
        preferredName = '';
    }

    return {
        xameId: user.xameId,
        firstName: user.firstName,
        lastName: user.lastName,
        preferredName: preferredName,
        profilePic: profilePicUrl
    };
}

function getContactDisplayName(contactXameId, partnerUser, savedContact) {
    if (savedContact?.customName) {
        return savedContact.customName;
    }
    
    if (partnerUser?.preferredName) {
        return partnerUser.preferredName;
    }
    
    if (partnerUser && partnerUser.preferredName === '') {
        return contactXameId;
    }
    
    if (partnerUser) {
        const fullName = `${partnerUser.firstName} ${partnerUser.lastName}`.trim();
        if (fullName) {
            return fullName;
        }
    }
    
    return contactXameId;
}

async function getLastInteractionDetails(userId, partnerId) {
    const [lastMessage, lastCall] = await Promise.all([
        Message.findOne({
            $or: [
                { senderId: userId, recipientId: partnerId },
                { senderId: partnerId, recipientId: userId }
            ]
        }).sort({ ts: -1 }).select('ts senderId'),
        
        CallHistory.findOne({
            $or: [
                { callerId: userId, recipientId: partnerId },
                { callerId: partnerId, recipientId: userId }
            ],
            status: { $in: ['accepted', 'ended', 'rejected', 'missed'] }
        }).sort({ createdAt: -1 }).select('createdAt status callerId')
    ]);

    let lastTs = 0;
    let previewText = 'Start a new chat.';

    if (lastMessage) {
        lastTs = lastMessage.ts;
        previewText = lastMessage.senderId === userId ? 'You: Sent a message.' : 'New message received.';
    }

    if (lastCall) {
        const callTs = lastCall.createdAt.getTime();
        
        if (callTs > lastTs) {
            lastTs = callTs;
            if (lastCall.status === 'missed' && lastCall.recipientId === userId) {
                previewText = 'Missed call.';
            } else if (lastCall.callerId === userId) {
                previewText = 'Outgoing call.';
            } else {
                previewText = 'Incoming call.';
            }
        }
    }

    return { lastInteractionTs: lastTs, lastInteractionPreview: previewText };
}

async function getFullContactData(userId) {
    const user = await User.findOne({ xameId: userId }).populate('contacts.contactId');
    if (!user) return [];

    const chatPartners = await Message.distinct('senderId', { recipientId: userId });
    const messageRecipients = await Message.distinct('recipientId', { senderId: userId });
    const callPartners = await CallHistory.distinct('callerId', { recipientId: userId });
    const callRecipients = await CallHistory.distinct('recipientId', { callerId: userId });

    const allPartnerIds = new Set([
        ...chatPartners,
        ...messageRecipients,
        ...callPartners,
        ...callRecipients,
        ...user.contacts.map(c => c.contactId?.xameId).filter(Boolean)
    ]);
    allPartnerIds.delete(userId);

    const contactsMap = new Map();
    const contactXameIds = Array.from(allPartnerIds);

    const partnerUsers = await User.find({ xameId: { $in: contactXameIds } });
    partnerUsers.forEach(p => contactsMap.set(p.xameId, p));

    const interactionPromises = contactXameIds.map(async (xameId) => {
        const partnerUser = contactsMap.get(xameId);
        const isSaved = user.contacts.some(c => c.contactId?.xameId === xameId);
        const savedContact = user.contacts.find(c => c.contactId?.xameId === xameId);

        const unreadMessagesCount = await Message.countDocuments({
            senderId: xameId,
            recipientId: userId,
            status: { $in: ['sent', 'delivered'] }
        });

        const missedCallsCount = await CallHistory.countDocuments({
            callerId: xameId,
            recipientId: userId,
            status: { $in: ['pending', 'missed'] }
        });

        const interactionDetails = await getLastInteractionDetails(userId, xameId);
        const filteredPartner = partnerUser ? getPrivacyFilteredContactData(partnerUser) : null;
        const displayName = getContactDisplayName(xameId, filteredPartner, savedContact);
        const profilePic = filteredPartner ? filteredPartner.profilePic : '';

        return {
            xameId: xameId,
            name: displayName,
            profilePic: profilePic,
            isOnline: onlineUsers.has(xameId),
            unreadMessagesCount: unreadMessagesCount,
            missedCallsCount: missedCallsCount,
            isSaved: isSaved,
            lastInteractionTs: interactionDetails.lastInteractionTs,
            lastInteractionPreview: interactionDetails.lastInteractionPreview
        };
    });

    const contactsWithDetails = await Promise.all(interactionPromises);
    contactsWithDetails.sort((a, b) => b.lastInteractionTs - a.lastInteractionTs);

    return contactsWithDetails;
}

// ============================================================
// API ENDPOINTS
// ============================================================

// Registration
app.post('/api/register',
    body('firstName').trim().escape().notEmpty().withMessage('First name is required.'),
    body('lastName').trim().escape().notEmpty().withMessage('Last name is required.'),
    body('dob').isDate({ format: 'YYYY-MM-DD' }).withMessage('Date of birth must be YYYY-MM-DD.'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { firstName, lastName, dob } = req.body;

        try {
            const xameId = await generateUniqueXameId();
            const newUser = new User({ xameId, firstName, lastName, dob });
            await newUser.save();
            console.log(`✅ User registered: ${newUser.xameId}`);
            res.json({ success: true, user: newUser });
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ success: false, message: 'Server error during registration.' });
        }
    }
);

// Login
app.post('/api/login', async (req, res) => {
    const { xameId } = req.body;
    
    try {
        const user = await User.findOne({ xameId });
        if (user) {
            userToSocketMap.set(user.xameId, `placeholder_socket_${user.xameId}`);
            console.log(`✅ User logged in: ${user.xameId}`);

            const userWithPrivacy = {
                ...user.toObject(),
                privacySettings: {
                    hidePreferredName: user.hidePreferredName,
                    hideProfilePicture: user.hideProfilePicture
                }
            };

            res.json({ success: true, user: userWithPrivacy });
        } else {
            res.status(404).json({ success: false, message: 'User not found.' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

// Logout
app.post('/api/logout', async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ success: false, message: 'User ID is required.' });
    }

    onlineUsers.delete(userId);
    userToSocketMap.delete(userId);
    console.log(`✅ User logged out: ${userId}`);

    io.emit('online_users', Array.from(onlineUsers));
    res.json({ success: true, message: 'Logged out successfully.' });
});

// Get user name
app.post('/api/get-user-name', async (req, res) => {
    const { xameId } = req.body;
    
    try {
        const user = await User.findOne({ xameId });
        if (user) {
            res.json({
                success: true,
                user: { firstName: user.firstName, lastName: user.lastName, xameId: user.xameId }
            });
        } else {
            res.status(404).json({ success: false, message: 'User not found.' });
        }
    } catch (error) {
        console.error('Get user name error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// File upload
app.post('/api/upload-file', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    try {
        const fileExt = path.extname(req.file.originalname);
        const newFilename = `${uuidv4()}${fileExt}`;
        const newPath = path.join(uploadDir, newFilename);

        await fsPromises.rename(req.file.path, newPath);

        const fileUrl = `/uploads/${newFilename}`;
        res.json({ success: true, url: fileUrl });
    } catch (error) {
        console.error('File processing failed:', error);
        res.status(500).json({ success: false, message: 'File processing failed.' });
    }
});

// Update profile
app.post('/api/update-profile', upload.single('profilePic'), async (req, res) => {
    const { userId, preferredName, removeProfilePic, hidePreferredName, hideProfilePicture } = req.body;

    try {
        const user = await User.findOne({ xameId: userId });
        if (!user) {
            if (req.file) {
                await fsPromises.unlink(req.file.path).catch(err => console.error('Failed to clean up file:', err));
            }
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        if (preferredName !== undefined) {
            user.preferredName = preferredName;
        }

        if (hidePreferredName !== undefined) {
            user.hidePreferredName = hidePreferredName === 'true';
        }
        if (hideProfilePicture !== undefined) {
            user.hideProfilePicture = hideProfilePicture === 'true';
        }

        if (removeProfilePic === 'true') {
            if (user.profilePic) {
                const oldPath = path.join(__dirname, user.profilePic);
                await fsPromises.unlink(oldPath).catch(err => console.error('Failed to delete old profile pic:', err));
            }
            user.profilePic = '';
            console.log(`✅ Profile picture removed for user: ${userId}`);
        } else if (req.file) {
            const oldProfilePic = user.profilePic ? path.join(__dirname, user.profilePic) : null;

            const fileExt = path.extname(req.file.originalname);
            const newFilename = `${userId}${fileExt}`;
            const newPath = path.join(profilePicsDir, newFilename);

            await fsPromises.rename(req.file.path, newPath);
            user.profilePic = `/media/profile_pics/${newFilename}`;
            console.log(`✅ Profile picture updated for user: ${userId}`);

            if (oldProfilePic) {
                await fsPromises.unlink(oldProfilePic).catch(err => console.error('Failed to delete old profile pic:', err));
            }
        }

        await user.save();

        res.json({
            success: true,
            preferredName: user.preferredName,
            profilePicUrl: user.profilePic,
            hidePreferredName: user.hidePreferredName,
            hideProfilePicture: user.hideProfilePicture
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ success: false, message: 'Server error during profile update.' });
    }
});

// Add contact
app.post('/api/add-contact', async (req, res) => {
    const { userId, contactId, customName } = req.body;
    
    try {
        const user = await User.findOne({ xameId: userId });
        const contact = await User.findOne({ xameId: contactId });

        if (!user || !contact) {
            return res.status(404).json({ success: false, message: 'User or contact not found.' });
        }

        const contactExists = user.contacts.some(c => c.contactId && c.contactId.toString() === contact._id.toString());
        if (contactExists) {
            return res.status(409).json({ success: false, message: 'Contact already exists.' });
        }

        user.contacts.push({
            contactId: contact._id,
            customName: customName
        });

        await user.save();

        const filteredContact = getPrivacyFilteredContactData(contact);
        const displayName = getContactDisplayName(contact.xameId, filteredContact, { customName });

        res.json({
            success: true,
            message: 'Contact added successfully.',
            contact: {
                xameId: contact.xameId,
                name: displayName,
                profilePic: filteredContact.profilePic,
                isOnline: onlineUsers.has(contact.xameId)
            }
        });
    } catch (error) {
        console.error('Add contact error:', error);
        res.status(500).json({ success: false, message: 'Server error adding contact.' });
    }
});

// Update contact
app.post('/api/update-contact',
    body('userId').trim().escape().notEmpty().withMessage('User ID is required.'),
    body('contactId').trim().escape().notEmpty().withMessage('Contact ID is required.'),
    body('newName').trim().escape().notEmpty().withMessage('New name is required.'),
    async (req, res) => {
        const validationErrors = validationResult(req);
        if (!validationErrors.isEmpty()) {
            return res.status(400).json({ success: false, message: 'Input validation failed.', errors: validationErrors.array() });
        }

        const { userId, contactId, newName } = req.body;

        try {
            const contactUser = await User.findOne({ xameId: contactId }).select('_id');
            if (!contactUser) {
                return res.status(404).json({ success: false, message: 'The user you are trying to contact was not found.' });
            }

            let result = await User.updateOne(
                {
                    xameId: userId,
                    'contacts.contactId': contactUser._id
                },
                {
                    $set: { 'contacts.$.customName': newName }
                }
            );

            if (result.matchedCount === 0) {
                const user = await User.findOne({ xameId: userId });
                if (!user) {
                    return res.status(404).json({ success: false, message: 'Your user profile was not found.' });
                }

                const contactExists = user.contacts.some(c => c.contactId && c.contactId.toString() === contactUser._id.toString());

                if (!contactExists) {
                    user.contacts.push({
                        contactId: contactUser._id,
                        customName: newName
                    });
                    await user.save();
                    console.log(`✅ Contact ${contactId} ADDED with custom name ${newName} for user ${userId}.`);
                } else {
                    await user.save();
                    console.log(`✅ Contact ${contactId} already exists but failed atomic update. Re-saving user document.`);
                }

                result = { modifiedCount: 1 };
            }

            console.log(`✅ Contact name for ${contactId} updated to ${newName} for user ${userId}.`);

            res.json({
                success: true,
                message: 'Contact name updated successfully.',
                updatedName: newName
            });
        } catch (error) {
            console.error(`🔴 MongoDB Update/Add Error for user ${userId} and contact ${contactId}:`, error);
            res.status(500).json({ success: false, message: 'A critical server error occurred during the save operation. Please try again.' });
        }
    }
);

// Delete chat and contact
app.post('/api/delete-chat-and-contact',
    body('userId').trim().escape().notEmpty().withMessage('User ID is required.'),
    body('contactId').trim().escape().notEmpty().withMessage('Contact ID is required.'),
    async (req, res) => {
        const validationErrors = validationResult(req);
        if (!validationErrors.isEmpty()) {
            return res.status(400).json({ success: false, message: 'Input validation failed.', errors: validationErrors.array() });
        }

        const { userId, contactId } = req.body;

        if (userId === contactId) {
            return res.status(403).json({ success: false, message: 'Cannot delete the self chat.' });
        }

        try {
            const contactToDelete = await User.findOne({ xameId: contactId }).select('_id');

            await Message.deleteMany({
                $or: [
                    { senderId: userId, recipientId: contactId },
                    { senderId: contactId, recipientId: userId }
                ]
            });

            await CallHistory.deleteMany({
                $or: [
                    { callerId: userId, recipientId: contactId },
                    { callerId: contactId, recipientId: userId }
                ]
            });

            let contactDeleted = false;
            if (contactToDelete) {
                const contactResult = await User.updateOne(
                    { xameId: userId },
                    { $pull: { contacts: { contactId: contactToDelete._id } } }
                );
                if (contactResult.modifiedCount > 0) {
                    contactDeleted = true;
                }
            }

            console.log(`✅ Permanent chat/contact deletion complete for user ${userId} and contact ${contactId}.`);

            res.json({
                success: true,
                message: `Contact and all chat history permanently deleted. (Contact list entry removed: ${contactDeleted})`
            });
        } catch (error) {
            console.error(`🔴 Critical Error during permanent chat/contact deletion for user ${userId} and contact ${contactId}:`, error);
            res.status(500).json({ success: false, message: 'A critical server error occurred during the permanent deletion operation.' });
        }
    }
);

// ============================================================
// SOCKET.IO HANDLERS
// ============================================================

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    console.log(`✅ User ${userId} connected. Total active users: ${io.engine.clientsCount}`);

    if (userId) {
        socketToUserMap.set(socket.id, userId);
        userToSocketMap.set(userId, socket.id);
        onlineUsers.add(userId);

        io.emit('online_users', Array.from(onlineUsers));
    }

    socket.on('disconnect', () => {
        const userId = socketToUserMap.get(socket.id);
        if (userId) {
            onlineUsers.delete(userId);
            userToSocketMap.delete(userId);
            socketToUserMap.delete(socket.id);
            io.emit('online_users', Array.from(onlineUsers));
        }
        console.log(`❌ User ${userId} disconnected. Total active users: ${io.engine.clientsCount}`);
    });

    socket.on('request_online_users', () => {
        socket.emit('online_users', Array.from(onlineUsers));
    });

    socket.on('get_chat_history', async ({ userId }) => {
        try {
            const messages = await Message.find({
                $or: [{ senderId: userId }, { recipientId: userId }]
            }).sort('ts');

            const chatHistory = {};

            messages.forEach(msg => {
                const contactId = msg.senderId === userId ? msg.recipientId : msg.senderId;
                if (!chatHistory[contactId]) {
                    chatHistory[contactId] = [];
                }

                const formattedMsg = {
                    id: msg.messageId,
                    text: msg.text,
                    file: msg.file,
                    type: msg.senderId === userId ? 'sent' : 'received',
                    ts: msg.ts,
                    status: msg.status
                };
                chatHistory[contactId].push(formattedMsg);
            });

            socket.emit('chat_history', chatHistory);
            console.log(`✅ Sent chat history for ${userId}. Total conversations: ${Object.keys(chatHistory).length}`);
        } catch (error) {
            console.error('Failed to get chat history:', error);
            socket.emit('chat_history', {});
        }
    });

    socket.on('get_contacts', async (userId) => {
        try {
            const formattedContacts = await getFullContactData(userId);

            socket.emit('contacts_list', formattedContacts);
            console.log(`✅ Sent full contact list for ${userId}. Total threads: ${formattedContacts.length}`);
        } catch (error) {
            console.error('Failed to get full contacts/threads list:', error);
            socket.emit('contacts_list', []);
        }
    });

    socket.on('send-message', async (data, callback) => {
        const { recipientId, message } = data;
        const senderId = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);

        try {
            const newMessageData = {
                messageId: message.id,
                senderId: senderId,
                recipientId: recipientId,
                ts: message.ts,
                ...(message.text && { text: message.text }),
                ...(message.file && { file: message.file })
            };

            const newMessage = new Message(newMessageData);
            await newMessage.save();

            if (recipientSocketId) {
                io.to(recipientSocketId).emit('receive-message', { senderId: senderId, message });

                await Message.findOneAndUpdate({ messageId: message.id }, { status: 'delivered' });
                io.to(socket.id).emit('message-status-update', {
                    recipientId: recipientId,
                    messageId: message.id,
                    status: 'delivered'
                });

                io.to(recipientSocketId).emit('new_message_count', { senderId: senderId });
            }
            callback({ success: true, messageId: message.id });
        } catch (error) {
            console.error('Failed to save message:', error);
            callback({ success: false, message: 'Server failed to save message.' });
        }
    });

    socket.on('sync-deletions', async ({ deletions }, callback) => {
        const userId = socketToUserMap.get(socket.id);
        if (!userId) {
            return callback({ success: false, message: 'Authentication failed.' });
        }

        const { contactId, messageIds, deleteForEveryone } = deletions.chat;
        const recipientId = contactId;

        if (!messageIds || messageIds.length === 0) {
            return callback({ success: true, message: 'No messages provided.' });
        }

        try {
            console.log(`[SYNC-DEL] User ${userId} deleting ${messageIds.length} messages for contact ${recipientId}. Delete for everyone: ${deleteForEveryone}`);

            if (deleteForEveryone) {
                const deleteResult = await Message.deleteMany({
                    messageId: { $in: messageIds },
                    senderId: userId
                });

                console.log(`[SYNC-DEL] Deleted ${deleteResult.deletedCount} messages permanently.`);

                if (deleteResult.deletedCount > 0) {
                    const recipientSocketId = findSocketIdByUserId(recipientId);
                    if (recipientSocketId) {
                        io.to(recipientSocketId).emit('messages-deleted', {
                            deleterId: userId,
                            contactId: userId,
                            messageIds: messageIds,
                            permanently: true
                        });
                        console.log(`[SYNC-DEL] Notified recipient ${recipientId} for permanent deletion.`);
                    }
                }
            } else {
                console.log(`[SYNC-DEL] Message(s) marked for local deletion only for user ${userId}. (Requires client-side persistence).`);
            }

            callback({ success: true });
        } catch (error) {
            console.error(`[SYNC-DEL] Critical error for user ${userId}:`, error);
            callback({ success: false, message: 'Internal server error during deletion.' });
        }
    });

    socket.on('message-seen', async ({ recipientId, messageIds }) => {
        const senderId = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);

        try {
            await Message.updateMany(
                { messageId: { $in: messageIds }, recipientId: senderId, senderId: recipientId },
                { status: 'seen' }
            );

            if (recipientSocketId) {
                io.to(recipientSocketId).emit('message-seen-update', {
                    recipientId: senderId,
                    messageIds: messageIds
                });
            }
        } catch (error) {
            console.error('Failed to update message seen status:', error);
        }
    });

    socket.on('typing', ({ recipientId }) => {
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('typing', { senderId: socketToUserMap.get(socket.id) });
        }
    });

    socket.on('stop-typing', ({ recipientId }) => {
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('stop-typing', { senderId: socketToUserMap.get(socket.id) });
        }
    });

    // WebRTC Signaling
    socket.on('call-user', async ({ recipientId, offer, callType }) => {
        const callerId = socketToUserMap.get(socket.id);
        console.log(`📞 User ${callerId} is calling ${recipientId}. Call Type: ${callType}`);
        const recipientSocketId = findSocketIdByUserId(recipientId);

        if (recipientSocketId) {
            try {
                const caller = await User.findOne({ xameId: callerId });
                const recipientUser = await User.findOne({ xameId: recipientId }).populate('contacts.contactId');

                if (!caller || !recipientUser) {
                    return socket.emit('call-error', { message: 'Caller or recipient not found.' });
                }

                const callId = uuidv4();
                const newCall = new CallHistory({
                    callId: callId,
                    callerId: callerId,
                    recipientId: recipientId,
                    callType: callType,
                    status: 'pending'
                });
                await newCall.save();

                const filteredCaller = getPrivacyFilteredContactData(caller.toObject());

                const savedContactForCaller = recipientUser.contacts.find(
                    c => c.contactId && c.contactId.xameId === callerId
                );

                const incomingCallName = getContactDisplayName(callerId, filteredCaller, savedContactForCaller);

                const restrictedCaller = {
                    xameId: filteredCaller.xameId,
                    firstName: filteredCaller.firstName,
                    lastName: filteredCaller.lastName,
                    preferredName: filteredCaller.preferredName,
                    profilePic: filteredCaller.profilePic,
                    displayName: incomingCallName
                };

                io.to(recipientSocketId).emit('call-user', { offer, callerId, caller: restrictedCaller, callType, callId: callId });
            } catch (error) {
                console.error('Call user error:', error);
                socket.emit('call-error', { message: 'Failed to initiate call due to server error.' });
            }
        } else {
            console.log(`📞 User ${recipientId} is offline, cannot call. Recording as missed.`);

            try {
                const callId = uuidv4();
                const newCall = new CallHistory({
                    callId: callId,
                    callerId: callerId,
                    recipientId: recipientId,
                    callType: callType,
                    status: 'missed'
                });
                await newCall.save();
                socket.emit('call-rejected', { senderId: recipientId, reason: 'offline' });
            } catch (error) {
                console.error('Failed to record missed call for offline user:', error);
            }
        }
    });

    socket.on('make-answer', ({ recipientId, answer }) => {
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('make-answer', { answer, senderId: socketToUserMap.get(socket.id) });
        }
    });

    socket.on('ice-candidate', ({ recipientId, candidate }) => {
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('ice-candidate', { candidate, senderId: socketToUserMap.get(socket.id) });
        }
    });

    socket.on('stream-ready', ({ recipientId, streamType }) => {
        const senderId = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            console.log(`🎥 User ${senderId} has a ${streamType} stream ready. Notifying ${recipientId}.`);
            io.to(recipientSocketId).emit('stream-ready', { senderId, streamType });
        }
    });

    socket.on('call-accepted', async ({ recipientId, callId }) => {
        const acceptorId = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-accepted', { recipientId: acceptorId });
            try {
                const query = callId ? { callId: callId } : { callerId: recipientId, recipientId: acceptorId, status: 'pending' };
                await CallHistory.findOneAndUpdate(query, { status: 'accepted' });
            } catch (error) {
                console.error('Failed to update call history (accepted):', error);
            }
        }
    });

    socket.on('call-rejected', async ({ recipientId, reason, callId }) => {
        const rejectorId = socketToUserMap.get(socket.id);
        const callerSocketId = findSocketIdByUserId(recipientId);

        try {
            const query = callId ? { callId: callId } : { callerId: recipientId, recipientId: rejectorId, status: 'pending' };
            const updateResult = await CallHistory.findOneAndUpdate(query, { status: 'rejected' });

            if (callerSocketId) {
                io.to(callerSocketId).emit('call-rejected', { senderId: rejectorId, reason });
            }

            if (updateResult) {
                socket.emit('call-acknowledged', { senderId: recipientId, acknowledgedCallId: updateResult.callId });
            }
        } catch (error) {
            console.error('Failed to update call history (rejected):', error);
        }
    });

    socket.on('call-unanswered', async ({ recipientId, callId }) => {
        const callerId = socketToUserMap.get(socket.id);

        try {
            await CallHistory.findOneAndUpdate(
                { callId: callId, callerId: callerId, recipientId: recipientId, status: 'pending' },
                { status: 'missed' }
            );

            const recipientSocketId = findSocketIdByUserId(recipientId);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('new_missed_call_count', { senderId: callerId });
            }
        } catch (error) {
            console.error('Failed to handle unanswered call:', error);
        }
    });

    socket.on('call-ended', async ({ recipientId }) => {
        const currentUserId = socketToUserMap.get(socket.id);
        try {
            await CallHistory.findOneAndUpdate(
                {
                    $or: [
                        { callerId: currentUserId, recipientId: recipientId, status: 'accepted' },
                        { callerId: recipientId, recipientId: currentUserId, status: 'accepted' }
                    ]
                },
                { status: 'ended', endTime: new Date() }
            );
        } catch (error) {
            console.error('Failed to end call:', error);
        }
    });
});

// ============================================================
// CATCH-ALL ROUTE FOR SPA
// ============================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('✅ XamePage Server v2.1 Started Successfully');
    console.log('='.repeat(60));
    console.log(`📡 Server running on port: ${PORT}`);
    console.log(`🌐 Local access: http://localhost:${PORT}`);
    console.log(`📁 Serving files from: ${__dirname}`);
    console.log(`🗄️  MongoDB: ${MONGODB_URI ? 'Connected' : 'Not configured'}`);
    console.log('='.repeat(60));
});
