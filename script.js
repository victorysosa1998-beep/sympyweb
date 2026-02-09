// =======================
// Data state management
// =======================
let currentVibe = "Chaotic";
let selectedVoice = "female";
const API_KEY = "Eghosa1998";
const BASE_URL = "https://web-production-6c359.up.railway.app";

// LiveKit Global Variables
let room;
let callTimer;
let secondsElapsed = 0;

// Mobile-safe state
let isConnecting = false;
let hasConnectedOnce = false;
let connectionTimeout;
let __audioUnlocked = false;
let __callStartedAt = 0;
let __callExitAllowed = false;

// =======================
// Screen Navigation Logic
// =======================
function navigateTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        if (s.id === 'call-overlay') s.style.display = 'none';
    });

    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
        if (screenId === 'call-overlay') forceShowCallOverlay();
    }

    if (screenId === 'chat-screen') startChat();
}

// =======================
// FORCE CALL OVERLAY VISIBLE
// =======================
function forceShowCallOverlay() {
    const overlay = document.getElementById('call-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
    }
}

// =======================
// Vibe Selection
// =======================
function setVibe(el, vibe) {
    document.querySelectorAll('.vibe-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    currentVibe = vibe;
}

// =======================
// Chat Init
// =======================
function startChat() {
    const chatBody = document.getElementById('chat-messages');
    if (chatBody && chatBody.innerHTML.trim() === '') {
        addMessage("sympy", "Hey, hi! ... I'm Missy, nice to meet you.");
        setTimeout(() => {
            addMessage(
                "sympy",
                "So, what do I call you and what language would you like to chat with today, English or Pidgin?"
            );
        }, 1000);
    }
}

// =======================
// Messages
// =======================
function addMessage(role, text) {
    const chatBody = document.getElementById('chat-messages');
    if (!chatBody) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    msgDiv.innerText = text;
    chatBody.appendChild(msgDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
}

// =======================
// Typing Indicator Functions
// =======================
function showTypingIndicator() {
    const chatBody = document.getElementById('chat-messages');
    if (!chatBody || document.getElementById('typing-indicator')) return;

    const typingDiv = document.createElement('div');
    typingDiv.id = 'typing-indicator';
    typingDiv.className = 'message sympy typing';
    typingDiv.innerHTML = `
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
    `;
    chatBody.appendChild(typingDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
}

function hideTypingIndicator() {
    const el = document.getElementById('typing-indicator');
    if (el) el.remove();
}

// =======================
// Send Chat
// =======================
async function sendMessage() {
    const input = document.getElementById('user-input');
    if (!input) return;
    const messageText = input.value.trim();
    if (!messageText) return;

    addMessage("user", messageText);
    input.value = '';

    showTypingIndicator();

    const url = `${BASE_URL}/chat?voice=${selectedVoice}&vibe=${currentVibe}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': API_KEY
            },
            body: JSON.stringify({ message: messageText, context: [] })
        });

        const data = await response.json();
        hideTypingIndicator();
        addMessage("sympy", data.reply);
    } catch (e) {
        hideTypingIndicator();
        addMessage("sympy", "Connection issue. Try again.");
    }
}

// =======================
// AUDIO UNLOCK (USER GESTURE)
// =======================
async function __unlockAudioOnce() {
    if (__audioUnlocked) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const silentAudio = document.createElement("audio");
        silentAudio.srcObject = stream;
        silentAudio.muted = true;
        silentAudio.playsInline = true;
        await silentAudio.play();
        __audioUnlocked = true;
        console.log("[CALL FIX] Microphone unlocked");
    } catch (err) {
        console.warn("[CALL FIX] Audio unlock blocked:", err);
    }
}

// =======================
// VOICE CALL
// =======================
async function startVoiceCall() {
    if (isConnecting) return;
    isConnecting = true;
    hasConnectedOnce = false;

    navigateTo('call-overlay');
    const statusEl = document.getElementById('call-status-text');
    if (statusEl) statusEl.innerText = "Connecting...";
    resetTimer();

    try {
        await __unlockAudioOnce();

        const tokenRes = await fetch(
            `${BASE_URL}/get_token?gender=${selectedVoice}&vibe=${currentVibe}`,
            { headers: { 'X-API-KEY': API_KEY } }
        );
        if (!tokenRes.ok) throw new Error("Token fetch failed");
        const tokenData = await tokenRes.json();

        if (room) try { await room.disconnect(); } catch (_) {}
        room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });

        room.on(LivekitClient.RoomEvent.TrackSubscribed, track => {
            if (track.kind === "audio") {
                const audio = track.attach();
                audio.autoplay = true;
                audio.playsInline = true;
                const container = document.getElementById('audio-container');
                if (container) container.appendChild(audio);
                audio.play().catch(() => {});
            }
        });

        await room.connect(tokenData.url, tokenData.token);
        try { await room.localParticipant.setMicrophoneEnabled(true); } catch (_) {}

        hasConnectedOnce = true;
        if (statusEl) statusEl.innerText = "Live";
        startDurationTimer();
        __markCallStarted();

        connectionTimeout = setTimeout(() => {
            if (!hasConnectedOnce) softFailCall();
        }, 15000);

    } catch (err) {
        console.warn("[CALL ERROR]", err);
        softFailCall();
    }
}

// =======================
// TIMERS
// =======================
function startDurationTimer() {
    secondsElapsed = 0;
    if (callTimer) clearInterval(callTimer);

    callTimer = setInterval(() => {
        secondsElapsed++;
        const m = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
        const s = String(secondsElapsed % 60).padStart(2, '0');
        const durationEl = document.getElementById('call-duration');
        if (durationEl) durationEl.innerText = `${m}:${s}`;
    }, 1000);
}

function resetTimer() {
    if (callTimer) clearInterval(callTimer);
    const durationEl = document.getElementById('call-duration');
    if (durationEl) durationEl.innerText = "00:00";
}

// =======================
// END CALL
// =======================
function __markCallStarted() {
    __callStartedAt = Date.now();
    __callExitAllowed = false;
    setTimeout(() => { __callExitAllowed = true; }, 4000);
}

function softFailCall() {
    const status = document.getElementById('call-status-text');
    if (status) status.innerText = "Reconnecting...";
    setTimeout(() => endCall(), 1500);
}

function endCall() {
    const elapsed = Date.now() - __callStartedAt;
    if (!__callExitAllowed && elapsed < 4000 && hasConnectedOnce) {
        return;
    }
    isConnecting = false;
    if (connectionTimeout) clearTimeout(connectionTimeout);
    try { if (room) room.disconnect(); } catch (_) {}
    resetTimer();
    navigateTo('chat-screen');
}

// =======================
// CONTROLS
// =======================
function toggleMute() {
    if (!room) return;
    const enabled = room.localParticipant.isMicrophoneEnabled;
    room.localParticipant.setMicrophoneEnabled(!enabled);
}

function toggleSpeaker() {
    const btn = document.getElementById('speaker-btn');
    if (btn) btn.classList.toggle('active-blue');
}

function selectVoice(gender) {
    selectedVoice = gender;
}

function handleKeyPress(e) {
    if (e.key === 'Enter') sendMessage();
}

// =======================
// Firebase Initialization
// =======================
const firebaseConfig = {
    apiKey: "AIzaSyDXTMsESWcJCzDMItxzQhVrPfnQXUDs8RY",
    authDomain: "sympy-ai.firebaseapp.com",
    projectId: "sympy-ai",
    storageBucket: "sympy-ai.firebasestorage.app",
    messagingSenderId: "949064788583",
    appId: "1:949064788583:web:9a63685807881b4da4c2c2",
    measurementId: "G-SBY8GEKMZT"
};
firebase.initializeApp(firebaseConfig);

// =======================
// Authentication Handlers
// =======================
async function handleLogin() {
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');

    if (!email || !pass) { alert("Please fill all fields"); return; }
    btn.innerText = "Authenticating...";
    btn.disabled = true;

    try {
        const cred = await firebase.auth().signInWithEmailAndPassword(email, pass);
        if (!cred.user.emailVerified) {
            alert("Please verify your email first.");
            await firebase.auth().signOut();
        } else {
            navigateTo('voice-screen');
        }
    } catch (e) { alert(e.message); }
    btn.innerText = "Login"; btn.disabled = false;
}

async function handleSignup() {
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const pass = document.getElementById('signup-password').value;
    const btn = document.getElementById('signup-btn');

    if (!name || !email || !pass) { alert("Please fill all fields"); return; }
    btn.innerText = "Creating Account...";
    btn.disabled = true;

    try {
        const cred = await firebase.auth().createUserWithEmailAndPassword(email, pass);
        await cred.user.updateProfile({ displayName: name });
        await cred.user.sendEmailVerification();
        alert("Verification link sent! Check your email.");
        navigateTo('login-screen');
    } catch (e) { alert(e.message); }
    btn.innerText = "Sign Up"; btn.disabled = false;
}

async function handleResetPassword() {
    const email = document.getElementById('reset-email').value;
    if (!email) { alert("Enter your email"); return; }
    try {
        await firebase.auth().sendPasswordResetEmail(email);
        alert("Reset link sent!");
        navigateTo('login-screen');
    } catch (e) { alert(e.message); }
}

// =======================
// Event Listeners
// =======================
const mainCallBtn = document.getElementById('call-btn');
if (mainCallBtn) {
    mainCallBtn.onclick = async () => {
        mainCallBtn.disabled = true;
        await startVoiceCall();
        mainCallBtn.disabled = false;
    };
}

document.addEventListener("click", async () => {
    if (!__audioUnlocked) await __unlockAudioOnce();
});

const inputEl = document.getElementById('user-input');
if (inputEl) inputEl.addEventListener('keypress', handleKeyPress);