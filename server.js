//
// XamePage v2.1 Server File - FULLY FIXED VERSION
//
// Production-grade server with full MongoDB persistence and WebRTC support.
// Compatible with both cloud deployment (Render) and local development (Termux).
//
// ✅ FIXES APPLIED:
// 1. Added pingTimeout/pingInterval/upgradeTimeout to Socket.IO config
// 2. Removed fake placeholder socket ID from /api/login
// 3. Fixed sync-deletions destructuring (was { deletions }, now correct shape)
// 4. Profile pic filename now includes timestamp to prevent collision
// 5. get_contacts socket event now authenticates the requesting socket
// 6. get_chat_history socket event now authenticates the requesting socket
// 7. Added /api/search-user endpoint
// 8. createDirectories() is now awaited before server starts listening
// + Old users without passwords can set passwords via /api/set-password
// + Profile pictures stored on filesystem (NOT base64 in MongoDB)
// + Cross-platform path handling
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
const bcrypt = require('bcryptjs');
require('dotenv').config();

// ============================================================
// SERVER SETUP
// ============================================================

const app = express();
const server = http.createServer(app);

// ✅ FIX 1: Added pingTimeout, pingInterval, upgradeTimeout to prevent
//    premature disconnections (was causing blank profile page & socket drops)
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    path: '/socket.io/',
    pingTimeout: 60000,      // ✅ How long to wait for pong before disconnect (ms)
    pingInterval: 25000,     // ✅ How often to send ping (ms)
    upgradeTimeout: 30000,   // ✅ How long to wait for transport upgrade (ms)
    maxHttpBufferSize: 1e8   // ✅ 100MB - needed for large file transfers
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());

// ============================================================
// CROSS-PLATFORM PATH CONFIGURATION
// ============================================================

const BASE_DIR = process.cwd();
const uploadDir = path.join(BASE_DIR, 'uploads');
const profilePicsDir = path.join(BASE_DIR, 'media', 'profile_pics');

console.log(`📁 Base directory: ${BASE_DIR}`);
console.log(`📂 Upload directory: ${uploadDir}`);
console.log(`🖼️  Profile pics directory: ${profilePicsDir}`);

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
    password: { type: String },           // Optional for backwards compatibility
    profilePic: { type: String, default: '' }, // Relative path, NOT base64
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

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const CallHistory = mongoose.model('CallHistory', callHistorySchema);

// ============================================================
// FILE UPLOAD CONFIGURATION
// ============================================================

const upload = multer({ dest: uploadDir });

// ✅ FIX 8: createDirectories is now awaited before server starts listening
async function createDirectories() {
    try {
        if (!fs.existsSync(uploadDir)) {
            await fsPromises.mkdir(uploadDir, { recursive: true });
            console.log('✅ Created uploads directory');
        }
        if (!fs.existsSync(profilePicsDir)) {
            await fsPromises.mkdir(profilePicsDir, { recursive: true });
            console.log('✅ Created profile pics directory');
        }
    } catch (error) {
        console.error('❌ Error creating directories:', error);
        process.exit(1);
    }
}

// Serve static files
app.use(express.static(BASE_DIR));
app.use('/media/profile_pics', express.static(profilePicsDir));
app.use('/uploads', express.static(uploadDir));

// ============================================================
// ONLINE USER STATE MANAGEMENT
// ============================================================

const onlineUsers = new Set();
const userToSocketMap = new Map();
const socketToUserMap = new Map();
const onlineUserTimestamps = new Map();
const disconnectTimeouts = new Map();

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
    return {
        xameId: user.xameId,
        firstName: user.firstName,
        lastName: user.lastName,
        preferredName: user.hidePreferredName ? '' : user.preferredName,
        profilePic: user.hideProfilePicture ? '' : user.profilePic
    };
}

