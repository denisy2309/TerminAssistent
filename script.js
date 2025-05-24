// --- Configuration ---
const N8N_WEBHOOK_URL = 'https://webhook-processor-production-ef3e.up.railway.app/webhook/7bc992d1-2857-4cb6-b708-b62c162c3f40';
const ELEVENLABS_API_KEY_DEFAULT = 'sk_5e09e402f42983acfb8e8b813b487a516485c9f4b392926a'; // Default key (German, English, Turkish)
const ELEVENLABS_API_KEY_ARABIC = 'sk_fae445a502bdf9d6721db1253e41b2ced35028c85b333e0b'; // Arabic-specific key
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
const statusElement = document.getElementById('status'); // Keep for general status messages
const voiceStatusDisplay = document.getElementById('voice-status-display');
const languageSelect = document.getElementById('language-select');

// New status text elements
const statusTextListening = document.getElementById('status-text-listening');
const statusTextThinking = document.getElementById('status-text-thinking');
const statusTextSpeaking = document.getElementById('status-text-speaking');
const statusTextIdle = document.getElementById('status-text-idle');


// --- Language Map for Status Texts ---
const statusTexts = {
    'de-DE': {
        idle: 'Starte das Gespräch',
        listening: 'Sag dem Assistenten etwas',
        thinking: 'Der Assistent denkt gerade nach',
        speaking: 'Assistent spricht gerade'
    },
    'en-US': {
        idle: 'Start the conversation',
        listening: 'Say something to the assistant',
        thinking: 'The assistant is thinking',
        speaking: 'Assistant is speaking'
    },
    'tr-TR': {
        idle: 'Konuşmayı başlat',
        listening: 'Asistana bir şey söyle',
        thinking: 'Asistan düşünüyor',
        speaking: 'Asistan konuşuyor'
    },
    'ar-SA': {
        idle: 'ابدأ المحادثة',
        listening: 'قل شيئًا للمساعد',
        thinking: 'المساعد يفكر',
        speaking: 'المساعد يتحدث'
    },
    'ru-RU': {
        idle: 'Начать разговор',
        listening: 'Скажите что-нибудь помощнику',
        thinking: 'Помощник думает',
        speaking: 'Помощник говорит'
    },
    'uk-UA': {
        idle: 'Почати розмову',
        listening: 'Скажіть щось помічнику',
        thinking: 'Помічник думає',
        speaking: 'Помічник говорить'
    }
};


// --- State Variables ---
let currentMode = 'text';
let recognition;
let isRecognizing = false;
let allowRecognitionRestart = false;
let restartTimeoutId = null;
let currentAudio = null; // Keep for potential fallback or other uses? Maybe remove later.
let typingIndicatorElement = null;
let elevenLabsController = null; // AbortController for ElevenLabs fetch
let audioContext = null; // Web Audio API context
let currentAudioSource = null; // Web Audio API source node

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
        const selectedLang = languageSelect.value;
        statusTextListening.textContent = statusTexts[selectedLang]?.listening || statusTexts['de-DE'].listening; // Set listening text based on language
        statusTextThinking.textContent = ''; // Clear thinking text
        statusTextSpeaking.textContent = ''; // Clear speaking text
        statusTextIdle.textContent = ''; // Clear idle text
        statusElement.textContent = ''; // Clear general status
        voiceStatusDisplay.className = 'listening';
        if (restartTimeoutId) {
            clearTimeout(restartTimeoutId);
            restartTimeoutId = null;
        }
    };

    recognition.onresult = (event) => {
        const speechResult = event.results[0][0].transcript;
        console.log('Speech recognized:', speechResult);
        statusTextListening.textContent = ''; // Clear listening text on result
        if (speechResult.trim()) {
            handleSend(speechResult, true);
        }
    };

    recognition.onspeechend = () => {
        console.log('Speech ended');
        statusTextListening.textContent = ''; // Clear listening text on speech end
    };

    recognition.onend = () => {
        isRecognizing = false;
        console.log('Speech recognition ended');
        statusTextListening.textContent = ''; // Clear listening text on recognition end
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
        statusTextListening.textContent = ''; // Clear listening text on error
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
    // Stop Web Audio API source node
    if (currentAudioSource) {
        console.log("Stopping current Web Audio playback.");
        try {
            currentAudioSource.stop();
        } catch (e) {
            console.warn("Error stopping audio source:", e); // Might throw if already stopped
        }
        currentAudioSource = null;
    }
     // Stop HTML Audio element (if used as fallback, keep for now)
     if (currentAudio) {
        console.log("Stopping current HTML Audio playback.");
        currentAudio.pause();
        currentAudio.src = '';
        currentAudio = null;
    }
    // Also abort any pending fetch request
    if (elevenLabsController) {
        console.log("Aborting pending ElevenLabs fetch request.");
        elevenLabsController.abort();
        elevenLabsController = null;
    }
}

