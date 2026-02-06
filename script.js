/*
// PART 1: Header and Core Setup with Security & Performance Fixes
*/

//
// XamePage v2.1 Script File - PERFORMANCE OPTIMIZED VERSION
//

// ===== CRITICAL: Debugging block for troubleshooting =====
console.log(' XamePage script START');
window.addEventListener('error', (e) => {
    console.error(' CRITICAL ERROR:', e.message, e.filename, e.lineno);
});
// ===== End debugging block =====

// --- Dynamic Server URL based on environment ---
let socket = null;
let serverURL;

const currentHostname = window.location.hostname;
const currentPort = window.location.port;

if (currentHostname.includes('trycloudflare.com')) {
    serverURL = `https://${currentHostname}`;
    console.log("Using Cloudflare URL:", serverURL);

} else if (currentHostname === 'localhost' || currentHostname === '127.0.0.1') {
    serverURL = `http://localhost:${currentPort || 8080}`;
    console.log("Using Localhost URL:", serverURL);

} else {
    // For production (Render or any live URL)
    serverURL = `https://${currentHostname}`;
    console.log("Using Production URL:", serverURL);
}

// ===== DUAL STORAGE: In-Memory + LocalStorage Fallback =====
const memoryStorage = new Map();
const persistentStorage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (error) {
      console.error(`Persistent storage get error for key ${key}:`, error);
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Persistent storage set error for key ${key}:`, error);
      return false;
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error(`Persistent storage delete error for key ${key}:`, error);
      return false;
    }
  },
  clear() {
    try {
      localStorage.clear();
      return true;
    } catch (error) {
      console.error('Persistent storage clear error:', error);
      return false;
    }
  }
};

// Initialize memory storage from persistent storage on boot
function initializeMemoryFromPersistent() {
  console.log(' Initializing memory storage from persistent storage...');
  
  try {
    // Load user
    const user = persistentStorage.get(KEYS.user);
    if (user) {
      memoryStorage.set(KEYS.user, user);
      console.log(' Loaded user from persistent storage');
    }
    
    // Load contacts
    const contacts = persistentStorage.get(KEYS.contacts, []);
    memoryStorage.set(KEYS.contacts, contacts);
    console.log(` Loaded ${contacts.length} contacts from persistent storage`);
    
    // Load drafts
    const drafts = persistentStorage.get(KEYS.drafts, {});
    memoryStorage.set(KEYS.drafts, drafts);
    console.log(` Loaded ${Object.keys(drafts).length} drafts from persistent storage`);
    
    // Load settings
    const settings = persistentStorage.get(KEYS.settings, {});
    memoryStorage.set(KEYS.settings, settings);
    console.log(' Loaded settings from persistent storage');
    
    // Note: Chat histories are loaded on-demand to avoid memory bloat
    
  } catch (error) {
    console.error(' Failed to initialize memory from persistent storage:', error);
  }
}

// Dual storage manager
const storage = {
  get(key, fallback = null) {
    // First try memory storage (fast)
    if (memoryStorage.has(key)) {
      return memoryStorage.get(key);
    }
    
    // Fall back to persistent storage
    try {
      const persistentValue = persistentStorage.get(key, fallback);
      if (persistentValue !== fallback) {
        // Cache in memory for future access
        memoryStorage.set(key, persistentValue);
      }
      return persistentValue;
    } catch (error) {
      console.error(`Dual storage get error for key ${key}:`, error);
      return fallback;
    }
  },
  
  set(key, value) {
    try {
      // Set in memory storage (immediate)
      memoryStorage.set(key, value);
      
      // Async set in persistent storage (don't wait for completion)
      setTimeout(() => {
        try {
          persistentStorage.set(key, value);
        } catch (persistentError) {
          console.warn(`Async persistent storage set failed for ${key}:`, persistentError);
        }
      }, 0);
      
      return true;
    } catch (error) {
      console.error(`Memory storage set error for key ${key}:`, error);
      return false;
    }
  },
  
  del(key) {
    try {
      // Delete from memory
      memoryStorage.delete(key);
      
      // Async delete from persistent storage
      setTimeout(() => {
        try {
          persistentStorage.del(key);
        } catch (persistentError) {
          console.warn(`Async persistent storage delete failed for ${key}:`, persistentError);
        }
      }, 0);
      
      return true;
    } catch (error) {
      console.error(`Memory storage delete error for key ${key}:`, error);
      return false;
    }
  },
  
  clear() {
    try {
      // Clear memory
      memoryStorage.clear();
      
      // Async clear persistent storage
      setTimeout(() => {
        try {
          persistentStorage.clear();
        } catch (persistentError) {
          console.warn('Async persistent storage clear failed:', persistentError);
        }
      }, 0);
      
      return true;
    } catch (error) {
      console.error('Memory storage clear error:', error);
      return false;
    }
  },
  
  // Additional methods for direct access
  getFromMemory(key, fallback = null) {
    return memoryStorage.has(key) ? memoryStorage.get(key) : fallback;
  },
  
  getFromPersistent(key, fallback = null) {
    return persistentStorage.get(key, fallback);
  },
  
  syncToPersistent() {
    console.log(' Syncing all memory data to persistent storage...');
    let syncedCount = 0;
    
    try {
      for (const [key, value] of memoryStorage.entries()) {
        if (key.startsWith('xame:')) {
          persistentStorage.set(key, value);
          syncedCount++;
        }
      }
      console.log(` Synced ${syncedCount} items to persistent storage`);
      return syncedCount;
    } catch (error) {
      console.error(' Sync to persistent storage failed:', error);
      return 0;
    }
  },
  
  syncFromPersistent() {
    console.log(' Syncing from persistent storage to memory...');
    return initializeMemoryFromPersistent();
  },
  
  // Debug methods
  getStats() {
    return {
      memoryItems: memoryStorage.size,
      memoryKeys: Array.from(memoryStorage.keys()),
      persistentKeys: Object.keys(localStorage).filter(k => k.startsWith('xame:')),
      memoryUsage: this.getMemoryUsage()
    };
  },
  
  getMemoryUsage() {
    if (performance.memory) {
      return {
        usedJSHeapSize: (performance.memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB',
        totalJSHeapSize: (performance.memory.totalJSHeapSize / 1048576).toFixed(2) + ' MB'
      };
    }
    return 'Memory API not available';
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
    audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'],
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

// ===== Utilities with Enhanced Security =====
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// FIXED: Enhanced HTML escaping including backticks
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"'`]/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;',
    '`': '&#96;'
  }[m]));
}

function now() {
  return Date.now();
}

function fmtTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    console.error('Time formatting error:', error);
    return '--:--';
  }
}

function fmtDate(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (error) {
    console.error('Date formatting error:', error);
    return 'Unknown date';
  }
}

function dayLabel(ts) {
  try {
    const one = 24 * 60 * 60 * 1000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yest = new Date(today.getTime() - one);
    const t = new Date(ts);
    t.setHours(0, 0, 0, 0);
    if (t.getTime() === today.getTime()) return 'Today';
    if (t.getTime() === yest.getTime()) return 'Yesterday';
    return fmtDate(ts);
  } catch (error) {
    console.error('Day label error:', error);
    return fmtDate(ts);
  }
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
    notification.textContent = escapeHtml(message);

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

// FIXED: Enhanced debounce with leading edge option
const debounce = (fn, ms, leading = false) => {
  let t;
  let lastCall = 0;
  return (...args) => {
    const now = Date.now();
    
    if (leading && now - lastCall > ms) {
      fn(...args);
      lastCall = now;
    }
    
    clearTimeout(t);
    t = setTimeout(() => {
      fn(...args);
      lastCall = Date.now();
    }, ms);
  };
};

// FIXED: Enhanced URL utilities
function cleanUrl(url) {
    if (!url) return url;
    try {
        return url.split('?')[0];
    } catch (error) {
        console.error('URL cleaning error:', error);
        return url;
    }
}

function addCacheBuster(url) {
    if (!url) return url;
    try {
        const cleanedUrl = cleanUrl(url);
        const separator = cleanedUrl.includes('?') ? '&' : '?';
        return `${cleanedUrl}${separator}ts=${Date.now()}`;
    } catch (error) {
        console.error('Cache buster error:', error);
        return url;
    }
}

// FIXED: Improved file URL construction
function constructFileUrl(fileUrl) {
    if (!fileUrl) return '';
    
    try {
        if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
            return fileUrl;
        }
        
        const base = serverURL.endsWith('/') ? serverURL.slice(0, -1) : serverURL;
        const path = fileUrl.startsWith('/') ? fileUrl : `/${fileUrl}`;
        return `${base}${path}`;
    } catch (error) {
        console.error('File URL construction error:', error);
        return fileUrl;
    }
}

// ===== File Validation =====
function validateFile(file) {
  if (!file) {
    return { valid: false, error: 'No file selected' };
  }
  
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
// PART 2: Data Model and State with Enhanced Contact Management
*/

function ensureSeedContacts() {
  let list = storage.get(KEYS.contacts);

  if (Array.isArray(list) && list.length > 0) {
    list = list.filter(c => c && c.id && c.id !== 'self');
    
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
        lastInteractionTs: c.lastInteractionTs || c.lastAt || c.createdAt || now(),
        lastInteractionPreview: c.lastInteractionPreview || c.status || '',
        isProfilePicHidden: c.isProfilePicHidden || false
    }));
    
    storage.set(KEYS.contacts, list);
    return list;
  }
  
  list = [];
  
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
  return list;
}

// ===== State with Resource Tracking =====
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

// FIXED: Resource cleanup tracking
const RESOURCES = {
    wavesurfers: new Map(),
    mediaRecorders: [],
    peerConnections: [],
    localStreams: []
};

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
    <button class="icon-btn" id="exitSelectModeBtn"></button>
    <div class="counter">0</div>
    <div class="toolbar">
      <button class="icon-btn" id="deleteSelectedBtn" title="Delete messages"></button>
      <button class="icon-btn" id="copySelectedBtn" title="Copy messages"></button>
      <button class="icon-btn" id="forwardSelectedBtn" title="Forward messages"></button>
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
    if (fileType.startsWith('image/')) return '';
    else if (fileType.startsWith('video/')) return '';
    else if (fileType.startsWith('audio/')) return '';
    else if (fileType === 'application/pdf') return '';
    else if (fileType === 'application/msword' || fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '';
    else if (fileType === 'application/vnd.ms-excel' || fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return '';
    else if (fileType === 'application/vnd.ms-powerpoint' || fileType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return '';
    else if (fileType === 'text/plain') return '';
    else if (fileName.endsWith('.zip') || fileName.endsWith('.rar')) return '';
    return '';
}

function formatDuration(seconds) {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function openImageFullscreen(imageUrl, imageName) {
    const overlay = document.createElement('div');
    overlay.className = 'fullscreen-image-overlay';
    overlay.innerHTML = `
        <div class="fullscreen-image-container">
            <button class="close-fullscreen-btn"></button>
            <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(imageName)}">
            <div class="image-actions">
                <a href="${escapeHtml(imageUrl)}" download="${escapeHtml(imageName)}" class="btn secondary">Download</a>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    const closeBtn = overlay.querySelector('.close-fullscreen-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => overlay.remove());
    }
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
}

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
        <button class="cancel-upload-btn" data-msg-id="${escapeHtml(msgId)}">Cancel</button>
    `;
    
    composer.insertAdjacentElement('beforebegin', progressDiv);
    
    const cancelBtn = progressDiv.querySelector('.cancel-upload-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (currentUpload) {
                currentUpload.abort();
            }
        });
    }
    
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
        chatToUpdate[msgIndex].text = 'Upload failed ';
        chatToUpdate[msgIndex].isPending = false;
        chatToUpdate[msgIndex].uploadProgress = 0;
        setChat(ACTIVE_ID, chatToUpdate);
        renderMessages();
    }
    
    removeUploadProgress(msgId);
}

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
        reader.onerror = () => {
            console.error('Failed to read image file');
            resolve(false);
        };
        reader.readAsDataURL(file);
    });
}


/*
// PART 3.5: CAMERA FUNCTIONALITY - ENHANCED WITH SCREEN SIZE TOGGLE
*/

// Camera modal elements
let cameraModal = null;
let cameraVideoElement = null;
let cameraCanvasElement = null;
let cameraStartRecordingBtn = null;
let cameraStopRecordingBtn = null;
let cameraCaptureBtn = null;
let cameraCloseBtn = null;
let cameraFullscreenBtn = null;
let cameraSwitchBtn = null;

let cameraStream = null;
let cameraMediaRecorder = null;
let cameraRecordedChunks = [];
let isCameraRecording = false;
let currentCameraMode = 'thumbnail'; // CHANGED: Start with thumbnail as default
let currentFacingMode = 'user'; // 'user' (front), 'environment' (back)

