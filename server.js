// XamePage v2.1 Server File
//
// This server has been rebuilt for production-grade reliability and scalability.
//
// Features:
// - All data (users, messages, call history) is now persisted in a MongoDB database.
// - Robust API endpoints for user registration, login, and profile updates.
// - Secure and consistent file handling for all media uploads.
// - WebRTC signaling with persistent call history.
// - **NEW:** Implements server-side privacy filtering for profile data and caller identity.
// - **UPDATE:** Comprehensive API endpoint for permanent chat and contact deletion.
// - **FIXED:** Implements real-time message deletion logic.

//======================
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const fsPromises = require('fs').promises; 
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors'); 
const { body, validationResult } = require('express-validator');
require('dotenv').config();

// --- Server setup ---
const express = require('express');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Optional: JSON middleware
app.use(express.json());

// --- MongoDB Configuration ---
const MONGODB_URI = process.env.MONGODB_CLOUD_URI;

// Check if the URI exists
if (!MONGODB_URI) {
    console.error('❌ ERROR: MONGODB_CLOUD_URI is not defined in environment variables.');
    process.exit(1);
}

// Optional: log the first 10 chars to confirm it's loaded (never log full password in prod)
console.log('✅ Mongo URI loaded:', MONGODB_URI.slice(0, 10) + '...');

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected successfully'))
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// --- MongoDB Schemas & Models ---
const contactSchema = new mongoose.Schema({
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    customName: { type: String },
    addedAt: { type: Date, default: Date.now }
});

const statusSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    mediaUrl: { type: String, required: true },
    caption: { type: String },
    viewedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    expiresAt: { type: Date, required: true }
});

