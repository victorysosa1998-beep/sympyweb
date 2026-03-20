// ═══════════════════════════════════════════
// SYMPY WEB — Complete Script
// Mirrors Flutter app logic exactly
// ═══════════════════════════════════════════

// ── CONFIG ──
const API_KEY  = "Eghosa1998";
const BASE_URL = "https://web-production-6c359.up.railway.app";

// ── GLOBAL STATE ──
let currentVibe    = "Chaotic";
let selectedVoice  = "female";
let selectedImage  = "assets/images/missy.png";
let selectedAIName = "Missy";

// Memory — mirrors Flutter app
let chatHistory      = [];
let knownName        = "";
let knownLang        = "";
let lastChatSummary  = "";
let lastCallSummary  = "";
let currentUserId    = "";

// Image upload state
let pendingImageBase64 = null;
let pendingImageType   = "image/jpeg";

// LiveKit state
let room;
let callTimer;
let secondsElapsed = 0;
let dailySecondsLeft = 300;

// Call guards
let isConnecting     = false;
let hasConnectedOnce = false;
let connectionTimeout;
let __audioUnlocked  = false;
let __callStartedAt  = 0;
let __callExitAllowed = false;


// ═══════════════════════════════════════════
// SCREEN NAVIGATION
// ═══════════════════════════════════════════
function navigateTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        if (s.id === 'call-overlay') s.style.display = 'none';
    });
    const target = document.getElementById(screenId);
    if (!target) return;
    target.classList.add('active');
    if (screenId === 'call-overlay') {
        target.style.display = 'flex';
    }
    if (screenId === 'chat-screen') startChat();
    if (screenId === 'voice-screen' && currentUserId) loadUserData();
}