function initCameraFunctionality() {
    createCameraModal();
    setupCameraButton();
}

function createCameraModal() {
    // Create camera modal HTML
    cameraModal = document.createElement('div');
    cameraModal.className = 'camera-modal hidden';
    cameraModal.innerHTML = `
        <div class="camera-modal-content">
            <div class="camera-header">
                <h3>Camera</h3>
                <div class="camera-header-controls">
                    <div class="screen-size-toggle">
                        <button class="size-toggle-btn ${currentCameraMode === 'thumbnail' ? 'active' : ''}" data-mode="thumbnail" title="Thumbnail">
                            <span class="btn-icon"></span>
                        </button>
                        <button class="size-toggle-btn ${currentCameraMode === 'halfscreen' ? 'active' : ''}" data-mode="halfscreen" title="Half Screen">
                            <span class="btn-icon"></span>
                        </button>
                        <button class="size-toggle-btn ${currentCameraMode === 'fullscreen' ? 'active' : ''}" data-mode="fullscreen" title="Full Screen">
                            <span class="btn-icon"></span>
                        </button>
                    </div>
                    <button class="close-camera">&times;</button>
                </div>
            </div>
            <div class="camera-preview">
                <video id="camera-video" autoplay playsinline muted></video>
                <canvas id="camera-canvas" style="display: none;"></canvas>
                <div class="recording-timer" id="recordingTimer" style="display: none;">
                    <span class="recording-dot"></span>
                    <span id="timerDisplay">00:00</span>
                </div>
            </div>
            <div class="camera-controls">
                <div class="camera-primary-controls">
                    <button id="camera-switch-camera" class="camera-btn switch-btn">
                        <span class="btn-icon"></span>
                        <span class="btn-text">Switch</span>
                    </button>
                    <button id="camera-capture-btn" class="camera-btn capture-btn">
                        <span class="btn-icon"></span>
                        <span class="btn-text">Photo</span>
                    </button>
                    <button id="camera-start-recording" class="camera-btn record-btn">
                        <span class="btn-icon"></span>
                        <span class="btn-text">Record</span>
                    </button>
                </div>
                <div class="camera-secondary-controls">
                    <button id="camera-stop-recording" class="camera-btn stop-btn" disabled>
                        <span class="btn-icon"></span>
                        <span class="btn-text">Stop</span>
                    </button>
                </div>
            </div>
            <div class="camera-preview-area" style="display: none;">
                <img id="camera-preview-image" style="max-width: 100%; display: none;">
                <video id="camera-preview-video" controls style="max-width: 100%; display: none;"></video>
                <div class="camera-preview-controls">
                    <button id="camera-send-media" class="preview-btn send-btn">Send</button>
                    <button id="camera-retake-media" class="preview-btn retake-btn">Retake</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(cameraModal);
    
    // Get references to modal elements
    cameraVideoElement = document.getElementById('camera-video');
    cameraCanvasElement = document.getElementById('camera-canvas');
    cameraCaptureBtn = document.getElementById('camera-capture-btn');
    cameraStartRecordingBtn = document.getElementById('camera-start-recording');
    cameraStopRecordingBtn = document.getElementById('camera-stop-recording');
    cameraCloseBtn = document.querySelector('.close-camera');
    cameraSwitchBtn = document.getElementById('camera-switch-camera');
    const sendMediaBtn = document.getElementById('camera-send-media');
    const retakeMediaBtn = document.getElementById('camera-retake-media');
    const previewImage = document.getElementById('camera-preview-image');
    const previewVideo = document.getElementById('camera-preview-video');
    const previewArea = document.querySelector('.camera-preview-area');
    const cameraPreview = document.querySelector('.camera-preview');
    const recordingTimer = document.getElementById('recordingTimer');
    const timerDisplay = document.getElementById('timerDisplay');

    // Screen size toggle buttons
    const sizeToggleBtns = document.querySelectorAll('.size-toggle-btn');
    sizeToggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            setCameraMode(mode);
            
            // Update active state
            sizeToggleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Event listeners for camera controls
    cameraCloseBtn.addEventListener('click', closeCamera);
    cameraCaptureBtn.addEventListener('click', capturePhoto);
    cameraStartRecordingBtn.addEventListener('click', startCameraRecording);
    cameraStopRecordingBtn.addEventListener('click', stopCameraRecording);
    cameraSwitchBtn.addEventListener('click', switchCamera);
    sendMediaBtn.addEventListener('click', sendCameraMedia);
    retakeMediaBtn.addEventListener('click', retakeCameraMedia);
    
    // Close modal when clicking outside
    cameraModal.addEventListener('click', function(e) {
        if (e.target === cameraModal) {
            closeCamera();
        }
    });
}

function setupCameraButton() {
    // Find camera button in the composer bar
    const cameraBtn = document.querySelector('[title="Camera/Video"]');
    if (cameraBtn) {
        cameraBtn.addEventListener('click', openCamera);
    } else {
        // Fallback: look for camera icon or text in the more options dropdown
        const cameraOption = document.createElement('div');
        cameraOption.className = 'menu-item';
        cameraOption.innerHTML = ' Camera';
        cameraOption.addEventListener('click', openCamera);
        
        const moreOptionsDropdown = document.getElementById('more-options-dropdown');
        if (moreOptionsDropdown) {
            moreOptionsDropdown.appendChild(cameraOption);
        }
    }
}

// CHANGED: Proper screen size toggle function
function setCameraMode(mode) {
    currentCameraMode = mode;
    
    // Remove all mode classes
    cameraModal.classList.remove('fullscreen', 'halfscreen', 'thumbnail');
    
    // Add current mode class
    cameraModal.classList.add(mode);
    
    console.log(`Camera mode changed to: ${mode}`);
}

// CHANGED: Updated toggle function for sequential cycling
function toggleCameraMode() {
    switch(currentCameraMode) {
        case 'thumbnail':
            setCameraMode('halfscreen');
            break;
        case 'halfscreen':
            setCameraMode('fullscreen');
            break;
        case 'fullscreen':
            setCameraMode('thumbnail');
            break;
    }
}

async function openCamera() {
    if (cameraModal) {
        cameraModal.classList.remove('hidden');
        // CHANGED: Start with thumbnail mode when opening
        setCameraMode('thumbnail');
        // Reset recording state
        resetRecordingState();
    }
    try {
        // CRITICAL FIX: Start with VIDEO ONLY (no audio) to prevent mic noise
        cameraStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: currentFacingMode
            }, 
            audio: false // NO AUDIO initially to prevent mic noise
        });
        cameraVideoElement.srcObject = cameraStream;
        
        // Set canvas size to match video
        cameraVideoElement.addEventListener('loadedmetadata', function() {
            cameraCanvasElement.width = cameraVideoElement.videoWidth;
            cameraCanvasElement.height = cameraVideoElement.videoHeight;
        });
        
    } catch (error) {
        console.error('Error accessing camera:', error);
        alert('Unable to access camera. Please check permissions.');
        closeCamera();
    }
}

function closeCamera() {
    if (cameraModal) {
        cameraModal.classList.add('hidden');
    }
    stopCamera();
    resetCameraPreview();
    // CHANGED: Reset to thumbnail when closing
    setCameraMode('thumbnail');
    // Reset recording state
    resetRecordingState();
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    if (isCameraRecording) {
        stopCameraRecording();
    }
}

function resetRecordingState() {
    isCameraRecording = false;
    cameraStartRecordingBtn.disabled = false;
    cameraStopRecordingBtn.disabled = true;
    cameraCaptureBtn.disabled = false;
    cameraStartRecordingBtn.style.display = 'flex';
    cameraStopRecordingBtn.style.display = 'none';
    
    // Hide recording timer
    const recordingTimer = document.getElementById('recordingTimer');
    if (recordingTimer) {
        recordingTimer.style.display = 'none';
    }
}

function capturePhoto() {
    const context = cameraCanvasElement.getContext('2d');
    context.drawImage(cameraVideoElement, 0, 0, cameraCanvasElement.width, cameraCanvasElement.height);
    
    cameraCanvasElement.toBlob(function(blob) {
        showCameraPreview('photo', blob);
    }, 'image/jpeg', 0.8);
}

// ADDED: Recording timer functionality
let recordingStartTime = 0;
let recordingTimerInterval = null;

function updateRecordingTimer() {
    if (!recordingStartTime) return;
    
    const elapsed = Date.now() - recordingStartTime;
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const displaySeconds = seconds % 60;
    
    const timerDisplay = document.getElementById('timerDisplay');
    if (timerDisplay) {
        timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')}`;
    }
}

async function startCameraRecording() {
    cameraRecordedChunks = [];
    
    try {
        // CRITICAL FIX: Get NEW stream with AUDIO for recording only
        const recordingStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: currentFacingMode
            },
            audio: true // Enable audio ONLY when recording starts
        });
        
        const options = { mimeType: 'video/webm;codecs=vp9,opus' };
        cameraMediaRecorder = new MediaRecorder(recordingStream, options);
        
        cameraMediaRecorder.ondataavailable = function(event) {
            if (event.data.size > 0) {
                cameraRecordedChunks.push(event.data);
            }
        };
        
        cameraMediaRecorder.onstop = function() {
            const blob = new Blob(cameraRecordedChunks, { type: 'video/webm' });
            showCameraPreview('video', blob);
            // Stop the recording stream
            recordingStream.getTracks().forEach(track => track.stop());
            
            // Stop timer
            if (recordingTimerInterval) {
                clearInterval(recordingTimerInterval);
                recordingTimerInterval = null;
            }
            recordingStartTime = 0;
        };
        
        cameraMediaRecorder.start();
        isCameraRecording = true;
        
        // Start recording timer
        recordingStartTime = Date.now();
        const recordingTimer = document.getElementById('recordingTimer');
        if (recordingTimer) {
            recordingTimer.style.display = 'flex';
        }
        recordingTimerInterval = setInterval(updateRecordingTimer, 1000);
        
        // Update button states
        cameraStartRecordingBtn.disabled = true;
        cameraStopRecordingBtn.disabled = false;
        cameraCaptureBtn.disabled = true;
        cameraStartRecordingBtn.classList.add('recording');
        
    } catch (error) {
        console.error('MediaRecorder error:', error);
        // Try with different MIME type
        try {
            const recordingStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: currentFacingMode
                },
                audio: true
            });
            
            cameraMediaRecorder = new MediaRecorder(recordingStream);
            cameraMediaRecorder.ondataavailable = function(event) {
                if (event.data.size > 0) {
                    cameraRecordedChunks.push(event.data);
                }
            };
            cameraMediaRecorder.onstop = function() {
                const blob = new Blob(cameraRecordedChunks, { type: 'video/mp4' });
                showCameraPreview('video', blob);
                // Stop the recording stream
                recordingStream.getTracks().forEach(track => track.stop());
                
                // Stop timer
                if (recordingTimerInterval) {
                    clearInterval(recordingTimerInterval);
                    recordingTimerInterval = null;
                }
                recordingStartTime = 0;
            };
            cameraMediaRecorder.start();
            isCameraRecording = true;
            
            // Start recording timer
            recordingStartTime = Date.now();
            const recordingTimer = document.getElementById('recordingTimer');
            if (recordingTimer) {
                recordingTimer.style.display = 'flex';
            }
            recordingTimerInterval = setInterval(updateRecordingTimer, 1000);
            
            // Update button states
            cameraStartRecordingBtn.disabled = true;
            cameraStopRecordingBtn.disabled = false;
            cameraCaptureBtn.disabled = true;
            cameraStartRecordingBtn.classList.add('recording');
            
        } catch (fallbackError) {
            console.error('Fallback MediaRecorder also failed:', fallbackError);
            alert('Video recording not supported in this browser.');
        }
    }
}

function stopCameraRecording() {
    if (cameraMediaRecorder && isCameraRecording) {
        cameraMediaRecorder.stop();
        isCameraRecording = false;
        
        // Update button states
        cameraStartRecordingBtn.disabled = false;
        cameraStopRecordingBtn.disabled = true;
        cameraCaptureBtn.disabled = false;
        cameraStartRecordingBtn.classList.remove('recording');
        
        // Stop and hide timer
        if (recordingTimerInterval) {
            clearInterval(recordingTimerInterval);
            recordingTimerInterval = null;
        }
        const recordingTimer = document.getElementById('recordingTimer');
        if (recordingTimer) {
            recordingTimer.style.display = 'none';
        }
        recordingStartTime = 0;
    }
}

async function switchCamera() {
    if (!cameraStream) return;
    
    // Toggle between front and back camera
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    
    stopCamera();
    
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: currentFacingMode
            },
            audio: false // Keep audio off for preview
        });
        cameraVideoElement.srcObject = cameraStream;
        
    } catch (error) {
        console.error('Error switching camera:', error);
        // Try to revert to original camera
        try {
            currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user'; // Revert
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: currentFacingMode
                },
                audio: false
            });
            cameraVideoElement.srcObject = cameraStream;
        } catch (revertError) {
            console.error('Failed to revert camera:', revertError);
            closeCamera();
        }
    }
}

