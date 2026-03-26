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
    if (screenId === 'upgrade-screen') renderPacks();
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
        // Read one-time free seconds from Firestore (never resets)
        const uid = currentUserId.replace('user_', '');
        const doc = await firebase.firestore().collection('users').doc(uid).get();
        const freeSeconds = doc.exists ? (doc.data().free_seconds_remaining ?? 0) : 0;
        const totalFreeSeconds = 300; // original signup grant

        dailySecondsLeft = freeSeconds + (purchasedCredits * 12); // 5 credits = 1 min = 60s, so 1 credit = 12s

        // Credits display: purchased + free minutes equivalent
        const freeCreditsEquiv = Math.floor(freeSeconds / 60) * 5;
        const totalCredits = purchasedCredits + freeCreditsEquiv;

        // Quota bar (based on one-time free seconds used)
        const usedSeconds = totalFreeSeconds - freeSeconds;
        document.getElementById('drawer-quota-bar').style.width =
            Math.min((usedSeconds / totalFreeSeconds) * 100, 100) + '%';

        // Label — no reset, it's one-time
        const freeLabel = freeSeconds > 0
            ? `${Math.floor(freeSeconds / 60)}m ${freeSeconds % 60}s free time left`
            : 'Free minutes used up';
        document.getElementById('drawer-reset-label').innerText = freeLabel;

        // Credits display
        document.getElementById('drawer-time-left').innerText = `${totalCredits} credits`;

        // Call screen pill
        const pill = document.getElementById('call-time-left');
        if (pill) {
            pill.innerText = `${totalCredits} credits`;
            pill.style.color = totalCredits <= 5 ? '#ff4444' : '';
        }

        const purchasedPill = document.getElementById('call-purchased-credits');
        if (purchasedPill) purchasedPill.style.display = 'none';

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
        // Combined credits: free daily equiv + purchased
        const freeEquiv = Math.floor(Math.max(0, dailySecondsLeft - secondsElapsed) / 60) * 5;
        const totalRemaining = purchasedCredits + freeEquiv;
        const pill = document.getElementById('call-time-left');
        if (pill) {
            pill.innerText = `${totalRemaining} credits`;
            pill.style.color = totalRemaining <= 5 ? '#ff4444' : '';
        }
        if (totalRemaining <= 0) endCall();
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

        // Initialize user doc with 5 free minutes (300s) — one-time, never resets
        try {
            await firebase.firestore().collection('users').doc(cred.user.uid).set({
                credits: 0,
                is_premium: false,
                email: email,
                created_at: firebase.firestore.FieldValue.serverTimestamp(),
                free_seconds_remaining: 300,  // 5 mins one-time signup bonus
            });
        } catch (e) {
            console.warn('[Signup] Firestore user init failed:', e);
        }

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
        updateDrawerCredits();
        const loginActive = document.getElementById('login-screen')?.classList.contains('active');
        if (loginActive) navigateTo('voice-screen');
    }
});

// URL param screen navigation (from profile page)
window.addEventListener('load', () => {
    const screen = new URLSearchParams(window.location.search).get('screen');
    if (screen) navigateTo(screen);
});



// ═══════════════════════════════════════════
// CREDITS & PAYMENT SYSTEM
// ═══════════════════════════════════════════

// ── Payment constants (mirrors Flutter PaymentDetailsPage) ──
const BANK_NAME      = "Opay";
const ACCOUNT_NAME   = "Sosa Technologies";
const ACCOUNT_NUMBER = "9059607887";
const USDT_ADDRESS   = "TGEU6XSCuKZdeAf8Xwn2jkgsJVeY7hNd51";
const USDT_NETWORK   = "TRC-20 (Tron)";

// ── Credit packs — exact mirror of Flutter kCreditPacks ──
const CREDIT_PACKS = [
    { id: 'starter',   name: 'Starter',   credits: 50,   priceNgn: 2500,  priceUsdt: 1.55, popular: false, description: '~10 mins voice call',              icon: '⚡' },
    { id: 'popular',   name: 'Popular',   credits: 200,  priceNgn: 8500,  priceUsdt: 5.30, popular: true,  description: '~40 mins voice call · best value', icon: '⭐' },
    { id: 'pro',       name: 'Pro',       credits: 500,  priceNgn: 19500, priceUsdt: 12.20, popular: false, description: '~100 mins voice call',             icon: '💎' },
    { id: 'unlimited', name: 'Unlimited', credits: 1200, priceNgn: 42000, priceUsdt: 26.25, popular: false, description: '~240 mins voice call — power user', icon: '∞' },
];