// ═══════════════════════════════════════════
// DRAWER
// ═══════════════════════════════════════════
function openDrawer() {
    document.getElementById('drawer').classList.add('open');
    document.getElementById('drawer-overlay').classList.add('open');
}
function closeDrawer() {
    document.getElementById('drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('open');
}
function updateDrawerUser() {
    const user = firebase.auth().currentUser;
    if (!user) return;
    document.getElementById('drawer-name').innerText  = user.displayName || knownName || "User";
    document.getElementById('drawer-email').innerText = user.email || "";
    updateDrawerQuota();
}
async function updateDrawerQuota() {
    if (!currentUserId) return;
    try {
        const res = await fetch(`${BASE_URL}/call_quota`, {
            headers: { 'X-API-KEY': API_KEY, 'X-Device-Id': currentUserId }
        });
        if (!res.ok) return;
        const data = await res.json();
        const remaining = data.seconds_remaining ?? 300;
        const limit     = data.limit ?? 300;
        dailySecondsLeft = remaining;
        const used = limit - remaining;
        const m = String(Math.floor(remaining / 60)).padStart(2,'0');
        const s = String(remaining % 60).padStart(2,'0');
        document.getElementById('drawer-time-left').innerText  = m + ':' + s;
        document.getElementById('drawer-quota-bar').style.width = Math.min((used / limit) * 100, 100) + '%';
        // Reset time label
        const now = new Date();
        const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
        const diff = midnight - now;
        const dh = Math.floor(diff / 3600000);
        const dm = Math.floor((diff % 3600000) / 60000);
        document.getElementById('drawer-reset-label').innerText =
            `Resets in ${dh}h ${String(dm).padStart(2,'0')}m`;
        // Update call screen pill
        document.getElementById('call-time-left').innerText = m + ':' + s;
        if (remaining <= 30) {
            document.getElementById('call-time-left').style.color = '#ff4444';
        }
    } catch (e) {}
}


// ═══════════════════════════════════════════
// VOICE / VIBE SELECTION
// ═══════════════════════════════════════════
function selectVoice(gender, image, name) {
    selectedVoice  = gender;
    selectedImage  = image;
    selectedAIName = name;
    // Persist so page reloads restore the same choice
    try {
        sessionStorage.setItem('sympy_voice', JSON.stringify({ gender, image, name }));
    } catch(e) {}

    // Update card selection
    document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
    document.getElementById(gender === 'male' ? 'card-buddy' : 'card-missy')?.classList.add('selected');

    // Update chat header
    const chatAvatar = document.getElementById('chat-avatar');
    if (chatAvatar) chatAvatar.src = image;
    const chatName = document.getElementById('chat-name');
    if (chatName) chatName.innerText = name;

    // Update call screen
    const callAvatar = document.getElementById('call-avatar-img');
    if (callAvatar) callAvatar.src = image;
    const callingName = document.getElementById('calling-name');
    if (callingName) callingName.innerText = name;

    // Update call bg accent
    const callBg = document.getElementById('call-bg');
    const hue = gender === 'male' ? 'rgba(68,138,255,0.15)' : 'rgba(224,64,251,0.12)';
    if (callBg) callBg.style.background =
        `radial-gradient(ellipse at 50% 30%, ${hue} 0%, #080818 60%, #000 100%)`;

    // Update chat background
    const chatBody = document.getElementById('chat-messages');
    if (chatBody) applyChatBackground(chatBody, image);
}

// Restore previously selected voice, or fall back to Missy
function restoreVoiceSelection() {
    try {
        const saved = sessionStorage.getItem('sympy_voice');
        if (saved) {
            const { gender, image, name } = JSON.parse(saved);
            selectVoice(gender, image, name);
            return;
        }
    } catch(e) {}
    selectVoice('female', 'assets/images/missy.png', 'Missy');
}

function setVibe(el, vibe) {
    document.querySelectorAll('.vibe-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    currentVibe = vibe;
    document.getElementById('call-vibe-tag').innerText = 'Vibe · ' + vibe;
}


// ═══════════════════════════════════════════
// MEMORY — load user data from backend
// ═══════════════════════════════════════════
async function loadUserData() {
    if (!currentUserId) return;
    try {
        const res = await fetch(`${BASE_URL}/user_profile`, {
            headers: { 'X-API-KEY': API_KEY, 'X-User-Id': currentUserId }
        });
        if (res.ok) {
            const d = await res.json();
            if (d.known_name) knownName = d.known_name;
            if (d.known_lang) knownLang = d.known_lang;
        }
    } catch (e) {}

    try {
        const r1 = await fetch(`${BASE_URL}/chat/last_summary`, {
            headers: { 'X-API-KEY': API_KEY, 'X-User-Id': currentUserId }
        });
        if (r1.ok) { const d1 = await r1.json(); if (d1.summary) lastChatSummary = d1.summary; }
    } catch (e) {}

    try {
        const r2 = await fetch(`${BASE_URL}/call/last_summary`, {
            headers: { 'X-API-KEY': API_KEY, 'X-User-Id': currentUserId }
        });
        if (r2.ok) { const d2 = await r2.json(); if (d2.summary) lastCallSummary = d2.summary; }
    } catch (e) {}

    // Seed name to backend if no name stored yet (same as Flutter _seedNameToBackend)
    const fbUser = firebase.auth().currentUser;
    if (fbUser?.displayName && !knownName) {
        fetch(`${BASE_URL}/set_name`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY, 'X-User-Id': currentUserId },
            body: JSON.stringify({ name: fbUser.displayName })
        }).catch(() => {});
        knownName = fbUser.displayName;
    }

    updateDrawerUser();
    updateDrawerQuota();
}


// ═══════════════════════════════════════════
// CHAT — init + messages + summaries
// ═══════════════════════════════════════════