function showCameraPreview(type, blob) {
    const previewArea = document.querySelector('.camera-preview-area');
    const cameraPreview = document.querySelector('.camera-preview');
    const previewImage = document.getElementById('camera-preview-image');
    const previewVideo = document.getElementById('camera-preview-video');
    
    cameraPreview.style.display = 'none';
    previewArea.style.display = 'flex';
    
    if (type === 'photo') {
        const url = URL.createObjectURL(blob);
        previewImage.src = url;
        previewImage.style.display = 'block';
        previewVideo.style.display = 'none';
        previewImage.dataset.blobUrl = url;
    } else if (type === 'video') {
        const url = URL.createObjectURL(blob);
        previewVideo.src = url;
        previewVideo.style.display = 'block';
        previewImage.style.display = 'none';
        previewVideo.dataset.blobUrl = url;
    }
    
    // Store the blob for sending
    previewArea.dataset.mediaBlob = URL.createObjectURL(blob);
    previewArea.dataset.mediaType = type;
}

function resetCameraPreview() {
    const previewArea = document.querySelector('.camera-preview-area');
    const cameraPreview = document.querySelector('.camera-preview');
    const previewImage = document.getElementById('camera-preview-image');
    const previewVideo = document.getElementById('camera-preview-video');
    
    cameraPreview.style.display = 'block';
    previewArea.style.display = 'none';
    
    // Clean up blob URLs
    if (previewImage.dataset.blobUrl) {
        URL.revokeObjectURL(previewImage.dataset.blobUrl);
        delete previewImage.dataset.blobUrl;
    }
    if (previewVideo.dataset.blobUrl) {
        URL.revokeObjectURL(previewVideo.dataset.blobUrl);
        delete previewVideo.dataset.blobUrl;
    }
    if (previewArea.dataset.mediaBlob) {
        URL.revokeObjectURL(previewArea.dataset.mediaBlob);
        delete previewArea.dataset.mediaBlob;
    }
    
    previewImage.src = '';
    previewVideo.src = '';
    previewImage.style.display = 'none';
    previewVideo.style.display = 'none';
}

function retakeCameraMedia() {
    resetCameraPreview();
}

function sendCameraMedia() {
    const previewArea = document.querySelector('.camera-preview-area');
    const mediaBlobUrl = previewArea.dataset.mediaBlob;
    const mediaType = previewArea.dataset.mediaType;
    
    if (!mediaBlobUrl) return;
    
    // Convert blob URL back to blob for sending
    fetch(mediaBlobUrl)
        .then(response => response.blob())
        .then(blob => {
            // Determine file extension and type
            let fileExtension = mediaType === 'photo' ? 'jpg' : 'webm';
            let fileType = mediaType === 'photo' ? 'image/jpeg' : 'video/webm';
            let fileName = mediaType === 'photo' ? `photo-${Date.now()}.jpg` : `video-${Date.now()}.webm`;
            
            const file = new File([blob], fileName, { type: fileType });
            sendFile(file);
            closeCamera();
        })
        .catch(error => {
            console.error('Error sending media:', error);
            alert('Error sending media. Please try again.');
        });
}

/*
// PART 4: FIXED WebRTC Logic with Proper Cleanup - SYNTAX ERROR FIXED
*/

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
        const clientY = e.type === "touchstart" ? e.touches[0].clientY : e.clientY;

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
    micMuteBtn.textContent = isAudioMuted ? '' : '';
};

const toggleCamera = () => {
    if (!localStream) return;
    isVideoMuted = !isVideoMuted;
    localStream.getVideoTracks().forEach(track => track.enabled = !isVideoMuted);
    cameraMuteBtn.classList.toggle('active', !isVideoMuted);
    cameraMuteBtn.textContent = isVideoMuted ? '' : '';
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
    loudSpeakerBtn.textContent = isLoudspeakerOn ? '' : '';
};

const toggleFrontBackCamera = async () => {
    if (!localStream) return;
    
    try {
        const videoTrack = localStream.getVideoTracks()[0];
        if (!videoTrack) return;
        
        const currentFacingMode = videoTrack.getSettings().facingMode;
        const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

        videoTrack.stop();

        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: newFacingMode },
            audio: true
        });

        const sender = peerConnection?.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
            await sender.replaceTrack(newStream.getVideoTracks()[0]);
        }

        localStream = newStream;
        localVideo.srcObject = newStream;
        
        RESOURCES.localStreams.push(newStream);

    } catch (err) {
        console.error('Failed to switch camera:', err);
        showNotification('Failed to switch camera');
    }
};

const exitVideoCall = () => {
    endCall();
    videoCallOverlay?.classList.add('hidden');
    
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    
    elChatHeader?.classList.remove('hidden');
    composer?.classList.remove('hidden');
};

if (micMuteBtn) micMuteBtn.addEventListener('click', toggleMic);
if (cameraMuteBtn) cameraMuteBtn.addEventListener('click', toggleCamera);
if (loudSpeakerBtn) loudSpeakerBtn.addEventListener('click', toggleLoudspeaker);
if (exitCallBtn) exitCallBtn.addEventListener('click', exitVideoCall);
if (cameraToggleBtn) cameraToggleBtn.addEventListener('click', toggleFrontBackCamera);

const incomingCallOverlay = $('#incomingCallOverlay');
const acceptCallBtn = $('#acceptCallBtn');
const declineCallBtn = $('#declineCallBtn');

//  FIXED: Parameter name was broken across lines
function showIncomingCallNotification(caller, callType, offer) {
    const localContact = CONTACTS.find(c => c.id === caller.xameId);
    
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
        callerPicUrl = addCacheBuster(callerPicUrl);
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
        if (socket) {
            socket.emit('call-accepted', { recipientId: caller.xameId });
        }
    };
    
    declineCallBtn.onclick = () => {
        incomingCallOverlay.classList.add('hidden');
        if (socket) {
            socket.emit('call-rejected', { recipientId: caller.xameId, reason: 'user-rejected' });
        }
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

        RESOURCES.localStreams.push(localStream);

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
        RESOURCES.peerConnections.push(peerConnection);
        
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
            
            if (peerConnection.iceConnectionState === 'failed' || 
                peerConnection.iceConnectionState === 'disconnected') {
                showNotification('Connection lost. Ending call...');
                setTimeout(exitVideoCall, 2000);
            }
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Sending ICE candidate');
                if (socket) {
                    socket.emit('ice-candidate', {
                        recipientId,
                        candidate: event.candidate
                    });
                }
            }
        };
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log(`Adding local track: ${track.kind} - Enabled: ${track.enabled}`);
        });
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        if (socket) {
            socket.emit('call-user', {
                recipientId: recipientId, 
                offer: offer,           
                callType: callType      
            });
        }

    } catch (err) {
        console.error('Failed to get local stream or start call', err);
        showNotification('Failed to start call. Please check your camera and microphone permissions.');
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

        RESOURCES.localStreams.push(localStream);

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
        RESOURCES.peerConnections.push(peerConnection);
        
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
            
            if (peerConnection.iceConnectionState === 'failed' || 
                peerConnection.iceConnectionState === 'disconnected') {
                showNotification('Connection lost. Ending call...');
                setTimeout(exitVideoCall, 2000);
            }
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Sending ICE candidate');
                if (socket) {
                    socket.emit('ice-candidate', {
                        recipientId: senderId,
                        candidate: event.candidate
                    });
                }
            }
        };

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log(`Adding local track: ${track.kind} - Enabled: ${track.enabled}`);
        });

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        
        console.log('Processing pending ICE candidates:', pendingIceCandidates.length);
        for (const candidate of pendingIceCandidates) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('Failed to add ICE candidate:', error);
            }
        }
        pendingIceCandidates = [];

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        if (socket) {
            socket.emit('make-answer', {
                recipientId: senderId,
                answer
            });
        }
        
    } catch (err) {
        console.error('Failed to handle incoming call:', err);
        showNotification('Failed to accept call. Please check your camera and microphone permissions.');
        exitVideoCall();
    }
}

async function handleAnswer(answer) {
    console.log('Received answer');
    
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));

        console.log('Processing pending ICE candidates:', pendingIceCandidates.length);
        for (const candidate of pendingIceCandidates) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('Failed to add ICE candidate:', error);
            }
        }
        pendingIceCandidates = [];
    } catch (error) {
        console.error('Failed to handle answer:', error);
        showNotification('Call connection failed');
        exitVideoCall();
    }
}

function handleNewIceCandidate(candidate) {
    console.log('Received ICE candidate');
    
    if (peerConnection) {
        if (peerConnection.remoteDescription) {
            peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                .catch(error => {
                    console.error('Failed to add ICE candidate:', error);
                });
        } else {
            console.log('Remote description not set yet, queuing candidate.');
            pendingIceCandidates.push(candidate);
        }
    } else {
        console.error('Peer connection is not initialized.');
        pendingIceCandidates.push(candidate);
    }
}

function endCall() {
    console.log('Ending call and cleaning up resources...');
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log(`Stopped local track: ${track.kind}`);
        });
        localStream = null;
    }
    
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => {
            track.stop();
            console.log(`Stopped remote track: ${track.kind}`);
        });
        remoteStream = null;
    }
    
    RESOURCES.localStreams.forEach(stream => {
        stream.getTracks().forEach(track => track.stop());
    });
    RESOURCES.localStreams = [];
    
    RESOURCES.peerConnections.forEach(pc => {
        if (pc && pc.connectionState !== 'closed') {
            pc.close();
        }
    });
    RESOURCES.peerConnections = [];
    
    pendingIceCandidates = [];
    isAudioMuted = false;
    isVideoMuted = false;
    isLoudspeakerOn = false;
    
    console.log('Call ended and resources cleaned up.');
}

/*
// PART 5: Navigation and FIXED Contacts Rendering
*/

function show(section) {
  [elLanding, elRegister, elLogin, elContacts, elChat, elProfile, elStatus].forEach(s => s?.classList.add('hidden'));
  section?.classList.remove('hidden');
}

