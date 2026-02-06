<meta name='viewport' content='width=device-width, initial-scale=1'/><script>
/*
// PART 1: Header and Core Setup
*/

//
// XamePage v2.1 Script File - Updated with Robust File Upload & Waveform Visualization
//

// --- Dynamic Server URL based on environment ---
let socket = null;

let serverURL;

// This logic automatically uses the correct URL.
// It detects if you're using a Cloudflare tunnel or a local network connection.
const currentHostname = window.location.hostname;
const currentPort = window.location.port;

if (currentHostname.includes('trycloudflare.com')) {
    serverURL = `https://${currentHostname}`;
    console.log("Using Cloudflare URL:", serverURL);
} else if (currentHostname === 'localhost' || currentHostname === '127.0.0.1') {
    serverURL = `http://localhost:${currentPort}`;
    console.log("Using Localhost URL:", serverURL);
} else {
    // This will handle your private IP like 10.28.130.157
    serverURL = `http://${currentHostname}:${currentPort}`;
    console.log("Using Network IP URL:", serverURL);
}

// ===== Storage helpers =====
const storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  del(key) {
    localStorage.removeItem(key);
  }
};

const KEYS = {
  user: 'xame:user',
  contacts: 'xame:contacts',
  chat: (id) => `xame:chat:${id}`,
  drafts: 'xame:drafts',
  settings: 'xame:settings',
  version: '2.1'
};
const APP_VERSION = '2.1';

// ===== File Upload Configuration =====
const FILE_CONFIG = {
  maxSize: 500 * 1024 * 1024, // 500MB
  allowedTypes: {
    images: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    videos: ['video/mp4', 'video/webm', 'video/ogg'],
    audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'],
    documents: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/javascript',
      'application/javascript',
      'application/x-javascript',
      'text/css',
      'text/html'
    ]
  }
};

// ===== Utilities =====
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
  }[m]));
}

function now() {
  return Date.now();
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function dayLabel(ts) {
  const one = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yest = new Date(today.getTime() - one);
  const t = new Date(ts);
  t.setHours(0, 0, 0, 0);
  if (t.getTime() === today.getTime()) return 'Today';
  if (t.getTime() === yest.getTime()) return 'Yesterday';
  return fmtDate(ts);
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function showNotification(message) {
    let existingNotif = document.querySelector('.status-notification');
    if (existingNotif) {
        existingNotif.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'status-notification'; 
    notification.textContent = message;

    document.body.appendChild(notification);

    window.requestAnimationFrame(() => {
        notification.classList.add('visible'); 
    });

    const displayTime = 3000;
    const fadeDuration = 500;

    setTimeout(() => {
        notification.classList.remove('visible');
        notification.classList.add('fade-out');

        setTimeout(() => {
             if (document.body.contains(notification)) {
                notification.remove();
             }
        }, fadeDuration);

    }, displayTime);
}

const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms)
  }
};

// ===== File Validation =====
function validateFile(file) {
  if (file.size > FILE_CONFIG.maxSize) {
    return {
      valid: false,
      error: `File size exceeds ${formatFileSize(FILE_CONFIG.maxSize)} limit`
    };
  }

  const allAllowedTypes = [
    ...FILE_CONFIG.allowedTypes.images,
    ...FILE_CONFIG.allowedTypes.videos,
    ...FILE_CONFIG.allowedTypes.audio,
    ...FILE_CONFIG.allowedTypes.documents
  ];

  if (!allAllowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: 'File type not supported'
    };
  }

  return { valid: true };
}

/*
// PART 2: Data Model and State
*/
// ===== Data model =====
function ensureSeedContacts() {
  let list = storage.get(KEYS.contacts);

  // 1. Check if the stored list exists and is an array with items.
  if (Array.isArray(list) && list.length > 0) {
    // If it exists, proceed to filter, add 'self', and map properties.
    list = list.filter(c => c.id !== 'self');
    if (USER && USER.xameId) {
      let selfContact = list.find(c => c.id === USER.xameId);
      if (!selfContact) {
        selfContact = {
          id: USER.xameId,
          name: `${USER.firstName} ${USER.lastName} (You)`,
          status: 'Message yourself',
          createdAt: now(),
          lastAt: now(),
          lastInteractionTs: now(),
          lastInteractionPreview: 'Message yourself',
          online: false,
          profilePic: USER.profilePic,
          unreadCount: 0,
          isProfilePicHidden: false
        };
        list.unshift(selfContact);
      }
    }
    list = list.map(c => ({
        ...c, 
        unreadCount: c.unreadCount || 0,
        lastInteractionTs: c.lastInteractionTs || c.lastAt || c.createdAt,
        lastInteractionPreview: c.lastInteractionPreview || c.status,
        isProfilePicHidden: c.isProfilePicHidden || false
    }));
    storage.set(KEYS.contacts, list);
    return list;
  }
  
  // 2. If the list doesn't exist or is empty, initialize it as an empty array.
  // Placeholder contacts and seed chat have been REMOVED here.
  list = [];
  
  // Add the 'self' contact if the user is logged in and the list was empty
  if (USER && USER.xameId) {
    list.push({
        id: USER.xameId,
        name: `${USER.firstName} ${USER.lastName} (You)`,
        status: 'Message yourself',
        createdAt: now(),
        lastAt: now(),
        lastInteractionTs: now(),
        lastInteractionPreview: 'Message yourself',
        online: false,
        profilePic: USER.profilePic,
        unreadCount: 0,
        isProfilePicHidden: false
    });
  }

  storage.set(KEYS.contacts, list);
  // The storage.set(KEYS.chat('aaron-cal'), seed) is also removed.
  
  return list;
}
  



// ===== State =====
let USER = null;
let CONTACTS = [];
let DRAFTS = {};
let ACTIVE_ID = null;
let isTyping = false;
let typingTimeout = null;
let selectedMessages = [];
let cropper = null;
let CHAT_HISTORY = {};
let currentUpload = null;


/*
// PART 3: Element References and Helper Functions
*/

// ===== Elements =====
const elLanding = $('#landing');
const elRegister = $('#register');
const elLogin = $('#login');
const elContacts = $('#contacts');
const elChat = $('#chat');
const elProfile = $('#profileSection');
const elStatus = $('#statusSection');

const signUpBtn = $('#signUpBtn');
const signInBtn = $('#signInBtn');
const backToLandingBtn = $('#backToLandingBtn');
const backToLandingBtn2 = $('#backToLandingBtn2');

const firstNameInput = $('#firstNameInput');
const lastNameInput = $('#lastNameInput');

const dobDayInput = $('#dobDay');
const dobMonthInput = $('#dobMonth');
const dobYearInput = $('#dobYear');
const dobHiddenDateInput = $('#dobHiddenDateInput');

const dobErrorElement = $('#dobError'); 

if (dobHiddenDateInput) {
  try {
    dobHiddenDateInput.max = new Date().toISOString().slice(0, 10);
    dobHiddenDateInput.min = '1900-01-01';
  } catch (_) {}
}

const registerForm = $('#registerForm');
const loginForm = $('#loginForm');
const loginXameIdInput = $('#loginXameIdInput');

const contactList = $('#contactList');
const contactsCount = $('#contactsCount');
const searchInput = $('#searchInput');
const logoutBtn = $('#logoutBtn');
const addContactBtn = $('#addContactBtn');
const moreBtn = $('#moreBtn');
const moreMenu = $('#moreMenu');

const avatarInitialsEl = document.getElementById('avatarInitials');
const clearAllChatsBtn = $('#clearAllChatsBtn'); 
const avatarBtn = document.getElementById('avatarBtn');
const accountMenu = document.getElementById('accountMenu');

const elChatHeader = $('#chat .header');
const elChatToolbar = $('#chat .header .toolbar');
const elChatHeaderDetails = $('#chat .header .header-details');
const elChatHeaderButtonGroup = $('#chat .header .icon-btn-group');

const selectToolbar = document.createElement('div');
selectToolbar.className = 'select-toolbar hidden';
selectToolbar.innerHTML = `
    <button class="icon-btn" id="exitSelectModeBtn">←</button>
    <div class="counter">0</div>
    <div class="toolbar">
      <button class="icon-btn" id="deleteSelectedBtn" title="Delete messages">🗑</button>
      <button class="icon-btn" id="copySelectedBtn" title="Copy messages">⎘</button>
      <button class="icon-btn" id="forwardSelectedBtn" title="Forward messages">⇥</button>
    </div>
`;

const exitSelectModeBtn = selectToolbar.querySelector('#exitSelectModeBtn');
const deleteSelectedBtn = selectToolbar.querySelector('#deleteSelectedBtn');
const copySelectedBtn = selectToolbar.querySelector('#copySelectedBtn');
const forwardSelectedBtn = selectToolbar.querySelector('#forwardSelectedBtn');

const backBtn = $('#backBtn');
const chatName = $('#chatName');
const chatSub = $('#chatSub');
const messagesEl = $('#messages');
const typingEl = $('#typing');
const composer = $('#composer');
const messageInput = $('#messageInput');
const sendBtn = $('#sendBtn');
const layer = $('#layer');

const profileBackBtn = $('#profileBackBtn');
const preferredNameInput = $('#preferredName');
const profilePicInput = $('#profilePic');
const profilePicPreview = $('#profilePicPreview');
const saveProfileBtn = $('#saveProfileBtn');
const removeProfilePicBtn = $('#removeProfilePicBtn');
const hideNameCheckbox = $('#hidePreferredNameSwitch');
const hidePicCheckbox = $('#hideProfilePictureSwitch');
const xameIdDisplay = $('#xameIdDisplay');

const cropModal = $('#cropModal');
const cropImage = $('#cropImage');
const cropCancelBtn = $('#cropCancelBtn');
const cropSaveBtn = $('#cropSaveBtn');

const statusItem = $('.status-item');
const statusBackBtn = $('#statusBackBtn');
const myStatusAvatarInitials = $('#myStatusAvatarInitials');
const myStatusTime = $('#myStatusTime');

const fileInput = $('#fileInput');
const attachBtn = $('#attachBtn');
const micBtn = $('#micBtn');
const voiceNoteControl = $('#voiceNoteControl');
const recordBtn = $('#recordBtn');
const playBtn = $('#playBtn');
const sendVoiceBtn = $('#sendVoiceBtn');
const stopRecordBtn = $('#stopRecordBtn');

let mediaRecorder;
let audioChunks = [];
let audioBlob = null;
let speechRecognizer = null;

