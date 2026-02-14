//
// XamePage v2.1 Server File - CLOUDINARY PROFILE PIC FIX
//
// Production-grade server with full MongoDB persistence and WebRTC support.
// Compatible with both cloud deployment (Render) and local development (Termux).
//
// ✅ CLOUDINARY FIX APPLIED:
// - Profile pictures now stored on Cloudinary (persistent cloud storage)
// - Local disk no longer used for profile pictures
// - multer switched to memoryStorage for profile pic uploads
// - Uploaded files go to req.file.buffer → Cloudinary → permanent URL in MongoDB
// - All other uploads (voice notes, files) still use local disk as before
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
const cloudinary = require('cloudinary').v2;
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
    path: '/socket.io/',
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 30000,
    maxHttpBufferSize: 1e8
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());

// ============================================================
// CLOUDINARY CONFIGURATION
// ============================================================

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Verify Cloudinary config on boot
if (!process.env.CLOUDINARY_CLOUD_NAME || 
    !process.env.CLOUDINARY_API_KEY || 
    !process.env.CLOUDINARY_API_SECRET) {
    console.warn('⚠️  Cloudinary env vars missing — profile pic uploads will fail');
    console.warn('    Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
} else {
    console.log('✅ Cloudinary configured for cloud:', process.env.CLOUDINARY_CLOUD_NAME);
}

// ============================================================
// WEB PUSH CONFIGURATION
// ============================================================

const webpush = require('web-push');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_EMAIL,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    console.log('✅ Web Push configured');
} else {
    console.warn('⚠️ VAPID keys missing — push notifications disabled');
}

// ============================================================
// CLOUDINARY UPLOAD HELPER
// ============================================================

/**
 * Upload a buffer to Cloudinary.
 * Returns the permanent secure_url string.
 * Automatically:
 *   - Crops to 256x256 face-aware square
 *   - Stores in xamepage/profile_pics folder
 *   - Overwrites previous pic for same userId (no orphaned files)
 */
function uploadToCloudinary(buffer, userId) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: 'xamepage/profile_pics',
                public_id: `user_${userId}`,   // ← same ID = overwrites old pic
                overwrite: true,
                transformation: [
                    {
                        width: 256,
                        height: 256,
                        crop: 'fill',
                        gravity: 'face'   // ← smart face-centering
                    }
                ],
                format: 'jpg'
            },
            (error, result) => {
                if (error) {
                    console.error('❌ Cloudinary upload error:', error);
                    reject(error);
                } else {
                    console.log('✅ Cloudinary upload success:', result.secure_url);
                    resolve(result.secure_url);  // ← permanent HTTPS URL
                }
            }
        );

        uploadStream.end(buffer);
    });
}

/**
 * Delete a user's profile pic from Cloudinary.
 * Called when user removes their profile picture.
 */
async function deleteFromCloudinary(userId) {
    try {
        const publicId = `xamepage/profile_pics/user_${userId}`;
        const result = await cloudinary.uploader.destroy(publicId);
        console.log(`✅ Cloudinary delete result for ${userId}:`, result);
        return result;
    } catch (error) {
        console.error('❌ Cloudinary delete error:', error);
        // Non-fatal — continue even if delete fails
    }
}

// ============================================================
// CROSS-PLATFORM PATH CONFIGURATION
// ============================================================

const BASE_DIR = process.cwd();
const uploadDir = path.join(BASE_DIR, 'uploads');
// profilePicsDir no longer needed for profile pics (Cloudinary handles it)
// but kept for any future local use
const profilePicsDir = path.join(BASE_DIR, 'media', 'profile_pics');

console.log(`📁 Base directory: ${BASE_DIR}`);
console.log(`📂 Upload directory: ${uploadDir}`);

// ============================================================
// MONGODB CONFIGURATION
// ============================================================