function handleLoginSuccess(user) {
    USER = user;
    
    // FIXED: Proper cache busting
    if (USER.profilePic) {
        USER.profilePic = addCacheBuster(USER.profilePic);
    }
    
    storage.set(KEYS.user, USER);
    setAvatarInitials();
    CONTACTS = ensureSeedContacts();
    DRAFTS = storage.get(KEYS.drafts, {});
    
    // CRITICAL FIX: Explicitly hide all other screens first
    [elLanding, elRegister, elLogin, elChat, elProfile, elStatus].forEach(s => s?.classList.add('hidden'));
    
    // Then show contacts
    show(elContacts);
    
    // Initialize camera functionality after login
    initCameraFunctionality();
    
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

function getChat(id) {
  return storage.get(KEYS.chat(id), []);
}

function setChat(id, arr) {
  storage.set(KEYS.chat(id), arr);
}

// FIXED: Debounced render function
const debouncedRenderContacts = debounce(renderContacts, 150);

function contactRow(c) {
  const profilePicUrl = (c.isProfilePicHidden || !c.profilePic) 
                        ? `${serverURL}/media/profile_pics/default.png` 
                        : addCacheBuster(c.profilePic);

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
      avatarContent = `<img class="profile-pic" src="${escapeHtml(profilePicUrl)}" alt="${escapeHtml(c.name || 'User')} profile picture" loading="lazy"/>`;
  } else {
      avatarContent = `<div class="profile-placeholder"><span>${escapeHtml(initialsOf(c))}</span></div>`;
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
        <div class="time">${escapeHtml(lastTime)}</div>
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
            /* Camera Modal Styles */
            .camera-modal {
                position: fixed;
                z-index: 10000;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.9);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .camera-modal.hidden {
                display: none;
            }
            .camera-modal-content {
                background-color: #000;
                margin: 2% auto;
                padding: 20px;
                width: 90%;
                max-width: 500px;
                border-radius: 15px;
                color: white;
            }
            .camera-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
            }
            .close-camera {
                background: none;
                border: none;
                color: white;
                font-size: 24px;
                cursor: pointer;
            }
            .camera-preview {
                width: 100%;
                background: #333;
                border-radius: 10px;
                overflow: hidden;
                margin-bottom: 15px;
            }
            #camera-video {
                width: 100%;
                height: 300px;
                object-fit: cover;
            }
            .camera-controls {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
                justify-content: center;
                margin-bottom: 15px;
            }
            .camera-btn {
                padding: 10px 15px;
                border: none;
                border-radius: 20px;
                background: #007bff;
                color: white;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 5px;
                font-size: 14px;
            }
            .camera-btn:disabled {
                background: #6c757d;
                cursor: not-allowed;
            }
            .capture-btn {
                background: #28a745;
            }
            .record-btn {
                background: #dc3545;
            }
            .stop-btn {
                background: #ffc107;
                color: #000;
            }
            .switch-btn {
                background: #6f42c1;
            }
            .camera-preview-area {
                text-align: center;
            }
            .camera-preview-controls {
                margin-top: 15px;
                display: flex;
                gap: 10px;
                justify-content: center;
            }
            .preview-btn {
                padding: 10px 20px;
                border: none;
                border-radius: 20px;
                cursor: pointer;
                font-size: 14px;
            }
            .send-btn {
                background: #28a745;
                color: white;
            }
            .retake-btn {
                background: #6c757d;
                color: white;
            }
        `;
        document.head.appendChild(style);
    }
}

function renderContacts(filter = '') {
  // CRITICAL FIX: Ensure contacts screen is visible and chat is hidden
  if (elContacts) {
    elContacts.classList.remove('hidden');
  }
  if (elChat) {
    elChat.classList.add('hidden');
  }
  if (contactList) {
    contactList.style.display = 'block';
  }

  let list = CONTACTS;
  if (filter) {
    const q = filter.trim().toLowerCase();
    list = list.filter(c => {
        const name = (c.name || '').toLowerCase();
        const id = (c.id || '').toLowerCase();
        return name.includes(q) || id.includes(q);
    });
  }

  const sortedContacts = list.sort((a, b) => {
      const tsA = b.lastInteractionTs || b.createdAt || 0;
      const tsB = a.lastInteractionTs || a.createdAt || 0;
      return tsA - tsB;
  });

  contactList.innerHTML = '';

  const selfContact = USER ? sortedContacts.find(c => c.id === USER.xameId) : null;
  const otherContacts = sortedContacts.filter(c => c.id !== (USER ? USER.xameId : null));

  if (!filter && selfContact) {
      const selfRow = document.createElement('div');
      selfRow.className = 'item fade-in';
      selfRow.dataset.userId = selfContact.id;
      const isSelfOnline = selfContact.online || false;
      const onlineStatusClass = isSelfOnline ? '' : 'hidden';

      let selfAvatarContent = '';
      if (selfContact.profilePic) {
          const picUrl = addCacheBuster(selfContact.profilePic);
          selfAvatarContent = `<img class="profile-pic" src="${escapeHtml(picUrl)}" alt="Your profile picture" loading="lazy"/>`;
      } else {
          selfAvatarContent = `<div class="profile-placeholder"><span>${escapeHtml(initialsOf(selfContact))}</span></div>`;
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

  if (otherContacts.length === 0 && !filter) {
      const welcomeMessage = document.createElement('div');
      welcomeMessage.className = 'empty-contact-list-message';
      welcomeMessage.style.cssText = `
          text-align: center;
          padding: 50px 20px;
          color: #777;
          font-size: 16px;
      `;
      
      welcomeMessage.innerHTML = `
          <h3 style="margin: 0 0 5px 0; font-weight: 900; color: #007bff; display: inline-block; font-size: 3em;">XamePage</h3>
          <span style="font-size: 0.8em; color: #999; margin-left: 5px; font-weight: 500;">2.1</span>
          <p style="font-size: 0.8em; color: #bbb; margin: 5px 0 0 0;">
              created by <strong style="font-weight: 700; color: #aaa;">Gibson Agbor</strong>
          </p>
          <p style="font-size: 12px; margin-top: 20px; color: #aaa;">Click on the "+" above to add a new contact, and call or start a conversation to see it appear here.</p>
      `;
      contactList.appendChild(welcomeMessage);
      
      contactsCount.textContent = `${0} contacts`;

  } else if (otherContacts.length > 0) {
    const allHeader = document.createElement('div');
    allHeader.className = 'contact-group-header';
    allHeader.textContent = 'All Contacts';
    contactList.appendChild(allHeader);
    
    otherContacts.forEach(c => contactList.appendChild(contactRow(c)));
    
    contactsCount.textContent = `${otherContacts.length} contact${otherContacts.length !== 1 ? 's' : ''}`;
  } else {
      contactsCount.textContent = `${0} contacts`;
  }
}

// FIXED: Enhanced openChat with proper cleanup and explicit screen switching
function openChat(id) {
    ACTIVE_ID = id;
    
    // CRITICAL FIX: Explicitly hide contacts and show chat
    if (elContacts) {
        elContacts.classList.add('hidden');
    }
    if (elChat) {
        elChat.classList.remove('hidden');
    }
    
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
                        : addCacheBuster(c.profilePic);

    let chatAvatarContent = '';
    if (c.profilePic && !c.isProfilePicHidden) {
        chatAvatarContent = `<img class="profile-pic" src="${escapeHtml(profilePicUrl)}" alt="${escapeHtml(c.name)} profile picture" loading="lazy"/>`;
    } else {
        chatAvatarContent = `<div class="profile-placeholder"><span>${escapeHtml(initialsOf(c))}</span></div>`;
    }

    elChatHeader.innerHTML = `
      <div class="icon-btn-group">
          <button class="icon-btn" id="backBtn"></button>
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
                  
              </button>
          </div>
      </div>
    `;

    $('#chatName').textContent = c.name;
    $('#chatSub').textContent = c.online ? 'Online' : 'Offline';
    $('#contactIdDisplay').textContent = c.id;
    
    const newBackBtn = $('#backBtn');
    if (newBackBtn) {
        newBackBtn.addEventListener('click', () => {
            // CRITICAL FIX: Explicitly show contacts and hide chat
            if (elChat) {
                elChat.classList.add('hidden');
            }
            if (elContacts) {
                elContacts.classList.remove('hidden');
            }
            debouncedRenderContacts();
        });
    }
    
    const newChatMoreBtn = $('#chatMoreBtn');
    if (newChatMoreBtn) {
        newChatMoreBtn.addEventListener('click', renderChatMoreMenu);
    }

    renderMessages();
    
    if (composer) {
        composer.classList.remove('hidden');
        composer.style.display = 'flex';
        composer.style.visibility = 'visible';
        composer.style.opacity = '1';
        composer.style.position = 'relative';
        composer.style.bottom = '0';
    }
    
    if (voiceNoteControl) voiceNoteControl.classList.add('hidden');
    if (messageInput) messageInput.classList.remove('hidden');
    if (attachBtn) attachBtn.classList.remove('hidden');
    if (micBtn) micBtn.classList.remove('hidden');
    
    const draft = DRAFTS[id] || '';
    if (messageInput) {
        messageInput.value = draft;
        messageInput.focus();
    }
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
// PART 6: Chat More Menu & Contact Management with Fixes
*/

function renderChatMoreMenu() {
    const wrap = document.createElement('div');
    wrap.className = 'menu-panel dialog-like';
    wrap.innerHTML = `
        <div class="menu-item" id="voiceCallBtn"> Voice Call</div>
        <div class="menu-item" id="videoCallBtn"> Video Call</div>
        <div class="menu-item" id="editContactBtn"> Edit Contact Name</div>
        <div class="menu-item" id="clearChatBtn"> Clear Chat</div>
        <div class="menu-item" id="deleteContactBtn"> Delete Contact</div>
    `;

    const chatMoreBtn = $('#chatMoreBtn');
    if (!chatMoreBtn) return;
    
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

    const voiceCallBtn = wrap.querySelector('#voiceCallBtn');
    const videoCallBtn = wrap.querySelector('#videoCallBtn');
    const editContactBtn = wrap.querySelector('#editContactBtn');
    const clearChatBtn = wrap.querySelector('#clearChatBtn');
    const deleteContactBtn = wrap.querySelector('#deleteContactBtn');

    if (voiceCallBtn) {
        voiceCallBtn.addEventListener('click', () => {
            startCall(ACTIVE_ID, 'voice');
            closeDialog();
        });
    }

    if (videoCallBtn) {
        videoCallBtn.addEventListener('click', () => {
            startCall(ACTIVE_ID, 'video');
            closeDialog();
        });
    }

    if (editContactBtn) {
        editContactBtn.addEventListener('click', () => {
            if (!ACTIVE_ID) return;
            const c = CONTACTS.find(x => x.id === ACTIVE_ID);
            if (c && ACTIVE_ID !== USER.xameId) {
                closeDialog();
                openDialog(renderEditContactDialog(c));
            } else {
                showNotification('Cannot edit this contact.');
            }
        });
    }
    
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', () => {
            if (!ACTIVE_ID) return;
            if (confirm('Are you sure you want to clear messages in this chat?')) { 
                setChat(ACTIVE_ID, []);
                const c = CONTACTS.find(x => x.id === ACTIVE_ID);
                if(c) {
                    c.lastInteractionTs = now();
                    c.lastInteractionPreview = 'Chat cleared.';
                    storage.set(KEYS.contacts, CONTACTS);
                }
                renderMessages();
                closeDialog();
                showNotification('Chat cleared successfully.');
            }
        });
    }

    if (deleteContactBtn) {
        deleteContactBtn.addEventListener('click', () => {
            const id = ACTIVE_ID;
            if (!id) return;
            const c = CONTACTS.find(x => x.id === id);
            if (!c) return;
            if (id === USER.xameId) {
                showNotification('Cannot delete the self chat.');
                return;
            }
            
            if (confirm(`Permanently delete contact "${c.name || id}" and ALL chat/call history? This cannot be undone.`)) {
                deleteContact(id); 
                closeDialog();
            }
        });
    }

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
            
            debouncedRenderContacts(searchInput.value); 
            
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
    if (confirm('Are you sure you want to clear ALL messages from ALL chats? This action cannot be undone.')) {
        
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
            if (messageInput) {
                messageInput.value = DRAFTS[ACTIVE_ID] || '';
            }
            updateComposerButtons();
        }
        debouncedRenderContacts(searchInput.value);
        
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

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => closeDialog());
    }

    if (saveBtn) {
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
                        
                        debouncedRenderContacts(searchInput.value);
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
    }

    return wrap;
}

/*
// PART 7: FIXED Message Bubble with Waveform & Memory Leak Prevention
*/

// FIXED: Comprehensive cleanup function for WaveSurfer instances
function cleanupWaveSurfers() {
    if (!messagesEl) return;
    
    // Destroy all WaveSurfer instances attached to bubbles
    const bubbles = messagesEl.querySelectorAll('.bubble');
    bubbles.forEach(bubble => {
        if (bubble.wavesurfer) {
            try {
                if (typeof bubble.wavesurfer.destroy === 'function') {
                    bubble.wavesurfer.destroy();
                    console.log('Destroyed wavesurfer instance');
                }
            } catch (error) {
                console.error('Error destroying wavesurfer:', error);
            }
            delete bubble.wavesurfer;
        }
    });
    
    // Clear the resources map
    RESOURCES.wavesurfers.forEach((ws, key) => {
        try {
            if (ws && typeof ws.destroy === 'function') {
                ws.destroy();
            }
        } catch (error) {
            console.error('Error destroying tracked wavesurfer:', error);
        }
    });
    RESOURCES.wavesurfers.clear();
}

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
  };
  
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
              <button class="icon-btn speak-btn"></button>
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
      
      // FIXED: Proper file URL construction
      let fileUrl = constructFileUrl(m.file.url);
      
      console.log(' File URL:', {
          original: m.file.url,
          constructed: fileUrl
      });
      
      const fileType = m.file.type;
      const fileName = m.file.name || 'file';
      
      // IMAGE HANDLING
      if (fileType.startsWith('image/')) {
          fileContent = `
              <div class="image-preview" data-url="${escapeHtml(fileUrl)}">
                  <img src="${escapeHtml(fileUrl)}" alt="${escapeHtml(fileName)}" loading="lazy">
                  <div class="image-overlay">
                      <button class="view-fullscreen-btn"> View</button>
                  </div>
              </div>
          `;
      } 
      // VIDEO HANDLING
      else if (fileType.startsWith('video/')) {
          fileContent = `
              <div class="video-preview">
                  <video src="${escapeHtml(fileUrl)}" controls preload="metadata">
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
                  <audio id="${audioId}" src="${escapeHtml(fileUrl)}" preload="metadata"></audio>
                  <div class="waveform-container" id="waveform-container-${m.id}">
                      <div class="waveform-loading">Loading waveform...</div>
                  </div>
                  <div class="audio-controls">
                      <button class="audio-play-btn" data-audio-id="${audioId}"></button>
                      <span class="audio-time">0:00</span>
                      <a href="${escapeHtml(fileUrl)}" download="${escapeHtml(fileName)}" class="download-btn" title="Download"></a>
                  </div>
              </div>
          `;
      } 
      // DOCUMENT HANDLING
      else {
          const fileIcon = getFileIcon(fileType, fileName);
          fileContent = `
              <a href="${escapeHtml(fileUrl)}" target="_blank" download="${escapeHtml(fileName)}" class="document-preview">
                  <div class="doc-icon">${fileIcon}</div>
                  <div class="doc-details">
                      <span class="doc-name">${escapeHtml(fileName)}</span>
                      <span class="doc-type">${escapeHtml(fileType.split('/')[1]?.toUpperCase() || 'FILE')}</span>
                  </div>
                  <button class="doc-download-btn" title="Download"></button>
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

      // FIXED: Audio waveform initialization with proper cleanup
      if (fileType.startsWith('audio/')) {
          const audioElement = div.querySelector(`#audio-${m.id}`);
          const waveformContainer = div.querySelector(`#waveform-container-${m.id}`);
          const playBtn = div.querySelector('.audio-play-btn');
          const timeDisplay = div.querySelector('.audio-time');
          
          if (audioElement && waveformContainer && typeof WaveSurfer !== 'undefined') {
              // Check if WaveSurfer already exists for this message
              const existingWs = RESOURCES.wavesurfers.get(m.id);
              if (existingWs) {
                  try {
                      existingWs.destroy();
                      RESOURCES.wavesurfers.delete(m.id);
                  } catch (e) {
                      console.error('Failed to destroy existing WaveSurfer:', e);
                  }
              }
              
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
                      if (timeDisplay) {
                          timeDisplay.textContent = formatDuration(duration);
                      }
                  });

                  wavesurfer.on('audioprocess', () => {
                      const currentTime = wavesurfer.getCurrentTime();
                      if (timeDisplay) {
                          timeDisplay.textContent = formatDuration(currentTime);
                      }
                  });

                  wavesurfer.on('finish', () => {
                      if (playBtn) {
                          playBtn.textContent = '';
                      }
                  });

                  if (playBtn) {
                      playBtn.addEventListener('click', (e) => {
                          e.stopPropagation();
                          if (wavesurfer.isPlaying()) {
                              wavesurfer.pause();
                              playBtn.textContent = '';
                          } else {
                              wavesurfer.play();
                              playBtn.textContent = '';
                          }
                      });
                  }

                  // FIXED: Track wavesurfer instance for cleanup
                  div.wavesurfer = wavesurfer;
                  RESOURCES.wavesurfers.set(m.id, wavesurfer);
                  
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
              <span class="file-icon"></span>
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

