// --- Configuration ---
const N8N_WEBHOOK_URL = 'https://webhook-processor-production-ef3e.up.railway.app/webhook/7bc992d1-2857-4cb6-b708-b62c162c3f40';
const ELEVENLABS_API_KEY_DEFAULT = 'sk_97d184f2d240feeb9cabeb7e0425f13309986590adaea795'; // Default key (German, English, Turkish)
const ELEVENLABS_API_KEY_ARABIC = 'sk_831124d925285659dad240555a312c42cac868c94bc01e35'; // Arabic-specific key
const ELEVENLABS_VOICE_ID_DEFAULT = 'kaGxVtjLwllv1bi2GFag'; // Default German Voice ID

// --- Session ID ---
const sessionId = crypto.randomUUID();
console.log('Session ID:', sessionId);

// --- HTML Element References ---
const chatOutput = document.getElementById('chat-output');
const textInput = document.getElementById('text-input');
const sendButton = document.getElementById('send-button');
const enterVoiceModeButton = document.getElementById('enter-voice-mode-button');
const startConversationButton = document.getElementById('start-conversation-button');
const stopConversationButton = document.getElementById('stop-conversation-button');
const backToTextButton = document.getElementById('back-to-text-button');
const statusElement = document.getElementById('status');
const voiceStatusDisplay = document.getElementById('voice-status-display');
const languageSelect = document.getElementById('language-select');

// --- State Variables ---
let currentMode = 'text';
let recognition;
let isRecognizing = false;
let allowRecognitionRestart = false;
let restartTimeoutId = null;
let currentAudio = null;
let typingIndicatorElement = null;
let elevenLabsController = null; // AbortController for ElevenLabs fetch

// --- Speech Recognition (STT - Web Speech API) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        console.log('Speech recognition started');
        isRecognizing = true;
        allowRecognitionRestart = false;
        statusElement.textContent = 'Höre zu...';
        statusElement.className = '';
        voiceStatusDisplay.className = 'listening';
        if (restartTimeoutId) {
            clearTimeout(restartTimeoutId);
            restartTimeoutId = null;
        }
    };

    recognition.onresult = (event) => {
        const speechResult = event.results[0][0].transcript;
        console.log('Speech recognized:', speechResult);
        if (speechResult.trim()) {
            handleSend(speechResult, true);
        }
    };

    recognition.onspeechend = () => {
        console.log('Speech ended');
    };

    recognition.onend = () => {
        isRecognizing = false;
        console.log('Speech recognition ended');
        if (currentMode === 'voiceActive' && allowRecognitionRestart) {
            console.log('Scheduling auto-restart recognition');
            restartTimeoutId = setTimeout(() => {
                if (currentMode === 'voiceActive') {
                    console.log('Executing auto-restart recognition');
                    startRecognition();
                } else {
                    console.log('Auto-restart cancelled, mode changed.');
                }
                restartTimeoutId = null;
            }, 150);
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        isRecognizing = false;
        allowRecognitionRestart = false;
        if (currentMode === 'voiceActive') {
            statusElement.textContent = `Spracherkennungsfehler: ${event.error}. Erneut versuchen?`;
            statusElement.className = 'error';
            voiceStatusDisplay.className = 'error';
        } else {
            setUIMode('text');
        }
    };

} else {
    console.warn('Web Speech API is not supported in this browser.');
    if(enterVoiceModeButton) enterVoiceModeButton.disabled = true;
    if(startConversationButton) startConversationButton.disabled = true;
    if(stopConversationButton) stopConversationButton.disabled = true;
}

// --- Core Functions ---
function addMessageToChat(text, sender) {
    if (currentMode === 'text' || (currentMode === 'voiceIdle' && sender === 'bot')) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', sender === 'user' ? 'user-message' : 'bot-message');
        messageElement.textContent = text;
        chatOutput.appendChild(messageElement);
        chatOutput.scrollTop = chatOutput.scrollHeight;
    }
}

function showTypingIndicator(show) {
    if (show && currentMode === 'text') {
        if (!typingIndicatorElement) {
            typingIndicatorElement = document.createElement('div');
            typingIndicatorElement.classList.add('message', 'bot-message', 'typing-indicator');
            typingIndicatorElement.innerHTML = '<span></span><span></span><span></span>';
            chatOutput.appendChild(typingIndicatorElement);
            chatOutput.scrollTop = chatOutput.scrollHeight;
        }
    } else {
        if (typingIndicatorElement) {
            typingIndicatorElement.remove();
            typingIndicatorElement = null;
        }
    }
}

async function handleSend(text, isFromVoice = false) {
    if (!text.trim()) return;

    if (!isFromVoice) {
        addMessageToChat(text, 'user');
        textInput.value = '';
        textInput.style.removeProperty('height');
        textInput.style.height = 'auto';
        textInput.blur(); // <-- Added to reset focus/height correctly
        showTypingIndicator(true);
    } else {
        statusElement.textContent = 'Denke nach...';
        statusElement.className = 'thinking';
        voiceStatusDisplay.className = 'thinking';
        allowRecognitionRestart = false;
    }

    try {
        const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatInput: text, sessionId: sessionId }),
        });

        if (!isFromVoice) showTypingIndicator(false);

        if (!response.ok) throw new Error(`n8n request failed with status ${response.status}`);

        const result = await response.json();
        const botResponseText = result.output;
        if (!botResponseText) throw new Error('n8n response did not contain an "output" field.');

        if (!isFromVoice) {
            addMessageToChat(botResponseText, 'bot');
        }

    } catch (error) {
        console.error('Error sending/receiving message:', error);
        if (!isFromVoice) {
            showTypingIndicator(false);
            addMessageToChat(`Fehler: ${error.message}`, 'bot');
        } else {
            allowRecognitionRestart = false;
            statusElement.textContent = `n8n Fehler: ${error.message}. Klicken zum Beenden/Neustarten.`;
            statusElement.className = 'error';
            voiceStatusDisplay.className = 'error';
        }
    }
}

// --- Event Listener for Sending ---
sendButton.addEventListener('click', () => handleSend(textInput.value));
textInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') handleSend(textInput.value);
});

// --- Auto-resize textarea ---
textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = textInput.scrollHeight + 'px';
});
