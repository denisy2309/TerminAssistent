// --- Configuration ---
const N8N_WEBHOOK_URL = 'https://webhook-processor-production-ef3e.up.railway.app/webhook/7bc992d1-2857-4cb6-b708-b62c162c3f40';
const ELEVENLABS_API_KEY_DEFAULT = 'sk_13c1b0003316958d674ce5bc3ba49d1924d9eb823004cc4f'; // Default key (German, English, Turkish)
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
        // Do not reset status display here if restart not allowed
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

// --- Permissions Check ---
async function checkMicPermission() {
    if (!navigator.permissions || !enterVoiceModeButton) {
        console.warn('Permissions API not supported or button not found.');
        return;
    }
    try {
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
        console.log('Microphone permission status:', permissionStatus.state);

        if (permissionStatus.state === 'denied') {
            enterVoiceModeButton.disabled = true;
            enterVoiceModeButton.textContent = 'Mikrofon blockiert';
            statusElement.textContent = 'Mikrofonzugriff blockiert. Bitte in Browsereinstellungen ändern.';
            statusElement.className = 'error';
            statusElement.style.display = 'inline';
        } else {
            enterVoiceModeButton.disabled = false;
        }

        permissionStatus.onchange = () => {
            console.log('Microphone permission status changed to:', permissionStatus.state);
             if (permissionStatus.state === 'denied') {
                enterVoiceModeButton.disabled = true;
                enterVoiceModeButton.textContent = 'Mikrofon blockiert';
                if(currentMode !== 'text') {
                    setUIMode('text');
                }
            } else {
                 enterVoiceModeButton.disabled = false;
                 enterVoiceModeButton.textContent = '🎤 Sprachmodus';
            }
        };

    } catch (error) {
        console.error('Error checking microphone permission:', error);
    }
}

// --- Start/Stop Recognition ---
function startRecognition() {
    if (recognition && !isRecognizing && currentMode === 'voiceActive') {
        try {
            recognition.lang = languageSelect.value;
            console.log(`Setting recognition language to: ${recognition.lang}`);
            allowRecognitionRestart = false;
            console.log("Attempting recognition.start()...");
            recognition.start();
        } catch (error) {
            console.error("Error starting recognition:", error);
             statusElement.textContent = `Fehler beim Start: ${error.message}`;
             statusElement.className = 'error';
             voiceStatusDisplay.className = 'error';
             isRecognizing = false;
        }
    } else {
        console.log("StartRecognition called but conditions not met (isRecognizing:", isRecognizing, "currentMode:", currentMode, ")");
    }
}

// Function to stop current TTS playback
function stopCurrentSpeech() {
    if (currentAudio) {
        console.log("Stopping current speech playback.");
        currentAudio.pause();
        currentAudio.src = '';
        currentAudio = null;
    }
}