// ===== Enhanced File Icon Function =====
function getFileIcon(fileType, fileName = '') {
    if (fileType.startsWith('image/')) return '🖼️';
    else if (fileType.startsWith('video/')) return '📹';
    else if (fileType.startsWith('audio/')) return '🎵';
    else if (fileType === 'application/pdf') return '📄';
    else if (fileType === 'application/msword' || fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '📝';
    else if (fileType === 'application/vnd.ms-excel' || fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return '📊';
    else if (fileType === 'application/vnd.ms-powerpoint' || fileType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return '📋';
    else if (fileType === 'text/plain') return '📜';
    else if (fileName.endsWith('.zip') || fileName.endsWith('.rar')) return '🗜️';
    return '📁';
}

// Helper function for audio duration formatting
function formatDuration(seconds) {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Image fullscreen viewer
function openImageFullscreen(imageUrl, imageName) {
    const overlay = document.createElement('div');
    overlay.className = 'fullscreen-image-overlay';
    overlay.innerHTML = `
        <div class="fullscreen-image-container">
            <button class="close-fullscreen-btn">✕</button>
            <img src="${imageUrl}" alt="${escapeHtml(imageName)}">
            <div class="image-actions">
                <a href="${imageUrl}" download="${imageName}" class="btn secondary">Download</a>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelector('.close-fullscreen-btn').addEventListener('click', () => {
        overlay.remove();
    });
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
}

// Upload progress UI functions
function createUploadProgress(msgId, fileName) {
    const existingProgress = document.getElementById(`upload-progress-${msgId}`);
    if (existingProgress) {
        existingProgress.remove();
    }
    
    const progressDiv = document.createElement('div');
    progressDiv.id = `upload-progress-${msgId}`;
    progressDiv.className = 'upload-progress-indicator';
    progressDiv.innerHTML = `
        <div class="upload-info">
            <span class="upload-filename">${escapeHtml(fileName)}</span>
            <span class="upload-percentage">0%</span>
        </div>
        <div class="upload-progress-bar">
            <div class="upload-progress-fill" style="width: 0%"></div>
        </div>
        <button class="cancel-upload-btn" data-msg-id="${msgId}">Cancel</button>
    `;
    
    composer.insertAdjacentElement('beforebegin', progressDiv);
    
    progressDiv.querySelector('.cancel-upload-btn').addEventListener('click', () => {
        if (currentUpload) {
            currentUpload.abort();
        }
    });
    
    return progressDiv;
}

function updateUploadProgress(msgId, percentage) {
    const progressDiv = document.getElementById(`upload-progress-${msgId}`);
    if (progressDiv) {
        const fill = progressDiv.querySelector('.upload-progress-fill');
        const percentageText = progressDiv.querySelector('.upload-percentage');
        
        if (fill) {
            fill.style.width = `${percentage}%`;
        }
        if (percentageText) {
            percentageText.textContent = `${Math.round(percentage)}%`;
        }
    }
}

function removeUploadProgress(msgId) {
    const progressDiv = document.getElementById(`upload-progress-${msgId}`);
    if (progressDiv) {
        progressDiv.remove();
    }
}

function handleUploadError(msgId, errorMessage) {
    showNotification(`Upload failed: ${errorMessage}`);
    console.error("File upload failed:", errorMessage);
    
    const chatToUpdate = getChat(ACTIVE_ID);
    const msgIndex = chatToUpdate.findIndex(m => m.id === msgId);
    if (msgIndex !== -1) {
        chatToUpdate[msgIndex].text = 'Upload failed ⚠️';
        chatToUpdate[msgIndex].isPending = false;
        chatToUpdate[msgIndex].uploadProgress = 0;
        setChat(ACTIVE_ID, chatToUpdate);
        renderMessages();
    }
}

// Image preview before sending
function showImagePreview(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const overlay = document.createElement('div');
            overlay.className = 'image-preview-overlay';
            overlay.innerHTML = `
                <div class="image-preview-dialog">
                    <h3>Send Image?</h3>
                    <img src="${e.target.result}" alt="Preview">
                    <div class="preview-actions">
                        <button class="btn secondary" id="cancelImageSend">Cancel</button>
                        <button class="btn primary" id="confirmImageSend">Send</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            overlay.querySelector('#cancelImageSend').addEventListener('click', () => {
                overlay.remove();
                resolve(false);
            });
            
            overlay.querySelector('#confirmImageSend').addEventListener('click', () => {
                overlay.remove();
                resolve(true);
            });
        };
        reader.readAsDataURL(file);
    });
}

/*
// PART 4: WebRTC Logic
*/

// ===== WebRTC Logic =====
const rtcConfig = {
    iceServers: [{
        urls: "stun:stun.l.google.com:19302"
    }]
};
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let isAudioMuted = false;
let isVideoMuted = false;
let isLoudspeakerOn = false;

let pendingIceCandidates = [];

const videoCallOverlay = $('#videoCallOverlay');
const remoteVideo = $('#remoteVideo');
const localVideo = $('#localVideo');
const cameraToggleBtn = $('#cameraToggleBtn');
const micMuteBtn = $('#micMuteBtn');
const cameraMuteBtn = $('#cameraMuteBtn');
const loudSpeakerBtn = $('#loudSpeakerBtn');
const exitCallBtn = $('#exitCallBtn');

const makeDraggable = (el) => {
    let initialX, initialY;
    let currentX = parseFloat(el.style.left) || 0;
    let currentY = parseFloat(el.style.top) || 0;
    let lastTap = 0;

    el.style.position = 'fixed';
    el.style.left = `${currentX}px`;
    el.style.top = `${currentY}px`;

    const dragStart = (e) => {
        e.preventDefault();

        const now = Date.now();
        const isDoubleTap = (now - lastTap) <= 300;
        lastTap = now;

        if (isDoubleTap) {
            swapVideos();
            return;
        }

        const clientX = e.type === "touchstart" ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === "touchstart" ? e.touches[0].clientY : e.touches[0].clientY;

        initialX = clientX;
        initialY = clientY;

        currentX = parseFloat(el.style.left) || 0;
        currentY = parseFloat(el.style.top) || 0;

        el.classList.add('dragging');

        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('touchmove', drag, { passive: false });
        document.addEventListener('touchend', dragEnd);
    };

    const dragEnd = () => {
        el.classList.remove('dragging');
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', dragEnd);
        document.removeEventListener('touchmove', drag);
        document.removeEventListener('touchend', dragEnd);
    };

    const drag = (e) => {
        e.preventDefault();

        const clientX = e.type === "touchmove" ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === "touchmove" ? e.touches[0].clientY : e.clientY;

        const dx = clientX - initialX;
        const dy = clientY - initialY;

        let newX = currentX + dx;
        let newY = currentY + dy;

        const elementRect = el.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        newX = Math.max(0, Math.min(newX, windowWidth - elementRect.width));
        newY = Math.max(0, Math.min(newY, windowHeight - elementRect.height));

        el.style.left = `${newX}px`;
        el.style.top = `${newY}px`;
    };

    el.addEventListener('mousedown', dragStart);
    el.addEventListener('touchstart', dragStart, { passive: false });
};

const swapVideos = () => {
    const localSrc = localVideo.srcObject;
    const remoteSrc = remoteVideo.srcObject;
    
    if (!localSrc || !remoteSrc) {
        console.error("Swap failed: One or both video streams are missing.");
        return;
    }

    localVideo.srcObject = remoteSrc;
    remoteVideo.srcObject = localSrc;

    localVideo.muted = true;
    remoteVideo.muted = false;

    localVideo.play().catch(e => console.error("Error playing local video:", e));
    remoteVideo.play().catch(e => console.error("Error playing remote video:", e));

    localVideo.classList.toggle('is-local');
    localVideo.classList.toggle('is-remote');
    remoteVideo.classList.toggle('is-local');
    remoteVideo.classList.toggle('is-remote');
};

const toggleMic = () => {
    if (!localStream) return;
    isAudioMuted = !isAudioMuted;
    localStream.getAudioTracks().forEach(track => track.enabled = !isAudioMuted);
    micMuteBtn.classList.toggle('active', !isAudioMuted);
    micMuteBtn.textContent = isAudioMuted ? '🔇' : '🎙️';
};

const toggleCamera = () => {
    if (!localStream) return;
    isVideoMuted = !isVideoMuted;
    localStream.getVideoTracks().forEach(track => track.enabled = !isVideoMuted);
    cameraMuteBtn.classList.toggle('active', !isVideoMuted);
    cameraMuteBtn.textContent = isVideoMuted ? '📷' : '📹';
};

const toggleLoudspeaker = () => {
    isLoudspeakerOn = !isLoudspeakerOn;
    if (remoteVideo) {
        remoteVideo.muted = !isLoudspeakerOn;
        if (isLoudspeakerOn) {
            remoteVideo.volume = 1;
        } else {
            remoteVideo.volume = 0;
        }
    }
    loudSpeakerBtn.classList.toggle('active', isLoudspeakerOn);
    loudSpeakerBtn.textContent = isLoudspeakerOn ? '🔊' : '🔈';
};

const toggleFrontBackCamera = async () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    const newFacingMode = videoTrack.getSettings().facingMode === 'user' ? 'environment' : 'user';

    videoTrack.stop();

    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: newFacingMode },
            audio: true
        });

        const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
        if (sender) {
            sender.replaceTrack(newStream.getVideoTracks()[0]);
        }

        localStream = newStream;
        localVideo.srcObject = newStream;

    } catch (err) {
        console.error('Failed to switch camera:', err);
    }
};

const exitVideoCall = () => {
    endCall();
    videoCallOverlay.classList.add('hidden');
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    elChatHeader.classList.remove('hidden');
    composer.classList.remove('hidden');
};

micMuteBtn.addEventListener('click', toggleMic);
cameraMuteBtn.addEventListener('click', toggleCamera);
loudSpeakerBtn.addEventListener('click', toggleLoudspeaker);
exitCallBtn.addEventListener('click', exitVideoCall);
cameraToggleBtn.addEventListener('click', toggleFrontBackCamera);

const incomingCallOverlay = $('#incomingCallOverlay');
const acceptCallBtn = $('#acceptCallBtn');
const declineCallBtn = $('#declineCallBtn');

function showIncomingCallNotification(caller, callType, offer) {
    const localContact = CONTACTS.find(c => c.id === caller.xameId);
    
const rtcConfig = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        },
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ]
};

    const displayName = localContact 
                        ? localContact.name 
                        : (caller.name || "Unknown Caller"); 
    
    const displayId = caller.xameId;

    $('#callerName').textContent = displayName;
    $('#callerId').textContent = displayId;
    $('#callStatus').textContent = `Incoming ${callType} call...`;
    
    const callerPicEl = $('#callerPic');
    const callAvatarInitialsEl = $('#callAvatarInitials');
    
    let callerPicUrl = caller.profilePic;
    let showPlaceholder = !caller.profilePic;
    
    if (localContact && localContact.isProfilePicHidden) {
        showPlaceholder = true;
        callerPicUrl = null;
    }
    
    if (callerPicUrl && !showPlaceholder) {
      if (!callerPicUrl.includes('?ts=')) {
          callerPicUrl = `${callerPicUrl}?ts=${new Date().getTime()}`;
      }
      callerPicEl.src = callerPicUrl;
      callerPicEl.classList.remove('hidden');
      callAvatarInitialsEl.classList.add('hidden');
    } else {
      const initials = initialsOf({ name: displayName });
      callAvatarInitialsEl.textContent = initials;
      callAvatarInitialsEl.classList.remove('hidden');
      callerPicEl.classList.add('hidden');
    }
    
    incomingCallOverlay.classList.remove('hidden');
    
    acceptCallBtn.onclick = async () => {
        incomingCallOverlay.classList.add('hidden');
        openChat(caller.xameId);
        await handleIncomingCall(offer, caller.xameId);
        socket.emit('call-accepted', { recipientId: caller.xameId });
    };
    declineCallBtn.onclick = () => {
        incomingCallOverlay.classList.add('hidden');
        socket.emit('call-rejected', { recipientId: caller.xameId, reason: 'user-rejected' });
    };
}

async function startCall(recipientId, callType) {
    console.log('Starting call with', recipientId, 'of type', callType);
    try {
        const hasVideo = callType === 'video';
        localStream = await navigator.mediaDevices.getUserMedia({
            video: hasVideo,
            audio: true
        });

        videoCallOverlay.classList.remove('hidden');
        elChatHeader.classList.add('hidden');
        composer.classList.add('hidden');
        
        localVideo.srcObject = localStream;
        localVideo.muted = true;

        if (!hasVideo) {
            localVideo.style.display = 'none';
        } else {
            localVideo.style.display = 'block';
            makeDraggable(localVideo);
        }

        peerConnection = new RTCPeerConnection(rtcConfig);
        
        peerConnection.ontrack = (event) => {
            console.log('Received remote track of kind:', event.track.kind);
            remoteStream = event.streams[0]; 
            
            if (remoteStream && remoteStream.getTracks().length > 0) {
                 remoteVideo.srcObject = remoteStream;
                 remoteVideo.muted = false;
                 remoteVideo.play().catch(e => console.error("Error playing remote video:", e));
                 console.log('Remote stream attached to remoteVideo and playing.');
            } else {
                 console.warn('Received ontrack event but the stream was empty or invalid.');
            }
        };
        
        peerConnection.oniceconnectionstatechange = () => {
            console.log(`ICE connection state changed to: ${peerConnection.iceConnectionState}`);
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Sending ICE candidate');
                socket.emit('ice-candidate', {
                    recipientId,
                    candidate: event.candidate
                });
            }
        };
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log(`Adding local track: ${track.kind} - Enabled: ${track.enabled}`);
        });
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('call-user', {
            recipientId: recipientId, 
            offer: offer,           
            callType: callType      
        });

    } catch (err) {
        console.error('Failed to get local stream or start call', err);
        alert('Failed to start call. Please check your camera and microphone permissions.');
        exitVideoCall();
    }
}

async function handleIncomingCall(offer, senderId) {
    console.log('Received offer from', senderId);
    try {
        const hasVideo = offer.sdp.includes('m=video');
        
        localStream = await navigator.mediaDevices.getUserMedia({
            video: hasVideo,
            audio: true
        });

        videoCallOverlay.classList.remove('hidden');
        elChatHeader.classList.add('hidden');
        composer.classList.add('hidden');

        localVideo.srcObject = localStream;
        localVideo.muted = true;

        if (!hasVideo) {
            localVideo.style.display = 'none';
        } else {
            localVideo.style.display = 'block';
            makeDraggable(localVideo);
        }

        peerConnection = new RTCPeerConnection(rtcConfig);
        
        peerConnection.ontrack = (event) => {
            console.log('Received remote track of kind:', event.track.kind);
            remoteStream = event.streams[0]; 
            
            if (remoteStream && remoteStream.getTracks().length > 0) {
                 remoteVideo.srcObject = remoteStream;
                 remoteVideo.muted = false;
                 remoteVideo.play().catch(e => console.error("Error playing remote video:", e));
                 console.log('Remote stream attached to remoteVideo and playing.');
            } else {
                 console.warn('Received ontrack event but the stream was empty or invalid.');
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            console.log(`ICE connection state changed to: ${peerConnection.iceConnectionState}`);
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Sending ICE candidate');
                socket.emit('ice-candidate', {
                    recipientId: senderId,
                    candidate: event.candidate
                });
            }
        };

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log(`Adding local track: ${track.kind} - Enabled: ${track.enabled}`);
        });

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        
        console.log('Processing pending ICE candidates:', pendingIceCandidates.length);
        for (const candidate of pendingIceCandidates) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingIceCandidates = [];

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket.emit('make-answer', {
            recipientId: senderId,
            answer
        });
        
    } catch (err) {
        console.error('Failed to handle incoming call:', err);
        alert('Failed to accept call. Please check your camera and microphone permissions.');
        exitVideoCall();
    }
}

async function handleAnswer(answer) {
    console.log('Received answer');
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));

    console.log('Processing pending ICE candidates:', pendingIceCandidates.length);
    for (const candidate of pendingIceCandidates) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
    pendingIceCandidates = [];
}

function handleNewIceCandidate(candidate) {
    console.log('Received ICE candidate');
    if (peerConnection) {
        if (peerConnection.remoteDescription) {
            peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
            console.log('Remote description not set yet, queuing candidate.');
            pendingIceCandidates.push(candidate);
        }
    } else {
        console.error('Peer connection is not initialized.');
    }
}

function endCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
        remoteStream = null;
    }
    pendingIceCandidates = [];
    console.log('Call ended.');
}

/*
// PART 5: Navigation and Contacts Rendering
*/

// ===== Navigation =====

function show(section) {
  [elLanding, elRegister, elLogin, elContacts, elChat, elProfile, elStatus].forEach(s => s?.classList.add('hidden'));
  section?.classList.remove('hidden');
}

function handleLoginSuccess(user) {
    USER = user;
    if (USER.profilePic && !USER.profilePic.includes('?ts=')) {
        USER.profilePic = `${USER.profilePic}?ts=${new Date().getTime()}`;
    }
    storage.set(KEYS.user, USER);
    setAvatarInitials();
    CONTACTS = ensureSeedContacts();
    DRAFTS = storage.get(KEYS.drafts, {});
    show(elContacts);
    
    try {
        connectSocket();
    } catch (err) {
        console.error('Failed to connect socket:', err);
        showNotification('Connected but real-time features may be limited.');
    }
    
    renderContacts();
}

function init() {
  const user = storage.get(KEYS.user);
  if (user && user.xameId) {
    handleLoginSuccess(user);
  } else {
    show(elLanding);
  }
}

// ===== Contacts rendering =====
function getChat(id) {
  return storage.get(KEYS.chat(id), []);
}
function setChat(id, arr) {
  storage.set(KEYS.chat(id), arr);
}