// Ask backend to generate the opening greeting.
// Backend uses Redis memory — knows name, language, history.
// This is how Flutter app works: agent greets on connect.
async function fetchGreeting() {
    showTypingIndicator();
    try {
        const res = await fetch(`${BASE_URL}/chat?voice=${selectedVoice}&vibe=${currentVibe}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': API_KEY,
                'X-User-Id': currentUserId,
            },
            body: JSON.stringify({ message: "__greeting__", context: [] })
        });
        hideTypingIndicator();
        if (res.ok) {
            const data = await res.json();
            const reply = data.reply || `Hey! I'm ${selectedAIName} 👋`;
            addMessage("sympy", reply);
            chatHistory.push({ role: "assistant", content: reply });
            if (data.known_name) knownName = data.known_name;
            if (data.known_lang) knownLang = data.known_lang;
        } else {
            // Fallback if backend unreachable
            addMessage("sympy", `Hey! I'm ${selectedAIName} 👋`);
            setTimeout(() => addMessage("sympy", "What do I call you, and what language do you prefer?"), 800);
        }
    } catch (e) {
        hideTypingIndicator();
        addMessage("sympy", `Hey! I'm ${selectedAIName} 👋`);
        setTimeout(() => addMessage("sympy", "What do I call you, and what language do you prefer?"), 800);
    }
}
function startChat() {
    const chatBody = document.getElementById('chat-messages');
    if (!chatBody) return;

    // Apply correct background
    applyChatBackground(chatBody, selectedImage);

    // Render summary banners
    renderSummaryBanners();

    if (chatBody.children.length === 0) {
        chatHistory = [];
        // Let the backend generate the greeting — it knows the user's name,
        // language, and history from Redis, just like the Flutter app does.
        fetchGreeting();
    }
}

function addMessage(role, text, imgSrc, caption) {
    const chatBody = document.getElementById('chat-messages');
    if (!chatBody) return;
    const div = document.createElement('div');
    div.className = `message ${role}`;
    if (imgSrc) {
        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = 'Image';
        div.appendChild(img);
        if (caption) {
            const cap = document.createElement('span');
            cap.className = 'caption-text';
            cap.innerText = caption;
            div.appendChild(cap);
        }
    } else {
        div.innerText = text;
    }
    chatBody.appendChild(div);
    chatBody.scrollTop = chatBody.scrollHeight;
}

function showTypingIndicator() {
    const chatBody = document.getElementById('chat-messages');
    if (!chatBody || document.getElementById('typing-indicator')) return;
    const div = document.createElement('div');
    div.id = 'typing-indicator';
    div.className = 'message sympy typing';
    div.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
    chatBody.appendChild(div);
    chatBody.scrollTop = chatBody.scrollHeight;
}
function hideTypingIndicator() {
    document.getElementById('typing-indicator')?.remove();
}


// ═══════════════════════════════════════════
// SUMMARY BANNERS
// ═══════════════════════════════════════════
function renderSummaryBanners() {
    let container = document.getElementById('summary-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'summary-container';
        container.style.cssText = 'width:100%;flex-shrink:0;';
        const chatScreen = document.getElementById('chat-screen');
        const chatBody   = document.getElementById('chat-messages');
        if (chatScreen && chatBody) chatScreen.insertBefore(container, chatBody);
    }
    container.innerHTML = '';
    [
        { text: lastChatSummary, icon: '💬', label: 'Last chat', color: '#448AFF' },
        { text: lastCallSummary, icon: '📞', label: 'Last call', color: '#E040FB' }
    ].forEach(({ text, icon, label, color }) => {
        if (!text) return;
        const b = document.createElement('div');
        b.style.cssText = `display:flex;align-items:center;gap:10px;padding:9px 16px;
            cursor:pointer;background:${color}12;border-bottom:1px solid ${color}22;width:100%;box-sizing:border-box;`;
        b.innerHTML = `
            <span style="font-size:15px;flex-shrink:0;">${icon}</span>
            <span style="flex:1;font-size:12px;color:rgba(255,255,255,0.7);
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                <strong style="color:${color};font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">${label}: </strong>${text}
            </span>
            <span style="font-size:10px;color:rgba(255,255,255,0.2);flex-shrink:0;">tap ▲</span>`;
        b.onclick = () => showSummaryModal(label, text, color);
        container.appendChild(b);
    });
}