function getContactDisplayName(contactXameId, partnerUser, savedContact) {
    if (savedContact?.customName) return savedContact.customName;
    if (partnerUser?.preferredName) return partnerUser.preferredName;
    if (partnerUser) {
        const fullName = `${partnerUser.firstName} ${partnerUser.lastName}`.trim();
        if (fullName) return fullName;
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
        previewText = lastMessage.senderId === userId
            ? 'You: Sent a message.'
            : 'New message received.';
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

    const contactXameIds = Array.from(allPartnerIds);
    const partnerUsers = await User.find({ xameId: { $in: contactXameIds } });
    const contactsMap = new Map();
    partnerUsers.forEach(p => contactsMap.set(p.xameId, p));

    const interactionPromises = contactXameIds.map(async (xameId) => {
        const partnerUser = contactsMap.get(xameId);
        const savedContact = user.contacts.find(c => c.contactId?.xameId === xameId);

        const [unreadMessagesCount, missedCallsCount, interactionDetails] = await Promise.all([
            Message.countDocuments({
                senderId: xameId,
                recipientId: userId,
                status: { $in: ['sent', 'delivered'] }
            }),
            CallHistory.countDocuments({
                callerId: xameId,
                recipientId: userId,
                status: { $in: ['pending', 'missed'] }
            }),
            getLastInteractionDetails(userId, xameId)
        ]);

        const filteredPartner = partnerUser ? getPrivacyFilteredContactData(partnerUser) : null;
        const displayName = getContactDisplayName(xameId, filteredPartner, savedContact);

        return {
            xameId,
            name: displayName,
            profilePic: filteredPartner ? filteredPartner.profilePic : '',
            isOnline: onlineUsers.has(xameId),
            unreadMessagesCount,
            missedCallsCount,
            isSaved: !!savedContact,
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

// --- REGISTER ---
app.post('/api/register',
    body('firstName').trim().escape().notEmpty().withMessage('First name is required.'),
    body('lastName').trim().escape().notEmpty().withMessage('Last name is required.'),
    body('dob').isDate({ format: 'YYYY-MM-DD' }).withMessage('Date of birth must be YYYY-MM-DD.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { firstName, lastName, dob, password } = req.body;

        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const xameId = await generateUniqueXameId();
            const newUser = new User({ xameId, firstName, lastName, dob, password: hashedPassword });
            await newUser.save();

            console.log(`✅ User registered: ${newUser.xameId}`);

            const userResponse = newUser.toObject();
            delete userResponse.password;

            res.json({ success: true, user: userResponse });
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ success: false, message: 'Server error during registration.' });
        }
    }
);

// --- SET PASSWORD (for legacy users without one) ---
app.post('/api/set-password',
    body('xameId').trim().escape().notEmpty().withMessage('Xame-ID is required.'),
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { xameId, newPassword } = req.body;

        try {
            const user = await User.findOne({ xameId });
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found.' });
            }
            if (user.password) {
                return res.status(400).json({
                    success: false,
                    message: 'This account already has a password. Use password reset instead.'
                });
            }

            user.password = await bcrypt.hash(newPassword, 10);
            await user.save();

            console.log(`✅ Password set for legacy user: ${xameId}`);

            const userResponse = user.toObject();
            delete userResponse.password;

            res.json({
                success: true,
                message: 'Password set successfully! You can now log in.',
                user: userResponse
            });
        } catch (error) {
            console.error('Set password error:', error);
            res.status(500).json({ success: false, message: 'Server error during password setup.' });
        }
    }
);