function contactRow(c) {
  const profilePicUrl = (c.isProfilePicHidden || !c.profilePic) 
                        ? `${serverURL}/media/profile_pics/default.png` 
                        : c.profilePic;

  const lastText = c.lastInteractionPreview || 'Hey there I\'m on XamePage';
  const lastTime = c.lastInteractionTs ? (dayLabel(c.lastInteractionTs) + ' · ' + fmtTime(c.lastInteractionTs)) : '';

  const div = document.createElement('div');
  div.className = 'item fade-in';
  div.dataset.userId = c.id;

  const onlineStatusClass = c.online ? '' : 'hidden';
  const unreadCount = c.unreadCount || 0;
  const unreadCountClass = unreadCount > 0 ? '' : 'hidden'; 

  let avatarContent = '';
  if (c.profilePic && !c.isProfilePicHidden) {
      avatarContent = `<img class="profile-pic" src="${profilePicUrl}" alt="${c.name || 'User'} profile picture"/>`;
  } else {
      avatarContent = `<div class="profile-placeholder"><span>${initialsOf(c)}</span></div>`;
  }

  div.innerHTML = `
    <div class="avatar-container">
      ${avatarContent}
      <span class="online-dot ${onlineStatusClass}"></span>
      <span class="unread-count ${unreadCountClass}">
          <span class="unread-count-text">${unreadCount}</span>
      </span>
    </div>
    <div class="meta">
      <div class="name-row">
        <div class="name">${escapeHtml(c.name)}</div>
        <div class="time">${lastTime}</div>
      </div>
      <div class="status">${escapeHtml(lastText)}</div>
    </div>
  `;
  div.addEventListener('click', () => openChat(c.id));
  return div;
}

function ensurePlaceholderStyles() {
    if (!$('#profile-placeholder-style')) {
        const style = document.createElement('style');
        style.id = 'profile-placeholder-style';
        style.textContent = `
            .profile-placeholder {
                width: 56px;
                height: 56px;
                border-radius: 50%;
                overflow: hidden;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                background-color: #3e5163;
                color: white;
                font-size: 20px;
                font-weight: bold;
                text-transform: uppercase;
            }
            .avatar-container .unread-count {
                position: absolute;
                bottom: -2px;
                right: -2px;
                background-color: #007bff;
                color: white;
                font-size: 10px;
                font-weight: bold;
                border-radius: 50%;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 2px solid white;
            }
            .avatar-container .unread-count.hidden {
                display: none;
            }
            .chat-privacy-notice {
                text-align: center;
                max-width: 80%;
                margin: 40px auto;
                padding: 20px;
                background: #f0f2f5;
                border-radius: 12px;
                color: #555;
                font-size: 14px;
                border: 1px solid #ddd;
            }
            .chat-privacy-notice p {
                margin: 8px 0;
                line-height: 1.4;
            }
            .chat-privacy-notice strong {
                font-weight: bold;
                color: #333;
            }
            .bubble {
                user-select: none;
                -webkit-user-select: none;
                -webkit-touch-callout: none;
                -webkit-tap-highlight-color: transparent;
                transition: transform 0.1s ease, border-color 0.2s ease;
                cursor: pointer;
            }
            .bubble.selected {
                border: 2px solid #FFD700 !important;
                background-color: rgba(255, 215, 0, 0.1);
            }
            .selection-toolbar-wrapper {
                display: flex;
                flex-grow: 1;
                align-items: center;
                justify-content: space-between;
                height: 100%;
                padding-right: 10px;
            }
            .selection-toolbar-wrapper .counter {
                flex-grow: 1;
                text-align: left;
                padding-left: 15px;
                font-size: 1.1em;
                font-weight: 500;
                color: #333;
            }
            .selection-toolbar-wrapper .toolbar {
                display: flex;
                gap: 5px;
            }
        `;
        document.head.appendChild(style);
    }
}

function renderContacts(filter = '') {
  if (elContacts) {
    elContacts.classList.remove('hidden');
  }
  if (contactList) {
    contactList.style.display = 'block';
  }

  let list = CONTACTS;
  if (filter) {
    const q = filter.trim().toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }

  const sortedContacts = list.sort((a, b) => {
      const tsA = b.lastInteractionTs || b.createdAt;
      const tsB = a.lastInteractionTs || a.createdAt;
      return tsA - tsB;
  });

  contactList.innerHTML = '';

  const selfContact = USER ? sortedContacts.find(c => c.id === USER.xameId) : null;
  const otherContacts = sortedContacts.filter(c => c.id !== (USER ? USER.xameId : null));

  // Render the "self" contact first if available
  if (!filter && selfContact) {
      const selfRow = document.createElement('div');
      selfRow.className = 'item fade-in';
      selfRow.dataset.userId = selfContact.id;
      const isSelfOnline = selfContact.online || false;
      const onlineStatusClass = isSelfOnline ? '' : 'hidden';

      let selfAvatarContent = '';
      if (selfContact.profilePic) {
          selfAvatarContent = `<img class="profile-pic" src="${selfContact.profilePic}" alt="Your profile picture"/>`;
      } else {
          selfAvatarContent = `<div class="profile-placeholder"><span>${initialsOf(selfContact)}</span></div>`;
      }

      selfRow.innerHTML = `
        <div class="avatar-container">
            ${selfAvatarContent}
            <span class="online-dot ${onlineStatusClass}"></span>
        </div>
        <div class="meta">
          <div class="name-row">
            <div class="name">${escapeHtml(selfContact.name)}</div>
          </div>
         
          <div class="status">${escapeHtml(selfContact.status || 'Message yourself')}</div>
        </div>
      `;
      selfRow.addEventListener('click', () => openChat(selfContact.id));
      contactList.appendChild(selfRow);
  }

  // Handle the case where the contact list is empty (excluding "self" contact) and no search filter is active
  if (otherContacts.length === 0 && !filter) {
      const welcomeMessage = document.createElement('div');
      welcomeMessage.className = 'empty-contact-list-message';
      welcomeMessage.style.cssText = `
          text-align: center;
          padding: 50px 20px;
          color: #777;
          font-size: 16px;
      `;
      
      // Updated Welcome Message HTML: XamePage is now larger (3em) for professionalism.
      welcomeMessage.innerHTML = `
          <h3 style="margin: 0 0 5px 0; font-weight: 900; color: #007bff; display: inline-block; font-size: 3em;">XamePage</h3>
          <span style="font-size: 0.8em; color: #999; margin-left: 5px; font-weight: 500;">2.1</span>
          <p style="font-size: 0.8em; color: #bbb; margin: 5px 0 0 0;">
              created by <strong style="font-weight: 700; color: #aaa;">Gibson Agbor</strong>
          </p>
          <p style="font-size: 12px; margin-top: 20px; color: #aaa;">Click on the "+" above to add a new contact, and call or start a conversation to see it appear here.</p>
      `;
      contactList.appendChild(welcomeMessage);
      
      // Update contacts count for user experience, excluding self contact if present
      contactsCount.textContent = `${0} contacts`;

  } else if (otherContacts.length > 0) {
    // Render the contacts if they exist
    const allHeader = document.createElement('div');
    allHeader.className = 'contact-group-header';
    allHeader.textContent = 'All Contacts';
    contactList.appendChild(allHeader);
    
    otherContacts.forEach(c => contactList.appendChild(contactRow(c)));
    
    // Update contacts count
    contactsCount.textContent = `${otherContacts.length} contact${otherContacts.length !== 1 ? 's' : ''}`;
  } else {
     // Case: filter is active but no results found
      contactsCount.textContent = `${0} contacts`;
  }
}

function openChat(id) {
    ACTIVE_ID = id;
    let c = CONTACTS.find(x => x.id === id);
    
    let isNewThread = false;
    if (!c) {
        c = { 
            id: id, 
            name: id,
            status: 'New message thread.', 
            lastInteractionTs: now(),
            lastInteractionPreview: 'New message thread.',
            online: false, 
            profilePic: null, 
            unreadCount: 0,
            isProfilePicHidden: false
        };
        CONTACTS.push(c);
        isNewThread = true;
    }
    
    c.unreadCount = 0;
    storage.set(KEYS.contacts, CONTACTS);

    if (isNewThread) {
        setChat(id, []);
    }
    
    if (selectedMessages.length > 0) {
        exitSelectMode();
    }
    
    const onlineStatusClass = c.online ? '' : 'hidden';
    
    const profilePicUrl = (c.isProfilePicHidden || !c.profilePic) 
                        ? `${serverURL}/media/profile_pics/default.png` 
                        : c.profilePic;

    let chatAvatarContent = '';
    if (c.profilePic && !c.isProfilePicHidden) {
        chatAvatarContent = `<img class="profile-pic" src="${profilePicUrl}" alt="${c.name} profile picture"/>`;
    } else {
        chatAvatarContent = `<div class="profile-placeholder"><span>${initialsOf(c)}</span></div>`;
    }

    elChatHeader.innerHTML = `
      <div class="icon-btn-group">
          <button class="icon-btn" id="backBtn">←</button>
      </div>
      <div class="header-details">
          <div class="avatar-container chat-header">
              ${chatAvatarContent}
              <span class="online-dot ${onlineStatusClass}"></span>
          </div>
          <div class="header-text">
              <div class="name-row">
                  <h2 id="chatName"></h2>
              </div>
              <p class="xame-id" id="contactIdDisplay"></p>
              <span id="chatSub"></span>
              <span id="typing" class="typing hidden">typing…</span>
          </div>
      </div>
      <div class="toolbar">
          <div class="menu" id="chatMoreMenu">
              <button class="icon-btn" id="chatMoreBtn" aria-haspopup="menu" aria-expanded="false" title="More options">
                  ⋮
              </button>
          </div>
      </div>
    `;

    $('#chatName').textContent = c.name;
    $('#chatSub').textContent = c.online ? 'Online' : 'Offline';
    $('#contactIdDisplay').textContent = c.id;
    
    $('#backBtn').addEventListener('click', () => {
        show(elContacts);
        renderContacts();
    });
    
    $('#chatMoreBtn').addEventListener('click', renderChatMoreMenu);

    show(elChat);
    renderMessages();
    
    // CRITICAL FIX: Force composer visible with inline styles
    if (composer) {
        console.log('Composer element found, forcing visibility');
        composer.classList.remove('hidden');
        composer.style.display = 'flex';
        composer.style.visibility = 'visible';
        composer.style.opacity = '1';
        composer.style.position = 'relative';
        composer.style.bottom = '0';
    } else {
        console.error('Composer element not found!');
    }
    
    if (voiceNoteControl) voiceNoteControl.classList.add('hidden');
    if (messageInput) messageInput.classList.remove('hidden');
    if (attachBtn) attachBtn.classList.remove('hidden');
    if (micBtn) micBtn.classList.remove('hidden');
    
    const draft = DRAFTS[id] || '';
    messageInput.value = draft;
    messageInput.focus();
    updateComposerButtons();
  
    if (socket) {
        const unseenMessageIds = getChat(id)
            .filter(m => m.type === 'received' && m.status !== 'seen')
            .map(m => m.id);

        if (unseenMessageIds.length > 0) {
            socket.emit('message-seen', { recipientId: ACTIVE_ID, messageIds: unseenMessageIds });
        }
    }
    markAllSeen(id);
}



/*
// PART 6: Chat More Menu & Contact Management
*/

function renderChatMoreMenu() {
    const wrap = document.createElement('div');
    wrap.className = 'menu-panel dialog-like';
    wrap.innerHTML = `
        <div class="menu-item" id="voiceCallBtn">📞 Voice Call</div>
        <div class="menu-item" id="videoCallBtn">📹 Video Call</div>
        <div class="menu-item" id="editContactBtn">✍️ Edit Contact Name</div>
        <div class="menu-item" id="clearChatBtn">🗑 Clear Chat</div>
        <div class="menu-item" id="deleteContactBtn">❌ Delete Contact</div>
    `;

    const chatMoreBtn = $('#chatMoreBtn');
    const rect = chatMoreBtn.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = rect.bottom + 5;
    let right = viewportWidth - rect.right;

    layer.appendChild(wrap);
    const menuRect = wrap.getBoundingClientRect();

    if (top + menuRect.height > viewportHeight) {
      top = rect.top - menuRect.height - 5;
    }

    if (right + menuRect.width > viewportWidth) {
      right = 5;
    }
    
    wrap.style.top = `${top}px`;
    wrap.style.right = `${right}px`;

    wrap.querySelector('#voiceCallBtn').addEventListener('click', () => {
        startCall(ACTIVE_ID, 'voice');
        closeDialog();
    });
    wrap.querySelector('#videoCallBtn').addEventListener('click', () => {
        startCall(ACTIVE_ID, 'video');
        closeDialog();
    });

    wrap.querySelector('#editContactBtn').addEventListener('click', () => {
        if (!ACTIVE_ID) return;
        const c = CONTACTS.find(x => x.id === ACTIVE_ID);
        if (c && ACTIVE_ID !== USER.xameId) {
            closeDialog();
            openDialog(renderEditContactDialog(c));
        } else {
            alert('Cannot edit this contact.');
        }
    });
    
    wrap.querySelector('#clearChatBtn').addEventListener('click', () => {
        if (!ACTIVE_ID) return;
        if (confirm('This icon is meant for clear all chat messages: Are you sure you want to clear messages in this chat?')) { 
            setChat(ACTIVE_ID, []);
            const c = CONTACTS.find(x => x.id === ACTIVE_ID);
            if(c) {
                c.lastInteractionTs = now();
                c.lastInteractionPreview = 'Chat cleared.';
                storage.set(KEYS.contacts, CONTACTS);
            }
            renderMessages();
            closeDialog();
        }
    });

    wrap.querySelector('#deleteContactBtn').addEventListener('click', () => {
        const id = ACTIVE_ID;
        if (!id) return;
        const c = CONTACTS.find(x => x.id === id);
        if (!c) return;
        if (id === USER.xameId) return alert('Cannot delete the self chat.');
        
        if (confirm(`Permanently delete contact "${c.name || id}" and ALL chat/call history? This cannot be undone.`)) {
            deleteContact(id); 
            closeDialog();
        }
    });

    openMenuDialog(wrap);
}