function showSummaryModal(title, text, color) {
    document.getElementById('summary-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'summary-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);';
    modal.innerHTML = `
        <div style="background:#13131f;border:1px solid ${color}35;border-radius:22px 22px 0 0;
            padding:24px 20px 40px;width:100%;max-width:500px;max-height:65vh;overflow-y:auto;
            box-shadow:0 -20px 60px rgba(0,0,0,0.6);">
            <div style="width:36px;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;margin:0 auto 20px;"></div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
                <strong style="font-size:15px;color:${color};">📋 ${title} Summary</strong>
                <button onclick="document.getElementById('summary-modal').remove()"
                    style="margin-left:auto;background:none;border:none;color:rgba(255,255,255,0.35);font-size:22px;cursor:pointer;line-height:1;">×</button>
            </div>
            <p style="color:rgba(255,255,255,0.75);font-size:14px;line-height:1.7;margin:0;">${text}</p>
        </div>`;
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
}


// Apply chat background — single source of truth, no fixed attachment
function applyChatBackground(el, imgPath) {
    el.style.backgroundImage   = `linear-gradient(rgba(0,0,0,0.6),rgba(0,0,0,0.6)), url('${imgPath}')`;
    el.style.backgroundSize    = 'cover';
    el.style.backgroundPosition = 'center top';
    el.style.backgroundRepeat  = 'no-repeat';
    el.style.backgroundAttachment = 'scroll'; // 'fixed' breaks on iOS/Android browsers
}

// ═══════════════════════════════════════════
// SEND MESSAGE — text
// ═══════════════════════════════════════════
async function sendMessage() {
    const input = document.getElementById('user-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    addMessage("user", text);
    chatHistory.push({ role: "user", content: text });
    input.value = '';
    showTypingIndicator();

    try {
        const res = await fetch(`${BASE_URL}/chat?voice=${selectedVoice}&vibe=${currentVibe}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': API_KEY,
                'X-User-Id': currentUserId,
            },
            body: JSON.stringify({ message: text, context: chatHistory.slice(-30) })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        hideTypingIndicator();
        const reply = data.reply || (knownLang === 'pidgin' ? "I dey here, try again." : "Try again.");
        addMessage("sympy", reply);
        chatHistory.push({ role: "assistant", content: reply });
        if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);
        if (data.known_name && data.known_name !== knownName) knownName = data.known_name;
        if (data.known_lang && data.known_lang !== knownLang) knownLang = data.known_lang;
        // Streak checkin
        if (currentUserId) {
            fetch(`${BASE_URL}/streak/checkin`, {
                method: 'POST', headers: { 'X-API-KEY': API_KEY, 'X-User-Id': currentUserId }
            }).catch(() => {});
        }
    } catch (e) {
        hideTypingIndicator();
        addMessage("sympy", knownLang === 'pidgin' ? "Network wahala! Check your data 🙏" : "Connection issue. Try again.");
    }
}


// ═══════════════════════════════════════════
// IMAGE UPLOAD
// ═══════════════════════════════════════════
function triggerImagePicker() {
    document.getElementById('image-file-input').click();
}

function handleImageSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Reset input so same file can be selected again
    event.target.value = '';

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        // Extract base64 and media type
        const parts = dataUrl.split(',');
        pendingImageBase64 = parts[1];
        pendingImageType   = file.type || 'image/jpeg';

        // Show preview overlay
        document.getElementById('preview-img').src = dataUrl;
        document.getElementById('image-caption').value = '';
        document.getElementById('image-preview-overlay').classList.add('open');
        setTimeout(() => document.getElementById('image-caption').focus(), 300);
    };
    reader.readAsDataURL(file);
}

function cancelImage() {
    pendingImageBase64 = null;
    document.getElementById('image-preview-overlay').classList.remove('open');
    document.getElementById('preview-img').src = '';
}

async function sendImageMessage() {
    if (!pendingImageBase64) return;
    const caption   = document.getElementById('image-caption').value.trim();
    const imgSrc    = document.getElementById('preview-img').src;
    const b64       = pendingImageBase64;
    const mediaType = pendingImageType;

    // Close overlay immediately
    cancelImage();

    // Show image bubble in chat (user side)
    addMessage("user", null, imgSrc, caption || null);

    // Add to context like Flutter app does
    const contextMsg = caption
        ? `[User sent an image with caption: "${caption}"]`
        : "[User sent an image]";
    chatHistory.push({ role: "user", content: contextMsg });

    showTypingIndicator();

    try {
        // Send to backend — same endpoint as Flutter app
        // Backend accepts base64 via JSON for web (different from mobile's binary)
        const body = {
            message: caption || "What do you see in this image?",
            context: chatHistory.slice(-30),
            image_base64: b64,
            image_media_type: mediaType
        };

        const res = await fetch(`${BASE_URL}/chat?voice=${selectedVoice}&vibe=${currentVibe}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': API_KEY,
                'X-User-Id': currentUserId,
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        hideTypingIndicator();
        const reply = data.reply || "Interesting! Tell me more.";
        addMessage("sympy", reply);
        chatHistory.push({ role: "assistant", content: reply });
        if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);

    } catch (e) {
        hideTypingIndicator();
        addMessage("sympy", knownLang === 'pidgin'
            ? "Wahala dey — couldn't process the image. Try again."
            : "Couldn't process that image. Try again.");
    }
}


// ═══════════════════════════════════════════
// VOICE CALL
// ═══════════════════════════════════════════
async function __unlockAudioOnce() {
    if (__audioUnlocked) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const silent = document.createElement('audio');
        silent.srcObject = stream; silent.muted = true; silent.playsInline = true;
        await silent.play();
        __audioUnlocked = true;
    } catch (err) { console.warn('[CALL] Audio unlock:', err); }
}