function stopRecognition() {
     if (restartTimeoutId) {
        clearTimeout(restartTimeoutId);
        restartTimeoutId = null;
     }
     if (recognition && isRecognizing) {
        console.log("Attempting recognition.stop()...");
        allowRecognitionRestart = false;
        recognition.stop();
    }
    isRecognizing = false;
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
        showTypingIndicator(true);
    } else {
        statusElement.textContent = 'Denke nach...';
        statusElement.className = 'thinking';
        voiceStatusDisplay.className = 'thinking';
        console.log("Set voiceStatusDisplay class to: thinking");
        allowRecognitionRestart = false;
    }

    try {
        console.log(`Sending to n8n (${isFromVoice ? 'voice' : 'text'}):`, text);
        const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatInput: text, sessionId: sessionId }),
        });

        if (!isFromVoice) { showTypingIndicator(false); }

        if (!response.ok) { throw new Error(`n8n request failed with status ${response.status}`); }
        const result = await response.json();
        const botResponseText = result.output;
        if (!botResponseText) { throw new Error('n8n response did not contain an "output" field.'); }
        console.log('Received from n8n:', botResponseText);

        if (!isFromVoice) {
            addMessageToChat(botResponseText, 'bot');
        } else {
            const apiKeyToUse = languageSelect.value.startsWith('ar') ? ELEVENLABS_API_KEY_ARABIC : ELEVENLABS_API_KEY_DEFAULT;
            if (apiKeyToUse) { // Check if a key exists for the selected language
                 try {
                     await speakText(botResponseText, apiKeyToUse); // Pass the correct API key
                     if (currentMode === 'voiceActive') {
                         console.log("TTS finished, enabling restart flag.");
                         allowRecognitionRestart = true;
                         if (!isRecognizing) {
                             console.log("Recognition already ended, manually triggering onend for restart check.");
                             recognition.onend();
                         }
                     }
                 } catch (ttsError) {
                     console.error("TTS Error occurred:", ttsError);
                     if (currentMode === 'voiceActive') {
                         allowRecognitionRestart = false;
                         statusElement.textContent = 'TTS Fehler. Klicken zum Beenden/Neustarten.';
                         statusElement.className = 'error';
                         voiceStatusDisplay.className = 'error';
                     }
                 }
            } else {
                console.warn('ElevenLabs API Key not set for this language. Skipping TTS.');
                if (currentMode === 'voiceActive') {
                     allowRecognitionRestart = true;
                     if (!isRecognizing) { recognition.onend(); }
                }
            }
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

function speakText(text, apiKey) { // Added apiKey parameter
    return new Promise(async (resolve, reject) => {
        stopCurrentSpeech();

        const selectedLang = languageSelect.value;
        let voiceId;
        if (selectedLang.startsWith('en')) {
            voiceId = 'uYXf8XasLslADfZ2MB4u';
        } else if (selectedLang.startsWith('tr')) {
            voiceId = '5RqXmIU9ikjifeWoXHMG';
        } else if (selectedLang.startsWith('ar')) {
            voiceId = 'VMy40598IGgDeaOE8phq'; // Using the first Arabic ID again
        } else {
            voiceId = ELEVENLABS_VOICE_ID_DEFAULT; // Use default German ID constant
        }
        console.log(`Using Voice ID: ${voiceId} for language: ${selectedLang}`);

        const modelId = 'eleven_multilingual_v2';
        console.log(`Using Model ID: ${modelId}`);

        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
        const headers = {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey, // Use the passed API key
        };
        const data = {
            text: text,
            model_id: modelId,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        };

        try {
            console.log('Sending to ElevenLabs:', text);
            statusElement.textContent = 'Spreche...';
            statusElement.className = 'speaking';
            voiceStatusDisplay.className = 'speaking';
            console.log("Set voiceStatusDisplay class to: speaking");

            const response = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(data) });

            if (!response.ok) {
                let errorBody = 'Unknown error';
                try { errorBody = (await response.json()).detail || response.statusText; } catch (e) { errorBody = response.statusText; }
                throw new Error(`ElevenLabs request failed: ${response.status} ${errorBody}`);
            }

            const audioBlob = await response.blob();
            if (selectedLang.startsWith('ar')) {
                console.log(`Arabic TTS Blob received: Size=${audioBlob.size}, Type=${audioBlob.type}`);
                if (audioBlob.size < 100) { console.warn("Received very small audio blob for Arabic."); }
            }
            const audioUrl = URL.createObjectURL(audioBlob);
            currentAudio = new Audio(audioUrl);
            console.log('Playing audio from ElevenLabs');

            currentAudio.onended = () => {
                console.log('Audio playback finished.');
                URL.revokeObjectURL(audioUrl);
                currentAudio = null;
                resolve();
            };
            currentAudio.onerror = (err) => {
                console.error('Audio playback error:', err);
                URL.revokeObjectURL(audioUrl);
                statusElement.textContent = 'Audio Wiedergabefehler.';
                statusElement.className = 'error';
                voiceStatusDisplay.className = 'error';
                currentAudio = null;
                reject(new Error('Audio playback error'));
            };
            currentAudio.play();
        } catch (error) {
            console.error('Error calling ElevenLabs API:', error);
            statusElement.textContent = 'TTS API Fehler.';
            statusElement.className = 'error';
            voiceStatusDisplay.className = 'error';
            currentAudio = null;
            console.error("ElevenLabs API Error Object:", error);
            reject(error);
        }
    });
}