/*
// PART 8: Message Selection & Management
*/

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
        icon: '',
        action: () => {
            copyMessages(selectedMessages);
            exitSelectMode();
            closeDialog();
        }
    }, {
        label: `Forward ${count} message${count === 1 ? '' : 's'}`,
        icon: '',
        action: () => {
            forwardMessages(selectedMessages);
            exitSelectMode();
            closeDialog();
        }
    }, {
        label: `Delete for me (${count})`,
        icon: '',
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
            icon: '',
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
    
    const deleteBtnElement = elChatHeader.querySelector('#deleteSelectedBtn');
    if (!deleteBtnElement) return;
    
    const deleteBtnRect = deleteBtnElement.getBoundingClientRect();
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
        item.innerHTML = `<span style="margin-right: 10px;">${opt.icon}</span> ${escapeHtml(opt.label)}`;
        item.addEventListener('click', opt.action);
        wrap.appendChild(item);
    });

    openMenuDialog(wrap);
}

function renderTicks(status) {
    if (status === 'seen') {
        return '<span class="tick-seen"></span>';
    } else if (status === 'delivered') {
        return '<span class="tick-delivered"></span>';
    } else {
        return '<span class="tick-sent"></span>';
    }
}

// FIXED: Enhanced renderMessages with proper cleanup and pagination
const MESSAGE_PAGE_SIZE = 100; // Load 100 messages at a time
let currentMessagePage = 1;
let isLoadingMoreMessages = false;

function renderMessages() {
  if (!messagesEl) return;
  
  // CRITICAL FIX: Clean up existing WaveSurfers BEFORE clearing DOM
  const existingBubbles = Array.from(messagesEl.querySelectorAll('.bubble'));
  existingBubbles.forEach(bubble => {
    if (bubble.wavesurfer && typeof bubble.wavesurfer.destroy === 'function') {
      try {
        bubble.wavesurfer.destroy();
        console.log('Destroyed WaveSurfer before re-render');
      } catch (e) {
        console.error('WaveSurfer destroy error:', e);
      }
      delete bubble.wavesurfer;
    }
  });
  
  // Clear the resources map
  RESOURCES.wavesurfers.forEach((ws, key) => {
    try {
      if (ws && typeof ws.destroy === 'function') {
        ws.destroy();
      }
    } catch (e) {
      console.error('Error destroying tracked WaveSurfer:', e);
    }
  });
  RESOURCES.wavesurfers.clear();
  
  // Clear DOM
  messagesEl.innerHTML = '';
  
  const msgs = getChat(ACTIVE_ID);
  
  // Implement pagination for performance
  const totalMessages = msgs.length;
  const messagesToShow = Math.min(MESSAGE_PAGE_SIZE * currentMessagePage, totalMessages);
  const startIndex = Math.max(0, totalMessages - messagesToShow);
  const visibleMsgs = msgs.slice(startIndex);
  
  let lastDay = '';
  
  // Use DocumentFragment for better performance
  const fragment = document.createDocumentFragment();
  
  visibleMsgs.forEach(m => {
    const label = dayLabel(m.ts);
    if (label !== lastDay) {
      const sep = document.createElement('div');
      sep.className = 'h-sub';
      sep.style.textAlign = 'center';
      sep.style.margin = '8px 0';
      sep.textContent = label;
      fragment.appendChild(sep);
      lastDay = label;
    }
    const bubble = messageBubble(m);
    fragment.appendChild(bubble);
  });
  
  messagesEl.appendChild(fragment);
  
  // Show load more button if there are more messages
  if (startIndex > 0 && !isLoadingMoreMessages) {
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'load-more-messages-btn';
    loadMoreBtn.textContent = `Load ${Math.min(MESSAGE_PAGE_SIZE, startIndex)} more messages`;
    loadMoreBtn.style.cssText = `
      display: block;
      margin: 10px auto;
      padding: 8px 16px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
    `;
    loadMoreBtn.addEventListener('click', () => {
      currentMessagePage++;
      isLoadingMoreMessages = true;
      renderMessages();
      isLoadingMoreMessages = false;
    });
messagesEl.insertBefore(loadMoreBtn, messagesEl.firstChild);
  }
  
  scrollToBottom();
}