const MONGODB_URI = process.env.MONGODB_CLOUD_URI;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_CLOUD_URI not found in environment variables');
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
    xameId:           { type: String, required: true, unique: true },
    firstName:        { type: String, required: true },
    lastName:         { type: String, required: true },
    preferredName:    { type: String, default: '' },
    dob:              { type: String, required: true },
    password:         { type: String },
    profilePic:       { type: String, default: '' }, // Now stores Cloudinary HTTPS URL
    hidePreferredName:  { type: Boolean, default: false },
    hideProfilePicture: { type: Boolean, default: false },
    contacts:         [contactSchema],
    createdAt:        { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
    messageId:   { type: String, required: true, unique: true },
    senderId:    { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    ts:          { type: Number, required: true },
    text:        { type: String },
    file: {
        url:  { type: String },
        name: { type: String },
        type: { type: String }
    },
    status: { 
        type: String, 
        enum: ['sent', 'delivered', 'seen'], 
        default: 'sent' 
    }
});

const pushSubscriptionSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    subscription: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now }
});

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);

const callHistorySchema = new mongoose.Schema({
    callId:      { type: String, required: true, unique: true },
    callerId:    { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    callType:    { type: String, required: true, enum: ['voice', 'video'] },
    startTime:   { type: Date, default: Date.now },
    endTime:     { type: Date },
    status: {
        type: String,
        required: true,
        enum: ['pending', 'accepted', 'rejected', 'ended', 'missed']
    }
}, { timestamps: true });

const User        = mongoose.model('User', userSchema);
const Message     = mongoose.model('Message', messageSchema);
const CallHistory = mongoose.model('CallHistory', callHistorySchema);

const pushSubscriptionSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    subscription: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now }
});


// ============================================================
// FILE UPLOAD CONFIGURATION
// ============================================================

// ✅ CHANGED: Profile pics use memoryStorage (buffer → Cloudinary)
//            Regular file uploads still use disk storage
const diskUpload   = multer({ dest: uploadDir });
const memoryUpload = multer({ storage: multer.memoryStorage() });

async function createDirectories() {
    try {
        if (!fs.existsSync(uploadDir)) {
            await fsPromises.mkdir(uploadDir, { recursive: true });
            console.log('✅ Created uploads directory');
        }
        if (!fs.existsSync(profilePicsDir)) {
            await fsPromises.mkdir(profilePicsDir, { recursive: true });
            console.log('✅ Created profile pics directory (local fallback)');
        }
    } catch (error) {
        console.error('❌ Error creating directories:', error);
        process.exit(1);
    }
}

// Serve static files
app.use(express.static(BASE_DIR));
app.use('/uploads', express.static(uploadDir));
app.use('/media/icons', express.static(path.join(BASE_DIR, 'media', 'icons')));
// /media/profile_pics no longer needed for new uploads
// kept for backwards compatibility with any old local URLs still in DB
app.use('/media/profile_pics', express.static(profilePicsDir));

// ============================================================
// ONLINE USER STATE MANAGEMENT
// ============================================================

const onlineUsers          = new Set();
const userToSocketMap      = new Map();
const socketToUserMap      = new Map();
const onlineUserTimestamps = new Map();
const disconnectTimeouts   = new Map();

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
        xameId:        user.xameId,
        preferredName: user.hidePreferredName  ? '' : user.preferredName,
        profilePic:    user.hideProfilePicture ? '' : user.profilePic
    };
}