async function deleteContact(contactId) {
    if (!contactId || contactId === USER.xameId) {
        return showNotification('Invalid contact ID or cannot delete self chat.');
    }
    
    showNotification(`Permanently deleting contact ${contactId} and all chat history...`);

    const deleteBtn = document.querySelector('#deleteContactBtn');
    if (deleteBtn) deleteBtn.disabled = true;

    try {
        const response = await fetch(`${serverURL}/api/delete-chat-and-contact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: USER.xameId, 
                contactId: contactId
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            CONTACTS = CONTACTS.filter(c => c.id !== contactId);
            storage.set(KEYS.contacts, CONTACTS); 

            delete CHAT_HISTORY[contactId];
            storage.set(KEYS.chat(contactId), []);
            
            openChat(USER.xameId); 
            
            renderContacts(searchInput.value); 
            
            showNotification('Contact and chat history permanently deleted.');

        } else {
            showNotification(data.message || 'Failed to delete contact and chat history.');
        }

    } catch (err) {
        console.error('Permanent deletion fetch error:', err);
        showNotification('Network error during permanent deletion. Please check your connection.');
    } finally {
        if (deleteBtn) deleteBtn.disabled = false;
    }
}

function clearAllChats() {
    if (confirm('This icon is meant for clear all chat messages: Are you sure you want to clear ALL messages from ALL chats? This action cannot be undone.')) {
        
        let contacts = storage.get(KEYS.contacts, []);
        
        contacts.forEach(c => {
            storage.set(KEYS.chat(c.id), []);
            
            if (c.id !== USER.xameId) {
                c.lastInteractionTs = now();
                c.lastInteractionPreview = 'All messages cleared.';
            }
            c.unreadCount = 0;
            
            if (DRAFTS[c.id]) {
                delete DRAFTS[c.id];
            }
        });
        
        storage.set(KEYS.contacts, contacts);
        storage.set(KEYS.drafts, DRAFTS);
        
        if (ACTIVE_ID) {
            renderMessages();
            messageInput.value = DRAFTS[ACTIVE_ID] || '';
            updateComposerButtons();
        }
        renderContacts(searchInput.value);
        
        showNotification('All chats have been cleared!');
    }
}

function renderEditContactDialog(contact) {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.innerHTML = `
      <div class="dialog fade-in">
        <h3>Edit Contact Name</h3>
        <div class="row" style="margin:8px 0 16px;">
          <input id="editContactNameInput" class="input" placeholder="Enter a new name" value="${escapeHtml(contact.name)}" maxlength="60" />
        </div>
        <div class="row">
          <button class="btn" id="saveEditBtn">Save</button>
          <button class="btn secondary" id="cancelEditBtn">Cancel</button>
        </div>
        <div id="editContactFeedback" class="feedback-message"></div>
      </div>
    `;

    const nameInput = wrap.querySelector('#editContactNameInput');
    const saveBtn = wrap.querySelector('#saveEditBtn');
    const cancelBtn = wrap.querySelector('#cancelEditBtn');
    const feedbackEl = wrap.querySelector('#editContactFeedback');

    cancelBtn.addEventListener('click', () => closeDialog());

    saveBtn.addEventListener('click', async () => {
    const newName = nameInput.value.trim();
    if (!newName) {
        showNotification('Please enter a name.');
        return;
    }

    saveBtn.disabled = true;
    feedbackEl.textContent = 'Saving...';
    
    try {
        const response = await fetch(`${serverURL}/api/update-contact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: USER.xameId, 
                contactId: contact.id,
                newName: newName
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            const contactToUpdate = CONTACTS.find(c => c.id === contact.id);
            if (contactToUpdate) {
                contactToUpdate.name = data.updatedName; 
                storage.set(KEYS.contacts, CONTACTS);
                
                renderContacts(searchInput.value);
                openChat(contactToUpdate.id);
                
                closeDialog();
                showNotification('Contact name updated successfully!');
            }
        } else {
            feedbackEl.textContent = data.message || `Save failed: ${response.statusText}.`;
        }

    } catch (err) {
        console.error('Update contact name fetch error:', err);
        feedbackEl.textContent = 'Network error. Please try again.';
    } finally {
        saveBtn.disabled = false;
    }
});

return wrap;
}

/*
// PART 7: 
//Enhanced Message Bubble with Waveform
*/

function messageBubble(m) {
  const div = document.createElement('div');
  div.className = `bubble ${m.type}`;
  if (m.type === 'sent' && m.status === 'seen') {
      div.classList.add('seen');
  }
  
  div.dataset.id = m.id;
  
  if (selectedMessages.includes(m.id)) {
      div.classList.add('selected');
  }

  // Selection mode click handler
  div.addEventListener('click', (e) => {
      if (selectedMessages.length > 0) { 
          e.preventDefault();
          e.stopPropagation(); 
          toggleMessageSelection(m);
      }
  });

  // Long-press detection
  let pressTimer;
  let hasMoved = false;
  const LONG_PRESS_DELAY = 500;
  const MOVE_THRESHOLD = 10;

  const longPressAction = () => {
      if (!hasMoved) {
          div.style.transform = 'scale(0.98)';
          setTimeout(() => {
              div.style.transform = '';
          }, 100);
          
          if (selectedMessages.length === 0) {
              enterSelectMode();
          }
          toggleMessageSelection(m);
      }
  }
  
  let startX = 0, startY = 0;
  
  const startTimer = (e) => {
      clearTimeout(pressTimer);
      hasMoved = false;
      
      if (e.type === 'mousedown' && e.button !== 0) {
          return;
      }
      
      if (e.type === 'touchstart') {
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
      } else {
          startX = e.clientX;
          startY = e.clientY;
      }
      
      pressTimer = setTimeout(longPressAction, LONG_PRESS_DELAY); 
  };
  
  const checkMove = (e) => {
      let currentX, currentY;
      
      if (e.type === 'touchmove') {
          currentX = e.touches[0].clientX;
          currentY = e.touches[0].clientY;
      } else {
          currentX = e.clientX;
          currentY = e.clientY;
      }
      
      const deltaX = Math.abs(currentX - startX);
      const deltaY = Math.abs(currentY - startY);
      
      if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
          hasMoved = true;
          clearTimeout(pressTimer);
      }
  };
  
  const clearTimer = () => {
      clearTimeout(pressTimer);
  };
  
  div.addEventListener('mousedown', startTimer);
  div.addEventListener('mousemove', checkMove);
  div.addEventListener('mouseup', clearTimer);
  div.addEventListener('mouseleave', clearTimer); 
  
  div.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
          startTimer(e);
      }
  }, { passive: true }); 
  
  div.addEventListener('touchmove', checkMove, { passive: true });
  div.addEventListener('touchend', clearTimer);
  div.addEventListener('touchcancel', clearTimer);

  div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
  });
  
  // TEXT MESSAGE RENDERING
  if (m.text) {
      div.innerHTML = `
          <div>${escapeHtml(m.text)}</div>
          <div class="time-row">
              <button class="icon-btn speak-btn">🔊</button>
              <span>${fmtTime(m.ts)}</span>
              ${m.type === 'sent' ? `<span class="ticks">${renderTicks(m.status)}</span>` : ''}
          </div>
      `;
      const speakBtn = div.querySelector('.speak-btn');
      if (speakBtn) {
          speakBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              textToVoice(m.text);
          });
      }

  } else if (m.file && m.file.url) {
      // FILE MESSAGE RENDERING
      let fileContent = '';
      
      // FIX: Construct proper file URL
      let fileUrl = m.file.url;
      if (!fileUrl.startsWith('http')) {
          fileUrl = fileUrl.startsWith('/') ? `${serverURL}${fileUrl}` : `${serverURL}/${fileUrl}`;
      }
      
      // DIAGNOSTIC: Now fileUrl exists
      console.log('🔗 File URL:', {
          original: m.file.url,
          constructed: fileUrl
      });
      
      const fileType = m.file.type;
      const fileName = m.file.name || 'file';
      
      // IMAGE HANDLING
      if (fileType.startsWith('image/')) {
          fileContent = `
              <div class="image-preview" data-url="${fileUrl}">
                  <img src="${fileUrl}" alt="${escapeHtml(fileName)}" loading="lazy">
                  <div class="image-overlay">
                      <button class="view-fullscreen-btn">🔍 View</button>
                  </div>
              </div>
          `;
      } 
      // VIDEO HANDLING
      else if (fileType.startsWith('video/')) {
          fileContent = `
              <div class="video-preview">
                  <video src="${fileUrl}" controls preload="metadata">
                      Your browser does not support video playback.
                  </video>
                  <div class="file-info">
                      <span class="file-name">${escapeHtml(fileName)}</span>
                  </div>
              </div>
          `;
      } 
      // AUDIO HANDLING WITH WAVEFORM
      else if (fileType.startsWith('audio/')) {
          const audioId = `audio-${m.id}`;
          fileContent = `
              <div class="audio-message-container">
                  <audio id="${audioId}" src="${fileUrl}" preload="metadata"></audio>
                  <div class="waveform-container" id="waveform-container-${m.id}">
                      <div class="waveform-loading">Loading waveform...</div>
                  </div>
                  <div class="audio-controls">
                      <button class="audio-play-btn" data-audio-id="${audioId}">▶️</button>
                      <span class="audio-time">0:00</span>
                      <a href="${fileUrl}" download="${fileName}" class="download-btn" title="Download">⬇️</a>
                  </div>
              </div>
          `;
      } 
      // DOCUMENT HANDLING
      else {
          const fileIcon = getFileIcon(fileType, fileName);
          fileContent = `
              <a href="${fileUrl}" target="_blank" download="${fileName}" class="document-preview">
                  <div class="doc-icon">${fileIcon}</div>
                  <div class="doc-details">
                      <span class="doc-name">${escapeHtml(fileName)}</span>
                      <span class="doc-type">${fileType.split('/')[1]?.toUpperCase() || 'FILE'}</span>
                  </div>
                  <button class="doc-download-btn" title="Download">⬇️</button>
              </a>
          `;
      }

      div.innerHTML = `
          <div class="file-message">
              ${fileContent}
          </div>
          <div class="time-row">
              <span>${fmtTime(m.ts)}</span>
              ${m.type === 'sent' ? `<span class="ticks">${renderTicks(m.status)}</span>` : ''}
          </div>
      `;

      // POST-RENDER HANDLERS
      
      // Image fullscreen viewer
      const imagePreview = div.querySelector('.image-preview');
      if (imagePreview) {
          imagePreview.addEventListener('click', (e) => {
              if (selectedMessages.length > 0) return;
              e.stopPropagation();
              openImageFullscreen(fileUrl, fileName);
          });
      }

      // Audio waveform initialization
      if (fileType.startsWith('audio/')) {
          const audioElement = div.querySelector(`#audio-${m.id}`);
          const waveformContainer = div.querySelector(`#waveform-container-${m.id}`);
          const playBtn = div.querySelector('.audio-play-btn');
          const timeDisplay = div.querySelector('.audio-time');
          
          if (audioElement && waveformContainer && typeof WaveSurfer !== 'undefined') {
              waveformContainer.innerHTML = '';
              
              const waveformDiv = document.createElement('div');
              waveformDiv.className = 'waveform';
              waveformContainer.appendChild(waveformDiv);
              
              try {
                  const wavesurfer = WaveSurfer.create({
                      container: waveformDiv,
                      waveColor: m.type === 'sent' ? 'rgba(255,255,255,0.5)' : '#9aa8b2',
                      progressColor: m.type === 'sent' ? '#fff' : '#0084ff',
                      cursorColor: 'transparent',
                      barWidth: 2,
                      barRadius: 3,
                      height: 50,
                      barGap: 2,
                      responsive: true,
                      interact: true
                  });

                  wavesurfer.load(fileUrl);
                  
                  wavesurfer.on('ready', () => {
                      const duration = wavesurfer.getDuration();
                      timeDisplay.textContent = formatDuration(duration);
                  });

                  wavesurfer.on('audioprocess', () => {
                      const currentTime = wavesurfer.getCurrentTime();
                      timeDisplay.textContent = formatDuration(currentTime);
                  });

                  wavesurfer.on('finish', () => {
                      playBtn.textContent = '▶️';
                  });

                  playBtn.addEventListener('click', (e) => {
                      e.stopPropagation();
                      if (wavesurfer.isPlaying()) {
                          wavesurfer.pause();
                          playBtn.textContent = '▶️';
                      } else {
                          wavesurfer.play();
                          playBtn.textContent = '⏸️';
                      }
                  });

                  div.wavesurfer = wavesurfer;
                  
              } catch (error) {
                  console.error('Failed to create waveform:', error);
                  waveformContainer.innerHTML = '<div class="waveform-error">Waveform unavailable</div>';
              }
          }
      }
  } else {
    // ERROR STATE
    div.innerHTML = `
          <div class="file-message">
              <span class="file-icon">⚠️</span>
              <span class="file-name">File not available.</span>
          </div>
          <div class="time-row">
              <span>${fmtTime(m.ts)}</span>
              ${m.type === 'sent' ? `<span class="ticks">${renderTicks(m.status)}</span>` : ''}
          </div>
    `;
  }
  
  return div;
}

// PART 8:
// Message Selection & Management

function toggleMessageSelection(message) {
    const id = message.id;
    const index = selectedMessages.indexOf(id);
    const element = messagesEl.querySelector(`.bubble[data-id="${id}"]`);

    if (index > -1) {
        selectedMessages.splice(index, 1);
        element?.classList.remove('selected');
        
        if (selectedMessages.length === 0) {
            exitSelectMode();
        }
    } else {
        selectedMessages.push(id);
        element?.classList.add('selected');
        
        if (selectedMessages.length === 1 && !elChatHeader.querySelector('.selection-toolbar-wrapper')) {
            enterSelectMode();
        }
    }
    updateSelectCounter();
}