function enterSelectMode() {
    const toolbarHtml = `
        <div class="selection-toolbar-wrapper">
            <button class="icon-btn" id="exitSelectModeBtn" title="Exit selection mode"></button>
            <div class="counter">${selectedMessages.length} selected</div> 
            <div class="toolbar">
                <button class="icon-btn" id="copySelectedBtn" title="Copy messages"></button>
                <button class="icon-btn" id="forwardSelectedBtn" title="Forward messages"></button>
                <button class="icon-btn" id="deleteSelectedBtn" title="Delete messages"></button>
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
    
    if (newExitBtn) {
        newExitBtn.addEventListener('click', exitSelectMode);
    }
    if (newDeleteBtn) {
        newDeleteBtn.addEventListener('click', renderDeleteMenu);
    }
    if (newCopyBtn) {
        newCopyBtn.addEventListener('click', () => {
            copyMessages(selectedMessages);
            exitSelectMode();
        });
    }
    if (newForwardBtn) {
        newForwardBtn.addEventListener('click', () => {
            forwardMessages(selectedMessages);
            exitSelectMode();
        });
    }
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
    
    // Reset pagination when exiting select mode
    currentMessagePage = 1;
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
        .map(m => m.text || '[Attachment]');
    
    if (messagesToCopy.length > 0) {
        const textToCopy = messagesToCopy.join('\n\n');
        navigator.clipboard.writeText(textToCopy).then(() => {
            showNotification('Messages copied!');
        }).catch(err => {
            console.error('Failed to copy messages:', err);
            showNotification('Failed to copy messages.');
        });
    }
}

function forwardMessages(messageIds) {
    const chat = getChat(ACTIVE_ID);
    const messagesToForward = chat.filter(m => messageIds.includes(m.id));
    const messageCount = messagesToForward.length;
    
    if (messageCount > 0) {
        showNotification(`Ready to forward ${messageCount} message${messageCount === 1 ? '' : 's'}.`);
    }
}

/*
// PART 9:
// Dialogs, Menus, Profile Management & Core UI Listeners (Updated for composer menu fix)
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

// --- Composer More Options Menu Handler (FIX FOR THREE DOTS) ---
const moreOptionsBtn = document.getElementById('more-options-btn');
const moreOptionsDropdown = document.getElementById('more-options-dropdown');

if (moreOptionsBtn && moreOptionsDropdown) {
    moreOptionsBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        
        // Toggle the visibility of the options dropdown
        moreOptionsDropdown.classList.toggle('hidden');
        moreOptionsBtn.setAttribute(
            'aria-expanded', 
            moreOptionsDropdown.classList.contains('hidden') ? 'false' : 'true'
        );
    });

    // Close the dropdown if the user clicks anywhere else on the document
    document.addEventListener('click', (e) => {
        // Check if the click target is outside both the button and the dropdown content
        if (!moreOptionsBtn.contains(e.target) && !moreOptionsDropdown.contains(e.target)) {
            moreOptionsDropdown.classList.add('hidden');
            moreOptionsBtn.setAttribute('aria-expanded', 'false');
        }
    });
}
// -------------------------------------------------------------

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

/*
// PART 10: FIXED Profile Management
*/

function loadProfileData() {
  if (preferredNameInput) {
      preferredNameInput.value = USER.preferredName || '';
  }
  
  // FIXED: Proper profile picture URL handling
  const profilePicUrl = USER.profilePic 
                        ? addCacheBuster(USER.profilePic)
                        : `${serverURL}/media/profile_pics/default.png`;
                        
  if (profilePicPreview) {
      profilePicPreview.src = profilePicUrl;
      profilePicPreview.onerror = function() {
          console.error('Failed to load profile picture');
          this.src = `${serverURL}/media/profile_pics/default.png`;
      };
  }
  
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

if (profileBackBtn) {
    profileBackBtn.addEventListener('click', () => {
        show(elContacts);
        debouncedRenderContacts();
    });
}

if (profilePicInput) {
    profilePicInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // Validate file
      const validation = validateFile(file);
      if (!validation.valid) {
          showNotification(validation.error);
          profilePicInput.value = '';
          return;
      }
      
      const reader = new FileReader();
      reader.onload = () => {
        if (cropImage) {
            cropImage.src = reader.result;
            openCropModal();
        }
      };
      reader.onerror = () => {
          showNotification('Failed to read image file');
      };
      reader.readAsDataURL(file);
    });
}

let isRemoveProfilePicClicked = false;

if (removeProfilePicBtn) {
    removeProfilePicBtn.addEventListener("click", () => {
      isRemoveProfilePicClicked = true;
      if (profilePicPreview) {
          profilePicPreview.src = `${serverURL}/media/profile_pics/default.png`;
      }
      showNotification('Profile picture will be removed when you save.');
    });
}

// FIXED: Comprehensive profile save with proper error handling
if (saveProfileBtn) {
    saveProfileBtn.addEventListener("click", async () => {
        const preferredName = preferredNameInput.value.trim();
        const hideName = hideNameCheckbox?.checked || false;
        const hidePic = hidePicCheckbox?.checked || false;
        
        if (preferredName.length < 2) {
            showNotification("Preferred name must be at least 2 characters.");
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

            // FIXED: Consolidated profile picture logic
            const currentPreviewSrc = profilePicPreview.src;
            const isDefaultPic = currentPreviewSrc.includes('default.png');
            
            if (isRemoveProfilePicClicked) {
                console.log(' Profile removal requested.');
                formData.append("removeProfilePic", "true");
                isRemoveProfilePicClicked = false;
                closeCropModal(); 
            } 
            else if (currentPreviewSrc.startsWith('data:image/')) {
                console.log(' Detecting new image from preview source...');
                
                try {
                    const blob = await fetch(currentPreviewSrc).then(res => res.blob());
                    
                    if (blob.size === 0) {
                        throw new Error('Processed image blob is empty.');
                    }

                    formData.append("profilePic", blob, "profile_pic.jpg");
                    console.log(' New profile pic blob added to FormData.');
                } catch (blobError) {
                    console.error('Failed to process image blob:', blobError);
                    throw new Error('Failed to process profile picture');
                }
            } 
            else {
                console.log(' No change to profile picture.');
            }

            closeCropModal();

            console.log(' Sending to:', `${serverURL}/api/update-profile`);
            const response = await fetch(`${serverURL}/api/update-profile`, {
                method: 'POST',
                body: formData
            });

            console.log(' Response status:', response.status, response.statusText);
            
            if (!response.ok) {
                throw new Error(`Server error: ${response.status} ${response.statusText}`);
            }
            
            const result = await response.json();
            console.log(' Server response:', result);

            if (result.success) {
                showNotification("Profile saved successfully!");
                USER.preferredName = result.preferredName;
                
                USER.privacySettings = {
                    hidePreferredName: result.hidePreferredName,
                    hideProfilePicture: result.hideProfilePicture
                };
                
                if (result.profilePicUrl) {
                    const newUrl = addCacheBuster(result.profilePicUrl);
                    
                    console.log(' New profile picture URL:', newUrl);
                    
                    profilePicPreview.src = newUrl;
                    profilePicPreview.onerror = function() {
                        console.error(' Failed to load new profile picture');
                        this.src = `${serverURL}/media/profile_pics/default.png`;
                        USER.profilePic = '';
                    };
                    profilePicPreview.onload = function() {
                        console.log(' Profile picture loaded successfully');
                    };
                    
                    USER.profilePic = newUrl;
                } else {
                    console.log(' No profile picture URL in response');
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
                
                console.log(' Profile save complete');
                show(elContacts);
                debouncedRenderContacts();
            } else {
                console.error(' Save failed:', result.message);
                showNotification("Failed to save profile: " + (result.message || "Unknown error."));
            }
        } catch (err) {
            console.error(" Profile save error:", err);
            showNotification("Error saving profile: " + err.message);
        } finally {
            saveProfileBtn.textContent = 'Save Changes';
            saveProfileBtn.disabled = false;
        }
    });
}

function openCropModal() {
  if (!cropModal) return;
  
  cropModal.classList.remove('hidden');
  if (cropper) {
    cropper.destroy();
  }
  
  try {
      cropper = new Cropper(cropImage, {
        aspectRatio: 1,
        viewMode: 1,
        guides: true,
        autoCropArea: 0.8,
      });
  } catch (error) {
      console.error('Failed to initialize cropper:', error);
      showNotification('Failed to initialize image editor');
      closeCropModal();
  }
}

function closeCropModal() {
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
  if (cropImage) cropImage.src = '';
  if (cropModal) cropModal.classList.add('hidden');
}

if (cropCancelBtn) {
    cropCancelBtn.addEventListener('click', closeCropModal);
}

if (cropSaveBtn) {
    cropSaveBtn.addEventListener('click', () => {
      if (cropper) {
        try {
            const croppedCanvas = cropper.getCroppedCanvas({
              width: 256,
              height: 256,
            });
            const croppedImageURL = croppedCanvas.toDataURL('image/png');
            if (profilePicPreview) {
                profilePicPreview.src = croppedImageURL;
            }
            closeCropModal();
        } catch (error) {
            console.error('Failed to crop image:', error);
            showNotification('Failed to crop image');
            closeCropModal();
        }
      }
    });
}

/*
// PART 11: Status & Dialogs
*/

function showStatus() {
    show(elStatus);
    if (myStatusTime) {
        myStatusTime.textContent = 'Last update: ' + fmtTime(now());
    }
}

if (statusBackBtn) {
    statusBackBtn.addEventListener('click', () => {
        show(elContacts);
    });
}

function closeDialog() {
  if (layer) layer.innerHTML = '';
}

function openDialog(node) {
  if (!layer) return;
  
  layer.innerHTML = '';
  layer.appendChild(node);
  setTimeout(() => {
    const closeHandler = (e) => {
      if (!node.contains(e.target)) {
        closeDialog();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 0);
}

function openMenuDialog(node) {
  if (!layer) return;
  
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
  if (!messageInput || !micBtn || !sendBtn) return;
  
  if (messageInput.value.trim().length > 0) {
    micBtn.classList.add('hidden');
    sendBtn.classList.remove('hidden');
  } else {
    micBtn.classList.remove('hidden');
    sendBtn.classList.add('hidden');
  }
}

/*
// PART 12: FIXED File Upload Handling
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
      
      console.log(' File selected:', {
          name: file.name,
          type: file.type,
          size: file.size
      });
      
      const validation = validateFile(file);
      if (!validation.valid) {
          showNotification(validation.error);
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

// FIXED: Complete sendFile function with fetch API and retry logic
function sendFile(file) {
    if (!ACTIVE_ID || !socket) {
        console.error('Cannot send file: No active chat or socket connection');
        showNotification('Cannot send file. Please check your connection.');
        return;
    }
    
    console.log(' Starting file upload:', file.name);
    
    const msgId = uid();
    const ts = now();
    
    const pendingMsg = {
        id: msgId,
        text: ` Uploading ${file.name}...`,
        type: 'sent',
        ts: ts,
        status: 'sending',
        isPending: true
    };

    const chat = getChat(ACTIVE_ID);
    chat.push(pendingMsg);
    setChat(ACTIVE_ID, chat);
    renderMessages();

    const progressDiv = createUploadProgress(msgId, file.name);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('senderId', USER.xameId);
    formData.append('recipientId', ACTIVE_ID);
    formData.append('messageId', msgId);
    
    console.log(' Uploading to server...');
    
    const xhr = new XMLHttpRequest();
    currentUpload = xhr;
    
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
                console.log(' Upload response:', data);
                
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

                        console.log(' Sending file message via socket...');
                        
                        // FIXED: Using correct socket event
                        if (socket) {
                            socket.emit('send-message', {
                                recipientId: ACTIVE_ID,
                                message: finalMessage
                            }, (response) => {
                                console.log('Socket response:', response);
                                if (response && response.success) {
                                    chatToUpdate[msgIndex].status = 'delivered';
                                    setChat(ACTIVE_ID, chatToUpdate);
                                    renderMessages();
                                    console.log(' File message delivered successfully');
                                    showNotification('File sent successfully!');
                                } else {
                                    console.error("Socket delivery failed:", response?.message);
                                    showNotification('File uploaded but delivery failed');
                                }
                            });
                        }
                    }
                } else {
                    throw new Error(data.message || 'Upload failed - no URL returned');
                }
            } catch (error) {
                console.error(' Failed to parse upload response:', error);
                handleUploadError(msgId, error.message);
            }
        } else {
            console.error(' Upload failed with status:', xhr.status);
            handleUploadError(msgId, `Server error: ${xhr.status}`);
        }
        
        currentUpload = null;
    });
    
    xhr.addEventListener('error', function() {
        console.error(' Network error during upload');
        removeUploadProgress(msgId);
        handleUploadError(msgId, 'Network error during upload');
        currentUpload = null;
    });
    
    xhr.addEventListener('abort', function() {
        console.log(' Upload cancelled by user');
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

/*
// PART 13: FIXED Voice Note Recording with Better Format Support
*/

if (micBtn) {
    micBtn.addEventListener('click', () => {
        console.log(' Voice note mode activated');
        if (messageInput) messageInput.classList.add('hidden');
        if (sendBtn) sendBtn.classList.add('hidden');
        if (attachBtn) attachBtn.classList.add('hidden');
        if (voiceNoteControl) voiceNoteControl.classList.remove('hidden');
    });
}

function resetVoiceRecorderUI() {
    if (messageInput) messageInput.classList.remove('hidden');
    if (attachBtn) attachBtn.classList.remove('hidden');
    if (voiceNoteControl) voiceNoteControl.classList.add('hidden');
    if (recordBtn) recordBtn.classList.remove('hidden');
    if (stopRecordBtn) stopRecordBtn.classList.add('hidden');
    if (playBtn) playBtn.classList.add('hidden');
    if (sendVoiceBtn) sendVoiceBtn.classList.add('hidden');
    updateComposerButtons();
}

if (recordBtn) {
    recordBtn.addEventListener('click', async () => {
        try {
            console.log(' Starting audio recording...');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // FIXED: Better format detection
            const mimeTypes = [
                'audio/webm;codecs=opus',
                'audio/ogg;codecs=opus',
                'audio/webm',
                'audio/mp4',
                ''  // Let browser choose
            ];
            
            let mimeType = mimeTypes.find(type => 
                type === '' || MediaRecorder.isTypeSupported(type)
            );
            
            console.log(' Using MIME type:', mimeType || 'browser default');
            
            const options = mimeType ? { mimeType } : {};
            mediaRecorder = new MediaRecorder(stream, options);
            RESOURCES.mediaRecorders.push(mediaRecorder);
            
            audioChunks = [];
            audioBlob = null;
            
            if (recordBtn) recordBtn.classList.add('hidden');
            if (stopRecordBtn) stopRecordBtn.classList.remove('hidden');
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    console.log(" Audio data chunk:", event.data.size, "bytes");
                    audioChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = () => {
                console.log(" Recording stopped. Total chunks:", audioChunks.length);
                
                if (audioChunks.length > 0) {
                    audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
                    console.log(" Audio Blob created:", audioBlob.size, "bytes, type:", audioBlob.type);
                    
                    if (audioBlob.size > 0) {
                        if (playBtn) playBtn.classList.remove('hidden');
                        if (sendVoiceBtn) sendVoiceBtn.classList.remove('hidden');
                        if (stopRecordBtn) stopRecordBtn.classList.add('hidden');
                    } else {
                        console.error(" Audio Blob is empty");
                        showNotification("Recording failed. Please try again.");
                        resetVoiceRecorderUI();
                    }
                } else {
                    console.error(" No audio chunks recorded");
                    showNotification("No audio was captured. Please try again.");
                    resetVoiceRecorderUI();
                }
                
                stream.getTracks().forEach(track => track.stop());
            };
            
            mediaRecorder.start();
            console.log(" Recording started...");

        } catch (err) {
            console.error(' Recording failed:', err);
            showNotification('Could not start recording. Check microphone permissions.');
            resetVoiceRecorderUI();
        }
    });
}

if (stopRecordBtn) {
    stopRecordBtn.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            console.log(' Stopping recording...');
            mediaRecorder.stop();
        }
    });
}

if (playBtn) {
    playBtn.addEventListener('click', () => {
        if (audioBlob) {
            console.log(' Playing recorded audio...');
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audio.play();
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
            };
            audio.onerror = () => {
                showNotification('Failed to play audio');
                URL.revokeObjectURL(audioUrl);
            };
        }
    });
}

if (sendVoiceBtn) {
    sendVoiceBtn.addEventListener('click', () => {
        if (audioBlob && audioBlob.size > 0) {
            console.log(' Sending voice note...');
            const timestamp = Date.now();
            
            // Determine file extension based on blob type
            let extension = 'webm';
            if (audioBlob.type.includes('mp4')) {
                extension = 'mp4';
            } else if (audioBlob.type.includes('ogg')) {
                extension = 'ogg';
            } else if (audioBlob.type.includes('mpeg')) {
                extension = 'mp3';
            }
            
            const audioFile = new File(
                [audioBlob], 
                `voicenote-${timestamp}.${extension}`, 
                { type: audioBlob.type }
            );
            sendFile(audioFile);
            resetVoiceRecorderUI();
            audioBlob = null;
            audioChunks = [];
        } else {
            console.error(" Cannot send empty audio blob");
            showNotification("No audio to send. Please record again.");
            resetVoiceRecorderUI();
        }
    });
}

// Speech-to-text button
const speechToTextBtn = document.createElement('button');
speechToTextBtn.className = 'icon-btn voice-text-btn';
speechToTextBtn.innerHTML = '';
speechToTextBtn.title = 'Voice to text';

speechToTextBtn.addEventListener('click', () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        return showNotification('Your browser does not support Speech Recognition.');
    }
    
    if (speechRecognizer && speechRecognizer.running) {
        speechRecognizer.stop();
        return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRecognizer = new SpeechRecognition();
    speechRecognizer.continuous = false;
    speechRecognizer.interimResults = false;
    speechRecognizer.lang = 'en-US';
    
    speechRecognizer.onstart = () => {
        speechToTextBtn.innerHTML = '';
        if (messageInput) messageInput.placeholder = 'Listening...';
    };
    
    speechRecognizer.onend = () => {
        speechToTextBtn.innerHTML = '';
        if (messageInput) messageInput.placeholder = 'Type a message...';
    };
    
    speechRecognizer.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (messageInput) {
            messageInput.value = transcript;
            messageInput.focus();
            updateComposerButtons();
        }
    };
    
    speechRecognizer.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        speechToTextBtn.innerHTML = '';
        if (messageInput) messageInput.placeholder = 'Type a message...';
        showNotification('Error with voice input. Try again.');
    };
    
    try {
        speechRecognizer.start();
    } catch (error) {
        console.error('Failed to start speech recognition:', error);
        showNotification('Failed to start voice input');
    }
});

if (composer && messageInput) {
  composer.insertBefore(speechToTextBtn, messageInput.nextSibling);
}

function textToVoice(text) {
    if (!('speechSynthesis' in window)) {
        return showNotification('Your browser does not support Text-to-Speech.');
    }
    
    try {
        // Cancel any ongoing speech
        speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        utterance.onerror = (event) => {
            console.error('Speech synthesis error:', event);
            showNotification('Failed to speak text');
        };
        
        speechSynthesis.speak(utterance);
    } catch (error) {
        console.error('Text-to-speech error:', error);
        showNotification('Failed to speak text');
    }
}

function scrollToBottom() {
  if (messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

/*
// PART 14: Message Sending & Management
*/

// FIXED: Add render batching to prevent freezes
let renderScheduled = false;
let pendingRenderType = null;

function scheduleRender(renderFn, type = 'messages') {
  if (renderScheduled && pendingRenderType === type) return;
  
  renderScheduled = true;
  pendingRenderType = type;
  
  requestAnimationFrame(() => {
    renderFn();
    renderScheduled = false;
    pendingRenderType = null;
  });
}

function sendMessage(text) {
    if (!ACTIVE_ID || !socket) {
        showNotification('Cannot send message. Check your connection.');
        return;
    }
    
    if (!text || !text.trim()) {
        return;
    }
    
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
    
    // FIXED: Use batched rendering
    scheduleRender(renderMessages, 'messages');
    
    socket.emit('send-message', {
        recipientId: ACTIVE_ID,
        message: {
            id: msgId,
            text: text,
            ts: ts
        }
    }, (response) => {
      console.log('Server acknowledged message:', response);
      if (response && response.success && response.messageId) {
        const chatToUpdate = getChat(ACTIVE_ID);
        const msgIndex = chatToUpdate.findIndex(m => m.id === response.messageId);
        if (msgIndex !== -1) {
          chatToUpdate[msgIndex].status = 'delivered';
          setChat(ACTIVE_ID, chatToUpdate);
          scheduleRender(renderMessages, 'messages');
        }
      } else {
        console.error("Server failed to deliver message:", response?.message);
        showNotification('Message may not have been delivered');
      }
    });
}

function markAllSeen(contactId) {
    const chat = getChat(contactId);
    const unseenMessages = chat.filter(m => m.type === 'received' && m.status !== 'seen');
    if (unseenMessages.length > 0) {
        unseenMessages.forEach(m => m.status = 'seen');
        setChat(contactId, chat);
        scheduleRender(renderMessages, 'messages');
    }
}

// FIXED: Async merge with chunking to prevent UI freeze
async function intelligentMerge(serverChatHistory) {
    console.log('Starting intelligent merge...');
    
    try {
        const entries = Object.entries(serverChatHistory);
        const CHUNK_SIZE = 5; // Process 5 contacts at a time
        
        for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
            const chunk = entries.slice(i, i + CHUNK_SIZE);
            
            // Process chunk asynchronously
            await new Promise(resolve => {
                requestAnimationFrame(() => {
                    chunk.forEach(([contactId, serverMessages]) => {
                        if (!Array.isArray(serverMessages)) {
                            console.warn(`Invalid messages for contact ${contactId}`);
                            return;
                        }
                        
                        const localMessages = storage.get(KEYS.chat(contactId), []);
                        const localMessageIds = new Set(localMessages.map(m => m.id));

                        const newMessages = serverMessages.filter(m => m && m.id && !localMessageIds.has(m.id));

                        if (newMessages.length > 0) {
                            console.log(`Merging ${newMessages.length} new messages for contact ${contactId}`);
                            const mergedChat = [...localMessages, ...newMessages].sort((a, b) => (a.ts || 0) - (b.ts || 0));
                            storage.set(KEYS.chat(contactId), mergedChat);
                        }
                    });
                    resolve();
                });
            });
        }
        
        console.log('Intelligent merge complete.');
    } catch (error) {
        console.error('Merge error:', error);
    }
}

/*
// PART 15: FIXED Socket Connection with Enhanced Error Handling
*/

function connectSocket() {
    if (!USER || !USER.xameId) {
      console.error("Cannot connect socket: User object is missing.");
      return;
    }

    // FIXED: Clean up existing socket and event listeners
    if (socket) {
        console.log('Cleaning up existing socket...');
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
    }
    
    console.log('Creating new socket connection...');
    socket = io(serverURL, {
    query: { userId: USER.xameId },
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
    timeout: 10000,
    transports: ['websocket', 'polling'],
    path: '/socket.io/'  // Add this line
});

    socket.on('connect', () => {
        console.log(' Connected to server!');
        showNotification('Connected to server');
        
        setTimeout(() => {
            if (socket && socket.connected) {
                socket.emit('request_online_users');
                socket.emit('get_contacts', USER.xameId);
                socket.emit('get_chat_history', { userId: USER.xameId });
            }
        }, 100);
    });

    socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err.message);
        showNotification('Connection error. Retrying...');
    });

    socket.on('connect_timeout', () => {
        console.error('Socket connection timeout');
        showNotification('Connection is slow. Please check your network.');
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`Reconnection attempt ${attemptNumber}`);
        showNotification(`Reconnecting... (attempt ${attemptNumber})`);
    });

    socket.on('reconnect', (attemptNumber) => {
        console.log(`Reconnected after ${attemptNumber} attempts`);
        showNotification('Reconnected successfully!');
        
        // Re-fetch data after reconnection
        if (socket.connected) {
            socket.emit('request_online_users');
            socket.emit('get_contacts', USER.xameId);
        }
    });

    socket.on('reconnect_failed', () => {
        console.error('Failed to reconnect after all attempts');
        showNotification('Failed to reconnect. Please refresh the page.');
    });

    socket.on('chat_history', async (historyData) => {
        console.log('Received full chat history from server. Performing intelligent merge.');
        
        // FIXED: Use async merge to prevent UI freeze
        await intelligentMerge(historyData);
        
        if (ACTIVE_ID) {
            scheduleRender(renderMessages, 'messages');
        }
        scheduleRender(() => renderContacts(), 'contacts');
    });
    
    socket.on('stream-ready', (data) => {
      console.log("Stream is ready, showing remote video.");
      if (remoteStream && remoteVideo) {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.muted = false;
      }
    });

    socket.on('contacts_list', (serverContacts) => {
        console.log('Received updated contacts list from server:', serverContacts);
        
        if (!Array.isArray(serverContacts)) {
            console.error('Invalid contacts list received');
            return;
        }
        
        const updatedContacts = serverContacts.map(c => {
            let profilePicUrl = c.profilePic;
            if (profilePicUrl) {
                profilePicUrl = addCacheBuster(profilePicUrl);
            }
                                    
            return {
                id: c.xameId,
                name: c.name || c.xameId,
                profilePic: profilePicUrl,
                online: c.isOnline || false,
                status: c.status || 'Message a friend',
                lastInteractionTs: c.lastInteractionTs || now(), 
                lastInteractionPreview: c.lastInteractionPreview || '', 
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
        scheduleRender(() => renderContacts(searchInput?.value), 'contacts');
    });
    
    socket.on('disconnect', (reason) => {
        console.log('Disconnected from server! Reason:', reason);
        showNotification('Disconnected from server');
        
        let contacts = storage.get(KEYS.contacts);
        if (contacts) {
            contacts.forEach(c => c.online = false);
            storage.set(KEYS.contacts, contacts);
            scheduleRender(() => renderContacts(), 'contacts');
        }
        
        // Attempt to reconnect if server disconnected us
        if (reason === 'io server disconnect') {
            socket.connect();
        }
    });
    
    socket.on('online_users', (onlineUserIds) => {
        console.log(`[online_users] Event received. Online user IDs:`, onlineUserIds);
        
        if (!Array.isArray(onlineUserIds)) {
            console.error('Invalid online users data');
            return;
        }
        
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
        CONTACTS = contacts;
        
        scheduleRender(() => renderContacts(searchInput?.value), 'contacts');
        
        if (ACTIVE_ID) {
            const activeContact = contacts.find(c => c.id === ACTIVE_ID);
            if (activeContact && chatSub) {
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
                CONTACTS = contacts;
                
                const userItem = document.querySelector(`.list .item[data-user-id="${userId}"]`);
                if (userItem) {
                    const onlineDot = userItem.querySelector('.online-dot');
                    if (onlineDot) {
                        onlineDot.classList.remove('hidden');
                    }
                }
            }
        }
        if (ACTIVE_ID === userId && chatSub) {
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
                CONTACTS = contacts;
                
                const userItem = document.querySelector(`.list .item[data-user-id="${userId}"]`);
                if (userItem) {
                    const onlineDot = userItem.querySelector('.online-dot');
                    if (onlineDot) {
                        onlineDot.classList.add('hidden');
                    }
                    if (ACTIVE_ID === userId && chatSub) {
                      chatSub.textContent = 'Offline';
                    }
                }
            }
        }
    });

    socket.on('receive-message', (data) => {
        console.log('Received message:', data);
        
        if (!data || !data.senderId || !data.message) {
            console.error('Invalid message data received');
            return;
        }
        
        const { senderId, message } = data;
        
        const chat = getChat(senderId);
        
        const newMsg = {
            id: message.id || uid(),
            text: message.text,
            file: message.file,
            type: 'received',
            ts: message.ts || now(),
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
        
        // FIXED: Use batched rendering
        scheduleRender(() => renderContacts(), 'contacts');

        if (ACTIVE_ID === senderId) {
            scheduleRender(renderMessages, 'messages');
            const newUnseenMessageIds = [newMsg.id];
            socket.emit('message-seen', { recipientId: ACTIVE_ID, messageIds: newUnseenMessageIds });
        } else {
            // Show notification for new message
            showNotification(`New message from ${contactToUpdate?.name || senderId}`);
        }
    });

    socket.on('messages-deleted', (data) => {
        console.log('Real-time deletion received:', data);
        
        if (!data || !data.senderId || !data.messageIds) {
            console.error('Invalid deletion data');
            return;
        }
        
        const { senderId, messageIds } = data;
        
        const contactId = senderId; 
        
        const chat = getChat(contactId);
        const updatedChat = chat.filter(m => !messageIds.includes(m.id));
        setChat(contactId, updatedChat);

        if (ACTIVE_ID === contactId) {
            scheduleRender(renderMessages, 'messages');
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
                scheduleRender(() => renderContacts(), 'contacts');
            }
        }
    });
    
    socket.on('message-status-update', (data) => {
      console.log('Message status update received:', data);
      
      if (!data || !data.recipientId || !data.messageId || !data.status) {
          console.error('Invalid status update data');
          return;
      }
      
      const { recipientId, messageId, status } = data;
      const chat = getChat(recipientId);
      const message = chat.find(m => m.id === messageId);
      
      if (message) {
        message.status = status;
        setChat(recipientId, chat);
        if (ACTIVE_ID === recipientId) {
          scheduleRender(renderMessages, 'messages');
        }
      }
    });

    socket.on('message-seen-update', (data) => {
      console.log('Message seen update received:', data);
      
      if (!data || !data.recipientId || !data.messageIds) {
          console.error('Invalid seen update data');
          return;
      }
      
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
        scheduleRender(renderMessages, 'messages');
      }
    });
    
    socket.on('typing', (data) => {
        if (data && ACTIVE_ID === data.senderId) {
            const chatSubEl = $('#chatSub');
            const typingEl = $('#typing');
            if (chatSubEl) chatSubEl.classList.add('hidden');
            if (typingEl) typingEl.classList.remove('hidden');
        }
    });
    
    socket.on('stop-typing', (data) => {
        if (data && ACTIVE_ID === data.senderId) {
            const chatSubEl = $('#chatSub');
            const typingEl = $('#typing');
            if (chatSubEl) chatSubEl.classList.remove('hidden');
            if (typingEl) typingEl.classList.add('hidden');
        }
    });

    socket.on('call-rejected', ({ senderId }) => {
        console.log('Call was rejected by', senderId);
        if (incomingCallOverlay) incomingCallOverlay.classList.add('hidden');
        showNotification("Call rejected."); 
    });
    
    socket.on('call-busy', ({ recipientId }) => {
        console.log('Recipient is busy:', recipientId);
        showNotification("This user is on another call.");
    });

    socket.on('call-user', (data) => {
        if (!data || !data.offer || !data.caller || !data.callType) {
            console.error('Invalid call data received');
            return;
        }
        
        const { offer, caller, callType } = data;
        console.log('Incoming call from', caller.xameId);
        showIncomingCallNotification(caller, callType, offer);
    });

    socket.on('make-answer', (data) => {
        if (data && data.answer) {
            handleAnswer(data.answer);
        }
    });

    socket.on('ice-candidate', (data) => {
        if (data && data.candidate) {
            handleNewIceCandidate(data.candidate);
        }
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


/*
// PART 16: Date Validation & Form Handling
*/

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

/*
// PART 17: FIXED Boot & Event Listeners with Better Initialization
*/

// Global error handler
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    event.preventDefault();
});

// FIXED: Separate event listener setup
function setupEventListeners() {
  console.log(' Setting up event listeners...');
  
  if (clearAllChatsBtn) {
      clearAllChatsBtn.addEventListener('click', clearAllChats);
  }

  if (signUpBtn) {
      signUpBtn.addEventListener('click', () => { 
          console.log('Sign up button clicked');
          show(elRegister); 
      });
  }
  
  if (signInBtn) {
      signInBtn.addEventListener('click', () => { 
          console.log('Sign in button clicked');
          show(elLogin); 
      });
  }
  
  if (backToLandingBtn) {
      backToLandingBtn.addEventListener('click', () => { 
          console.log('Back to landing (from register)');
          show(elLanding); 
      });
  }
  
  if (backToLandingBtn2) {
      backToLandingBtn2.addEventListener('click', () => { 
          console.log('Back to landing (from login)');
          show(elLanding); 
      });
  }
  
  if (composer) {
      composer.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!messageInput) return;
          
          const text = messageInput.value.trim();
          if (text) {
              sendMessage(text);
              messageInput.value = '';
              updateComposerButtons();
              
              if (ACTIVE_ID) {
                  delete DRAFTS[ACTIVE_ID];
                  storage.set(KEYS.drafts, DRAFTS);
              }
          }
      });
  }

  // FIXED: Improved typing indicator with debouncing
  let typingTimer;
  if (messageInput) {
      messageInput.addEventListener('input', () => {
          clearTimeout(typingTimer);
          
          if (socket && ACTIVE_ID) {
              socket.emit('typing', { recipientId: ACTIVE_ID });
          }
          
          typingTimer = setTimeout(() => {
              if (socket && ACTIVE_ID) {
                  socket.emit('stop-typing', { recipientId: ACTIVE_ID });
              }
          }, 1500);
          
          updateComposerButtons();
          
          if (ACTIVE_ID) {
              DRAFTS[ACTIVE_ID] = messageInput.value;
              storage.set(KEYS.drafts, DRAFTS);
          }
      });
  }
  
  if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          
          console.log(' Login form submitted');
          
          if (!loginXameIdInput) {
              console.error('Login input not found');
              return;
          }
          
          const xameId = loginXameIdInput.value.trim();
          
          if (!xameId) {
              showNotification('Please enter your Xame-ID.');
              return;
          }
          
          console.log(' Attempting login for:', xameId);
          
          try {
              const checkResponse = await fetch(`${serverURL}/api/get-user-name`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ xameId })
              });
              
              if (!checkResponse.ok) {
                  throw new Error(`Server error: ${checkResponse.status}`);
              }
              
              const checkResult = await checkResponse.json();

              if (!checkResult.success) {
                  showNotification(checkResult.message || 'Login failed. Please check your Xame-ID.');
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
              
              if (!loginResponse.ok) {
                  throw new Error(`Login failed: ${loginResponse.status}`);
              }
              
              const loginResult = await loginResponse.json();

              if (loginResult.success) {
                  console.log(' Login successful');
                  handleLoginSuccess(loginResult.user);
              } else {
                  showNotification(loginResult.message || 'Login failed. Please check your Xame-ID.');
              }
} catch (err) {
              console.error(' Login error:', err);
              showNotification('A server or network error occurred. Please try again later.');
          }
      });
  }

  if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          
          console.log(' Registration form submitted');
          
          if (!firstNameInput || !lastNameInput || !dobHiddenDateInput) {
              console.error('Registration inputs not found');
              return;
          }
          
          const firstName = firstNameInput.value.trim();
          const lastName = lastNameInput.value.trim();
          const dob = dobHiddenDateInput.value.trim(); 
          
          if (!firstName || !lastName) {
              showNotification("Please fill out both name fields.");
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
                  showNotification(errorMessage); 
              }
              
              dobInputs.forEach(input => input?.classList.add('input-error'));
              
              return;
          }

          try {
              e.submitter.disabled = true;
              console.log(' Attempting registration...');

              const response = await fetch(`${serverURL}/api/register`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ firstName, lastName, dob })
              });
              
              if (!response.ok) {
                  throw new Error(`Registration failed: ${response.status}`);
              }
              
              const data = await response.json();
              
              if (data.success) {
                  const newUser = data.user || data;
                  
                  console.log(' Registration successful:', newUser.xameId);
                  alert(`Registration successful! Your Xame-ID is: ${newUser.xameId}`);
                  
                  storage.set(KEYS.user, newUser); 
                  handleLoginSuccess(newUser);
                  
              } else {
                  showNotification(data.message || 'Registration failed. Please try again.');
              }
          } catch (err) {
              console.error(' Registration error:', err);
              showNotification('A server or network error occurred. Please try again later.');
          } finally {
              e.submitter.disabled = false;
          }
      });
  }

  if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
          if (confirm('Are you sure you want to log out?')) {
              try {
                  console.log(' Logging out...');
                  
                  // FIXED: Comprehensive cleanup
                  cleanupWaveSurfers();
                  
                  if (cropper) {
                      cropper.destroy();
                      cropper = null;
                  }
                  
                  if (mediaRecorder && mediaRecorder.state === 'recording') {
                      mediaRecorder.stop();
                  }
                  
                  RESOURCES.mediaRecorders.forEach(recorder => {
                      if (recorder.state === 'recording') {
                          recorder.stop();
                      }
                  });
                  RESOURCES.mediaRecorders = [];
                  
                  endCall();
                  
                  if (socket) {
                      socket.removeAllListeners();
                      socket.disconnect();
                      socket = null;
                  }
                  
                  // Clear all memory storage
                  storage.clear();
                  
                  USER = null;
                  CONTACTS = [];
                  DRAFTS = {};
                  ACTIVE_ID = null;
                  selectedMessages = [];
                  currentMessagePage = 1;
                  
                  show(elLanding);
                  showNotification('Logged out successfully');
                  console.log(' Logout complete');
              } catch (error) {
                  console.error(' Logout error:', error);
                  showNotification('Error during logout');
              }
          }
      });
  }
  
  if (searchInput) {
      // FIXED: Use debounce with leading edge for immediate feedback
      const debouncedSearch = debounce((value) => {
          renderContacts(value);
      }, 300, true); // Leading edge = true for immediate first render
      
      searchInput.addEventListener('input', (e) => {
          debouncedSearch(e.target.value);
      });
  }
  
  console.log(' Event listeners setup complete');
}

// FIXED: Simplified boot function with better error handling
(function boot() {
  console.log(' Starting boot sequence...');
  
  try {
    // Initialize dual storage system
    initializeMemoryFromPersistent();
    
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
    
    console.log(' Checking for existing user...');
    const user = storage.get(KEYS.user);
    
    if (user && user.xameId) {
      console.log(' Found existing user:', user.xameId);
      handleLoginSuccess(user);
    } else {
      console.log(' No existing user found');
      show(elLanding);
    }
    
    setupEventListeners();
    
    // Log storage stats
    console.log(' Storage stats:', storage.getStats());
    
    console.log(' Boot sequence complete');
  } catch (error) {
    console.error(' Boot error:', error);
    show(elLanding);
  }
})();


/*
// PART 18: Mobile Keyboard Fix - Prevents Header/Composer Jumping
*/

(function initKeyboardFix() {
  'use strict';
  
  console.log(' Initializing keyboard fix...');
  
  let initialHeight = window.innerHeight;
  
  function setViewportHeight() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }
  
  setViewportHeight();
  
  // FIXED: Debounce resize handler
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      setViewportHeight();
    }, 100);
  });
  
  const messageInputEl = document.getElementById('messageInput');
  
  if (messageInputEl) {
    messageInputEl.addEventListener('focus', () => {
      document.body.classList.add('input-focused');
      
      const chatBg = document.querySelector('.chat-bg');
      if (chatBg) {
        setTimeout(() => {
          chatBg.scrollTop = chatBg.scrollHeight;
        }, 300);
      }
    });
    
    messageInputEl.addEventListener('blur', () => {
      document.body.classList.remove('input-focused');
    });
  }
  
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const chat = document.getElementById('chat');
      if (chat && document.body.contains(chat) && !chat.classList.contains('hidden')) {
        const offset = window.visualViewport.offsetTop;
        if (offset > 0) {
          chat.style.top = `${offset}px`;
          chat.style.height = `${window.visualViewport.height}px`;
        } else {
          chat.style.top = '0';
          chat.style.height = '100vh';
        }
      }
    });
  }
  
  document.addEventListener('touchmove', (e) => {
    if (e.target === document.body) {
      e.preventDefault();
    }
  }, { passive: false });
  
  const searchInputEl = document.getElementById('searchInput');
  if (searchInputEl) {
    searchInputEl.addEventListener('focus', () => {
      document.body.classList.add('input-focused');
    });
    
    searchInputEl.addEventListener('blur', () => {
      document.body.classList.remove('input-focused');
    });
  }
  
  console.log(' Keyboard fix initialized');
})(); //  THIS WAS MISSING - NOW FIXED

/*
// PART 19: Visibility Change Handler
*/

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log(' Tab hidden');
        
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
        }
        
        if (speechRecognizer && speechRecognizer.running) {
            speechRecognizer.stop();
        }
        
        // Pause any playing WaveSurfer instances
        RESOURCES.wavesurfers.forEach((ws) => {
            if (ws && ws.isPlaying && ws.isPlaying()) {
                ws.pause();
            }
        });
    } else {
        console.log(' Tab visible');
        
        if (socket && socket.connected) {
            socket.emit('request_online_users');
        }
        
        // Re-render to ensure UI is up to date
        if (ACTIVE_ID) {
            scheduleRender(renderMessages, 'messages');
        }
    }
});

/*
// PART 20: Page Unload Handler
*/

window.addEventListener('beforeunload', (e) => {
    console.log(' Page unloading...');
    
    // FIXED: Comprehensive cleanup on page unload
    try {
        cleanupWaveSurfers();
        
        if (cropper) {
            cropper.destroy();
        }
        
        endCall();
        
        RESOURCES.mediaRecorders.forEach(recorder => {
            if (recorder.state === 'recording') {
                recorder.stop();
            }
        });
        
        if (socket) {
            socket.removeAllListeners();
            socket.disconnect();
        }
        
        // Cancel any pending renders
        renderScheduled = false;
        
        console.log(' Cleanup complete');
    } catch (error) {
        console.error(' Cleanup error:', error);
    }
});

/*
// PART 21: Network Status Monitoring
*/

window.addEventListener('online', () => {
    console.log(' Network connection restored');
    showNotification('Connection restored');
    
    if (USER && (!socket || !socket.connected)) {
        try {
            connectSocket();
        } catch (error) {
            console.error('Failed to reconnect:', error);
        }
    }
});

window.addEventListener('offline', () => {
    console.log(' Network connection lost');
    showNotification('Connection lost. You are offline.');
});


/*
// PART 22: Debug Helpers
*/

window.__XAME_DEBUG__ = {
    storage,
    persistentStorage,
    memoryStorage,
    KEYS,
    getChat,
    setChat,
    get USER() { return USER; },
    get CONTACTS() { return CONTACTS; },
    get ACTIVE_ID() { return ACTIVE_ID; },
    get socket() { return socket; },
    cleanupWaveSurfers,
    endCall,
    renderMessages,
    renderContacts: () => renderContacts(),
    scheduleRender,
    version: APP_VERSION,
    resources: RESOURCES,
    // Storage debugging
    storageStats: () => storage.getStats(),
    syncStorage: () => storage.syncToPersistent(),
    reloadFromStorage: () => storage.syncFromPersistent(),
    // Performance monitoring
    getMemoryUsage: () => storage.getMemoryUsage(),
    getResourceCount: () => ({
        wavesurfers: RESOURCES.wavesurfers.size,
        mediaRecorders: RESOURCES.mediaRecorders.length,
        peerConnections: RESOURCES.peerConnections.length,
        localStreams: RESOURCES.localStreams.length
    }),
    clearAllResources: () => {
        cleanupWaveSurfers();
        endCall();
        RESOURCES.mediaRecorders = [];
        console.log('All resources cleared');
    }
};

console.log(`

                                        
   XamePage v${APP_VERSION} - OPTIMIZED      
   Performance Fixes Applied          
   - WaveSurfer cleanup fixed           
   - Render batching added              
   - Message pagination (100 msgs)      
   - Socket event cleanup               
   - In-memory storage (no localStorage)
   - Async merge with chunking          
                                        

`);

console.log(' XamePage initialized successfully');
console.log(' Debug helpers available at window.__XAME_DEBUG__');
console.log(' Memory usage:', window.__XAME_DEBUG__.getMemoryUsage());
console.log(' Active resources:', window.__XAME_DEBUG__.getResourceCount());

/*
// END OF OPTIMIZED XAMEPAGE v2.1
*/
