// ============================================================
// CyberSeal - Content Script Injector
// Runs on target platforms, enables capture + UI overlay
// ============================================================

(function() {
  'use strict';

  // Prevent double injection
  if (window.__CYBERSEAL_INJECTED__) return;
  window.__CYBERSEAL_INJECTED__ = true;

  // Platform detection
  const PLATFORM_MAP = {
    'instagram.com': 'instagram',
    'whatsapp.com': 'whatsapp',
    'discord.com': 'discord',
    'twitter.com': 'twitter',
    'x.com': 'twitter',
    'telegram.org': 'telegram',
    'facebook.com': 'facebook',
    'reddit.com': 'reddit'
  };

  function detectPlatform() {
    const host = window.location.hostname;
    for (const [domain, platform] of Object.entries(PLATFORM_MAP)) {
      if (host.includes(domain)) return platform;
    }
    return 'unknown';
  }

  // Create floating panic button
  function createPanicButton() {
    if (document.getElementById('cyberseal-panic')) return;

    const btn = document.createElement('div');
    btn.id = 'cyberseal-panic';
    btn.innerHTML = `
      <div class="cs-shield-icon">🛡️</div>
      <div class="cs-pulse-ring"></div>
    `;
    btn.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0a0f1e, #1a2340);
      border: 2px solid rgba(0,255,200,0.5);
      cursor: pointer;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 0 20px rgba(0,255,200,0.2), 0 4px 20px rgba(0,0,0,0.5);
      transition: all 0.2s ease;
      user-select: none;
    `;

    const style = document.createElement('style');
    style.textContent = `
      #cyberseal-panic:hover { 
        transform: scale(1.1); 
        border-color: rgba(0,255,200,0.9);
        box-shadow: 0 0 30px rgba(0,255,200,0.4), 0 4px 20px rgba(0,0,0,0.5);
      }
      .cs-pulse-ring {
        position: absolute;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        border: 2px solid rgba(0,255,200,0.3);
        animation: cs-pulse 2s ease-out infinite;
      }
      @keyframes cs-pulse {
        0% { transform: scale(1); opacity: 0.6; }
        100% { transform: scale(1.8); opacity: 0; }
      }
      #cyberseal-toast {
        position: fixed;
        bottom: 88px;
        right: 24px;
        background: #0a0f1e;
        border: 1px solid rgba(0,255,200,0.4);
        color: #00ffc8;
        padding: 10px 16px;
        border-radius: 8px;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        z-index: 2147483646;
        opacity: 0;
        transform: translateY(8px);
        transition: all 0.3s ease;
        max-width: 260px;
        box-shadow: 0 0 20px rgba(0,255,200,0.1);
      }
      #cyberseal-toast.visible {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);

    btn.addEventListener('click', () => triggerCapture('panic'));
    document.body.appendChild(btn);

    // Tooltip on hover
    const toast = document.createElement('div');
    toast.id = 'cyberseal-toast';
    toast.textContent = '🛡️ CyberSeal: Capture Evidence';
    document.body.appendChild(toast);

    btn.addEventListener('mouseenter', () => toast.classList.add('visible'));
    btn.addEventListener('mouseleave', () => toast.classList.remove('visible'));
  }

  // Trigger capture - send message to service worker
  function triggerCapture(mode = 'manual') {
    const platform = detectPlatform();
    const metadata = extractMetadata(platform);

    // Send to background service worker
    chrome.runtime.sendMessage({
      type: 'CAPTURE_REQUEST',
      payload: {
        platform,
        metadata,
        mode,
        url: window.location.href,
        timestamp: Date.now()
      }
    }, response => {
      if (response?.success) {
        showCaptureFlash('#00ffc8', '✓ Evidence captured & secured');
      } else {
        showCaptureFlash('#ff4444', '✗ Capture failed');
      }
    });
  }

  // Extract platform metadata
  function extractMetadata(platform) {
    const base = {
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      platform,
      referrer: document.referrer,
      cookies: document.cookie ? 'present' : 'none',
      domSnapshot: document.documentElement.outerHTML.slice(0, 50000) // First 50KB
    };

    // Platform-specific selectors
    const selectors = {
      instagram: {
        messages: '[role="row"]',
        username: 'header a[href*="/"] span',
      },
      whatsapp: {
        messages: '.message-in, .message-out',
        chatName: '#main header span[title]'
      },
      discord: {
        messages: '[class*="messageContent"]',
        serverName: '[class*="nameText"]'
      },
      twitter: {
        tweets: 'article[data-testid="tweet"]',
        author: '[data-testid="User-Name"]'
      },
      telegram: {
        messages: '.message',
        chatName: '.peer-title'
      },
      facebook: {
        posts: '[data-ad-preview="message"]',
      },
      reddit: {
        comments: '[data-testid="comment"]',
        post: 'h1'
      }
    };

    const pSel = selectors[platform];
    if (pSel) {
      for (const [key, selector] of Object.entries(pSel)) {
        try {
          const els = document.querySelectorAll(selector);
          const texts = [];
          els.forEach(el => {
            const t = el.innerText?.trim();
            if (t) texts.push(t);
          });
          base[`extracted_${key}`] = texts.slice(0, 20);
        } catch(e) {}
      }
    }

    return base;
  }

  // Visual flash feedback on capture
  function showCaptureFlash(color, message) {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: ${color}1a;
      border: 3px solid ${color};
      z-index: 2147483646;
      pointer-events: none;
      animation: cs-flash 0.6s ease-out forwards;
    `;

    const label = document.createElement('div');
    label.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #0a0f1e;
      border: 1px solid ${color};
      color: ${color};
      padding: 16px 32px;
      border-radius: 8px;
      font-family: 'Courier New', monospace;
      font-size: 16px;
      font-weight: bold;
      z-index: 2147483647;
      pointer-events: none;
      animation: cs-flash 0.6s ease-out 0.5s forwards;
      opacity: 1;
    `;
    label.textContent = message;

    const style = document.createElement('style');
    style.textContent = `@keyframes cs-flash { to { opacity: 0; } }`;
    document.head.appendChild(style);

    document.body.appendChild(flash);
    document.body.appendChild(label);

    setTimeout(() => {
      flash.remove();
      label.remove();
    }, 1200);
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TRIGGER_CAPTURE') {
      triggerCapture('popup');
      sendResponse({ received: true });
    }
    if (message.type === 'GET_PAGE_METADATA') {
      const platform = detectPlatform();
      sendResponse({ metadata: extractMetadata(platform), platform });
    }
    if (message.type === 'PING') {
      sendResponse({ alive: true, platform: detectPlatform() });
    }
    return true;
  });

  // Initialize panic button
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createPanicButton);
  } else {
    createPanicButton();
  }

  // Watch for disappearing messages (WhatsApp/Instagram)
  if (window.location.hostname.includes('whatsapp') || window.location.hostname.includes('instagram')) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(m => {
        m.removedNodes.forEach(node => {
          if (node.nodeType === 1) {
            const text = node.innerText?.trim();
            if (text && text.length > 5) {
              chrome.runtime.sendMessage({
                type: 'DISAPPEARING_CONTENT',
                payload: {
                  content: text,
                  timestamp: Date.now(),
                  platform: detectPlatform(),
                  url: window.location.href
                }
              });
            }
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

})();