async function startVoiceCall() {
    if (isConnecting) return;
    isConnecting     = true;
    hasConnectedOnce = false;

    navigateTo('call-overlay');

    // Update call screen UI
    document.getElementById('call-status-text').innerText = 'Connecting...';
    document.getElementById('call-live-dot').classList.remove('live');
    document.getElementById('call-wave').classList.remove('active');
    document.getElementById('calling-name').innerText = selectedAIName;
    document.getElementById('call-avatar-img').src     = selectedImage;
    document.getElementById('call-vibe-tag').innerText = 'Vibe · ' + currentVibe;
    await updateDrawerQuota();
    resetTimer();

    try {
        await __unlockAudioOnce();

        const tokenRes = await fetch(
            `${BASE_URL}/get_token?gender=${selectedVoice}&vibe=${currentVibe}`,
            { headers: { 'X-API-KEY': API_KEY, 'X-Device-Id': currentUserId } }
        );
        if (!tokenRes.ok) throw new Error('Token fetch failed');
        const tokenData = await tokenRes.json();

        if (room) try { await room.disconnect(); } catch (_) {}
        room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });

        room.on(LivekitClient.RoomEvent.TrackSubscribed, track => {
            if (track.kind === 'audio') {
                const audio = track.attach();
                audio.autoplay = true; audio.playsInline = true;
                document.getElementById('audio-container').appendChild(audio);
                audio.play().catch(() => {});
                // Animate waveform when AI speaks
                document.getElementById('call-wave').classList.add('active');
            }
        });

        room.on(LivekitClient.RoomEvent.TrackUnsubscribed, () => {
            document.getElementById('call-wave').classList.remove('active');
        });

        await room.connect(tokenData.url, tokenData.token);
        try { await room.localParticipant.setMicrophoneEnabled(true); } catch (_) {}

        hasConnectedOnce = true;
        document.getElementById('call-status-text').innerText = 'Live';
        document.getElementById('call-live-dot').classList.add('live');
        startDurationTimer();
        __markCallStarted();

        connectionTimeout = setTimeout(() => {
            if (!hasConnectedOnce) softFailCall();
        }, 15000);

    } catch (err) {
        console.warn('[CALL ERROR]', err);
        softFailCall();
    }
}