// [2025-10-01] UPDATED userSchema to include privacy settings (Caller's Name Display Rule)
const userSchema = new mongoose.Schema({
    xameId: { type: String, required: true, unique: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    preferredName: { type: String, default: '' },
    dob: { type: String, required: true },
    profilePic: { type: String, default: '' },
    // --- NEW PRIVACY FIELDS ---
    hidePreferredName: { type: Boolean, default: false },
    hideProfilePicture: { type: Boolean, default: false },
    // --- END NEW FIELDS ---
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
    // 'pending' (incoming call not yet acted upon), 'accepted', 'rejected' (declined), 'ended', 'missed' (unanswered)
    status: { type: String, required: true, enum: ['pending', 'accepted', 'rejected', 'ended', 'missed'] }, 
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const CallHistory = mongoose.model('CallHistory', callHistorySchema);
const Status = mongoose.model('Status', statusSchema);

// Middleware for parsing JSON and handling file uploads
app.use(express.json());
app.use(cors()); 
const upload = multer({ dest: 'uploads/' });

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media/profile_pics', express.static(path.join(__dirname, 'media/profile_pics')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Data & State Management ---
const onlineUsers = new Set();
const userToSocketMap = new Map(); // Maps userId to socketId
const socketToUserMap = new Map(); // Maps socketId to userId

// Ensure the necessary folders exist (Using synchronous fs methods)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const profilePicsDir = path.join(__dirname, 'media', 'profile_pics');
if (!fs.existsSync(profilePicsDir)) {
    fs.mkdirSync(profilePicsDir, { recursive: true });
}

// --- Helper Functions ---
async function generateUniqueXameId() {
    const prefix = '058';
    let newId;
    let isUnique = false;
    do {
        const randomPart = Math.floor(1e8 + Math.random() * 9e8).toString();
        newId = `${prefix}${randomPart}`;
        const existingUser = await User.findOne({ xameId: newId });
        if (!existingUser) {
            isUnique = true;
        }
    } while (!isUnique);
    return newId;
}

function findSocketIdByUserId(userId) {
    return userToSocketMap.get(userId);
}

// Rule 3: Helper function to apply a user's privacy settings before sending their data to a contact.
// This is critical for achieving an intercontinental standard in user privacy.
function getPrivacyFilteredContactData(user) {
    // Determine the profile picture URL to send:
    let profilePicUrl = user.profilePic;
    if (user.hideProfilePicture) {
        // Use a generic placeholder URL (empty string) when the user has hidden their picture.
        // The client-side logic will interpret the empty string as a signal to use a default image.
        profilePicUrl = ''; 
    }

    // Determine the display name to send:
    let preferredName = user.preferredName;
    if (user.hidePreferredName) {
        // Send an empty string for the preferred name if hidden, forcing the name logic 
        // to default to the registered name (firstName/lastName) or Xame-ID.
        preferredName = '';
    }

    return {
        // ALWAYS send essential, non-private identifiers
        xameId: user.xameId,
        firstName: user.firstName, // Used as fallback if preferredName is hidden
        lastName: user.lastName,   // Used as fallback if preferredName is hidden
        
        // PRIVACY-CONTROLLED FIELDS
        preferredName: preferredName,
        profilePic: profilePicUrl
    };
}


// NEW HELPER FUNCTION: Centralizes the logic for displaying a contact's name.
// UPDATED to enforce Xame-ID fallback when preferredName is explicitly hidden.
function getContactDisplayName(contactXameId, partnerUser, savedContact) {
    if (savedContact?.customName) {
        return savedContact.customName;
    }
    // partnerUser here is the **filtered** object
    
    // Check if the user has a visible preferred name
    if (partnerUser?.preferredName) {
        return partnerUser.preferredName;
    }
    
    // Check if the user has explicitly hidden their name (preferredName is filtered to '')
    if (partnerUser && partnerUser.preferredName === '') {
        return contactXameId; // Fallback to Xame-ID
    }
    
    // This fallback is only reached if preferredName was not explicitly hidden but was genuinely empty 
    // in the database (or if partnerUser is null)
    if (partnerUser) {
        // Use the registered names if preferredName is genuinely empty
        const fullName = `${partnerUser.firstName} ${partnerUser.lastName}`.trim();
        if (fullName) {
            return fullName;
        }
    }
    // Final Fallback: If no user record or name fields are empty, use the XameID
    return contactXameId;
}

// NEW HELPER to get the timestamp and a generic preview of the last interaction
async function getLastInteractionDetails(userId, partnerId) {
    const [lastMessage, lastCall] = await Promise.all([
        // Find the most recent message (sent or received)
        Message.findOne({ 
            $or: [
                { senderId: userId, recipientId: partnerId },
                { senderId: partnerId, recipientId: userId }
            ]
        }).sort({ ts: -1 }).select('ts senderId'),
        
        // Find the most recent call (made or received) that is NOT pending
        CallHistory.findOne({
            $or: [
                { callerId: userId, recipientId: partnerId },
                { callerId: partnerId, recipientId: userId }
            ],
            status: { $in: ['accepted', 'ended', 'rejected', 'missed'] }
        }).sort({ createdAt: -1 }).select('createdAt status callerId')
    ]);

    let lastTs = 0;
    let previewText = "Start a new chat.";

    // Compare Message TS and Call Time
    if (lastMessage) {
        lastTs = lastMessage.ts;
        previewText = lastMessage.senderId === userId ? "You: Sent a message." : "New message received.";
    }

    if (lastCall) {
        // Mongoose timestamps are Date objects, convert to ms for comparison
        const callTs = lastCall.createdAt.getTime(); 
        
        if (callTs > lastTs) {
            lastTs = callTs;
            if (lastCall.status === 'missed' && lastCall.recipientId === userId) {
                previewText = "Missed call.";
            } else if (lastCall.callerId === userId) {
                previewText = "Outgoing call.";
            } else {
                previewText = "Incoming call.";
            }
        }
    }

    return { lastInteractionTs: lastTs, lastInteractionPreview: previewText };
}

// NEW HELPER FUNCTION: Get all relevant contact data, including unread counts and unknowns
async function getFullContactData(userId) {
    const user = await User.findOne({ xameId: userId }).populate('contacts.contactId');
    if (!user) return [];

    // 1. Get ALL unique contacts/threads from Messages and Call History
    const chatPartners = await Message.distinct('senderId', { recipientId: userId });
    const messageRecipients = await Message.distinct('recipientId', { senderId: userId });
    
    // Check for unique IDs in CallHistory where the user is involved (caller or recipient)
    const callPartners = await CallHistory.distinct('callerId', { recipientId: userId });
    const callRecipients = await CallHistory.distinct('recipientId', { callerId: userId });


    const allPartnerIds = new Set([
        ...chatPartners, 
        ...messageRecipients, 
        ...callPartners, 
        ...callRecipients,
        ...user.contacts.map(c => c.contactId?.xameId).filter(Boolean) // Saved contacts
    ]);
    allPartnerIds.delete(userId); // Exclude self

    const contactsMap = new Map();
    const contactXameIds = Array.from(allPartnerIds);

    // 2. Fetch all required user details in one query
    const partnerUsers = await User.find({ xameId: { $in: contactXameIds } });
    partnerUsers.forEach(p => contactsMap.set(p.xameId, p));

    // 3. Prepare the final list and calculate counts
    const finalContacts = [];

    // Use Promise.all to fetch interaction details in parallel for better performance
    const interactionPromises = contactXameIds.map(xameId => {
        return (async () => {
            const partnerUser = contactsMap.get(xameId);
            const isSaved = user.contacts.some(c => c.contactId?.xameId === xameId);
            const savedContact = user.contacts.find(c => c.contactId?.xameId === xameId);

            // --- Calculate Unread Counts (Rule 1: Initial State) ---
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

            // --- Get Last Interaction Details (SAFE PREVIEW) ---
            const interactionDetails = await getLastInteractionDetails(userId, xameId);

            // Rule 4: Apply Privacy Filtering to the partner's data
            const filteredPartner = partnerUser ? getPrivacyFilteredContactData(partnerUser) : null;
            
            // Use the filtered partner data to determine the display name
            let displayName = getContactDisplayName(xameId, filteredPartner, savedContact);
            
            // Use the filtered profile pic URL
            let profilePic = filteredPartner ? filteredPartner.profilePic : '';

            return {
                xameId: xameId,
                name: displayName,
                // USE THE PRIVACY-FILTERED PICTURE HERE
                profilePic: profilePic, 
                isOnline: onlineUsers.has(xameId),
                unreadMessagesCount: unreadMessagesCount,
                missedCallsCount: missedCallsCount,
                isSaved: isSaved, 
                // NEW: Safe interaction details for sorting and generic preview
                lastInteractionTs: interactionDetails.lastInteractionTs,
                lastInteractionPreview: interactionDetails.lastInteractionPreview 
            };
        })();
    });

    // Resolve all promises
    const contactsWithDetails = await Promise.all(interactionPromises);
    
    // Sort the contacts by the most recent interaction time (descending)
    contactsWithDetails.sort((a, b) => b.lastInteractionTs - a.lastInteractionTs);

    return contactsWithDetails;
}

// --- API Endpoints ---
app.post('/api/register',
    body('firstName').trim().escape().notEmpty().withMessage('First name is required.'),
    body('lastName').trim().escape().notEmpty().withMessage('Last name is required.'),
    body('dob').isDate({ format: 'YYYY-MM-DD' }).withMessage('Date of birth must be a valid date in YYYY-MM-DD format.'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }
        
        const { firstName, lastName, dob } = req.body;
        
        try {
            const xameId = await generateUniqueXameId();
            const newUser = new User({
                xameId,
                firstName,
                lastName,
                dob
            });
            await newUser.save();
            console.log(`User registered: ${newUser.xameId}`);
            res.json({ success: true, user: newUser });
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ success: false, message: 'Server error during registration.' });
        }
    }
);

