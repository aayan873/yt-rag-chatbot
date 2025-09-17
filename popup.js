document.addEventListener('DOMContentLoaded', () => {
  const chatContainer = document.getElementById('chatContainer');
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const videoInfo = document.getElementById('videoInfo');

  let currentVideoId = null;

  initialize();

  async function initialize() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.url.includes('youtube.com/watch')) {
        // videoInfo.innerHTML = '<div class="error">Please navigate to a YouTube video first</div>';
        return;
      }

      const urlParams = new URLSearchParams(new URL(tab.url).search);
      currentVideoId = urlParams.get('v');

      if (!currentVideoId) {
        // videoInfo.innerHTML = '<div class="error">Could not find video ID</div>';
        return;
      }

    //   videoInfo.innerHTML = `<strong>YouTube Video (${currentVideoId})</strong><br><small>Ready to chat about this video!</small>`;
      messageInput.disabled = false;
      sendButton.disabled = false;
      messageInput.focus();

    } catch (error) {
      console.error('Initialization error:', error);
    //   videoInfo.innerHTML = '<div class="error">Error loading video</div>';
    }
  }

  async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || !currentVideoId) return;

    addMessage(message, 'user');
    messageInput.value = '';
    sendButton.disabled = true;

    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'message bot-message typing';
    thinkingDiv.textContent = 'Thinking...';
    chatContainer.appendChild(thinkingDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
      const response = await fetch('https://yt-rag-chatbot-production.up.railway.app/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: currentVideoId, question: message }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Response error:', errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();

      if (thinkingDiv.parentNode) chatContainer.removeChild(thinkingDiv);

      if (data.error) {
        addMessage(`Backend error: ${data.error}`, 'bot');
      } else {
        let botResponse = data.answer;

        if (data.sources?.length) {
          const timestamps = data.sources
            .filter(s => s.start !== null)
            .map(s => formatTime(s.start))
            .slice(0, 3);

          if (timestamps.length) {
            botResponse += `\n\nRelated timestamps: ${timestamps.join(', ')}`;
          }
        }

        addMessage(botResponse, 'bot');
      }
    } catch (error) {
      if (thinkingDiv.parentNode) chatContainer.removeChild(thinkingDiv);
      console.error('Fetch error:', error);
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        addMessage('Backend not reachable. Is it running on localhost:8000?', 'bot');
      } else {
        addMessage(`Error: ${error.message}`, 'bot');
      }
    } finally {
      sendButton.disabled = false;
    }
  }

  function addMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `message ${sender}-message`;
    div.textContent = text;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  sendButton.addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', e => {
    if (e.key === 'Enter' && !sendButton.disabled) sendMessage();
  });
});