function startDurationTimer() {
    secondsElapsed = 0;
    if (callTimer) clearInterval(callTimer);
    callTimer = setInterval(() => {
        secondsElapsed++;
        const m = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
        const s = String(secondsElapsed % 60).padStart(2, '0');
        document.getElementById('call-duration').innerText = `${m}:${s}`;
        // Count down remaining quota
        const rem = Math.max(0, dailySecondsLeft - secondsElapsed);
        const rm = String(Math.floor(rem / 60)).padStart(2,'0');
        const rs = String(rem % 60).padStart(2,'0');
        const pill = document.getElementById('call-time-left');
        if (pill) {
            pill.innerText = `${rm}:${rs}`;
            pill.style.color = rem <= 30 ? '#ff4444' : '';
        }
        if (rem <= 0) endCall();
    }, 1000);
}

function resetTimer() {
    if (callTimer) clearInterval(callTimer);
    document.getElementById('call-duration').innerText = '00:00';
}

function __markCallStarted() {
    __callStartedAt   = Date.now();
    __callExitAllowed = false;
    setTimeout(() => { __callExitAllowed = true; }, 4000);
}

function softFailCall() {
    document.getElementById('call-status-text').innerText = 'Connection failed';
    setTimeout(() => endCall(), 1500);
}

function endCall() {
    const elapsed = Date.now() - __callStartedAt;
    if (!__callExitAllowed && elapsed < 4000 && hasConnectedOnce) return;
    isConnecting = false;
    if (connectionTimeout) clearTimeout(connectionTimeout);
    try { if (room) room.disconnect(); } catch (_) {}

    // Report usage to backend
    if (secondsElapsed > 0 && currentUserId) {
        fetch(`${BASE_URL}/call_ended?duration_seconds=${secondsElapsed}`, {
            method: 'POST',
            headers: { 'X-API-KEY': API_KEY, 'X-Device-Id': currentUserId }
        }).catch(() => {});
    }

    // Generate call summary
    if (currentUserId) {
        fetch(`${BASE_URL}/call/summary`, {
            method: 'POST',
            headers: { 'X-API-KEY': API_KEY, 'X-User-Id': currentUserId }
        }).then(async r => {
            if (r.ok) {
                const d = await r.json();
                if (d.summary) { lastCallSummary = d.summary; renderSummaryBanners(); }
            }
        }).catch(() => {});
    }

    document.getElementById('call-wave').classList.remove('active');
    const audioContainer = document.getElementById('audio-container');
    if (audioContainer) audioContainer.innerHTML = '';
    resetTimer();
    updateDrawerQuota();
    navigateTo('chat-screen');
}

function toggleMute() {
    if (!room) return;
    const enabled = room.localParticipant.isMicrophoneEnabled;
    room.localParticipant.setMicrophoneEnabled(!enabled);
    const btn = document.getElementById('mute-btn');
    if (btn) {
        btn.classList.toggle('muted', enabled);
        btn.querySelector('i').className = enabled ? 'fas fa-microphone-slash' : 'fas fa-microphone';
        btn.nextElementSibling && (btn.nextElementSibling.innerText = enabled ? 'Unmute' : 'Mute');
    }
}

function toggleSpeaker() {
    const btn = document.getElementById('speaker-btn');
    if (btn) btn.classList.toggle('active-blue');
}

function handleKeyPress(e) { if (e.key === 'Enter') sendMessage(); }


// ═══════════════════════════════════════════
// FIREBASE INIT
// ═══════════════════════════════════════════
const firebaseConfig = {
    apiKey:            "AIzaSyDXTMsESWcJCzDMItxzQhVrPfnQXUDs8RY",
    authDomain:        "sympy-ai.firebaseapp.com",
    projectId:         "sympy-ai",
    storageBucket:     "sympy-ai.firebasestorage.app",
    messagingSenderId: "949064788583",
    appId:             "1:949064788583:web:9a63685807881b4da4c2c2",
    measurementId:     "G-SBY8GEKMZT"
};
firebase.initializeApp(firebaseConfig);