// --- UI Mode Management & Event Listeners ---
function setUIMode(newMode) {
    console.log(`Setting UI Mode: ${newMode}`);
    const oldMode = currentMode;
    currentMode = newMode;
    document.body.className = '';

    switch (newMode) {
        case 'text':
            document.body.classList.add('text-mode');
            if (oldMode !== 'text') { stopCurrentSpeech(); stopRecognition(); }
            allowRecognitionRestart = false; isRecognizing = false;
            statusElement.style.display = 'none';
            voiceStatusDisplay.className = '';
            break;
        case 'voiceIdle':
            document.body.classList.add('voice-mode-idle');
            statusElement.textContent = 'Bereit. Klicken Sie auf Grün zum Starten.';
            statusElement.className = '';
            voiceStatusDisplay.className = 'idle';
            if (oldMode !== 'voiceIdle') { stopCurrentSpeech(); stopRecognition(); }
            allowRecognitionRestart = false; isRecognizing = false;
            break;
        case 'voiceActive':
            document.body.classList.add('voice-mode-active');
            break;
    }
}

// --- Attach Event Listeners ---
sendButton.addEventListener('click', () => handleSend(textInput.value));
textInput.addEventListener('keypress', (event) => { if (event.key === 'Enter') handleSend(textInput.value); });

enterVoiceModeButton.addEventListener('click', async () => {
    if (!recognition || currentMode !== 'text') return;
    setUIMode('voiceIdle');
    const greeting = "Hallo! Wie kann ich Ihnen bei Ihrer Terminplanung helfen?";
    const apiKeyToUse = languageSelect.value.startsWith('ar') ? ELEVENLABS_API_KEY_ARABIC : ELEVENLABS_API_KEY_DEFAULT;
    try {
        console.log("Attempting to speak greeting on entering voice mode...");
        await speakText(greeting, apiKeyToUse); // Pass correct key for greeting
        console.log("Greeting finished speaking.");
        if (currentMode === 'voiceIdle') {
             statusElement.textContent = 'Bereit. Klicken Sie auf Grün zum Starten.';
             statusElement.className = '';
             voiceStatusDisplay.className = 'idle';
        }
    } catch (error) {
         console.error("Error during initial greeting:", error);
         statusElement.textContent = 'Fehler bei Begrüßung. Zurück zum Text?';
         statusElement.className = 'error';
         voiceStatusDisplay.className = 'error';
    }
});

startConversationButton.addEventListener('click', () => {
    if (!recognition || currentMode !== 'voiceIdle') return;
    setUIMode('voiceActive');
    console.log("Green button clicked, starting recognition for user's first turn...");
    startRecognition();
});

stopConversationButton.addEventListener('click', () => {
    if (currentMode !== 'voiceActive') return;
    console.log("Stop conversation button clicked");
    allowRecognitionRestart = false;
    stopCurrentSpeech();
    stopRecognition();
    setUIMode('voiceIdle');
});

backToTextButton.addEventListener('click', () => {
    allowRecognitionRestart = false;
    stopCurrentSpeech();
    stopRecognition();
    setUIMode('text');
});

// --- Initial Setup ---
if (SpeechRecognition) {
    checkMicPermission();
}
setUIMode('text'); // Set initial UI mode

// --- Initial Greeting Message (Text Mode) ---
const initialGreeting = "Hallo! Wie kann ich Ihnen bei Ihrer Terminplanung helfen?";
addMessageToChat(initialGreeting, 'bot');