function renderDeleteMenu() {
    const count = selectedMessages.length;
    if (count === 0) return;
    
    const currentChat = getChat(ACTIVE_ID);
    const hasSentMessages = selectedMessages.some(id => 
        currentChat.find(m => m.id === id)?.type === 'sent'
    );
    
    const options = [{
        label: `Copy ${count} message${count === 1 ? '' : 's'}`,
        icon: '⎘',
        action: () => {
            copyMessages(selectedMessages);
            exitSelectMode();
            closeDialog();
        }
    }, {
        label: `Forward ${count} message${count === 1 ? '' : 's'}`,
        icon: '⇥',
        action: () => {
            forwardMessages(selectedMessages);
            exitSelectMode();
            closeDialog();
        }
    }, {
        label: `Delete for me (${count})`,
        icon: '🗑',
        action: () => {
            if (confirm(`Are you sure you want to delete ${count} message${count === 1 ? '' : 's'} for yourself?`)) { 
                deleteMessages(selectedMessages, false);
                closeDialog();
            }
        }
    }];
    
    if (hasSentMessages) {
        options.push({
            label: `Delete for everyone (${count})`,
            icon: '💥',
            action: () => {
                if (confirm(`Are you sure you want to delete ${count} message${count === 1 ? '' : 's'} for everyone?`)) { 
                    deleteMessages(selectedMessages, true);
                    closeDialog();
                }
            }
        });
    }

    const wrap = document.createElement('div');
    wrap.className = 'menu-panel dialog-like';
    wrap.style.minWidth = '250px';
    wrap.style.padding = '5px 0';
    
    const deleteBtnRect = elChatHeader.querySelector('#deleteSelectedBtn').getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = deleteBtnRect.bottom + 5;
    let right = viewportWidth - deleteBtnRect.right;

    layer.appendChild(wrap);
    const menuRect = wrap.getBoundingClientRect();

    if (top + menuRect.height > viewportHeight) {
      top = deleteBtnRect.top - menuRect.height - 5;
    }
    if (right + menuRect.width > viewportWidth) {
      right = 5;
    }
    
    wrap.style.top = `${top}px`;
    wrap.style.right = `${right}px`;
    
    options.forEach(opt => {
        const item = document.createElement('div');
        item.className = 'menu-item';
        item.style.fontWeight = 'bold';
        item.innerHTML = `<span style="margin-right: 10px;">${opt.icon}</span> ${opt.label}`;
        item.addEventListener('click', opt.action);
        wrap.appendChild(item);
    });

    openMenuDialog(wrap);
}

function renderTicks(status) {
    if (status === 'seen') {
        return '<span class="tick-seen">✓✓</span>';
    } else if (status === 'delivered') {
        return '<span class="tick-delivered">✓✓</span>';
    } else {
        return '<span class="tick-sent">✓</span>';
    }
}

function renderMessages() {
  messagesEl.innerHTML = '';
  const msgs = getChat(ACTIVE_ID);
  
  let lastDay = '';
  msgs.forEach(m => {
    const label = dayLabel(m.ts);
    if (label !== lastDay) {
      const sep = document.createElement('div');
      sep.className = 'h-sub';
      sep.style.textAlign = 'center';
      sep.style.margin = '8px 0';
      sep.textContent = label;
      messagesEl.appendChild(sep);
      lastDay = label;
    }
    const bubble = messageBubble(m);
    messagesEl.appendChild(bubble);
  });
  
  scrollToBottom();
}

function enterSelectMode() {
    const toolbarHtml = `
        <div class="selection-toolbar-wrapper">
            <button class="icon-btn" id="exitSelectModeBtn" title="Exit selection mode">←</button>
            <div class="counter">${selectedMessages.length} selected</div> 
            <div class="toolbar">
                <button class="icon-btn" id="copySelectedBtn" title="Copy messages">⎘</button>
                <button class="icon-btn" id="forwardSelectedBtn" title="Forward messages">⇥</button>
                <button class="icon-btn" id="deleteSelectedBtn" title="Delete messages">🗑</button>
            </div>
        </div>
    `;

    elChatHeader.insertAdjacentHTML('beforeend', toolbarHtml);

    const originalHeaderDetails = elChatHeader.querySelector('.header-details');
    const originalToolbar = elChatHeader.querySelector('.toolbar:not(.selection-toolbar-wrapper .toolbar)'); 
    const originalButtonGroup = elChatHeader.querySelector('.icon-btn-group'); 
    
    if (originalHeaderDetails) originalHeaderDetails.classList.add('hidden');
    if (originalToolbar) originalToolbar.classList.add('hidden');
    if (originalButtonGroup) originalButtonGroup.classList.add('hidden'); 

    const selectionToolbarWrapper = elChatHeader.querySelector('.selection-toolbar-wrapper');
    const newExitBtn = selectionToolbarWrapper.querySelector('#exitSelectModeBtn');
    const newDeleteBtn = selectionToolbarWrapper.querySelector('#deleteSelectedBtn');
    const newCopyBtn = selectionToolbarWrapper.querySelector('#copySelectedBtn');
    const newForwardBtn = selectionToolbarWrapper.querySelector('#forwardSelectedBtn');
    
    newExitBtn.addEventListener('click', exitSelectMode);
    newDeleteBtn.addEventListener('click', renderDeleteMenu);
    
    newCopyBtn.addEventListener('click', () => {
        copyMessages(selectedMessages);
        exitSelectMode();
    });

    newForwardBtn.addEventListener('click', () => {
        forwardMessages(selectedMessages);
        exitSelectMode();
    });
}

function exitSelectMode() {
    selectedMessages = [];
    
    elChatHeader.querySelector('.selection-toolbar-wrapper')?.remove();

    const originalHeaderDetails = elChatHeader.querySelector('.header-details');
    const originalToolbar = elChatHeader.querySelector('.toolbar:not(.selection-toolbar-wrapper .toolbar)');
    const originalButtonGroup = elChatHeader.querySelector('.icon-btn-group');
    
    if (originalHeaderDetails) originalHeaderDetails.classList.remove('hidden');
    if (originalToolbar) originalToolbar.classList.remove('hidden');
    if (originalButtonGroup) originalButtonGroup.classList.remove('hidden');
    
    renderMessages();
}

function updateSelectCounter() {
    const count = selectedMessages.length;
    const counterEl = elChatHeader.querySelector('.selection-toolbar-wrapper .counter');
    if (counterEl) {
        counterEl.textContent = `${count} selected`; 
    }
}

async function deleteMessages(messageIds, deleteForEveryone = false) {
    if (!ACTIVE_ID || messageIds.length === 0) return;
    
    showNotification('Deleting messages...');
    
    const syncNeeded = deleteForEveryone;
    let deletionSucceeded = !syncNeeded;

    if (syncNeeded) {
        deletionSucceeded = await syncDeletionsWithServer({
            chat: { 
                contactId: ACTIVE_ID, 
                messageIds: messageIds,
                deleteForEveryone: deleteForEveryone
            }
        });
    }

    if (deletionSucceeded || deleteForEveryone === false) { 
        const currentChat = getChat(ACTIVE_ID);
        const updatedChat = currentChat.filter(m => !messageIds.includes(m.id));
        setChat(ACTIVE_ID, updatedChat);
        
        exitSelectMode(); 
        
        showNotification(`${messageIds.length} message(s) deleted.`);
    } else {
        showNotification('Deletion failed to sync with server. Retrying...');
    }
}

function copyMessages(messageIds) {
    const chat = getChat(ACTIVE_ID);
    const messagesToCopy = chat
        .filter(m => messageIds.includes(m.id))
        .map(m => m.text);
    
    if (messagesToCopy.length > 0) {
        const textToCopy = messagesToCopy.join('\n\n');
        navigator.clipboard.writeText(textToCopy).then(() => {
            alert('Messages copied!');
        }).catch(err => {
            console.error('Failed to copy messages:', err);
            alert('Failed to copy messages.');
        });
    }
}

function forwardMessages(messageIds) {
    const chat = getChat(ACTIVE_ID);
    const messagesToForward = chat.filter(m => messageIds.includes(m.id));
    const messageCount = messagesToForward.length;
    
    if (messageCount > 0) {
        alert(`Ready to forward ${messageCount} message${messageCount === 1 ? '' : 's'}.`);
    }
}

/*
// Part 9:
// Unfixed
*/

addContactBtn?.addEventListener('click', () => {
  openDialog(renderAddContactDialog());
});