// ═══════════════════════════════════════════
// AUTH HANDLERS
// ═══════════════════════════════════════════
async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-password').value;
    const btn   = document.getElementById('login-btn');
    if (!email || !pass) { showToast("Please fill all fields"); return; }
    setLoading(btn, true);
    try {
        const cred = await firebase.auth().signInWithEmailAndPassword(email, pass);
        if (!cred.user.emailVerified) {
            showToast("Please verify your email first.");
            await firebase.auth().signOut();
        } else {
            currentUserId = 'user_' + cred.user.uid;
            restoreVoiceSelection();
            await loadUserData();
            navigateTo('voice-screen');
        }
    } catch (e) { showToast(e.message); }
    setLoading(btn, false);
}

async function handleSignup() {
    const name  = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const pass  = document.getElementById('signup-password').value;
    const btn   = document.getElementById('signup-btn');
    if (!name || !email || !pass) { showToast("Please fill all fields"); return; }
    setLoading(btn, true);
    try {
        const cred = await firebase.auth().createUserWithEmailAndPassword(email, pass);
        await cred.user.updateProfile({ displayName: name });
        await cred.user.sendEmailVerification();
        showToast("Verification email sent! Check your inbox.");
        navigateTo('login-screen');
    } catch (e) { showToast(e.message); }
    setLoading(btn, false);
}

async function handleResetPassword() {
    const email = document.getElementById('reset-email').value.trim();
    const btn   = document.getElementById('reset-btn');
    if (!email) { showToast("Enter your email"); return; }
    setLoading(btn, true);
    try {
        await firebase.auth().sendPasswordResetEmail(email);
        showToast("Reset link sent! Check your email.");
        navigateTo('login-screen');
    } catch (e) { showToast(e.message); }
    setLoading(btn, false);
}

async function handleLogout() {
    closeDrawer();
    await firebase.auth().signOut();
    currentUserId = ''; knownName = ''; knownLang = '';
    lastChatSummary = ''; lastCallSummary = '';
    chatHistory = [];
    document.getElementById('chat-messages').innerHTML = '';
    navigateTo('login-screen');
}


// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function setLoading(btn, isLoading) {
    const text   = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.loader');
    if (text)   text.style.display   = isLoading ? 'none' : '';
    if (loader) loader.style.display = isLoading ? 'block' : 'none';
    btn.disabled = isLoading;
}

function showToast(msg, duration = 3000) {
    document.getElementById('toast-msg')?.remove();
    const t = document.createElement('div');
    t.id = 'toast-msg';
    t.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;
        background:rgba(30,30,50,0.95);color:white;padding:12px 22px;border-radius:24px;
        font-size:14px;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.5);
        border:1px solid rgba(255,255,255,0.1);max-width:90vw;text-align:center;
        animation:fadeInUp 0.25s ease;`;
    t.innerText = msg;
    document.body.appendChild(t);
    setTimeout(() => t.style.opacity = '0', duration - 300);
    setTimeout(() => t.remove(), duration);
}

// Toast animation
const toastStyle = document.createElement('style');
toastStyle.innerText = '@keyframes fadeInUp{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
document.head.appendChild(toastStyle);


// ═══════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════
// Call button
const mainCallBtn = document.getElementById('call-btn');
if (mainCallBtn) {
    mainCallBtn.onclick = async () => {
        mainCallBtn.disabled = true;
        await startVoiceCall();
        mainCallBtn.disabled = false;
    };
}

// Unlock audio on any user gesture
document.addEventListener('click', async () => {
    if (!__audioUnlocked) await __unlockAudioOnce();
}, { once: false, passive: true });

const inputEl = document.getElementById('user-input');
if (inputEl) inputEl.addEventListener('keypress', handleKeyPress);


// ═══════════════════════════════════════════
// AUTH STATE PERSISTENCE
// ═══════════════════════════════════════════
firebase.auth().onAuthStateChanged(async (user) => {
    if (user && user.emailVerified) {
        currentUserId = 'user_' + user.uid;
        restoreVoiceSelection();
        await loadUserData();
        const loginActive = document.getElementById('login-screen')?.classList.contains('active');
        if (loginActive) navigateTo('voice-screen');
    }
});

// URL param screen navigation (from profile page)
window.addEventListener('load', () => {
    const screen = new URLSearchParams(window.location.search).get('screen');
    if (screen) navigateTo(screen);
});