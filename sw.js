// Service Worker to intercept Hugging Face model requests and serve locally
const CACHE_NAME = 'whisper-model-cache-v1';

// Intercept requests to Hugging Face and serve from local
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Check if this is a Hugging Face model request
  if (url.hostname === 'huggingface.co' && url.pathname.includes('/resolve/main/')) {
    // Extract the model path and file from the URL
    const match = url.pathname.match(/\/([^\/]+\/[^\/]+)\/resolve\/main\/(.*)/);
    if (match) {
      const [, modelName, filePath] = match;
      
      // Redirect to local server
      const localUrl = `/models/${modelName}/${filePath}`;
      console.log(`[Service Worker] Intercepting HF request, serving from local: ${localUrl}`);
      
      event.respondWith(
        fetch(localUrl).catch(() => {
          console.log(`[Service Worker] Local file not found, falling back to HF: ${event.request.url}`);
          return fetch(event.request);
        })
      );
    }
  }
});

self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(self.clients.claim());
});
