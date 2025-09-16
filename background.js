console.log('YouTube RAG Chatbot background script loaded');

chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed successfully');
});