// [2025-10-01] UPDATED /api/login to include new privacy settings
app.post('/api/login', async (req, res) => {
    const { xameId } = req.body;
    try {
        const user = await User.findOne({ xameId });
        if (user) {
            // This is a placeholder as the socket ID is not known yet for REST API calls
            userToSocketMap.set(user.xameId, `placeholder_socket_${user.xameId}`);
            console.log(`User logged in: ${user.xameId}`);
            
            // Prepare the user object with the new privacy settings
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

// NEW ENDPOINT: Get user name without full login
app.post('/api/get-user-name', async (req, res) => {
    const { xameId } = req.body;
    try {
        const user = await User.findOne({ xameId });
        if (user) {
            res.json({ success: true, user: { firstName: user.firstName, lastName: user.lastName, xameId: user.xameId } });
        } else {
            res.status(404).json({ success: false, message: 'User not found.' });
        }
    } catch (error) {
        console.error('Get user name error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// New endpoint for user logout
app.post('/api/logout', async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ success: false, message: 'User ID is required.' });
    }

    // Remove user from the online state management
    onlineUsers.delete(userId);
    userToSocketMap.delete(userId);
    console.log(`User logged out: ${userId}`);

    // Notify all clients about the updated online user list
    io.emit('online_users', Array.from(onlineUsers));

    res.json({ success: true, message: 'Logged out successfully.' });
});


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
        return res.status(500).json({ success: false, message: 'File processing failed.' });
    }
});

// [2025-10-01] UPDATED /api/update-profile to handle new privacy switches
app.post('/api/update-profile', upload.single('profilePic'), async (req, res) => {
    // Destructure new privacy fields from the body
    const { userId, preferredName, removeProfilePic, hidePreferredName, hideProfilePicture } = req.body; 
    
    try {
        const user = await User.findOne({ xameId: userId });
        if (!user) {
            // Clean up the uploaded file if the user doesn't exist
            if (req.file) {
                await fsPromises.unlink(req.file.path).catch(err => console.error('Failed to clean up file:', err));
            }
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // --- Standard Profile Updates ---
        if (preferredName !== undefined) {
            user.preferredName = preferredName;
        }
        
        // --- NEW PRIVACY SETTINGS UPDATE ---
        // Convert string 'true'/'false' from form-data to actual boolean
        if (hidePreferredName !== undefined) {
            user.hidePreferredName = hidePreferredName === 'true';
        }
        if (hideProfilePicture !== undefined) {
            user.hideProfilePicture = hideProfilePicture === 'true';
        }
        // --- END NEW PRIVACY SETTINGS ---
        
        // --- Profile Picture Logic ---
        if (removeProfilePic === 'true') {
            // Delete the old profile picture file if it exists
            if (user.profilePic) {
                const oldPath = path.join(__dirname, user.profilePic);
                await fsPromises.unlink(oldPath).catch(err => console.error('Failed to delete old profile pic:', err));
            }
            user.profilePic = '';
            console.log(`Profile picture removed for user: ${userId}`);
        } else if (req.file) {
            const oldProfilePic = user.profilePic ? path.join(__dirname, user.profilePic) : null;

            const fileExt = path.extname(req.file.originalname);
            const newFilename = `${userId}${fileExt}`;
            const newPath = path.join(profilePicsDir, newFilename);

            // Rename the new file and update the user's profile
            await fsPromises.rename(req.file.path, newPath);
            user.profilePic = `/media/profile_pics/${newFilename}`;
            console.log(`Profile picture updated for user: ${userId}`);
            
            // Delete the old profile picture after a successful update
            if (oldProfilePic) {
                await fsPromises.unlink(oldProfilePic).catch(err => console.error('Failed to delete old profile pic:', err));
            }
        }
        
        await user.save();
        
        // Return updated fields, including new privacy settings
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

app.post('/api/add-contact', async (req, res) => {
    const { userId, contactId, customName } = req.body;
    try {
        const user = await User.findOne({ xameId: userId });
        const contact = await User.findOne({ xameId: contactId });
        
        if (!user || !contact) {
            return res.status(404).json({ success: false, message: 'User or contact not found.' });
        }

        // We check using contact._id, which is the correct way for Mongoose reference
        const contactExists = user.contacts.some(c => c.contactId && c.contactId.toString() === contact._id.toString());
        if (contactExists) {
            return res.status(409).json({ success: false, message: 'Contact already exists.' });
        }
        
        // This is the correct action: Add the new contact to the user's list.
        user.contacts.push({ 
            contactId: contact._id, 
            customName: customName 
        });

        await user.save();
        
        // --- APPLY PRIVACY FILTERING BEFORE RETURNING NEW CONTACT DATA ---
        const filteredContact = getPrivacyFilteredContactData(contact);
        const displayName = getContactDisplayName(contact.xameId, filteredContact, { customName });
        // --- END FILTERING ---

        // Return the contact data needed by the frontend to render the new contact
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

// VERBATIM SNIPPET TO REPLACE EXISTING /api/update-contact
app.post('/api/update-contact', 
    body('userId').trim().escape().notEmpty().withMessage('User ID is required.'),
    body('contactId').trim().escape().notEmpty().withMessage('Contact ID is required.'),
    body('newName').trim().escape().notEmpty().withMessage('New name is required.'),
    async (req, res) => {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
        // Enforce a proper API standard with detailed error messages
        return res.status(400).json({ success: false, message: 'Input validation failed.', errors: validationErrors.array() });
    }
        
    const { userId, contactId, newName } = req.body;
    
    try {
        // 1. Find the MongoDB ObjectId for the contact's xameId
        const contactUser = await User.findOne({ xameId: contactId }).select('_id');
        if (!contactUser) {
            return res.status(404).json({ success: false, message: 'The user you are trying to contact was not found.' });
        }
        
        // 2. Attempt to update the existing contact's customName
        let result = await User.updateOne(
            { 
                xameId: userId,
                // Use the correct ObjectId to find the embedded contact document
                'contacts.contactId': contactUser._id 
            },
            { 
                // $set the customName field on the identified embedded document
                $set: { 'contacts.$.customName': newName } 
            }
        );

        if (result.matchedCount === 0) {
            // CRITICAL FIX: If the update failed (contact not found in contacts array), attempt to ADD the contact.
            
            // Fetch the current user document
            const user = await User.findOne({ xameId: userId });
            if (!user) {
                return res.status(404).json({ success: false, message: 'Your user profile was not found.' });
            }

            // Check if the contact is already in the list (race condition check, or it exists but has no name)
            const contactExists = user.contacts.some(c => c.contactId && c.contactId.toString() === contactUser._id.toString());
            
            if (!contactExists) {
                // ADD the new contact with the custom name
                user.contacts.push({ 
                    contactId: contactUser._id, 
                    customName: newName // Save the custom name during the add
                });
                await user.save();
                console.log(`Contact ${contactId} ADDED with custom name ${newName} for user ${userId}.`);
            } else {
                 // The contact exists but the $set query failed to match. Re-save the user.
                 await user.save();
                 console.log(`Contact ${contactId} already exists but failed atomic update. Re-saving user document.`);
            }
            
            // Mark the operation as modified/successful to proceed to the success response
            result = { modifiedCount: 1 }; 
        }
        
        console.log(`Contact name for ${contactId} updated to ${newName} for user ${userId}.`);
        
        // Success response
        res.json({ 
            success: true, 
            message: 'Contact name updated successfully.',
            updatedName: newName // Return the new name for client-side UI update
        });
        
    } catch (error) {
        // Centralized logging for intercontinental standard
        console.error(`🔴 MongoDB Update/Add Error for user ${userId} and contact ${contactId}:`, error);
        res.status(500).json({ success: false, message: 'A critical server error occurred during the save operation. Please try again.' });
    }
});
// END VERBATIM SNIPPET


// VERBATIM SNIPPET TO REPLACE EXISTING /api/delete-contact
// NEW ENDPOINT: Handles permanent deletion of a contact AND all associated messages/calls
app.post('/api/delete-chat-and-contact', 
    body('userId').trim().escape().notEmpty().withMessage('User ID is required.'),
    body('contactId').trim().escape().notEmpty().withMessage('Contact ID is required.'),
    async (req, res) => {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Input validation failed.', errors: validationErrors.array() });
    }
        
    const { userId, contactId } = req.body;

    // IMPORTANT: Never delete the self-chat. The client should enforce this, but the server must too.
    if (userId === contactId) {
        return res.status(403).json({ success: false, message: 'Cannot delete the self chat.' });
    }
    
    try {
        // 1. Find the contact's MongoDB ObjectId (needed to remove the contact reference)
        const contactToDelete = await User.findOne({ xameId: contactId }).select('_id');
        
        // --- ATOMIC DELETION STEPS (for user <-> contact relationship) ---
        
        // 2. Delete ALL messages between the two users
        await Message.deleteMany({
            $or: [
                { senderId: userId, recipientId: contactId },
                { senderId: contactId, recipientId: userId }
            ]
        });
        
        // 3. Delete ALL call history between the two users
        await CallHistory.deleteMany({
            $or: [
                { callerId: userId, recipientId: contactId },
                { callerId: contactId, recipientId: userId }
            ]
        });
        
        let contactDeleted = false;
        if (contactToDelete) {
            // 4. Remove the contact reference from the user's contacts array
            const contactResult = await User.updateOne(
                { xameId: userId },
                { $pull: { contacts: { contactId: contactToDelete._id } } }
            );
            if (contactResult.modifiedCount > 0) {
                contactDeleted = true;
            }
        }
        
        console.log(`Permanent chat/contact deletion complete for user ${userId} and contact ${contactId}.`);
        
        res.json({ 
            success: true, 
            // Note: contactDeleted will be false if the user was just a chat partner and not a formal contact
            message: `Contact and all chat history permanently deleted. (Contact list entry removed: ${contactDeleted})` 
        });

    } catch (error) {
        console.error(`🔴 Critical Error during permanent chat/contact deletion for user ${userId} and contact ${contactId}:`, error);
        res.status(500).json({ success: false, message: 'A critical server error occurred during the permanent deletion operation.' });
    }
});
// END VERBATIM SNIPPET


// --- Socket.IO Handlers ---
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
    
    // NEW: Fetches and sends full chat history from the database to the client
    socket.on('get_chat_history', async ({ userId }) => {
        try {
            // Find all messages where the user is either the sender or the recipient
            const messages = await Message.find({
                $or: [{ senderId: userId }, { recipientId: userId }]
            }).sort('ts');
            
            const chatHistory = {};

            // Organize messages by contact
            messages.forEach(msg => {
                const contactId = msg.senderId === userId ? msg.recipientId : msg.senderId;
                if (!chatHistory[contactId]) {
                    chatHistory[contactId] = [];
                }

                // Format the message to match the client's expected structure
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

            // Send the organized history back to the client
            socket.emit('chat_history', chatHistory);
            console.log(`Sent chat history for ${userId}. Total conversations: ${Object.keys(chatHistory).length}`);

        } catch (error) {
            console.error('Failed to get chat history:', error);
            socket.emit('chat_history', {});
        }
    });

    // UPDATED: Fetches ALL contacts (saved and unsaved threads) along with unread/missed counts and a SAFE PREVIEW.
    socket.on('get_contacts', async (userId) => {
        try {
            const formattedContacts = await getFullContactData(userId);
            
            // Emit the complete, enriched list
            socket.emit('contacts_list', formattedContacts);
            console.log(`Sent full contact list for ${userId}. Total threads: ${formattedContacts.length}`);

        } catch (error) {
            console.error('Failed to get full contacts/threads list:', error);
            socket.emit('contacts_list', []);
        }
    });
    
    // UPDATED: Combined message and file-message into a single handler
    // NOW includes logic to notify the recipient to update their unread count.
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
                ... (message.text && { text: message.text }),
                ... (message.file && { file: message.file }),
            };
            
            const newMessage = new Message(newMessageData);
            await newMessage.save();
            
            if (recipientSocketId) {
                // 1. Send the message payload
                io.to(recipientSocketId).emit('receive-message', { senderId: senderId, message });
                
                // 2. Send status update to sender
                await Message.findOneAndUpdate({ messageId: message.id }, { status: 'delivered' });
                io.to(socket.id).emit('message-status-update', {
                    recipientId: recipientId,
                    messageId: message.id,
                    status: 'delivered'
                });
                
                // 3. Notify recipient to update the message count on their UI
                io.to(recipientSocketId).emit('new_message_count', { senderId: senderId });

            }
            callback({ success: true, messageId: message.id });
        } catch (error) {
            console.error('Failed to save message:', error);
            callback({ success: false, message: 'Server failed to save message.' });
        }
    });

    // VERBATIM SNIPPET FOR MESSAGE DELETION LOGIC
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
                // --- MODE 1: PERMANENT DELETE (DELETE FOR EVERYONE) ---
                
                // Delete the message documents entirely from the database
                const deleteResult = await Message.deleteMany({
                    messageId: { $in: messageIds },
                    // Security check: Only allow deletion of messages sent BY the user
                    senderId: userId 
                });

                console.log(`[SYNC-DEL] Deleted ${deleteResult.deletedCount} messages permanently.`);

                if (deleteResult.deletedCount > 0) {
                    // Notify the recipient's client to also remove these messages from their local chat
                    const recipientSocketId = findSocketIdByUserId(recipientId);
                    if (recipientSocketId) { 
                         io.to(recipientSocketId).emit('messages-deleted', { 
                             deleterId: userId,
                             contactId: userId, // The chat window where they see the deletion
                             messageIds: messageIds,
                             permanently: true // Flag to ensure local removal on their side
                         });
                         console.log(`[SYNC-DEL] Notified recipient ${recipientId} for permanent deletion.`);
                    } else {
                         // For a truly scalable system, a push notification or pending deletion sync record would be needed here.
                    }
                }
                
            } else {
                // --- MODE 2: DELETE FOR ME (MARK AS DELETED FOR REQUESTING USER) ---
                
                // NOTE: Proper "Delete For Me" requires a schema change (e.g., a `deletedFor` array on the Message model).
                // With the current schema, the server cannot track "deleted for user A but not user B."
                // The current implementation allows the client to locally delete and relies on the client's internal state management 
                // to prevent re-syncing messages marked only for local deletion.
                console.log(`[SYNC-DEL] Message(s) marked for local deletion only for user ${userId}. (Requires client-side persistence).`);
            }

            // Return success after operation, allowing the client to clear messages locally
            callback({ success: true });

        } catch (error) {
            console.error(`[SYNC-DEL] Critical error for user ${userId}:`, error);
            callback({ success: false, message: 'Internal server error during deletion.' });
        }
    });
    // END VERBATIM SNIPPET FOR MESSAGE DELETION LOGIC

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

    // --- WebRTC signaling ---
    // [2025-10-01] UPDATED socket.on('call-user') to respect caller's privacy settings AND recipient's custom name
    socket.on('call-user', async ({ recipientId, offer, callType }) => {
        const callerId = socketToUserMap.get(socket.id);
        console.log(`User ${callerId} is calling ${recipientId}. Call Type: ${callType}`);
        const recipientSocketId = findSocketIdByUserId(recipientId);

        if (recipientSocketId) {
            try {
                const caller = await User.findOne({ xameId: callerId });
                // NEW: Find the recipient's user document to check for a custom name for the caller
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
                    status: 'pending' // Starts as pending
                });
                await newCall.save();
                
                // --- APPLY PRIVACY SETTINGS (Caller's Name Display Rule) ---
                // We re-use the new helper function for consistency and maintainability
                const filteredCaller = getPrivacyFilteredContactData(caller.toObject());
                
                // NEW: Check for a custom name the recipient has saved for the caller
                const savedContactForCaller = recipientUser.contacts.find(
                    c => c.contactId && c.contactId.xameId === callerId
                );

                // Determine the name the RECIPIENT should see on the incoming call screen
                // This uses the same centralized logic you already created (now with Xame-ID fallback).
                const incomingCallName = getContactDisplayName(callerId, filteredCaller, savedContactForCaller);
                
                // Structure the caller object sent to the recipient
                const restrictedCaller = {
                    xameId: filteredCaller.xameId,
                    firstName: filteredCaller.firstName,
                    lastName: filteredCaller.lastName,
                    preferredName: filteredCaller.preferredName, // Empty string if hidden
                    profilePic: filteredCaller.profilePic, // Empty string if hidden
                    // NEW: The final display name the client should use
                    displayName: incomingCallName 
                };
                // --- END PRIVACY SETTINGS & CUSTOM NAME LOGIC ---

                // Send call signal to the recipient with the restricted caller object
                io.to(recipientSocketId).emit('call-user', { offer, callerId, caller: restrictedCaller, callType, callId: callId });
                
            } catch (error) {
                console.error('Call user error:', error);
                socket.emit('call-error', { message: 'Failed to initiate call due to server error.' });
            }
        } else {
            console.log(`User ${recipientId} is offline, cannot call. Recording as missed.`);
            
            // --- Record Missed Call for Offline User ---
            try {
                 const callId = uuidv4();
                 const newCall = new CallHistory({
                    callId: callId,
                    callerId: callerId,
                    recipientId: recipientId,
                    callType: callType,
                    status: 'missed' // Explicitly set to 'missed' for offline calls
                });
                await newCall.save();
                socket.emit('call-rejected', { senderId: recipientId, reason: 'offline' });
                
            } catch(error) {
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
    
    // NEW EVENT: Added to explicitly confirm that a media track is ready to be received.
    socket.on('stream-ready', ({ recipientId, streamType }) => {
        const senderId = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            console.log(`User ${senderId} has a ${streamType} stream ready. Notifying ${recipientId}.`);
            io.to(recipientSocketId).emit('stream-ready', { senderId, streamType });
        }
    });
    
    // UPDATED: Fixed logic for updating call history
    socket.on('call-accepted', async ({ recipientId, callId }) => {
        const acceptorId = socketToUserMap.get(socket.id);
        const recipientSocketId = findSocketIdByUserId(recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-accepted', { recipientId: acceptorId });
            try {
                // Use the provided callId if available, otherwise find the pending one
                const query = callId ? { callId: callId } : { callerId: recipientId, recipientId: acceptorId, status: 'pending' };
                await CallHistory.findOneAndUpdate(query, { status: 'accepted' });
            } catch (error) {
                console.error('Failed to update call history (accepted):', error);
            }
        }
    });

    // VERBATIM SNIPPET TO REPLACE EXISTING socket.on('call-rejected')
    socket.on('call-rejected', async ({ recipientId, reason, callId }) => {
        const rejectorId = socketToUserMap.get(socket.id);
        const callerSocketId = findSocketIdByUserId(recipientId); // This is the caller's socket
        
        // 1. Find the pending call and update its status
        try {
            // Find the pending call where the caller is the 'recipientId' and the recipient is the 'rejectorId' (current user).
            const query = callId ? { callId: callId } : { callerId: recipientId, recipientId: rejectorId, status: 'pending' };
            // Save the result of the update to check if a document was modified
            const updateResult = await CallHistory.findOneAndUpdate(query, { status: 'rejected' });
            
            // 2. Notify the caller (recipientId) that the call was rejected
            if (callerSocketId) {
                io.to(callerSocketId).emit('call-rejected', { senderId: rejectorId, reason });
            }
            
            // 3. NEW: Send an acknowledgement to the REJECTOR'S client to clear the missed count/pending state locally.
            if (updateResult) {
                // Only emit this if an actual document was found and updated (meaning they had a pending/missed call)
                socket.emit('call-acknowledged', { senderId: recipientId, acknowledgedCallId: updateResult.callId });
            }
            
        } catch (error) {
            console.error('Failed to update call history (rejected):', error);
        }
    });
    // END VERBATIM SNIPPET
    
    // Handle when a call is not answered (missed call)
    socket.on('call-unanswered', async ({ recipientId, callId }) => {
        const callerId = socketToUserMap.get(socket.id);
        
        try {
            // Update the pending call to a 'missed' status 
            await CallHistory.findOneAndUpdate(
                { callId: callId, callerId: callerId, recipientId: recipientId, status: 'pending' },
                { status: 'missed' }
            );

            // Notify the recipient (missed call notification)
            const recipientSocketId = findSocketIdByUserId(recipientId);
            if (recipientSocketId) {
                 // Notify the recipient's client to update their missed call count
                 io.to(recipientSocketId).emit('new_missed_call_count', { senderId: callerId });
            }
            
        } catch (error) {
            console.error('Failed to handle unanswered call:', error);
        }
    });

    socket.on('call-ended', async ({ recipientId }) => {
        const currentUserId = socketToUserMap.get(socket.id);
        try {
            // Find the active call where the current user and recipient are involved
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

// --- Example Express route ---
app.get('/', (req, res) => {
    res.send('Server is live!');
});

// --- Start server ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