function stopRecognition() {
    isRecognizing = false; // Set flag to false immediately
     if (restartTimeoutId) {
        clearTimeout(restartTimeoutId);
        restartTimeoutId = null;
     }
     if (recognition) { // Check if recognition object exists
        console.log("Attempting recognition.stop()...");
        allowRecognitionRestart = false;
        recognition.stop();
    }
    // isRecognizing is already set to false
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
        // Remove inline height style to allow CSS/rows attribute to reset height
        textInput.style.removeProperty('height');
        textInput.style.height = 'auto';
        showTypingIndicator(true);
    } else {
        const selectedLang = languageSelect.value;
        statusTextListening.textContent = ''; // Clear listening text
        statusTextThinking.textContent = statusTexts[selectedLang]?.thinking || statusTexts['de-DE'].thinking; // Set thinking text based on language
        statusTextSpeaking.textContent = ''; // Clear speaking text
        statusTextIdle.textContent = ''; // Clear idle text
        statusElement.textContent = ''; // Clear general status
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
            // Determine API Key based on language
            const selectedLang = languageSelect.value;
            const apiKeyToUse = (selectedLang.startsWith('ar') || selectedLang.startsWith('ru') || selectedLang.startsWith('uk-UA'))
                                ? ELEVENLABS_API_KEY_ARABIC
                                : ELEVENLABS_API_KEY_DEFAULT;

            if (apiKeyToUse) {
                 try {
                     await speakText(botResponseText, apiKeyToUse); // Pass API key to speakText
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

function speakText(text, apiKey) {
    return new Promise(async (resolve, reject) => {
        stopCurrentSpeech(); // Stop any previous speech or pending request

        // Ensure AudioContext is available and resumed
        if (!audioContext) {
            console.error("AudioContext not initialized.");
            return reject(new Error("AudioContext not initialized."));
        }
        if (audioContext.state === 'suspended') {
            try {
                await audioContext.resume();
                console.log("AudioContext resumed for playback.");
            } catch (e) {
                console.error("Failed to resume AudioContext for playback:", e);
                return reject(new Error("Failed to resume AudioContext."));
            }
        }

        elevenLabsController = new AbortController(); // Create a new controller for this request
        const signal = elevenLabsController.signal;

        const selectedLang = languageSelect.value;
        let voiceId;
        // Select Voice ID based on language
        if (selectedLang.startsWith('en')) {
            voiceId = 'uYXf8XasLslADfZ2MB4u'; // English
        } else if (selectedLang.startsWith('tr')) {
            voiceId = '5RqXmIU9ikjifeWoXHMG'; // Turkish
        } else if (selectedLang.startsWith('ar')) {
            voiceId = 'VMy40598IGgDeaOE8phq'; // Arabic
        } else if (selectedLang.startsWith('ru')) {
            voiceId = 'aG9q1I1wTbfHh5sbpJnp'; // Russian
        } else if (selectedLang.startsWith('uk')) {
            voiceId = 'Ntd0iVwICtUtA6Fvx27M'; // Ukrainian
        } else { // Default to German
            voiceId = ELEVENLABS_VOICE_ID_DEFAULT;
        }
        console.log(`Using Voice ID: ${voiceId} for language: ${selectedLang}`);

        const modelId = 'eleven_multilingual_v2';
        console.log(`Using Model ID: ${modelId}`);

        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
        const headers = {
            'Accept': 'audio/mpeg', // Keep this for the API request
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
        };
        const data = {
            text: text,
            model_id: modelId,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        };

        try {
            console.log('Sending to ElevenLabs:', text);
            const selectedLang = languageSelect.value; // Get language again inside try for safety
            statusTextListening.textContent = ''; // Clear listening text
            statusTextThinking.textContent = ''; // Clear thinking text
            statusTextSpeaking.textContent = statusTexts[selectedLang]?.speaking || statusTexts['de-DE'].speaking; // Set speaking text based on language
            statusTextIdle.textContent = ''; // Clear idle text
            statusElement.textContent = ''; // Clear general status
            voiceStatusDisplay.className = 'speaking';
            console.log("Set voiceStatusDisplay class to: speaking");

            const response = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(data), signal: signal });

            if (!response.ok) {
                let errorBody = 'Unknown error';
                try { errorBody = (await response.json()).detail || response.statusText; } catch (e) { errorBody = response.statusText; }
                throw new Error(`ElevenLabs request failed: ${response.status} ${errorBody}`);
            }

            const audioData = await response.arrayBuffer(); // Get data as ArrayBuffer
            console.log("Received audio data, decoding...");

            // Decode the audio data using Web Audio API
            audioContext.decodeAudioData(audioData, (buffer) => {
                console.log("Audio decoded successfully.");
                currentAudioSource = audioContext.createBufferSource();
                currentAudioSource.buffer = buffer;
                currentAudioSource.connect(audioContext.destination);

                currentAudioSource.onended = () => {
                    console.log('Web Audio playback finished.');
                    currentAudioSource = null;
                    elevenLabsController = null;
                    statusTextSpeaking.textContent = ''; // Clear speaking text on end
                    // After speaking, if still in voiceActive, go back to listening state
                    if (currentMode === 'voiceActive') {
                         const selectedLang = languageSelect.value; // Get language again
                         statusTextListening.textContent = statusTexts[selectedLang]?.listening || statusTexts['de-DE'].listening; // Set listening text based on language
                         voiceStatusDisplay.className = 'listening';
                         allowRecognitionRestart = true; // Re-enable recognition restart
                         if (!isRecognizing) {
                             console.log("Recognition already ended, manually triggering onend for restart check.");
                             recognition.onend();
                         }
                    }
                    resolve();
                };

                console.log("Starting Web Audio playback.");
                currentAudioSource.start(0);

            }, (decodeError) => {
                console.error('Error decoding audio data:', decodeError);
                statusElement.textContent = 'Audio Dekodierungsfehler.';
                statusElement.className = 'error';
                voiceStatusDisplay.className = 'error';
                statusTextSpeaking.textContent = ''; // Clear speaking text on error
                elevenLabsController = null;
                reject(new Error('Error decoding audio data'));
            });

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('ElevenLabs fetch request aborted.');
                elevenLabsController = null;
                statusTextSpeaking.textContent = ''; // Clear speaking text on abort
                resolve(); // Resolve as the action was intentionally aborted
            } else {
                console.error('Error calling ElevenLabs API or processing audio:', error);
                statusElement.textContent = 'TTS API/Audio Fehler.';
                statusElement.className = 'error';
                voiceStatusDisplay.className = 'error';
                statusTextSpeaking.textContent = ''; // Clear speaking text on error
                elevenLabsController = null;
                console.error("ElevenLabs/Audio Error Object:", error);
                reject(error);
            }
        }
    });
}

