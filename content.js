console.log('YouTube RAG Chatbot loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getTranscript') {
        getYouTubeTranscript(request.videoId)
            .then(data => sendResponse(data))
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }
});

async function getYouTubeTranscript(videoId) {
    try {
        const titleElement = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string') ||
                           document.querySelector('#title h1');
        const title = titleElement ? titleElement.textContent.trim() : 'YouTube Video';
        
        const scripts = document.querySelectorAll('script');
        let transcriptData = null;
        
        for (const script of scripts) {
            if (script.textContent.includes('captionTracks')) {
                try {
                    const regex = /"captionTracks":\[(.*?)\]/;
                    const match = script.textContent.match(regex);
                    
                    if (match) {
                        const captionTracks = JSON.parse('[' + match[1] + ']');
                        
                        if (captionTracks.length > 0) {
                            const captionUrl = captionTracks[0].baseUrl;
                            
                            if (captionUrl) {
                                const response = await fetch(captionUrl);
                                const xmlText = await response.text();
                                transcriptData = parseTranscriptXML(xmlText);
                                break;
                            }
                        }
                    }
                } catch (parseError) {
                    console.log('Error parsing:', parseError);
                    continue;
                }
            }
        }
        
        if (transcriptData && transcriptData.length > 0) {
            return { success: true, title: title, transcript: transcriptData };
        } else {
            throw new Error('No transcript available');
        }
    } catch (error) {
        return { success: false, error: 'Could not retrieve transcript' };
    }
}

function parseTranscriptXML(xmlText) {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        const textElements = xmlDoc.querySelectorAll('text');
        
        const transcript = [];
        textElements.forEach(textElement => {
            const start = parseFloat(textElement.getAttribute('start')) || 0;
            const duration = parseFloat(textElement.getAttribute('dur')) || 0;
            const text = textElement.textContent.trim();
            
            if (text) {
                transcript.push({ text: text, start: start, duration: duration });
            }
        });
        
        return transcript;
    } catch (error) {
        return null;
    }
}