function getContactDisplayName(contactXameId, partnerUser, savedContact) {
    if (savedContact?.customName)   return savedContact.customName;
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

    let lastTs      = 0;
    let previewText = 'Start a new chat.';

    if (lastMessage) {
        lastTs      = lastMessage.ts;
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

    const chatPartners      = await Message.distinct('senderId',    { recipientId: userId });
    const messageRecipients = await Message.distinct('recipientId', { senderId: userId });
    const callPartners      = await CallHistory.distinct('callerId',    { recipientId: userId });
    const callRecipients    = await CallHistory.distinct('recipientId', { callerId: userId });

    const allPartnerIds = new Set([
        ...chatPartners,
        ...messageRecipients,
        ...callPartners,
        ...callRecipients,
        ...user.contacts.map(c => c.contactId?.xameId).filter(Boolean)
    ]);
    allPartnerIds.delete(userId);

    const contactXameIds = Array.from(allPartnerIds);
    const partnerUsers   = await User.find({ xameId: { $in: contactXameIds } });
    const contactsMap    = new Map();
    partnerUsers.forEach(p => contactsMap.set(p.xameId, p));

    const interactionPromises = contactXameIds.map(async (xameId) => {
        const partnerUser  = contactsMap.get(xameId);
        const savedContact = user.contacts.find(c => c.contactId?.xameId === xameId);

        const [unreadMessagesCount, missedCallsCount, interactionDetails] = await Promise.all([
            Message.countDocuments({
                senderId:    xameId,
                recipientId: userId,
                status:      { $in: ['sent', 'delivered'] }
            }),
            CallHistory.countDocuments({
                callerId:    xameId,
                recipientId: userId,
                status:      { $in: ['pending', 'missed'] }
            }),
            getLastInteractionDetails(userId, xameId)
        ]);

        const filteredPartner = partnerUser
            ? getPrivacyFilteredContactData(partnerUser)
            : null;
        const displayName = getContactDisplayName(xameId, filteredPartner, savedContact);

        return {
            xameId,
            name:                   displayName,
            profilePic:             filteredPartner ? filteredPartner.profilePic : '',
            isOnline:               onlineUsers.has(xameId),
            unreadMessagesCount,
            missedCallsCount,
            isSaved:                !!savedContact,
            lastInteractionTs:      interactionDetails.lastInteractionTs,
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
            const xameId         = await generateUniqueXameId();
            const newUser        = new User({ 
                xameId, firstName, lastName, dob, 
                password: hashedPassword 
            });
            await newUser.save();

            console.log(`✅ User registered: ${newUser.xameId}`);

            const userResponse = newUser.toObject();
            delete userResponse.password;

            res.json({ success: true, user: userResponse });
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Server error during registration.' 
            });
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
                user:    userResponse
            });
        } catch (error) {
            console.error('Set password error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Server error during password setup.' 
            });
        }
    }
);