// --- UI Mode Management & Event Listeners ---
function setUIMode(newMode) {
    console.log(`Setting UI Mode: ${newMode}`);
    const oldMode = currentMode;
    currentMode = newMode;
    document.body.className = '';

    // Clear all status texts initially
    statusTextListening.textContent = '';
    statusTextThinking.textContent = '';
    statusTextSpeaking.textContent = '';
    statusTextIdle.textContent = '';
    statusElement.textContent = ''; // Clear general status

    const selectedLang = languageSelect.value; // Get selected language

    switch (newMode) {
        case 'text':
            document.body.classList.add('text-mode');
            // Stops are handled by the button listeners triggering this mode change
            allowRecognitionRestart = false; isRecognizing = false;
            statusElement.style.display = 'none'; // General status hidden in text mode
            voiceStatusDisplay.className = '';
            break;
        case 'voiceIdle':
            document.body.classList.add('voice-mode-idle');
            statusTextIdle.textContent = statusTexts[selectedLang]?.idle || statusTexts['de-DE'].idle; // Set idle text based on language
            statusElement.className = '';
            voiceStatusDisplay.className = 'idle';
            // Stops are handled by the button listeners triggering this mode change
            allowRecognitionRestart = false; isRecognizing = false;
            break;
        case 'voiceActive':
            document.body.classList.add('voice-mode-active');
            // Status text will be set by recognition/speakText handlers
            break;
    }
}