function renderAddContactDialog() {
  const wrap = document.createElement('div');
  wrap.className = 'dialog-backdrop';
  wrap.innerHTML = `
    <div class="dialog fade-in">
      <h3>Add a new contact</h3>
      <div class="row" style="margin:8px 0 16px;">
        <input id="newContactId" class="input" placeholder="Enter Xame-ID" maxlength="60" />
      </div>
      <div class="row" style="margin-bottom:16px;">
        <input id="newContactName" class="input" placeholder="Enter a name for them (e.g., Jane Doe)" maxlength="60" />
      </div>
      <div class="row">
        <button class="btn" id="saveContact">Save</button>
        <button class="btn secondary" id="cancelContact">Cancel</button>
      </div>
      <div id="feedbackMessage" class="feedback-message"></div>
    </div>`;

  const saveBtn = wrap.querySelector('#saveContact');
  const cancelBtn = wrap.querySelector('#cancelContact');
  const idInput = wrap.querySelector('#newContactId');
  const nameInput = wrap.querySelector('#newContactName');
  const feedbackMessage = wrap.querySelector('#feedbackMessage');

  cancelBtn.addEventListener('click', () => closeDialog());

  saveBtn.addEventListener('click', async () => {
    const contactId = idInput.value.trim();
    const customName = nameInput.value.trim();

    if (!contactId) {
      feedbackMessage.textContent = 'Please enter a Xame-ID.';
      return;
    }
    if (contactId === USER.xameId) {
      feedbackMessage.textContent = 'You cannot add yourself as a contact.';
      return;
    }
    
    if (CONTACTS.some(c => c.id === contactId)) {
      feedbackMessage.textContent = 'This Xame-ID is already in your contacts.';
      return;
    }

    try {
      feedbackMessage.textContent = 'Adding contact...';
      saveBtn.disabled = true;

      const response = await fetch(`${serverURL}/api/add-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER.xameId,
          contactId: contactId,
          customName: customName
        })
      });

      const data = await response.json();

      if (data.success) {
        const contact = {
          id: contactId,
          name: data.contact.name,
          profilePic: data.contact.profilePic,
          status: 'Message a friend',
          createdAt: now(),
          lastAt: now(),
          lastInteractionTs: now(),
          lastInteractionPreview: 'Message a friend',
          online: data.contact.isOnline || false,
          isProfilePicHidden: data.contact.isProfilePicHidden || false,
          unreadCount: 0
        };
        
        CONTACTS.push(contact);
        storage.set(KEYS.contacts, CONTACTS);
        closeDialog();
        renderContacts(searchInput.value);
        openChat(contactId);
        
        alert('Contact added successfully!');
      } else {
        feedbackMessage.textContent = data.message || 'Failed to add contact. Try again.';
      }

    } catch (err) {
      console.error('Add contact fetch error:', err);
      feedbackMessage.textContent = 'Network error. Please try again.';
    } finally {
      saveBtn.disabled = false;
    }
  });
  
  return wrap;
}

moreBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = moreBtn.getAttribute('aria-expanded') === 'true';
  if (open) {
    closeMenu();
    return;
  }
  openMenu();
});

function openMenu() {
  moreBtn.setAttribute('aria-expanded', 'true');
  const panel = document.createElement('div');
  panel.className = 'menu-panel fade-in';
  panel.innerHTML = `
    <div class="menu-item" id="exportData">Export chats (JSON)</div>
    <div class="menu-item" id="importData">Import chats (JSON)</div>
    <div class="menu-item" id="resetAll">Reset app</div>
  `;
  moreMenu?.appendChild(panel);
  panel.querySelector('#exportData')?.addEventListener('click', exportData);
  panel.querySelector('#importData')?.addEventListener('click', importDataDialog);
  panel.querySelector('#resetAll')?.addEventListener('click', () => {
      if (confirm('This will erase all contacts and chats. Proceed?')) {
          resetAll();
      }
  });
  document.addEventListener('click', onAway, {
    once: true
  });

  function onAway(ev) {
    if (!moreMenu.contains(ev.target)) closeMenu();
  }
}

function closeMenu() {
  moreBtn.setAttribute('aria-expanded', 'false');
  const p = moreMenu?.querySelector('.menu-panel');
  if (p) p.remove();
}

function exportData() {
  const data = {
    user: storage.get(KEYS.user),
    contacts: storage.get(KEYS.contacts, []),
    drafts: storage.get(KEYS.drafts, {}),
    chats: Object.fromEntries(storage.get(KEYS.contacts, []).map(c => [c.id, storage.get(KEYS.chat(c.id), [])]))
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'xamepage-export.json';
  a.click();
  URL.revokeObjectURL(url);
  closeMenu();
}

function importDataDialog() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== 'object') throw new Error('Invalid file');
        if (Array.isArray(data.contacts)) storage.set(KEYS.contacts, data.contacts);
        if (data.user) storage.set(KEYS.user, data.user);
        if (data.drafts) storage.set(KEYS.drafts, data.drafts);
        if (data.chats && typeof data.chats === 'object') {
          Object.entries(data.chats).forEach(([id, arr]) => storage.set(KEYS.chat(id), arr || []));
        }
        USER = storage.get(KEYS.user);
        CONTACTS = storage.get(KEYS.contacts, []);
        DRAFTS = storage.get(KEYS.drafts, {});
        renderContacts();
        alert('Import complete.');
      } catch (err) {
        alert('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  });
  input.click();
  closeMenu();
}

function resetAll() {
  Object.keys(localStorage).filter(k => k.startsWith('xame:')).forEach(k => localStorage.removeItem(k));
  USER = null;
  CONTACTS = ensureSeedContacts();
  DRAFTS = {};
  ACTIVE_ID = null;
  show(elLanding);
  firstNameInput?.focus();
  closeMenu();
}

function initialsOf(user) {
  if (!user) return 'U';
  const f = (user.firstName || '').trim();
  const l = (user.lastName || '').trim();
  const n = (user.name || '').trim();
  let a = '';
  if (f) a += f[0];
  if (l) a += l[0];
  if (!a && n) {
    const parts = n.split(/\s+/);
    if (parts[0]) a += parts[0][0];
    if (parts[1]) a += parts[1][0];
  }
  a = a.toUpperCase().slice(0, 2);
  return a || 'U';
}

function setAvatarInitials() {
  if (avatarInitialsEl) avatarInitialsEl.textContent = initialsOf(window.USER);
  if (myStatusAvatarInitials) myStatusAvatarInitials.textContent = initialsOf(window.USER);
  if (xameIdDisplay) {
    xameIdDisplay.textContent = window.USER?.xameId || '';
  }
}

avatarBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = avatarBtn.getAttribute('aria-expanded') === 'true';
  if (open) {
    closeAccountMenu();
    return;
  }
  openAccountMenu();
});

function openAccountMenu() {
  avatarBtn.setAttribute('aria-expanded', 'true');
  const panel = document.createElement('div');
  panel.className = 'menu-panel fade-in';
  panel.innerHTML = `
    <div class="menu-item" id="accountProfile">Profile</div>
    <div class="menu-item" id="accountSettings">Settings</div>
    <div class="menu-item" id="accountThemes">Themes</div>
  `;
  accountMenu?.appendChild(panel);
  panel.querySelector('#accountProfile')?.addEventListener('click', () => {
    closeAccountMenu();
    show(elProfile);
    loadProfileData();
  });
  panel.querySelector('#accountSettings')?.addEventListener('click', () => {
    closeAccountMenu();
    alert('Settings coming soon');
  });
  panel.querySelector('#accountThemes')?.addEventListener('click', () => {
    closeAccountMenu();
    alert('Themes coming soon');
  });

  const onAway = (ev) => {
    if (!accountMenu.contains(ev.target)) closeAccountMenu();
  };
  setTimeout(() => document.addEventListener('click', onAway, {
    once: true
  }));
}

function closeAccountMenu() {
  avatarBtn.setAttribute('aria-expanded', 'false');
  const p = accountMenu?.querySelector('.menu-panel');
  if (p) p.remove();
}
//////////////////////////////////////////////////////


//////////////////////////////////////////////////////

function loadProfileData() {
  preferredNameInput.value = USER.preferredName || '';
  
  const profilePicUrl = USER.profilePic 
                        ? (USER.profilePic.includes('?ts=') ? USER.profilePic : `${USER.profilePic}?ts=${new Date().getTime()}`)
                        : `${serverURL}/media/profile_pics/default.png`;
                        
  profilePicPreview.src = profilePicUrl;
  
  if (xameIdDisplay) {
    xameIdDisplay.textContent = USER.xameId;
  }
  if (hideNameCheckbox) {
      hideNameCheckbox.checked = USER.privacySettings?.hidePreferredName || false; 
  }
  if (hidePicCheckbox) {
      hidePicCheckbox.checked = USER.privacySettings?.hideProfilePicture || false;
  }
}

profileBackBtn?.addEventListener('click', () => {
    show(elContacts);
    renderContacts();
});

profilePicInput?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    cropImage.src = reader.result;
    openCropModal();
  };
  reader.readAsDataURL(file);
});

let isRemoveProfilePicClicked = false;

removeProfilePicBtn?.addEventListener("click", () => {
  isRemoveProfilePicClicked = true;
});


saveProfileBtn?.addEventListener("click", async () => {
    const preferredName = preferredNameInput.value.trim();
    const hideName = hideNameCheckbox?.checked || false;
    const hidePic = hidePicCheckbox?.checked || false;
    
    if (preferredName.length < 2) {
        alert("Preferred name must be at least 2 characters.");
        return;
    }
    
    saveProfileBtn.textContent = 'Saving...';
    saveProfileBtn.disabled = true;

    try {
        const formData = new FormData();
        formData.append("userId", USER.xameId);
        formData.append("preferredName", preferredName);
        formData.append("hidePreferredName", hideName);
        formData.append("hideProfilePicture", hidePic);

        // --- CONSOLIDATED PROFILE PICTURE LOGIC ---
        const currentPreviewSrc = profilePicPreview.src;
        const isDefaultPic = currentPreviewSrc.includes('default.png');
        
        if (isRemoveProfilePicClicked) {
            // SCENARIO 1: User clicked the 'Remove Profile Pic' button.
            console.log('🗑️ Profile removal requested.');
            formData.append("removeProfilePic", "true");
            isRemoveProfilePicClicked = false; // Reset flag
            closeCropModal(); 
        } 
        // SCENARIO 2: A new image was selected and is currently in the preview, but not yet uploaded.
        // We check if the preview source is a temporary Data URL (base64) from the crop canvas.
        else if (currentPreviewSrc.startsWith('data:image/')) {
            console.log('🖼️ Detecting new image from preview source...');
            
            // Convert the Data URL in the preview back into a Blob for upload.
            const blob = await fetch(currentPreviewSrc).then(res => res.blob());
            
            if (blob.size === 0) {
                throw new Error('Processed image blob is empty.');
            }

            // Append the new profile picture file.
            // Server expects 'profilePic' key.
            formData.append("profilePic", blob, "profile_pic.jpg");
            console.log('✅ New profile pic blob added to FormData.');
            
            // Clean up the temporary Data URL from the preview to prevent re-uploading on subsequent saves
            // We set it to the old URL (or default) temporarily until the server responds with the new official URL
            profilePicPreview.src = USER.profilePic || `${serverURL}/media/profile_pics/default.png`;
        } 
        else if (!isDefaultPic && USER.profilePic === '' && !currentPreviewSrc.startsWith('data:image/')) {
            // SCENARIO 3: User had no pic, but now has one (but maybe didn't use the cropper, or another edge case).
            // We keep this check simple to avoid conflicts.
            console.log('ℹ️ No change to profile picture expected, but check for default state.');
        }
        else {
            // SCENARIO 4: No change to profile picture (neither remove clicked nor new image cropped).
            console.log('ℹ️ No change to profile picture expected.');
        }

        closeCropModal(); // Ensure the modal is closed regardless of the path

        // --- END CONSOLIDATED PROFILE PICTURE LOGIC ---

        // Log FormData contents
        console.log('📤 FormData contents:');
        for (let pair of formData.entries()) {
            if (pair[1] instanceof Blob) {
                console.log(`  ${pair[0]}: [Blob: ${pair[1].size} bytes, Key: ${pair[0]}]`);
            } else {
                console.log(`  ${pair[0]}: ${pair[1]}`);
            }
        }

        console.log('📤 Sending to:', `${serverURL}/api/update-profile`);
        const response = await fetch(`${serverURL}/api/update-profile`, {
            method: 'POST',
            body: formData
        });

        console.log('📥 Response status:', response.status, response.statusText);
        const result = await response.json();
        console.log('📥 Server response:', result);

        if (response.ok && result.success) {
            alert("Profile saved successfully!");
            USER.preferredName = result.preferredName;
            
            USER.privacySettings = {
                hidePreferredName: result.hidePreferredName,
                hideProfilePicture: result.hideProfilePicture
            };
            
            if (result.profilePicUrl) {
                const cleanUrl = result.profilePicUrl.split('?')[0];
                const newUrl = `${cleanUrl}?ts=${new Date().getTime()}`; 
                
                console.log('📸 Server returned profile pic URL:', result.profilePicUrl);
                console.log('📸 Constructed URL with timestamp:', newUrl);
                
                profilePicPreview.src = newUrl;
                profilePicPreview.onerror = function() {
                    console.error('❌ Failed to load new profile picture');
                    this.src = `${serverURL}/media/profile_pics/default.png`;
                    USER.profilePic = '';
                };
                profilePicPreview.onload = function() {
                    console.log('✅ Profile picture loaded successfully');
                };
                
                USER.profilePic = newUrl;
            } else {
                console.log('ℹ️ No profile picture URL in response');
                profilePicPreview.src = `${serverURL}/media/profile_pics/default.png`;
                USER.profilePic = '';
            }

            storage.set(KEYS.user, USER);
            if (hideNameCheckbox) hideNameCheckbox.checked = USER.privacySettings.hidePreferredName;
            if (hidePicCheckbox) hidePicCheckbox.checked = USER.privacySettings.hideProfilePicture;
            
            setAvatarInitials();
            
            const selfContact = CONTACTS.find(c => c.id === USER.xameId);
            if (selfContact) {
                selfContact.profilePic = USER.profilePic;
                storage.set(KEYS.contacts, CONTACTS);
            }
            
            console.log('💾 === PROFILE SAVE COMPLETE ===');
            show(elContacts);
            renderContacts();
        } else {
            console.error('❌ Save failed:', result.message);
            alert("Failed to save profile: " + (result.message || "Unknown error."));
        }
    } catch (err) {
        console.error("❌ Profile save error:", err);
        alert("Error saving profile: " + err.message);
    } finally {
        saveProfileBtn.textContent = 'Save Changes';
        saveProfileBtn.disabled = false;
        closeCropModal();
    }
});


function openCropModal() {
  cropModal?.classList.remove('hidden');
  if (cropper) {
    cropper.destroy();
  }
  cropper = new Cropper(cropImage, {
    aspectRatio: 1,
    viewMode: 1,
    guides: true,
    autoCropArea: 0.8,
  });
}

function closeCropModal() {
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
  cropImage.src = '';
  cropModal?.classList.add('hidden');
}

cropCancelBtn?.addEventListener('click', closeCropModal);
cropSaveBtn?.addEventListener('click', () => {
  if (cropper) {
    const croppedCanvas = cropper.getCroppedCanvas({
      width: 256,
      height: 256,
    });
    const croppedImageURL = croppedCanvas.toDataURL('image/png');
    profilePicPreview.src = croppedImageURL;
    closeCropModal();
  }
});

///////////////////////////////////////////////////////////



//////////////////////////////////////////////////////////


function showStatus() {
    show(elStatus);
    myStatusTime.textContent = 'Last update: ' + fmtTime(now());
}

statusBackBtn?.addEventListener('click', () => {
    show(elContacts);
});

function closeDialog() {
  layer.innerHTML = '';
}

function openDialog(node) {
  layer.innerHTML = '';
  layer.appendChild(node);
  setTimeout(() => {
    document.addEventListener('click', (e) => {
      if (!node.contains(e.target)) {
        closeDialog();
      }
    }, { once: true });
  }, 0);
}

function openMenuDialog(node) {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  backdrop.appendChild(node);
  
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeDialog();
    }
  });
  
  layer.innerHTML = '';
  layer.appendChild(backdrop);
}

function updateComposerButtons() {
  if (messageInput.value.trim().length > 0) {
    micBtn?.classList.add('hidden');
    sendBtn?.classList.remove('hidden');
  } else {
    micBtn?.classList.remove('hidden');
    sendBtn?.classList.add('hidden');
  }
}


/*
//Part 10

// ===== ENHANCED FILE UPLOAD HANDLING =====
*/
if (attachBtn) {
  attachBtn.addEventListener('click', () => {
      if (fileInput) fileInput.click();
  });
}

if (fileInput) {
  fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      console.log('📎 File selected:', {
          name: file.name,
          type: file.type,
          size: file.size
      });
      
      // Validate file
      const validation = validateFile(file);
      if (!validation.valid) {
          alert(validation.error);
          fileInput.value = '';
          return;
      }
      
      if (file.type.startsWith('image/')) {
          const shouldSend = await showImagePreview(file);
          if (shouldSend) {
              sendFile(file);
          } else {
              fileInput.value = '';
          }
      } else {
          sendFile(file);
      }
      
      fileInput.value = '';
  });
}

// FIXED: Complete sendFile function with proper error handling (OBSOLETE XMLHTTPREQUEST VERSION)
function sendFile(file) {
    if (!ACTIVE_ID || !socket) {
        console.error('Cannot send file: No active chat or socket connection');
        showNotification('Cannot send file. Please check your connection.');
        return;
    }
    
    console.log('📤 Starting file upload:', file.name);
    
    const msgId = uid();
    const ts = now();
    
    // Create pending message
    const pendingMsg = {
        id: msgId,
        text: `📎 Uploading ${file.name}...`,
        type: 'sent',
        ts: ts,
        status: 'sending',
        isPending: true
    };

    const chat = getChat(ACTIVE_ID);
    chat.push(pendingMsg);
    setChat(ACTIVE_ID, chat);
    renderMessages();

    // Show upload progress
    const progressDiv = createUploadProgress(msgId, file.name);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('senderId', USER.xameId);
    formData.append('recipientId', ACTIVE_ID);
    formData.append('messageId', msgId);
    
    console.log('📤 Uploading to server...');
    
    // Create XMLHttpRequest for progress tracking
    const xhr = new XMLHttpRequest();
    currentUpload = xhr;
    
    // Track upload progress
    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            updateUploadProgress(msgId, percentComplete);
            console.log(`Upload progress: ${percentComplete.toFixed(1)}%`);
        }
    });
    
    xhr.addEventListener('load', function() {
        removeUploadProgress(msgId);
        
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                console.log('✅ Upload response:', data);
                
                if (data.success && data.url) {
                    const chatToUpdate = getChat(ACTIVE_ID);
                    const msgIndex = chatToUpdate.findIndex(m => m.id === msgId);
                    
                    if (msgIndex !== -1) {
                        const finalMessage = {
                            id: msgId,
                            file: {
                                name: file.name,
                                type: file.type,
                                url: data.url
                            },
                            type: 'sent',
                            ts: ts,
                            status: 'sending'
                        };
                        
                        chatToUpdate[msgIndex] = finalMessage;
                        setChat(ACTIVE_ID, chatToUpdate);
                        renderMessages();

                        console.log('📨 Sending file message via socket...');
                        
                        // Send via socket
                        // NOTE: This event should probably be 'send-message' to match text messages
                        socket.emit('send-message', {
                            recipientId: ACTIVE_ID,
                            message: finalMessage
                        }, (response) => {
                            console.log('Socket response:', response);
                            if (response.success) {
                                chatToUpdate[msgIndex].status = 'delivered';
                                setChat(ACTIVE_ID, chatToUpdate);
                                renderMessages();
                                console.log('✅ File message delivered successfully');
                                showNotification('File sent successfully!');
                            } else {
                                console.error("Socket delivery failed:", response.message);
                                showNotification('File uploaded but delivery failed');
                            }
                        });
                    }
                } else {
                    throw new Error(data.message || 'Upload failed - no URL returned');
                }
            } catch (error) {
                console.error('❌ Failed to parse upload response:', error);
                handleUploadError(msgId, error.message);
            }
        } else {
            console.error('❌ Upload failed with status:', xhr.status);
            handleUploadError(msgId, `Server error: ${xhr.status}`);
        }
        
        currentUpload = null;
    });
    
    xhr.addEventListener('error', function() {
        console.error('❌ Network error during upload');
        removeUploadProgress(msgId);
        handleUploadError(msgId, 'Network error during upload');
        currentUpload = null;
    });
    
    xhr.addEventListener('abort', function() {
        console.log('⚠️ Upload cancelled by user');
        removeUploadProgress(msgId);
        const chatToUpdate = getChat(ACTIVE_ID);
        const msgIndex = chatToUpdate.findIndex(m => m.id === msgId);
        if (msgIndex !== -1) {
            chatToUpdate.splice(msgIndex, 1);
            setChat(ACTIVE_ID, chatToUpdate);
            renderMessages();
        }
        showNotification('Upload cancelled');
        currentUpload = null;
    });
    
    xhr.open('POST', `${serverURL}/api/upload-file`);
    xhr.send(formData);
}

// FIXED: Voice note recording and upload
micBtn?.addEventListener('click', () => {
    console.log('🎙️ Voice note mode activated');
    messageInput?.classList.add('hidden');
    sendBtn?.classList.add('hidden');
    attachBtn?.classList.add('hidden');
    voiceNoteControl?.classList.remove('hidden');
});

function resetVoiceRecorderUI() {
    messageInput?.classList.remove('hidden');
    attachBtn?.classList.remove('hidden');
    voiceNoteControl?.classList.add('hidden');
    recordBtn?.classList.remove('hidden');
    stopRecordBtn?.classList.add('hidden');
    playBtn?.classList.add('hidden');
    sendVoiceBtn?.classList.add('hidden');
    updateComposerButtons();
}

recordBtn?.addEventListener('click', async () => {
    try {
        console.log('🎙️ Starting audio recording...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Use a format that's widely compatible
        let mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported('audio/webm')) {
            mimeType = 'audio/mp4';
            if (!MediaRecorder.isTypeSupported('audio/mp4')) {
                mimeType = ''; // Let browser choose
            }
        }
        
        const options = mimeType ? { mimeType } : {};
        mediaRecorder = new MediaRecorder(stream, options);
        audioChunks = [];
        audioBlob = null;
        
        recordBtn.classList.add('hidden');
        stopRecordBtn.classList.remove('hidden');
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                console.log("📊 Audio data chunk:", event.data.size, "bytes");
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            console.log("⏹️ Recording stopped. Total chunks:", audioChunks.length);
            
            if (audioChunks.length > 0) {
                audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
                console.log("✅ Audio Blob created:", audioBlob.size, "bytes, type:", audioBlob.type);
                
                if (audioBlob.size > 0) {
                    playBtn.classList.remove('hidden');
                    sendVoiceBtn.classList.remove('hidden');
                    stopRecordBtn.classList.add('hidden');
                } else {
                    console.error("❌ Audio Blob is empty");
                    alert("Recording failed. Please try again.");
                    resetVoiceRecorderUI();
                }
            } else {
                console.error("❌ No audio chunks recorded");
                alert("No audio was captured. Please try again.");
                resetVoiceRecorderUI();
            }
            
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        console.log("🔴 Recording started...");

    } catch (err) {
        console.error('❌ Recording failed:', err);
        alert('Could not start recording. Check microphone permissions.');
        resetVoiceRecorderUI();
    }
});

stopRecordBtn?.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log('⏹️ Stopping recording...');
        mediaRecorder.stop();
    }
});

playBtn?.addEventListener('click', () => {
    if (audioBlob) {
        console.log('▶️ Playing recorded audio...');
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();
        audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
        };
    }
});

sendVoiceBtn?.addEventListener('click', () => {
    if (audioBlob && audioBlob.size > 0) {
        console.log('📤 Sending voice note...');
        const timestamp = Date.now();
        const extension = audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
        const audioFile = new File(
            [audioBlob], 
            `voicenote-${timestamp}.${extension}`, 
            { type: audioBlob.type }
        );
        sendFile(audioFile);
        resetVoiceRecorderUI();
        audioBlob = null;
    } else {
        console.error("❌ Cannot send empty audio blob");
        alert("No audio to send. Please record again.");
        resetVoiceRecorderUI();
    }
});

const speechToTextBtn = document.createElement('button');
speechToTextBtn.className = 'icon-btn voice-text-btn';
speechToTextBtn.innerHTML = '🎙';
speechToTextBtn.addEventListener('click', () => {
    if (!('speechSynthesis' in window)) {
        return alert('Your browser does not support Speech Recognition.');
    }
    
    if (speechRecognizer && speechRecognizer.running) {
        speechRecognizer.stop();
        return;
    }
    
    speechRecognizer = new webkitSpeechRecognition();
    speechRecognizer.continuous = false;
    speechRecognizer.interimResults = false;
    speechRecognizer.lang = 'en-US';
    
    speechRecognizer.onstart = () => {
        speechToTextBtn.innerHTML = '🔴';
        if (messageInput) messageInput.placeholder = 'Listening...';
    };
    
    speechRecognizer.onend = () => {
        speechToTextBtn.innerHTML = '🎙';
        if (messageInput) messageInput.placeholder = 'Type a message...';
    };
    
    speechRecognizer.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (messageInput) {
            messageInput.value = transcript;
            messageInput.focus();
        }
    };
    
    speechRecognizer.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        speechToTextBtn.innerHTML = '🎙';
        if (messageInput) messageInput.placeholder = 'Type a message...';
        alert('Error with voice input. Try again.');
    };
    
    speechRecognizer.start();
});
if (composer && messageInput) {
  composer.insertBefore(speechToTextBtn, messageInput.nextSibling);
}

function textToVoice(text) {
    if (!('speechSynthesis' in window)) {
        return alert('Your browser does not support Text-to-Speech.');
    }
    const utterance = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utterance);
}

function scrollToBottom() {
  if (messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function sendMessage(text) {
    if (!ACTIVE_ID || !socket) return;
    
    const msgId = uid();
    const ts = now();
    const newMsg = {
        id: msgId,
        text: text,
        type: 'sent',
        ts: ts,
        status: 'sending'
    };
    
    const chat = getChat(ACTIVE_ID);
    chat.push(newMsg);
    setChat(ACTIVE_ID, chat);
    renderMessages();
    
    socket.emit('send-message', {
        recipientId: ACTIVE_ID,
        message: {
            id: msgId,
            text: text,
            ts: ts
        }
    }, (response) => {
      console.log('Server acknowledged message:', response);
      if (response.success && response.messageId) {
        const chatToUpdate = getChat(ACTIVE_ID);
        const msgIndex = chatToUpdate.findIndex(m => m.id === response.messageId);
        if (msgIndex !== -1) {
          chatToUpdate[msgIndex].status = 'delivered';
          setChat(ACTIVE_ID, chatToUpdate);
          renderMessages();
        }
      } else {
        console.error("Server failed to deliver message:", response.message);
      }
    });
}

function sendFile(file) {
    if (!ACTIVE_ID || !socket) return;
    
    const msgId = uid();
    const ts = now();
    
    const pendingMsg = {
        id: msgId,
        text: 'Uploading file...',
        type: 'sent',
        ts: ts,
        status: 'sending',
        isPending: true
    };

    const chat = getChat(ACTIVE_ID);
    chat.push(pendingMsg);
    setChat(ACTIVE_ID, chat);
    renderMessages();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('senderId', USER.xameId);
    formData.append('recipientId', ACTIVE_ID);
    formData.append('messageId', msgId);
    
    fetch(`${serverURL}/api/upload-file`, {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('File upload failed on the server.');
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            const chatToUpdate = getChat(ACTIVE_ID);
            const msgIndex = chatToUpdate.findIndex(m => m.id === msgId);
            
            if (msgIndex !== -1) {
                const finalMessage = {
                    id: msgId,
                    file: {
                        name: file.name,
                        type: file.type,
                        url: data.url
                    },
                    type: 'sent',
                    ts: ts,
                    status: 'sending'
                };
                
                chatToUpdate[msgIndex] = finalMessage;
                setChat(ACTIVE_ID, chatToUpdate);
                renderMessages();

                // 🌟 FIX APPLIED: Changed 'send-file-message' to 'send-message' 
                socket.emit('send-message', {
                    recipientId: ACTIVE_ID,
                    message: finalMessage
                }, (response) => {
                    if (response.success) {
                        chatToUpdate[msgIndex].status = 'delivered';
                        setChat(ACTIVE_ID, chatToUpdate);
                        renderMessages();
                        console.log('File message delivered successfully.');
                    } else {
                        console.error("Server failed to confirm file message delivery:", response.message);
                    }
                });
            }
        } else {
            throw new Error(data.message || 'File upload failed.');
        }
    })
    .catch(error => {
        alert("File upload failed: " + error.message);
        console.error("File upload failed:", error);
        const chatToUpdate = getChat(ACTIVE_ID);
        const msgIndex = chatToUpdate.findIndex(m => m.id === msgId);
        if (msgIndex !== -1) {
            chatToUpdate[msgIndex].text = 'File upload failed. ⚠️';
            chatToUpdate[msgIndex].isPending = false;
            setChat(ACTIVE_ID, chatToUpdate);
            renderMessages();
        }
    });
}

function markAllSeen(contactId) {
    const chat = getChat(contactId);
    const unseenMessages = chat.filter(m => m.type === 'received' && m.status !== 'seen');
    if (unseenMessages.length > 0) {
        unseenMessages.forEach(m => m.status = 'seen');
        setChat(contactId, chat);
        renderMessages();
    }
}

function intelligentMerge(serverChatHistory) {
    console.log('Starting intelligent merge...');
    
    for (const [contactId, serverMessages] of Object.entries(serverChatHistory)) {
        const localMessages = storage.get(KEYS.chat(contactId), []);
        const localMessageIds = new Set(localMessages.map(m => m.id));

        const newMessages = serverMessages.filter(m => !localMessageIds.has(m.id));

        if (newMessages.length > 0) {
            console.log(`Merging ${newMessages.length} new messages for contact ${contactId}`);
            const mergedChat = [...localMessages, ...newMessages].sort((a, b) => a.ts - b.ts);
            storage.set(KEYS.chat(contactId), mergedChat);
        }
    }
    console.log('Intelligent merge complete.');
}


function connectSocket() {
    if (!USER || !USER.xameId) {
      console.error("Cannot connect socket: User object is missing.");
      return;
    }

    if (socket) {
        socket.disconnect();
    }
    
    socket = io(serverURL, {
        query: { userId: USER.xameId },
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.5,
        timeout: 10000
    });

    socket.on('connect', () => {
        console.log('Connected to server!');
        setTimeout(() => {
            socket.emit('request_online_users');
            socket.emit('get_contacts', USER.xameId);
            socket.emit('get_chat_history', { userId: USER.xameId });
        }, 100);
    });

    socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err.message);
    });

    socket.on('connect_timeout', () => {
        console.error('Socket connection timeout');
        showNotification('Connection is slow. Please check your network.');
    });

    socket.on('chat_history', (historyData) => {
        console.log('Received full chat history from server. Performing intelligent merge.');
        intelligentMerge(historyData);
        
        if (ACTIVE_ID) {
            renderMessages();
        }
        renderContacts();
    });
    
    socket.on('stream-ready', (data) => {
      console.log("Stream is ready, showing remote video.");
      if (remoteStream) {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.muted = false;
      }
    });

    socket.on('contacts_list', (serverContacts) => {
        console.log('Received updated contacts list from server:', serverContacts);
        
        const updatedContacts = serverContacts.map(c => {
            let profilePicUrl = c.profilePic;
            if (profilePicUrl && !profilePicUrl.includes('?ts=')) {
                profilePicUrl = `${profilePicUrl}?ts=${new Date().getTime()}`;
            }
                                    
            return {
                id: c.xameId,
                name: c.name,
                profilePic: profilePicUrl,
                online: c.isOnline,
                status: c.status || 'Message a friend',
                lastInteractionTs: c.lastInteractionTs, 
                lastInteractionPreview: c.lastInteractionPreview, 
                isProfilePicHidden: c.isProfilePicHidden || false, 
                createdAt: now(),
                lastAt: now(),
                unreadCount: 0
            };
        });

        const selfContactIndex = updatedContacts.findIndex(c => c.id === USER.xameId);
        if (selfContactIndex !== -1) {
            updatedContacts[selfContactIndex].online = true;
            updatedContacts[selfContactIndex].profilePic = USER.profilePic;
            updatedContacts[selfContactIndex].isProfilePicHidden = false;
        } else {
            updatedContacts.push({
                id: USER.xameId,
                name: `${USER.firstName} ${USER.lastName} (You)`,
                profilePic: USER.profilePic,
                online: true,
                status: 'Message yourself',
                createdAt: now(),
                lastAt: now(),
                lastInteractionTs: now(),
                lastInteractionPreview: 'Message yourself',
                isProfilePicHidden: false,
                unreadCount: 0
            });
        }

        CONTACTS = updatedContacts;
        storage.set(KEYS.contacts, CONTACTS);
        renderContacts(searchInput.value);
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server!');
        let contacts = storage.get(KEYS.contacts);
        if (contacts) {
            contacts.forEach(c => c.online = false);
            storage.set(KEYS.contacts, contacts);
            renderContacts();
        }
    });
    
    socket.on('online_users', (onlineUserIds) => {
        console.log(`[online_users] Event received. Online user IDs:`, onlineUserIds);
        
        let contacts = storage.get(KEYS.contacts);
        if (!contacts) return;
        
        contacts.forEach(c => {
            const isOnline = onlineUserIds.includes(c.id);
            c.online = isOnline;
        });

        const selfContact = contacts.find(c => c.id === USER.xameId);
        if (selfContact) {
            selfContact.online = true;
        }
        
        storage.set(KEYS.contacts, contacts);
        
        renderContacts(searchInput.value);
        
        if (ACTIVE_ID) {
            const activeContact = contacts.find(c => c.id === ACTIVE_ID);
            if (activeContact) {
                chatSub.textContent = activeContact.online ? 'Online' : 'Offline';
            }
        }
    });

    socket.on('user-connected', (userId) => {
        console.log('User connected:', userId);
        const contacts = storage.get(KEYS.contacts);
        if (contacts) {
            const contact = contacts.find(c => c.id === userId);
            if (contact) {
                contact.online = true;
                storage.set(KEYS.contacts, contacts);
                const userItem = document.querySelector(`.list .item[data-user-id="${userId}"]`);
                if (userItem) {
                    const onlineDot = userItem.querySelector('.online-dot');
                    if (onlineDot) {
                        onlineDot.classList.remove('hidden');
                    }
                }
            }
        }
        if (ACTIVE_ID === userId) {
            chatSub.textContent = 'Online';
        }
    });

    socket.on('user-disconnected', (userId) => {
        console.log('User disconnected:', userId);
        const contacts = storage.get(KEYS.contacts);
        if (contacts) {
            const contact = contacts.find(c => c.id === userId);
            if (contact) {
                contact.online = false;
                storage.set(KEYS.contacts, contacts);
                const userItem = document.querySelector(`.list .item[data-user-id="${userId}"]`);
                if (userItem) {
                    const onlineDot = userItem.querySelector('.online-dot');
                    if (onlineDot) {
                        onlineDot.classList.add('hidden');
                    }
                    if (ACTIVE_ID === userId) {
                      chatSub.textContent = 'Offline';
                    }
                }
            }
        }
    });

    socket.on('receive-message', (data) => {
        console.log('Received message:', data);
        const { senderId, message } = data;
        
        const chat = getChat(senderId);
        
        const newMsg = {
            id: message.id,
            text: message.text,
            file: message.file,
            type: 'received',
            ts: message.ts,
            status: 'delivered'
        };
        
        chat.push(newMsg);
        setChat(senderId, chat);

        const contactToUpdate = CONTACTS.find(c => c.id === senderId);
        if (contactToUpdate) {
            contactToUpdate.lastAt = newMsg.ts;
            contactToUpdate.lastInteractionTs = message.ts; 
            contactToUpdate.lastInteractionPreview = message.text ? message.text : 'Attachment';
            
            if (ACTIVE_ID !== senderId) {
                contactToUpdate.unreadCount = (contactToUpdate.unreadCount || 0) + 1;
            }
            storage.set(KEYS.contacts, CONTACTS);
        }
        
        renderContacts();

        if (ACTIVE_ID === senderId) {
            renderMessages();
            const newUnseenMessageIds = [newMsg.id];
            socket.emit('message-seen', { recipientId: ACTIVE_ID, messageIds: newUnseenMessageIds });
        }
    });

    socket.on('messages-deleted', (data) => {
        console.log('Real-time deletion received:', data);
        const { senderId, messageIds } = data;
        
        const contactId = senderId; 
        
        const chat = getChat(contactId);
        const updatedChat = chat.filter(m => !messageIds.includes(m.id));
        setChat(contactId, updatedChat);

        if (ACTIVE_ID === contactId) {
            renderMessages();
            showNotification(`${messageIds.length} message(s) deleted by sender.`);
        } else {
            const contactToUpdate = CONTACTS.find(c => c.id === contactId);
            if (contactToUpdate) {
                const latestMsg = updatedChat.length > 0 ? updatedChat[updatedChat.length - 1] : null;
                
                contactToUpdate.lastInteractionTs = latestMsg ? latestMsg.ts : now();
                contactToUpdate.lastInteractionPreview = latestMsg 
                    ? (latestMsg.text || 'Attachment') 
                    : 'Chat cleared or message deleted';
                    
                storage.set(KEYS.contacts, CONTACTS);
                renderContacts();
            }
        }
    });
    
    socket.on('message-status-update', (data) => {
      console.log('Message status update received:', data);
      const { recipientId, messageId, status } = data;
      const chat = getChat(recipientId);
      const message = chat.find(m => m.id === messageId);
      
      if (message) {
        message.status = status;
        setChat(recipientId, chat);
        if (ACTIVE_ID === recipientId) {
          renderMessages();
        }
      }
    });

    socket.on('message-seen-update', (data) => {
      console.log('Message seen update received:', data);
      const { recipientId, messageIds } = data;
      const chat = getChat(recipientId);
      
      messageIds.forEach(messageId => {
        const message = chat.find(m => m.id === messageId);
        if (message) {
          message.status = 'seen';
        }
      });
      
      setChat(recipientId, chat);
      if (ACTIVE_ID === recipientId) {
        renderMessages();
      }
    });
    
    socket.on('typing', (data) => {
        if (ACTIVE_ID === data.senderId) {
            $('#chatSub').classList.add('hidden');
            $('#typing').classList.remove('hidden');
        }
    });
    
    socket.on('stop-typing', (data) => {
        if (ACTIVE_ID === data.senderId) {
            $('#chatSub').classList.remove('hidden');
            $('#typing').classList.add('hidden');
        }
    });

    socket.on('call-rejected', ({ senderId }) => {
        console.log('Call was rejected by', senderId);
        incomingCallOverlay?.classList.add('hidden');
        showNotification("Call rejected."); 
    });
    
    socket.on('call-busy', ({ recipientId }) => {
        console.log('Recipient is busy:', recipientId);
        showNotification("This user is on another call.");
    });

    socket.on('call-user', (data) => {
        const { offer, caller, callType } = data;
        console.log('Incoming call from', caller.xameId);
        showIncomingCallNotification(caller, callType, offer);
    });

    socket.on('make-answer', (data) => {
        handleAnswer(data.answer);
    });

    socket.on('ice-candidate', (data) => {
        handleNewIceCandidate(data.candidate);
    });
}

function syncDeletionsWithServer(deletions) {
    return new Promise((resolve) => {
        if (!socket || !USER) {
            console.error('Socket not connected or user not logged in. Deletion sync aborted.');
            return resolve(false); 
        }
        console.log('Syncing deletions with server...', deletions);
        
        socket.emit('sync-deletions', { 
            userId: USER.xameId, 
            deletions 
        }, (response) => {
            if (response && response.success) {
                console.log('Server confirmed deletion sync successful.');
                resolve(true);
            } else {
                console.error('Server failed to confirm deletion:', response?.message || 'No response data.');
                resolve(false);
            }
        });
    });
}

function isValidISO(dateString) {
    const regex = /^(\d{4})-(\d{2})-(\d{2})$/;
    const match = dateString.match(regex);

    if (!match) {
        return false;
    }

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);

    const date = new Date(Date.UTC(year, month - 1, day));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return false;
    }

    if (date.getTime() >= Date.now()) { 
        return false; 
    }
    
    if (year < 1900) {
        return false;
    }

    return true;
}

const updateHiddenDOB = () => {
    if (!dobDayInput || !dobMonthInput || !dobYearInput || !dobHiddenDateInput) return;

    const day = dobDayInput.value.padStart(2, '0');
    const month = dobMonthInput.value.padStart(2, '0');
    const year = dobYearInput.value;

    if (year.length === 4 && day.length === 2 && month.length === 2) {
        dobHiddenDateInput.value = `${year}-${month}-${day}`;
    } else {
        dobHiddenDateInput.value = ''; 
    }
};

const handleDateSegmentInput = (currentInput, maxLength, nextInput) => {
    let value = currentInput.value.replace(/[^0-9]/g, '');
    
    if (value.length > maxLength) {
        currentInput.value = value.slice(0, maxLength);
        value = currentInput.value;
    } else {
        currentInput.value = value;
    }

    if (value.length === maxLength && nextInput) {
        nextInput.focus();
    }
    
    updateHiddenDOB();
};

(function boot() {
  const v = storage.get(KEYS.version);
  if (v !== APP_VERSION) {
    storage.set(KEYS.version, APP_VERSION);
  }

  if (dobDayInput && dobMonthInput && dobYearInput && dobHiddenDateInput) {
      dobDayInput.addEventListener('input', () => {
          handleDateSegmentInput(dobDayInput, 2, dobMonthInput);
      });

      dobMonthInput.addEventListener('input', () => {
          handleDateSegmentInput(dobMonthInput, 2, dobYearInput);
      });
      
      dobYearInput.addEventListener('input', () => {
          handleDateSegmentInput(dobYearInput, 4, null);
      });

      updateHiddenDOB();
  }

  ensurePlaceholderStyles();
  init();
  
  clearAllChatsBtn?.addEventListener('click', clearAllChats);

  signUpBtn?.addEventListener('click', () => { show(elRegister); });
  signInBtn?.addEventListener('click', () => { show(elLogin); });
  backToLandingBtn?.addEventListener('click', () => { show(elRegister); });
  backToLandingBtn2?.addEventListener('click', () => { show(elLanding); });
  
  composer?.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = messageInput.value.trim();
      if (text) {
          sendMessage(text);
          messageInput.value = '';
          updateComposerButtons();
      }
  });

  let typingTimer;
  messageInput?.addEventListener('input', () => {
      clearTimeout(typingTimer);
      socket?.emit('typing', { recipientId: ACTIVE_ID });
      typingTimer = setTimeout(() => {
          socket?.emit('stop-typing', { recipientId: ACTIVE_ID });
      }, 1500);
      updateComposerButtons();
  });
  
  loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const xameId = loginXameIdInput.value.trim();
      
      if (!xameId) {
          alert('Please enter your Xame-ID.');
          return;
      }
      try {
          const checkResponse = await fetch(`${serverURL}/api/get-user-name`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ xameId })
          });
          const checkResult = await checkResponse.json();

          if (!checkResponse.ok || !checkResult.success) {
              alert(checkResult.message || 'Login failed. Please check your Xame-ID.');
              return;
          }

          const userName = checkResult.user.firstName + ' ' + checkResult.user.lastName;
          const isConfirmed = confirm(`Login as ${userName}?`);

          if (!isConfirmed) {
              return;
          }
          
          if (USER && USER.xameId !== xameId) {
              const switchConfirmed = confirm('Logging in as a different user will sign you out. Do you want to continue?');
              if (!switchConfirmed) {
                  return;
              }
          }

          const loginResponse = await fetch(`${serverURL}/api/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ xameId })
          });
          const loginResult = await loginResponse.json();

          if (loginResponse.ok && loginResult.success) {
              handleLoginSuccess(loginResult.user);
          } else {
              alert(loginResult.message || 'Login failed. Please check your Xame-ID.');
          }
      } catch (err) {
          console.error('Login error:', err);
          alert('A server or network error occurred. Please try again later.');
      }
  });

  registerForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const firstName = firstNameInput.value.trim();
      const lastName = lastNameInput.value.trim();
      const dob = dobHiddenDateInput.value.trim(); 
      
      if (!firstName || !lastName) {
          alert("Please fill out both name fields.");
          return;
      }

      if (dobErrorElement) {
          dobErrorElement.style.display = 'none';
          dobErrorElement.textContent = '';
      }
      
      const dobInputs = [dobDayInput, dobMonthInput, dobYearInput];
      dobInputs.forEach(input => input?.classList.remove('input-error'));

      if (!dob || dob.length !== 10 || !isValidISO(dob)) {
          const errorMessage = "Please enter a valid date of birth (DD-MM-YYYY), e.g., 31-12-1995.";
          
          if (dobErrorElement) {
              dobErrorElement.textContent = errorMessage;
              dobErrorElement.style.display = 'block';
              dobErrorElement.scrollIntoView({ behavior: 'smooth', block: 'center' }); 
          } else {
              alert(errorMessage); 
          }
          
          dobInputs.forEach(input => input?.classList.add('input-error'));
          
          return;
      }

      try {
          e.submitter.disabled = true;

          const response = await fetch(`${serverURL}/api/register`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ firstName, lastName, dob })
          });
          
          const data = await response.json();
          
          if (data.success) {
              const newUser = data.user || data;
              
              alert(`Registration successful! Your Xame-ID is: ${newUser.xameId}`);
              
              storage.set(KEYS.user, newUser); 
              
              handleLoginSuccess(newUser);
              
              return; 
              
          } else {
              alert(data.message || 'Registration failed. Please try again.');
          }
      } catch (err) {
          console.error('Registration fetch error:', err);
          alert('A server or network error occurred. Please try again later.');
      } finally {
          e.submitter.disabled = false;
      }
  });

  logoutBtn?.addEventListener('click', () => {
      if (confirm('Are you sure you want to log out?')) {
          if (socket) {
              socket.disconnect();
          }
          storage.del(KEYS.user);
          USER = null;
          show(elLanding);
      }
  });
})();