// ── State ──
let selectedPack   = CREDIT_PACKS.find(p => p.popular); // pre-select Popular like Flutter
let selectedMethod = null;
let paymentRef     = null;
let pendingOrderId = null;
let _orderListener = null;
let purchasedCredits = 0; // cached for call screen

// ── Generate reference ──
function generateReference() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return 'SYMP-' + s;
}

// ── Render packs — list style matching Flutter _PackCard ──
function renderPacks() {
    const container = document.getElementById('pack-grid');
    if (!container) return;
    container.innerHTML = CREDIT_PACKS.map(p => {
        const isSel = selectedPack && selectedPack.id === p.id;
        return `
        <div onclick="selectPack('${p.id}')" id="pack-${p.id}" style="
            margin-bottom:12px;padding:16px;border-radius:18px;cursor:pointer;
            background:${isSel ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.03)'};
            border:${isSel ? '1.5px solid rgba(168,85,247,0.45)' : '1px solid rgba(255,255,255,0.07)'};
            display:flex;align-items:center;gap:14px;transition:all 0.2s;">
            <div style="width:44px;height:44px;border-radius:12px;flex-shrink:0;
                background:${isSel ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.05)'};
                display:flex;align-items:center;justify-content:center;font-size:20px;">
                ${p.icon}
            </div>
            <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:15px;font-weight:bold;color:${isSel ? 'white' : 'rgba(255,255,255,0.8)'};">${p.name}</span>
                    ${p.popular ? `<span style="font-size:9px;font-weight:bold;color:#a855f7;background:rgba(168,85,247,0.15);padding:2px 7px;border-radius:5px;letter-spacing:0.5px;">BEST VALUE</span>` : ''}
                </div>
                <div style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:3px;">${p.description}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
                <div style="font-size:16px;font-weight:bold;color:${isSel ? 'white' : 'rgba(255,255,255,0.7)'};">₦${p.priceNgn.toLocaleString()}</div>
                <div style="font-size:11px;color:rgba(255,255,255,0.3);">$${p.priceUsdt.toFixed(2)} USDT</div>
            </div>
            <div style="width:20px;height:20px;border-radius:50%;flex-shrink:0;
                background:${isSel ? '#a855f7' : 'transparent'};
                border:1.5px solid ${isSel ? '#a855f7' : 'rgba(255,255,255,0.2)'};
                display:flex;align-items:center;justify-content:center;">
                ${isSel ? '<i class="fas fa-check" style="color:white;font-size:10px;"></i>' : ''}
            </div>
        </div>`;
    }).join('');
    updateUpgradeCTA();
}

function selectPack(packId) {
    selectedPack = CREDIT_PACKS.find(p => p.id === packId);
    renderPacks(); // re-render to update highlight
}

function updateUpgradeCTA() {
    const btn = document.getElementById('upgrade-cta-btn');
    if (!btn) return;
    if (selectedPack) {
        btn.style.background = 'linear-gradient(135deg,#7b2ff7,#4776E6)';
        btn.style.boxShadow  = '0 6px 20px rgba(123,47,247,0.3)';
        btn.style.color      = 'white';
        btn.innerText        = `Continue with ${selectedPack.name} Pack  →`;
    } else {
        btn.style.background = 'rgba(255,255,255,0.06)';
        btn.style.boxShadow  = 'none';
        btn.style.color      = 'rgba(255,255,255,0.3)';
        btn.innerText        = 'Select a pack to continue';
    }
}

function proceedFromUpgrade() {
    if (!selectedPack) return;
    renderPaymentMethodSummary();
    navigateTo('payment-method-screen');
}

// ── Payment method screen ──
function renderPaymentMethodSummary() {
    const box = document.getElementById('pm-order-summary');
    if (!box || !selectedPack) return;
    box.innerHTML = `
        <div style="width:42px;height:42px;border-radius:12px;background:rgba(123,47,247,0.1);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">${selectedPack.icon}</div>
        <div style="flex:1;">
            <div style="font-size:14px;font-weight:bold;color:white;">${selectedPack.name} Pack</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.4);">${selectedPack.credits} credits</div>
        </div>
        <div style="text-align:right;">
            <div style="font-size:16px;font-weight:bold;color:white;">₦${selectedPack.priceNgn.toLocaleString()}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.3);">$${selectedPack.priceUsdt.toFixed(2)} USDT</div>
        </div>`;
    selectedMethod = null;
    updateMethodUI();
}

function selectPayMethod(method) {
    selectedMethod = method;
    updateMethodUI();
}