// --- Attach Event Listeners ---
sendButton.addEventListener('click', () => handleSend(textInput.value));
textInput.addEventListener('keypress', (event) => { if (event.key === 'Enter') {
    event.preventDefault();
    handleSend(textInput.value);
} });

// Auto-resize textarea based on content
textInput.addEventListener('input', () => {
    textInput.style.height = 'auto'; // Reset height to recalculate
    textInput.style.height = textInput.scrollHeight + 'px'; // Set height based on content scroll height
});


enterVoiceModeButton.addEventListener('click', async () => {
    if (!recognition || currentMode !== 'text') return;

    // Initialize or resume AudioContext on user gesture
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log("AudioContext created.");
        } catch (e) {
            console.error("Error creating AudioContext:", e);
            alert("Web Audio API wird von diesem Browser nicht unterstützt.");
            return;
        }
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log("AudioContext resumed successfully.");
        }).catch(e => console.warn("AudioContext resume failed:", e));
    }

    setUIMode('voiceIdle');
    startConversationButton.disabled = true; // Disable button before speaking
    const greeting = "Hallo! Wie kann ich Ihnen bei Ihrer Terminplanung helfen?"; // Greeting is always in German based on previous code
    const apiKeyToUse = languageSelect.value.startsWith('ar') || languageSelect.value.startsWith('ru') || languageSelect.value.startsWith('uk-UA')
                                ? ELEVENLABS_API_KEY_ARABIC
                                : ELEVENLABS_API_KEY_DEFAULT;
    try {
        console.log("Attempting to speak greeting on entering voice mode...");
        await speakText(greeting, apiKeyToUse);
        console.log("Greeting finished speaking.");
        // After greeting, if still in voiceIdle, set status text and enable button
        if (currentMode === 'voiceIdle') { // Check if still in voiceIdle
             const selectedLang = languageSelect.value; // Get selected language
             statusTextIdle.textContent = statusTexts[selectedLang]?.idle || statusTexts['de-DE'].idle; // Set idle text based on language
             statusElement.className = '';
             voiceStatusDisplay.className = 'idle';
             startConversationButton.disabled = false; // Enable button on success
        }
    } catch (error) {
         console.error("Error during initial greeting:", error);
         statusElement.textContent = 'Fehler bei Begrüßung. Zurück zum Text?';
         statusElement.className = 'error';
         voiceStatusDisplay.className = 'error';
         startConversationButton.disabled = false; // Ensure button is enabled on error too
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
    // Set mode to voiceIdle *before* stopping recognition to avoid race condition with onerror
    setUIMode('voiceIdle');
    stopCurrentSpeech(); // Stop TTS if playing or pending
    stopRecognition(); // Stop STT if active (onerror check will now see 'voiceIdle')
});

backToTextButton.addEventListener('click', () => {
    allowRecognitionRestart = false;
    stopCurrentSpeech(); // Stop TTS if playing or pending
    stopRecognition();
    setUIMode('text');
});

// --- Initial Setup ---
if (SpeechRecognition) {
    checkMicPermission();
}
setUIMode('text');

// --- Initial Greeting Message (Text Mode) ---
const initialGreeting = "Hallo! Wie kann ich Ihnen bei Ihrer Terminplanung helfen?";
addMessageToChat(initialGreeting, 'bot');