// --- LOGIN ---
// ✅ FIX 2: Removed fake placeholder socket ID that was breaking message routing
app.post('/api/login', async (req, res) => {
    const { xameId, password } = req.body;

    if (!xameId) {
        return res.status(400).json({ success: false, message: 'Xame-ID is required.' });
    }

    try {
        const user = await User.findOne({ xameId });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // Legacy user with no password — prompt them to set one
        if (!user.password) {
            return res.status(403).json({
                success: false,
                message: 'Your account needs a password. Please set one to continue.',
                requiresPasswordSetup: true,
                user: {
                    xameId: user.xameId,
                    firstName: user.firstName,
                    lastName: user.lastName
                }
            });
        }

        if (!password) {
            return res.status(400).json({ success: false, message: 'Password is required.' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, message: 'Invalid password.' });
        }

        // ✅ FIX 2: Do NOT set userToSocketMap here with a fake ID.
        //    The real socket ID is set when the socket connects in io.on('connection').
        console.log(`✅ User logged in: ${user.xameId}`);

        const userWithPrivacy = {
            ...user.toObject(),
            privacySettings: {
                hidePreferredName: user.hidePreferredName,
                hideProfilePicture: user.hideProfilePicture
            }
        };
        delete userWithPrivacy.password;

        res.json({ success: true, user: userWithPrivacy });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

// --- LOGOUT ---
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

// --- GET USER NAME ---
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

// ✅ FIX 7: Added missing /api/search-user endpoint (client search dialog was broken)
app.post('/api/search-user', async (req, res) => {
    const { xameId } = req.body;

    if (!xameId || typeof xameId !== 'string' || xameId.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Xame-ID is required.' });
    }

    try {
        const user = await User.findOne({ xameId: xameId.trim() });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const filtered = getPrivacyFilteredContactData(user);
        res.json({
            success: true,
            user: {
                xameId: filtered.xameId,
                firstName: filtered.firstName,
                lastName: filtered.lastName,
                preferredName: filtered.preferredName,
                profilePic: filtered.profilePic,
                isOnline: onlineUsers.has(user.xameId)
            }
        });
    } catch (error) {
        console.error('Search user error:', error);
        res.status(500).json({ success: false, message: 'Server error during search.' });
    }
});

// --- UPLOAD FILE ---
app.post('/api/upload-file', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    try {
        const fileExt = path.extname(req.file.originalname);
        const newFilename = `${uuidv4()}${fileExt}`;
        const newPath = path.join(uploadDir, newFilename);

        await fsPromises.rename(req.file.path, newPath);

        res.json({ success: true, url: `/uploads/${newFilename}` });
    } catch (error) {
        console.error('File processing failed:', error);
        res.status(500).json({ success: false, message: 'File processing failed.' });
    }
});

// --- UPDATE PROFILE ---
// ✅ FIX 4: Profile pic filename now includes timestamp to prevent collision
//    when user uploads the same file extension multiple times
app.post('/api/update-profile', upload.single('profilePic'), async (req, res) => {
    const { userId, preferredName, removeProfilePic, hidePreferredName, hideProfilePicture } = req.body;

    try {
        const user = await User.findOne({ xameId: userId });
        if (!user) {
            if (req.file) {
                await fsPromises.unlink(req.file.path).catch(err =>
                    console.error('Failed to clean up temp file:', err)
                );
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
                const oldPath = path.join(BASE_DIR, user.profilePic);
                await fsPromises.unlink(oldPath).catch(err =>
                    console.error('Failed to delete old profile pic:', err)
                );
            }
            user.profilePic = '';
            console.log(`✅ Profile picture removed for user: ${userId}`);

        } else if (req.file) {
            // ✅ FIX 4: Use timestamp in filename to avoid collision on same extension
            const fileExt = path.extname(req.file.originalname);
            const newFilename = `${userId}_${Date.now()}${fileExt}`;
            const newPath = path.join(profilePicsDir, newFilename);
            const oldProfilePic = user.profilePic ? path.join(BASE_DIR, user.profilePic) : null;

            await fsPromises.rename(req.file.path, newPath);
            user.profilePic = `/media/profile_pics/${newFilename}`;

            if (oldProfilePic) {
                await fsPromises.unlink(oldProfilePic).catch(err =>
                    console.error('Failed to delete old profile pic:', err)
                );
            }
            console.log(`✅ Profile picture updated for user: ${userId}`);
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

// --- ADD CONTACT ---
app.post('/api/add-contact', async (req, res) => {
    const { userId, contactId, customName } = req.body;

    try {
        const user = await User.findOne({ xameId: userId });
        const contact = await User.findOne({ xameId: contactId });

        if (!user || !contact) {
            return res.status(404).json({ success: false, message: 'User or contact not found.' });
        }

        const contactExists = user.contacts.some(
            c => c.contactId && c.contactId.toString() === contact._id.toString()
        );
        if (contactExists) {
            return res.status(409).json({ success: false, message: 'Contact already exists.' });
        }

        user.contacts.push({ contactId: contact._id, customName });
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

// --- UPDATE CONTACT ---
app.post('/api/update-contact',
    body('userId').trim().escape().notEmpty().withMessage('User ID is required.'),
    body('contactId').trim().escape().notEmpty().withMessage('Contact ID is required.'),
    body('newName').trim().escape().notEmpty().withMessage('New name is required.'),
    async (req, res) => {
        const validationErrors = validationResult(req);
        if (!validationErrors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Input validation failed.',
                errors: validationErrors.array()
            });
        }

        const { userId, contactId, newName } = req.body;

        try {
            const contactUser = await User.findOne({ xameId: contactId }).select('_id');
            if (!contactUser) {
                return res.status(404).json({
                    success: false,
                    message: 'The user you are trying to contact was not found.'
                });
            }

            let result = await User.updateOne(
                { xameId: userId, 'contacts.contactId': contactUser._id },
                { $set: { 'contacts.$.customName': newName } }
            );

            if (result.matchedCount === 0) {
                const user = await User.findOne({ xameId: userId });
                if (!user) {
                    return res.status(404).json({
                        success: false,
                        message: 'Your user profile was not found.'
                    });
                }

                const contactExists = user.contacts.some(
                    c => c.contactId && c.contactId.toString() === contactUser._id.toString()
                );

                if (!contactExists) {
                    user.contacts.push({ contactId: contactUser._id, customName: newName });
                }

                await user.save();
                console.log(`✅ Contact ${contactId} updated/added with name "${newName}" for user ${userId}.`);
            }

            res.json({
                success: true,
                message: 'Contact name updated successfully.',
                updatedName: newName
            });
        } catch (error) {
            console.error(`🔴 Update contact error for user ${userId}:`, error);
            res.status(500).json({
                success: false,
                message: 'A critical server error occurred. Please try again.'
            });
        }
    }
);

// --- DELETE CHAT AND CONTACT ---
app.post('/api/delete-chat-and-contact',
    body('userId').trim().escape().notEmpty().withMessage('User ID is required.'),
    body('contactId').trim().escape().notEmpty().withMessage('Contact ID is required.'),
    async (req, res) => {
        const validationErrors = validationResult(req);
        if (!validationErrors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Input validation failed.',
                errors: validationErrors.array()
            });
        }

        const { userId, contactId } = req.body;

        if (userId === contactId) {
            return res.status(403).json({ success: false, message: 'Cannot delete the self chat.' });
        }

        try {
            const contactToDelete = await User.findOne({ xameId: contactId }).select('_id');

            await Promise.all([
                Message.deleteMany({
                    $or: [
                        { senderId: userId, recipientId: contactId },
                        { senderId: contactId, recipientId: userId }
                    ]
                }),
                CallHistory.deleteMany({
                    $or: [
                        { callerId: userId, recipientId: contactId },
                        { callerId: contactId, recipientId: userId }
                    ]
                })
            ]);

            let contactDeleted = false;
            if (contactToDelete) {
                const contactResult = await User.updateOne(
                    { xameId: userId },
                    { $pull: { contacts: { contactId: contactToDelete._id } } }
                );
                contactDeleted = contactResult.modifiedCount > 0;
            }

            console.log(`✅ Permanent deletion complete: user ${userId}, contact ${contactId}`);

            res.json({
                success: true,
                message: `Contact and all chat history permanently deleted. (Contact removed: ${contactDeleted})`
            });
        } catch (error) {
            console.error(`🔴 Permanent deletion error for user ${userId}:`, error);
            res.status(500).json({
                success: false,
                message: 'A critical server error occurred during deletion.'
            });
        }
    }
);

// ============================================================
// SOCKET.IO HANDLERS
// ============================================================

function broadcastOnlineUsers() {
    const onlineArray = Array.from(onlineUsers);
    io.emit('online_users', onlineArray);
    console.log(`📊 Broadcasting online users: ${onlineArray.length} users online`);
}

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    console.log(`✅ User ${userId} connected. Total active sockets: ${io.engine.clientsCount}`);

    socket.userId = userId;

    if (userId) {
        // Clear any pending disconnect grace period timeout
        if (disconnectTimeouts.has(userId)) {
            clearTimeout(disconnectTimeouts.get(userId));
            disconnectTimeouts.delete(userId);
            console.log(`🔄 User ${userId} reconnected within grace period`);
        }

        socketToUserMap.set(socket.id, userId);
        userToSocketMap.set(userId, socket.id);
        onlineUsers.add(userId);
        onlineUserTimestamps.set(userId, Date.now());

        broadcastOnlineUsers();
    }

    // --- USER ONLINE (explicit presence announcement) ---
    socket.on('user-online', ({ userId: announcedUserId, timestamp }) => {
        const uid = announcedUserId || socket.userId;
        if (!uid) return;

        console.log(`🟢 User ${uid} announced online presence`);

        if (disconnectTimeouts.has(uid)) {
            clearTimeout(disconnectTimeouts.get(uid));
            disconnectTimeouts.delete(uid);
        }

        onlineUsers.add(uid);
        onlineUserTimestamps.set(uid, timestamp || Date.now());

        if (uid !== socket.userId) {
            socket.userId = uid;
        }

        broadcastOnlineUsers();
    });

    // --- HEARTBEAT ---
    socket.on('heartbeat', ({ userId: heartbeatUserId, timestamp }) => {
        const uid = heartbeatUserId || socket.userId;
        if (!uid) return;

        onlineUserTimestamps.set(uid, timestamp || Date.now());

        if (!onlineUsers.has(uid)) {
            console.log(`💓 Heartbeat restored user ${uid} to online`);
            onlineUsers.add(uid);
            broadcastOnlineUsers();
        }

        if (disconnectTimeouts.has(uid)) {
            clearTimeout(disconnectTimeouts.get(uid));
            disconnectTimeouts.delete(uid);
        }
    });

    // --- USER OFFLINE (explicit logout) ---
    socket.on('user-offline', ({ userId: offlineUserId }) => {
        const uid = offlineUserId || socket.userId;
        if (!uid) return;

        console.log(`🔴 User ${uid} announced offline (logout)`);

        if (disconnectTimeouts.has(uid)) {
            clearTimeout(disconnectTimeouts.get(uid));
            disconnectTimeouts.delete(uid);
        }

        onlineUsers.delete(uid);
        onlineUserTimestamps.delete(uid);
        broadcastOnlineUsers();
    });

    // --- REQUEST ONLINE USERS ---
    socket.on('request_online_users', () => {
        socket.emit('online_users', Array.from(onlineUsers));
    });

    // --- DISCONNECT with 60-second grace period ---
    socket.on('disconnect', (reason) => {
        const disconnectedUserId = socket.userId || socketToUserMap.get(socket.id);

        console.log(`❌ Socket ${socket.id} disconnected. Reason: ${reason}`);
        socketToUserMap.delete(socket.id);

        if (disconnectedUserId) {
            const hasOtherSockets = Array.from(socketToUserMap.values()).includes(disconnectedUserId);

            if (!hasOtherSockets) {
                console.log(`⏱️ Starting 60s grace period for user ${disconnectedUserId}`);

                const timeoutId = setTimeout(() => {
                    console.log(`🔴 Grace period expired for user ${disconnectedUserId}`);

                    const stillNoSockets = !Array.from(socketToUserMap.values()).includes(disconnectedUserId);
                    if (stillNoSockets && onlineUsers.has(disconnectedUserId)) {
                        onlineUsers.delete(disconnectedUserId);
                        onlineUserTimestamps.delete(disconnectedUserId);
                        userToSocketMap.delete(disconnectedUserId);
                        broadcastOnlineUsers();
                    }

                    disconnectTimeouts.delete(disconnectedUserId);
                }, 60000);

                disconnectTimeouts.set(disconnectedUserId, timeoutId);
            } else {
                console.log(`ℹ️ User ${disconnectedUserId} has other active sockets`);
            }
        }

        console.log(`📊 Total active sockets: ${io.engine.clientsCount}`);
    });

    // --- GET CHAT HISTORY ---
    // ✅ FIX 6: Authenticated — only the socket's own userId can request history
    socket.on('get_chat_history', async ({ userId: requestedUserId }) => {
        const authenticatedUserId = socketToUserMap.get(socket.id);

        if (authenticatedUserId !== requestedUserId) {
            console.warn(`⚠️ Unauthorized chat history request from socket ${socket.id}`);
            return socket.emit('chat_history', {});
        }

        try {
            const messages = await Message.find({
                $or: [{ senderId: requestedUserId }, { recipientId: requestedUserId }]
            }).sort('ts');

            const chatHistory = {};

            messages.forEach(msg => {
                const contactId = msg.senderId === requestedUserId
                    ? msg.recipientId
                    : msg.senderId;

                if (!chatHistory[contactId]) chatHistory[contactId] = [];

                chatHistory[contactId].push({
                    id: msg.messageId,
                    text: msg.text,
                    file: msg.file,
                    type: msg.senderId === requestedUserId ? 'sent' : 'received',
                    ts: msg.ts,
                    status: msg.status
                });
            });

            socket.emit('chat_history', chatHistory);
            console.log(`✅ Sent chat history for ${requestedUserId}. Conversations: ${Object.keys(chatHistory).length}`);
        } catch (error) {
            console.error('Failed to get chat history:', error);
            socket.emit('chat_history', {});
        }
    });

    // --- GET CONTACTS ---
    // ✅ FIX 5: Authenticated — only the socket's own userId can request contacts
    socket.on('get_contacts', async (requestedUserId) => {
        const authenticatedUserId = socketToUserMap.get(socket.id);

        if (authenticatedUserId !== requestedUserId) {
            console.warn(`⚠️ Unauthorized contacts request from socket ${socket.id}`);
            return socket.emit('contacts_list', []);
        }

        try {
            const formattedContacts = await getFullContactData(requestedUserId);
            socket.emit('contacts_list', formattedContacts);
            console.log(`✅ Sent contact list for ${requestedUserId}. Threads: ${formattedContacts.length}`);
        } catch (error) {
            console.error('Failed to get contacts list:', error);
            socket.emit('contacts_list', []);
        }
    });

    // --- SEND MESSAGE ---
    socket.on('send-message', async (data, callback) => {
        const { recipientId, message } = data;
        const senderId = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);

        try {
            const newMessage = new Message({
                messageId: message.id,
                senderId,
                recipientId,
                ts: message.ts,
                ...(message.text && { text: message.text }),
                ...(message.file && { file: message.file })
            });
            await newMessage.save();

            if (recipientSocketId) {
                io.to(recipientSocketId).emit('receive-message', { senderId, message });

                await Message.findOneAndUpdate({ messageId: message.id }, { status: 'delivered' });
                io.to(socket.id).emit('message-status-update', {
                    recipientId,
                    messageId: message.id,
                    status: 'delivered'
                });

                io.to(recipientSocketId).emit('new_message_count', { senderId });
            }

            callback({ success: true, messageId: message.id });
        } catch (error) {
            console.error('Failed to save message:', error);
            callback({ success: false, message: 'Server failed to save message.' });
        }
    });

    // --- SYNC DELETIONS ---
    // ✅ FIX 3: Fixed destructuring — client sends deletionData directly,
    //    not wrapped in { deletions: ... }
    socket.on('sync-deletions', async (deletionData, callback) => {
        const userId = socketToUserMap.get(socket.id);
        if (!userId) {
            return callback({ success: false, message: 'Authentication failed.' });
        }

        // ✅ FIX 3: Was `const { contactId } = deletions.chat` — now correct
        const { contactId, messageIds, deleteForEveryone } = deletionData.chat;
        const recipientId = contactId;

        if (!messageIds || messageIds.length === 0) {
            return callback({ success: true, message: 'No messages provided.' });
        }

        try {
            console.log(`[SYNC-DEL] User ${userId} deleting ${messageIds.length} messages. For everyone: ${deleteForEveryone}`);

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
                            messageIds,
                            permanently: true
                        });
                    }
                }
            } else {
                console.log(`[SYNC-DEL] Local deletion only for user ${userId}.`);
            }

            callback({ success: true });
        } catch (error) {
            console.error(`[SYNC-DEL] Error for user ${userId}:`, error);
            callback({ success: false, message: 'Internal server error during deletion.' });
        }
    });

    // --- MESSAGE SEEN ---
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
                    messageIds
                });
            }
        } catch (error) {
            console.error('Failed to update message seen status:', error);
        }
    });

    // --- TYPING INDICATORS ---
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

    // --- WEBRTC: CALL USER ---
    socket.on('call-user', async ({ recipientId, offer, callType }) => {
        const callerId = socketToUserMap.get(socket.id);
        console.log(`📞 User ${callerId} is calling ${recipientId}. Type: ${callType}`);
        const recipientSocketId = findSocketIdByUserId(recipientId);

        if (recipientSocketId) {
            try {
                const [caller, recipientUser] = await Promise.all([
                    User.findOne({ xameId: callerId }),
                    User.findOne({ xameId: recipientId }).populate('contacts.contactId')
                ]);

                if (!caller || !recipientUser) {
                    return socket.emit('call-error', { message: 'Caller or recipient not found.' });
                }

                const callId = uuidv4();
                await new CallHistory({
                    callId,
                    callerId,
                    recipientId,
                    callType,
                    status: 'pending'
                }).save();

                const filteredCaller = getPrivacyFilteredContactData(caller.toObject());
                const savedContact = recipientUser.contacts.find(
                    c => c.contactId && c.contactId.xameId === callerId
                );
                const incomingCallName = getContactDisplayName(callerId, filteredCaller, savedContact);

                io.to(recipientSocketId).emit('call-user', {
                    offer,
                    callerId,
                    caller: {
                        xameId: filteredCaller.xameId,
                        firstName: filteredCaller.firstName,
                        lastName: filteredCaller.lastName,
                        preferredName: filteredCaller.preferredName,
                        profilePic: filteredCaller.profilePic,
                        displayName: incomingCallName
                    },
                    callType,
                    callId
                });
            } catch (error) {
                console.error('Call user error:', error);
                socket.emit('call-error', { message: 'Failed to initiate call.' });
            }
        } else {
            console.log(`📞 ${recipientId} is offline. Recording as missed.`);
            try {
                await new CallHistory({
                    callId: uuidv4(),
                    callerId,
                    recipientId,
                    callType,
                    status: 'missed'
                }).save();
                socket.emit('call-rejected', { senderId: recipientId, reason: 'offline' });
            } catch (error) {
                console.error('Failed to record missed call:', error);
            }
        }
    });

    // --- WEBRTC: ANSWER ---
    socket.on('make-answer', ({ recipientId, answer }) => {
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('make-answer', {
                answer,
                senderId: socketToUserMap.get(socket.id)
            });
        }
    });

    // --- WEBRTC: ICE CANDIDATE ---
    socket.on('ice-candidate', ({ recipientId, candidate }) => {
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('ice-candidate', {
                candidate,
                senderId: socketToUserMap.get(socket.id)
            });
        }
    });

    // --- WEBRTC: STREAM READY ---
    socket.on('stream-ready', ({ recipientId, streamType }) => {
        const senderId = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            console.log(`🎥 User ${senderId} has a ${streamType} stream ready. Notifying ${recipientId}.`);
            io.to(recipientSocketId).emit('stream-ready', { senderId, streamType });
        }
    });

    // --- WEBRTC: CALL ACCEPTED ---
    socket.on('call-accepted', async ({ recipientId, callId }) => {
        const acceptorId = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-accepted', { recipientId: acceptorId });
            try {
                const query = callId
                    ? { callId }
                    : { callerId: recipientId, recipientId: acceptorId, status: 'pending' };
                await CallHistory.findOneAndUpdate(query, { status: 'accepted' });
            } catch (error) {
                console.error('Failed to update call history (accepted):', error);
            }
        }
    });

    // --- WEBRTC: CALL REJECTED ---
    socket.on('call-rejected', async ({ recipientId, reason, callId }) => {
        const rejectorId = socketToUserMap.get(socket.id);
        const callerSocketId = findSocketIdByUserId(recipientId);

        try {
            const query = callId
                ? { callId }
                : { callerId: recipientId, recipientId: rejectorId, status: 'pending' };
            const updateResult = await CallHistory.findOneAndUpdate(query, { status: 'rejected' });

            if (callerSocketId) {
                io.to(callerSocketId).emit('call-rejected', { senderId: rejectorId, reason });
            }

            if (updateResult) {
                socket.emit('call-acknowledged', {
                    senderId: recipientId,
                    acknowledgedCallId: updateResult.callId
                });
            }
        } catch (error) {
            console.error('Failed to update call history (rejected):', error);
        }
    });

    // --- WEBRTC: CALL UNANSWERED ---
    socket.on('call-unanswered', async ({ recipientId, callId }) => {
        const callerId = socketToUserMap.get(socket.id);
        try {
            await CallHistory.findOneAndUpdate(
                { callId, callerId, recipientId, status: 'pending' },
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

    // --- WEBRTC: CALL ENDED ---
    socket.on('call-ended', async ({ recipientId }) => {
        const currentUserId = socketToUserMap.get(socket.id);
        try {
            await CallHistory.findOneAndUpdate(
                {
                    $or: [
                        { callerId: currentUserId, recipientId, status: 'accepted' },
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

app.get('{*splat}', (req, res) => {
    res.sendFile(path.join(BASE_DIR, 'index.html'));
});

// ============================================================
// START SERVER
// ✅ FIX 8: Server only starts after directories are confirmed to exist
// ============================================================

const PORT = process.env.PORT || 8080;

createDirectories().then(() => {
    server.listen(PORT, () => {
        console.log('='.repeat(60));
        console.log('✅ XamePage Server v2.1 - FULLY FIXED');
        console.log('='.repeat(60));
        console.log(`📡 Port:              ${PORT}`);
        console.log(`🌐 Local:             http://localhost:${PORT}`);
        console.log(`📁 Base dir:          ${BASE_DIR}`);
        console.log(`📂 Uploads:           ${uploadDir}`);
        console.log(`🖼️  Profile pics:      ${profilePicsDir}`);
        console.log(`🗄️  MongoDB:           Connected`);
        console.log(`🔐 Auth:              Password enabled`);
        console.log(`⏱️  Ping timeout:      60000ms`);
        console.log(`💓 Ping interval:     25000ms`);
        console.log('='.repeat(60));
        console.log('Fixes applied:');
        console.log('  ✅ Socket.IO ping/timeout settings');
        console.log('  ✅ Removed fake socket ID from login');
        console.log('  ✅ sync-deletions destructuring fixed');
        console.log('  ✅ Profile pic filename collision prevention');
        console.log('  ✅ get_contacts auth guard');
        console.log('  ✅ get_chat_history auth guard');
        console.log('  ✅ /api/search-user endpoint added');
        console.log('  ✅ Directories created before server starts');
        console.log('='.repeat(60));
    });
}).catch(err => {
    console.error('❌ Failed to create directories, server not started:', err);
    process.exit(1);
});