function updateMethodUI() {
    const isNgn  = selectedMethod === 'ngn';
    const isUsdt = selectedMethod === 'usdt';

    const ngnEl   = document.getElementById('method-ngn');
    const usdtEl  = document.getElementById('method-usdt');
    const radioN  = document.getElementById('radio-ngn');
    const radioU  = document.getElementById('radio-usdt');
    if (!ngnEl) return;

    ngnEl.style.border      = isNgn  ? '1.5px solid rgba(34,197,94,0.4)'   : '1px solid rgba(255,255,255,0.07)';
    ngnEl.style.background  = isNgn  ? 'rgba(34,197,94,0.06)'              : 'rgba(255,255,255,0.03)';
    radioN.innerHTML        = isNgn  ? '<i class="fas fa-check" style="color:#22c55e;font-size:10px;"></i>' : '';
    radioN.style.background = isNgn  ? '#22c55e'    : 'transparent';
    radioN.style.border     = isNgn  ? 'none'        : '1.5px solid rgba(255,255,255,0.2)';

    usdtEl.style.border      = isUsdt ? '1.5px solid rgba(38,161,123,0.4)'  : '1px solid rgba(255,255,255,0.07)';
    usdtEl.style.background  = isUsdt ? 'rgba(38,161,123,0.06)'             : 'rgba(255,255,255,0.03)';
    radioU.innerHTML         = isUsdt ? '<i class="fas fa-check" style="color:#26a17b;font-size:10px;"></i>' : '';
    radioU.style.background  = isUsdt ? '#26a17b'    : 'transparent';
    radioU.style.border      = isUsdt ? 'none'        : '1.5px solid rgba(255,255,255,0.2)';

    const btn = document.getElementById('pm-continue-btn');
    if (btn) {
        btn.style.background = selectedMethod ? 'linear-gradient(135deg,#7b2ff7,#4776E6)' : 'rgba(255,255,255,0.06)';
        btn.style.color      = selectedMethod ? 'white' : 'rgba(255,255,255,0.3)';
        btn.innerText        = selectedMethod ? 'Continue to Payment Details  →' : 'Select a payment method';
    }
}

function proceedToPaymentDetails() {
    if (!selectedMethod || !selectedPack) return;
    paymentRef = generateReference();
    renderPaymentDetails();
    navigateTo('payment-details-screen');
}

// ── Payment details screen ──
function detailRow(label, value, highlight, mono, copyFn) {
    const copyBtn = copyFn ? `<div onclick="${copyFn}" style="cursor:pointer;padding:7px;background:rgba(255,255,255,0.06);border-radius:8px;flex-shrink:0;"><i class="fas fa-copy" style="color:rgba(255,255,255,0.4);font-size:13px;"></i></div>` : '';
    return `<div style="margin-bottom:8px;padding:14px 16px;border-radius:14px;
        background:${highlight ? 'rgba(68,138,255,0.06)' : 'rgba(255,255,255,0.03)'};
        border:1px solid ${highlight ? 'rgba(68,138,255,0.2)' : 'rgba(255,255,255,0.06)'};
        display:flex;align-items:center;gap:12px;">
        <div style="flex:1;">
            <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:3px;">${label}</div>
            <div style="font-size:${mono ? '13px' : '15px'};color:white;font-weight:${highlight ? 'bold' : '500'};font-family:${mono ? 'monospace' : 'inherit'};word-break:break-all;">${value}</div>
        </div>${copyBtn}</div>`;
}

function copyText(text, label) {
    navigator.clipboard.writeText(text).then(() => showToast(`${label} copied!`)).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        showToast(`${label} copied!`);
    });
}