/*
// PART 11: Keyboard Fix - Prevents Header/Composer Jumping
*/

(function initKeyboardFix() {
  'use strict';
  
  console.log('🔧 Initializing keyboard fix...');
  
  // Store the initial viewport height
  let initialHeight = window.innerHeight;
  
  // Function to set CSS custom property for viewport height
  function setViewportHeight() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }
  
  // Set initial height
  setViewportHeight();
  
  // Update on resize (but debounce it)
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      setViewportHeight();
    }, 100);
  });
  
  // Prevent body scroll when input is focused (iOS Safari fix)
  const messageInput = document.getElementById('messageInput');
  
  if (messageInput) {
    messageInput.addEventListener('focus', () => {
      // Add class to body to prevent scroll
      document.body.classList.add('input-focused');
      
      // Scroll to bottom of messages to prevent weird positioning
      const chatBg = document.querySelector('.chat-bg');
      if (chatBg) {
        setTimeout(() => {
          chatBg.scrollTop = chatBg.scrollHeight;
        }, 300);
      }
    });
    
    messageInput.addEventListener('blur', () => {
      // Remove class from body
      document.body.classList.remove('input-focused');
    });
  }
  
  // Prevent visual viewport shifts (advanced fix for iOS Safari)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const chat = document.getElementById('chat');
      if (chat && document.body.contains(chat) && !chat.classList.contains('hidden')) {
        // Keep the chat at the correct position
        const offset = window.visualViewport.offsetTop;
        if (offset > 0) {
          // Keyboard is visible
          chat.style.top = `${offset}px`;
          chat.style.height = `${window.visualViewport.height}px`;
        } else {
          // Keyboard is hidden
          chat.style.top = '0';
          chat.style.height = '100vh';
        }
      }
    });
  }
  
  // Additional iOS Safari fix: prevent elastic scrolling on body
  document.addEventListener('touchmove', (e) => {
    if (e.target === document.body) {
      e.preventDefault();
    }
  }, { passive: false });
  
  // Fix for search input (if you have one in contacts)
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('focus', () => {
      document.body.classList.add('input-focused');
    });
    
    searchInput.addEventListener('blur', () => {
      document.body.classList.remove('input-focused');
    });
  }
  
  console.log('✅ Keyboard fix initialized');
})();

// Export for debugging
window.__XAME__ = {
  storage,
  KEYS,
  getChat,
  setChat,
  USER
};
</script>