// --- LOGIN ---
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

        if (!user.password) {
            return res.status(403).json({
                success: false,
                message: 'Your account needs a password. Please set one to continue.',
                requiresPasswordSetup: true,
                user: {
                    xameId:    user.xameId,
                    firstName: user.firstName,
                    lastName:  user.lastName
                }
            });
        }

        if (!password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Password is required.' 
            });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, message: 'Invalid password.' });
        }

        console.log(`✅ User logged in: ${user.xameId}`);

        const userWithPrivacy = {
            ...user.toObject(),
            privacySettings: {
                hidePreferredName:  user.hidePreferredName,
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

// --- SAVE PUSH SUBSCRIPTION ---
app.post('/api/save-push-subscription', async (req, res) => {
    const { userId, subscription } = req.body;

    if (!userId || !subscription) {
        return res.status(400).json({ success: false, message: 'Missing data.' });
    }

    try {
        await PushSubscription.findOneAndUpdate(
            { userId },
            { userId, subscription },
            { upsert: true, new: true }
        );
        console.log(`✅ Push subscription saved for: ${userId}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Push subscription save error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// --- GET USER NAME ---
app.post('/api/get-user-name', async (req, res) => {
    const { xameId } = req.body;

    try {
        const user = await User.findOne({ xameId });
        if (user) {
            res.json({
                success: true,
                user: { 
                    firstName: user.firstName, 
                    lastName:  user.lastName, 
                    xameId:    user.xameId 
                }
            });
        } else {
            res.status(404).json({ success: false, message: 'User not found.' });
        }
    } catch (error) {
        console.error('Get user name error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// --- SEARCH USER ---
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
                xameId:       filtered.xameId,
                firstName:    filtered.firstName,
                lastName:     filtered.lastName,
                preferredName: filtered.preferredName,
                profilePic:   filtered.profilePic,
                isOnline:     onlineUsers.has(user.xameId)
            }
        });
    } catch (error) {
        console.error('Search user error:', error);
        res.status(500).json({ success: false, message: 'Server error during search.' });
    }
});

// --- UPLOAD FILE (voice notes, documents, media) ---
// Still uses disk storage — these are ephemeral chat files, not persistent data
app.post('/api/upload-file', diskUpload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    try {
        const fileExt    = path.extname(req.file.originalname);
        const newFilename = `${uuidv4()}${fileExt}`;
        const newPath    = path.join(uploadDir, newFilename);

        await fsPromises.rename(req.file.path, newPath);

        res.json({ success: true, url: `/uploads/${newFilename}` });
    } catch (error) {
        console.error('File processing failed:', error);
        res.status(500).json({ success: false, message: 'File processing failed.' });
    }
});

// --- UPDATE PROFILE ---
// ✅ CHANGED: Uses memoryUpload + Cloudinary instead of diskUpload + local filesystem
app.post('/api/update-profile', 
    memoryUpload.single('profilePic'),   // ← buffer in memory, not disk
    async (req, res) => {
        const { 
            userId, 
            preferredName, 
            removeProfilePic, 
            hidePreferredName, 
            hideProfilePicture 
        } = req.body;

        try {
            const user = await User.findOne({ xameId: userId });
            if (!user) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'User not found.' 
                });
            }

            // Update text fields
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
                // ✅ Delete from Cloudinary, clear URL in MongoDB
                await deleteFromCloudinary(userId);
                user.profilePic = '';
                console.log(`✅ Profile picture removed for user: ${userId}`);

            } else if (req.file && req.file.buffer) {
                // ✅ Upload buffer directly to Cloudinary
                console.log(`📤 Uploading profile pic to Cloudinary for user: ${userId}`);
                
                const cloudinaryUrl = await uploadToCloudinary(
                    req.file.buffer, 
                    userId
                );
                
                // Store the permanent Cloudinary URL in MongoDB
                user.profilePic = cloudinaryUrl;
                console.log(`✅ Profile picture saved to Cloudinary: ${cloudinaryUrl}`);
            }

            await user.save();

            res.json({
                success:            true,
                preferredName:      user.preferredName,
                profilePicUrl:      user.profilePic,      // ← permanent Cloudinary URL
                hidePreferredName:  user.hidePreferredName,
                hideProfilePicture: user.hideProfilePicture
            });

        } catch (error) {
            console.error('Profile update error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Server error during profile update: ' + error.message 
            });
        }
    }
);

// --- ADD CONTACT ---
app.post('/api/add-contact', async (req, res) => {
    const { userId, contactId, customName } = req.body;

    try {
        const user    = await User.findOne({ xameId: userId });
        const contact = await User.findOne({ xameId: contactId });

        if (!user || !contact) {
            return res.status(404).json({ 
                success: false, 
                message: 'User or contact not found.' 
            });
        }

        const contactExists = user.contacts.some(
            c => c.contactId && c.contactId.toString() === contact._id.toString()
        );
        if (contactExists) {
            return res.status(409).json({ 
                success: false, 
                message: 'Contact already exists.' 
            });
        }

        user.contacts.push({ contactId: contact._id, customName });
        await user.save();

        const filteredContact = getPrivacyFilteredContactData(contact);
        const displayName     = getContactDisplayName(
            contact.xameId, filteredContact, { customName }
        );

        res.json({
            success:  true,
            message:  'Contact added successfully.',
            contact: {
                xameId:    contact.xameId,
                name:      displayName,
                profilePic: filteredContact.profilePic,
                isOnline:  onlineUsers.has(contact.xameId)
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
                errors:  validationErrors.array()
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
                    c => c.contactId && 
                         c.contactId.toString() === contactUser._id.toString()
                );

                if (!contactExists) {
                    user.contacts.push({ 
                        contactId: contactUser._id, 
                        customName: newName 
                    });
                }

                await user.save();
            }

            res.json({
                success:     true,
                message:     'Contact name updated successfully.',
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
                errors:  validationErrors.array()
            });
        }

        const { userId, contactId } = req.body;

        if (userId === contactId) {
            return res.status(403).json({ 
                success: false, 
                message: 'Cannot delete the self chat.' 
            });
        }

        try {
            const contactToDelete = await User.findOne({ xameId: contactId }).select('_id');

            await Promise.all([
                Message.deleteMany({
                    $or: [
                        { senderId: userId,    recipientId: contactId },
                        { senderId: contactId, recipientId: userId }
                    ]
                }),
                CallHistory.deleteMany({
                    $or: [
                        { callerId: userId,    recipientId: contactId },
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
}

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    console.log(`✅ User ${userId} connected. Sockets: ${io.engine.clientsCount}`);

    socket.userId = userId;

    if (userId) {
        if (disconnectTimeouts.has(userId)) {
            clearTimeout(disconnectTimeouts.get(userId));
            disconnectTimeouts.delete(userId);
        }

        socketToUserMap.set(socket.id, userId);
        userToSocketMap.set(userId, socket.id);
        onlineUsers.add(userId);
        onlineUserTimestamps.set(userId, Date.now());

        broadcastOnlineUsers();
    }

    socket.on('user-online', ({ userId: announcedUserId, timestamp }) => {
        const uid = announcedUserId || socket.userId;
        if (!uid) return;

        if (disconnectTimeouts.has(uid)) {
            clearTimeout(disconnectTimeouts.get(uid));
            disconnectTimeouts.delete(uid);
        }

        onlineUsers.add(uid);
        onlineUserTimestamps.set(uid, timestamp || Date.now());
        if (uid !== socket.userId) socket.userId = uid;
        broadcastOnlineUsers();
    });

    socket.on('heartbeat', ({ userId: heartbeatUserId, timestamp }) => {
        const uid = heartbeatUserId || socket.userId;
        if (!uid) return;

        onlineUserTimestamps.set(uid, timestamp || Date.now());

        if (!onlineUsers.has(uid)) {
            onlineUsers.add(uid);
            broadcastOnlineUsers();
        }

        if (disconnectTimeouts.has(uid)) {
            clearTimeout(disconnectTimeouts.get(uid));
            disconnectTimeouts.delete(uid);
        }
    });

    socket.on('user-offline', ({ userId: offlineUserId }) => {
        const uid = offlineUserId || socket.userId;
        if (!uid) return;

        if (disconnectTimeouts.has(uid)) {
            clearTimeout(disconnectTimeouts.get(uid));
            disconnectTimeouts.delete(uid);
        }

        onlineUsers.delete(uid);
        onlineUserTimestamps.delete(uid);
        broadcastOnlineUsers();
    });

    socket.on('request_online_users', () => {
        socket.emit('online_users', Array.from(onlineUsers));
    });

    socket.on('disconnect', (reason) => {
        const disconnectedUserId = socket.userId || socketToUserMap.get(socket.id);
        socketToUserMap.delete(socket.id);

        if (disconnectedUserId) {
            const hasOtherSockets = Array.from(socketToUserMap.values())
                .includes(disconnectedUserId);

            if (!hasOtherSockets) {
                const timeoutId = setTimeout(() => {
                    const stillNoSockets = !Array.from(socketToUserMap.values())
                        .includes(disconnectedUserId);
                    if (stillNoSockets && onlineUsers.has(disconnectedUserId)) {
                        onlineUsers.delete(disconnectedUserId);
                        onlineUserTimestamps.delete(disconnectedUserId);
                        userToSocketMap.delete(disconnectedUserId);
                        broadcastOnlineUsers();
                    }
                    disconnectTimeouts.delete(disconnectedUserId);
                }, 60000);

                disconnectTimeouts.set(disconnectedUserId, timeoutId);
            }
        }
    });

    socket.on('get_chat_history', async ({ userId: requestedUserId }) => {
        const authenticatedUserId = socketToUserMap.get(socket.id);
        if (authenticatedUserId !== requestedUserId) {
            return socket.emit('chat_history', {});
        }

        try {
            const messages = await Message.find({
                $or: [
                    { senderId:    requestedUserId },
                    { recipientId: requestedUserId }
                ]
            }).sort('ts');

            const chatHistory = {};

            messages.forEach(msg => {
                const contactId = msg.senderId === requestedUserId
                    ? msg.recipientId
                    : msg.senderId;

                if (!chatHistory[contactId]) chatHistory[contactId] = [];

                chatHistory[contactId].push({
                    id:     msg.messageId,
                    text:   msg.text,
                    file:   msg.file,
                    type:   msg.senderId === requestedUserId ? 'sent' : 'received',
                    ts:     msg.ts,
                    status: msg.status
                });
            });

            socket.emit('chat_history', chatHistory);
        } catch (error) {
            console.error('Failed to get chat history:', error);
            socket.emit('chat_history', {});
        }
    });

    socket.on('get_contacts', async (requestedUserId) => {
        const authenticatedUserId = socketToUserMap.get(socket.id);
        if (authenticatedUserId !== requestedUserId) {
            return socket.emit('contacts_list', []);
        }

        try {
            const formattedContacts = await getFullContactData(requestedUserId);
            socket.emit('contacts_list', formattedContacts);
        } catch (error) {
            console.error('Failed to get contacts list:', error);
            socket.emit('contacts_list', []);
        }
    });

    socket.on('send-message', async (data, callback) => {
        const { recipientId, message } = data;
        const senderId         = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);

        try {
            const newMessage = new Message({
                messageId:   message.id,
                senderId,
                recipientId,
                ts:          message.ts,
                ...(message.text && { text: message.text }),
                ...(message.file && { file: message.file })
            });
            await newMessage.save();

            if (recipientSocketId) {
                io.to(recipientSocketId).emit('receive-message', { senderId, message });
                await Message.findOneAndUpdate(
                    { messageId: message.id }, 
                    { status: 'delivered' }
                );
                io.to(socket.id).emit('message-status-update', {
                    recipientId,
                    messageId: message.id,
                    status:    'delivered'
                });
                io.to(recipientSocketId).emit('new_message_count', { senderId });
            }

            callback({ success: true, messageId: message.id });
        } catch (error) {
            console.error('Failed to save message:', error);
            callback({ success: false, message: 'Server failed to save message.' });
        }
    });

    socket.on('sync-deletions', async (deletionData, callback) => {
        const userId = socketToUserMap.get(socket.id);
        if (!userId) {
            return callback({ success: false, message: 'Authentication failed.' });
        }

        if (!deletionData?.chat) {
            return callback({ success: false, message: 'Invalid deletion payload.' });
        }

        const { contactId, messageIds, deleteForEveryone } = deletionData.chat;

        if (!messageIds || messageIds.length === 0) {
            return callback({ success: true, message: 'No messages provided.' });
        }

        try {
            if (deleteForEveryone) {
                const deleteResult = await Message.deleteMany({
                    messageId: { $in: messageIds },
                    senderId:  userId
                });

                if (deleteResult.deletedCount > 0) {
                    const recipientSocketId = findSocketIdByUserId(contactId);
                    if (recipientSocketId) {
                        io.to(recipientSocketId).emit('messages-deleted', {
                            deleterId:  userId,
                            contactId:  userId,
                            messageIds,
                            permanently: true
                        });
                    }
                }
            }

            callback({ success: true });
        } catch (error) {
            console.error('Deletion error:', error);
            callback({ success: false, message: 'Internal server error during deletion.' });
        }
    });

    socket.on('message-seen', async ({ recipientId, messageIds }) => {
        const senderId          = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);

        try {
            await Message.updateMany(
                { 
                    messageId:   { $in: messageIds }, 
                    recipientId: senderId, 
                    senderId:    recipientId 
                },
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

    socket.on('typing', ({ recipientId }) => {
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('typing', { 
                senderId: socketToUserMap.get(socket.id) 
            });
        }
    });

    socket.on('stop-typing', ({ recipientId }) => {
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('stop-typing', { 
                senderId: socketToUserMap.get(socket.id) 
            });
        }
    });

    socket.on('call-user', async ({ recipientId, offer, callType }) => {
        const callerId          = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);

        if (recipientSocketId) {
            try {
                const [caller, recipientUser] = await Promise.all([
                    User.findOne({ xameId: callerId }),
                    User.findOne({ xameId: recipientId }).populate('contacts.contactId')
                ]);

                if (!caller || !recipientUser) {
                    return socket.emit('call-error', { 
                        message: 'Caller or recipient not found.' 
                    });
                }

                const callId = uuidv4();
                await new CallHistory({
                    callId, callerId, recipientId, callType, status: 'pending'
                }).save();

                const filteredCaller = getPrivacyFilteredContactData(caller.toObject());
                const savedContact   = recipientUser.contacts.find(
                    c => c.contactId && c.contactId.xameId === callerId
                );
                const incomingCallName = getContactDisplayName(
                    callerId, filteredCaller, savedContact
                );
         io.to(recipientSocketId).emit('call-user', {
                    offer,
                    callerId,
                    caller: {
                        xameId:        filteredCaller.xameId,
                        preferredName: filteredCaller.preferredName,
                        profilePic:    filteredCaller.profilePic,
                        displayName:   incomingCallName
                    },
                    callType,
                    callId
                });

                // Send push notification for incoming call
                try {
                    const pushSub = await PushSubscription.findOne({ userId: recipientId });
                    if (pushSub) {
                        await webpush.sendNotification(
                            pushSub.subscription,
                            JSON.stringify({
                                type: 'incoming-call',
                                callerId,
                                callerName: incomingCallName,
                                callType,
                                callId
                            })
                        );
                        console.log(`✅ Push notification sent to: ${recipientId}`);
                    }
                } catch (pushError) {
                    console.error('Push notification error:', pushError);
                }

            } catch (error) {
                console.error('Call user error:', error);
                socket.emit('call-error', { message: 'Failed to initiate call.' });
            }
        } else {
            try {
                await new CallHistory({
                    callId: uuidv4(), callerId, recipientId, callType, status: 'missed'
                }).save();
                socket.emit('call-rejected', { 
                    senderId: recipientId, reason: 'offline' 
                });
            } catch (error) {
                console.error('Failed to record missed call:', error);
            }
        }
    });

    socket.on('make-answer', ({ recipientId, answer }) => {
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('make-answer', {
                answer,
                senderId: socketToUserMap.get(socket.id)
            });
        }
    });

    socket.on('ice-candidate', ({ recipientId, candidate }) => {
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('ice-candidate', {
                candidate,
                senderId: socketToUserMap.get(socket.id)
            });
        }
    });

    socket.on('stream-ready', ({ recipientId, streamType }) => {
        const senderId          = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('stream-ready', { senderId, streamType });
        }
    });

    socket.on('call-accepted', async ({ recipientId, callId }) => {
        const acceptorId        = socketToUserMap.get(socket.id);
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

    socket.on('call-rejected', async ({ recipientId, reason, callId }) => {
        const rejectorId      = socketToUserMap.get(socket.id);
        const callerSocketId  = findSocketIdByUserId(recipientId);

        try {
            const query = callId
                ? { callId }
                : { callerId: recipientId, recipientId: rejectorId, status: 'pending' };
            const updateResult = await CallHistory.findOneAndUpdate(
                query, { status: 'rejected' }
            );

            if (callerSocketId) {
                io.to(callerSocketId).emit('call-rejected', { 
                    senderId: rejectorId, reason 
                });
            }

            if (updateResult) {
                socket.emit('call-acknowledged', {
                    senderId:           recipientId,
                    acknowledgedCallId: updateResult.callId
                });
            }
        } catch (error) {
            console.error('Failed to update call history (rejected):', error);
        }
    });

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

app.get('*', (req, res) => {
    res.sendFile(path.join(BASE_DIR, 'index.html'));
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 8080;

createDirectories().then(() => {
    server.listen(PORT, () => {
        console.log('='.repeat(60));
        console.log('✅ XamePage Server v2.1 - CLOUDINARY EDITION');
        console.log('='.repeat(60));
        console.log(`📡 Port:              ${PORT}`);
        console.log(`🌐 Local:             http://localhost:${PORT}`);
        console.log(`📁 Base dir:          ${BASE_DIR}`);
        console.log(`📂 Uploads:           ${uploadDir}`);
        console.log(`☁️  Profile pics:      Cloudinary (persistent)`);
        console.log(`🗄️  MongoDB:           Connected`);
        console.log(`🔐 Auth:              Password enabled`);
        console.log('='.repeat(60));
        console.log('Key changes from previous version:');
        console.log('  ✅ Profile pics → Cloudinary (never disappear)');
        console.log('  ✅ memoryStorage for profile pic uploads');
        console.log('  ✅ Cloudinary auto-crops to 256x256 face-aware');
        console.log('  ✅ Same public_id per user = no orphaned files');
        console.log('  ✅ Local disk still used for chat file uploads');
        console.log('='.repeat(60));
    });
}).catch(err => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
});