function renderPaymentDetails() {
    if (!selectedPack || !selectedMethod || !paymentRef) return;
    const isNgn = selectedMethod === 'ngn';
    const amount = isNgn ? `₦${selectedPack.priceNgn.toLocaleString()}` : `$${selectedPack.priceUsdt.toFixed(2)} USDT`;
    const accentColor = isNgn ? '#22c55e' : '#26a17b';

    let html = `
    <div style="padding:20px;border-radius:18px;background:${accentColor}14;border:1px solid ${accentColor}30;margin-bottom:20px;">
        <div style="font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:1.2px;margin-bottom:6px;">AMOUNT TO PAY</div>
        <div style="font-size:32px;font-weight:bold;color:white;">${amount}</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">${selectedPack.credits} credits · ${selectedPack.name} Pack</div>
    </div>
    <p style="font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:1.5px;font-weight:600;margin-bottom:10px;">YOUR REFERENCE</p>
    <div style="margin-bottom:20px;padding:16px;border-radius:14px;background:rgba(123,47,247,0.07);border:1px solid rgba(123,47,247,0.2);display:flex;align-items:center;gap:12px;cursor:pointer;" onclick="copyText('${paymentRef}','Reference')">
        <div style="flex:1;">
            <div style="font-size:11px;color:rgba(255,255,255,0.3);margin-bottom:6px;">Include this in your payment description</div>
            <div style="font-size:22px;font-weight:bold;color:white;letter-spacing:3px;font-family:monospace;">${paymentRef}</div>
        </div>
        <i class="fas fa-copy" style="color:#a855f7;font-size:16px;flex-shrink:0;"></i>
    </div>`;

    if (isNgn) {
        html += `
    <p style="font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:1.5px;font-weight:600;margin-bottom:10px;">BANK DETAILS</p>
    ${detailRow('Bank Name', BANK_NAME, false, false, null)}
    ${detailRow('Account Name', ACCOUNT_NAME, true, false, null)}
    ${detailRow('Account Number', ACCOUNT_NUMBER, true, true, "copyText('" + ACCOUNT_NUMBER + "','Account number')")}`;
    } else {
        html += `
    <p style="font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:1.5px;font-weight:600;margin-bottom:10px;">USDT DETAILS</p>
    ${detailRow('Network', USDT_NETWORK, false, false, null)}
    ${detailRow('Wallet Address', USDT_ADDRESS, true, true, "copyText('" + USDT_ADDRESS + "','Wallet address')")}`;
    }

    const warning = isNgn
        ? 'Transfer the exact amount and include your reference as the payment description. Payments without a reference may be delayed.'
        : 'Send the exact USDT amount on TRC-20 network ONLY. Do NOT use ERC-20 or BEP-20 — funds sent on the wrong network will be lost.';

    html += `
    <div style="margin-top:20px;padding:14px;border-radius:14px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);display:flex;align-items:flex-start;gap:10px;">
        <i class="fas fa-info-circle" style="color:#f59e0b;font-size:14px;margin-top:1px;flex-shrink:0;"></i>
        <span style="font-size:12px;color:rgba(245,158,11,0.8);line-height:1.6;">${warning}</span>
    </div>`;

    document.getElementById('pd-content').innerHTML = html;
}

// ── Submit payment ──
async function submitPayment() {
    const user = firebase.auth().currentUser;
    if (!user || !selectedPack || !selectedMethod || !paymentRef) return;

    const btn     = document.getElementById('pd-paid-btn');
    const btnText = btn.querySelector('span');
    const loader  = btn.querySelector('.loader');
    btn.disabled = true; btnText.style.display = 'none'; loader.style.display = 'block';

    try {
        const orderRef = await firebase.firestore().collection('pending_orders').add({
            user_id:        user.uid,
            user_email:     user.email || '',
            user_name:      user.displayName || '',
            pack_id:        selectedPack.id,
            pack_name:      selectedPack.name,
            credits:        selectedPack.credits,
            amount_ngn:     selectedPack.priceNgn,
            amount_usdt:    selectedPack.priceUsdt,
            payment_method: selectedMethod,
            reference:      paymentRef,
            status:         'pending',
            created_at:     firebase.firestore.FieldValue.serverTimestamp(),
            approved_at:    null,
            approved_by:    null,
        });
        pendingOrderId = orderRef.id;

        // Fire-and-forget Telegram notify
        fetch(`${BASE_URL}/notify_admin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
            body: JSON.stringify({
                order_id: orderRef.id, user_name: user.displayName || '',
                user_email: user.email || '', pack_name: selectedPack.name,
                credits: selectedPack.credits, amount_ngn: selectedPack.priceNgn,
                amount_usdt: selectedPack.priceUsdt, payment_method: selectedMethod,
                reference: paymentRef,
            })
        }).catch(() => {});

        renderPendingScreen('pending');
        navigateTo('payment-pending-screen');
        listenForOrderApproval(orderRef.id);

    } catch (e) {
        showToast('Error: ' + e.message);
        btn.disabled = false; btnText.style.display = ''; loader.style.display = 'none';
    }
}

// ── Pending screen states ──
function renderPendingScreen(status) {
    const body = document.getElementById('pending-body');
    if (!body || !selectedPack || !paymentRef) return;

    if (status === 'approved') {
        body.innerHTML = `
        <div style="text-align:center;">
            <div style="width:80px;height:80px;border-radius:50%;background:rgba(34,197,94,0.12);border:2px solid rgba(34,197,94,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:36px;">✅</div>
            <h2 style="font-size:22px;font-weight:bold;margin-bottom:10px;">Credits Added!</h2>
            <p style="color:rgba(255,255,255,0.5);font-size:14px;line-height:1.6;margin-bottom:28px;">${selectedPack.credits} credits have been added to your account.</p>
            <button onclick="navigateTo('chat-screen')" style="width:100%;height:52px;border-radius:16px;border:none;background:linear-gradient(135deg,#22c55e,#16a34a);color:white;font-size:15px;font-weight:bold;cursor:pointer;">Start Chatting! 🎉</button>
        </div>`;
        if (_orderListener) { _orderListener(); _orderListener = null; }
        updateDrawerCredits();
        return;
    }

    if (status === 'rejected') {
        body.innerHTML = `
        <div style="text-align:center;">
            <div style="width:80px;height:80px;border-radius:50%;background:rgba(239,68,68,0.1);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:36px;">❌</div>
            <h2 style="font-size:20px;font-weight:bold;margin-bottom:10px;">Payment Not Confirmed</h2>
            <p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;margin-bottom:16px;">We couldn't verify your payment. Contact support with your reference.</p>
            <div style="padding:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;margin-bottom:28px;">
                <span style="font-family:monospace;color:rgba(255,255,255,0.5);font-size:13px;">Reference: ${paymentRef}</span>
            </div>
            <a href="mailto:support@sympyapp.com" style="display:block;text-align:center;margin-bottom:12px;color:#448AFF;font-size:13px;">support@sympyapp.com</a>
            <button onclick="navigateTo('voice-screen')" style="width:100%;height:52px;border-radius:16px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:white;font-size:15px;font-weight:bold;cursor:pointer;">Go Back to Home</button>
        </div>`;
        if (_orderListener) { _orderListener(); _orderListener = null; }
        return;
    }

    // Pending
    body.innerHTML = `
    <div style="text-align:center;width:100%;">
        <div style="width:100px;height:100px;border-radius:50%;background:rgba(168,85,247,0.1);border:2px solid rgba(168,85,247,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 28px;font-size:44px;animation:pendingPulse 1.4s ease-in-out infinite;">⏳</div>
        <h2 style="font-size:22px;font-weight:bold;margin-bottom:10px;">Verifying Payment</h2>
        <p style="color:rgba(255,255,255,0.45);font-size:14px;line-height:1.6;margin-bottom:32px;">Our team is reviewing your payment. Credits will be added within 1 hour.</p>
        <div style="padding:16px;background:rgba(168,85,247,0.07);border:1px solid rgba(168,85,247,0.2);border-radius:16px;margin-bottom:16px;">
            <div style="font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:1.2px;margin-bottom:6px;">YOUR REFERENCE</div>
            <div style="font-size:22px;font-weight:bold;color:white;letter-spacing:3px;font-family:monospace;">${paymentRef}</div>
        </div>
        <div style="padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;margin-bottom:32px;display:flex;justify-content:space-between;">
            <span style="color:white;font-size:14px;">${selectedPack.name} Pack</span>
            <span style="color:rgba(255,255,255,0.4);font-size:14px;">${selectedPack.credits} credits</span>
        </div>
        <p style="font-size:12px;color:rgba(255,255,255,0.2);line-height:1.6;margin-bottom:16px;">You can safely close this screen.<br>We'll update it when credits are added.</p>
        <button onclick="navigateTo('voice-screen')" style="background:none;border:none;color:rgba(255,255,255,0.3);font-size:13px;text-decoration:underline;cursor:pointer;">Go back to home</button>
    </div>`;
}

// ── Firestore real-time listener ──
function listenForOrderApproval(orderId) {
    if (_orderListener) { _orderListener(); _orderListener = null; }
    _orderListener = firebase.firestore()
        .collection('pending_orders').doc(orderId)
        .onSnapshot(snap => {
            if (!snap.exists) return;
            const s = snap.data().status || 'pending';
            if (s === 'approved' || s === 'rejected') renderPendingScreen(s);
        });
}

// ── Update drawer & call screen with purchased credits ──
async function updateDrawerCredits() {
    const user = firebase.auth().currentUser;
    if (!user) return;
    try {
        const doc = await firebase.firestore().collection('users').doc(user.uid).get();
        purchasedCredits = doc.exists ? (doc.data().credits || 0) : 0;
        // Refresh the combined display
        updateDrawerQuota();
    } catch(e) {}
}

// Pulse animation
const payStyle = document.createElement('style');
payStyle.innerText = `@keyframes pendingPulse{0%,100%{box-shadow:0 0 0 0 rgba(168,85,247,0.3);}50%{box-shadow:0 0 0 14px rgba(168,85,247,0);}}`;
document.head.appendChild(payStyle);

// (done inline in the original navigateTo function above)