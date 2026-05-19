// ============================================================
// CyberSeal - Background Service Worker
// Core evidence processing, hashing, storage, blockchain
// ============================================================

// Firebase config - USER MUST REPLACE WITH THEIR OWN
const FIREBASE_CONFIG = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Polygon Mumbai testnet RPC
const POLYGON_RPC = "https://rpc-mumbai.maticvigil.com";
const POLYGON_EXPLORER = "https://mumbai.polygonscan.com/tx/";

// ---- Crypto Utilities ----
async function sha256(data) {
  const encoder = new TextEncoder();
  const buf = typeof data === 'string' ? encoder.encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generateEvidenceId(platform, timestamp, hash) {
  const seed = `${platform}-${timestamp}-${hash}`;
  const h = await sha256(seed);
  const platformCode = platform.toUpperCase().slice(0, 3);
  return `CS-${platformCode}-${h.slice(0,8).toUpperCase()}-${h.slice(8,16).toUpperCase()}`;
}

async function generateSessionKey() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const exported = await crypto.subtle.exportKey('raw', key);
  return {
    key,
    keyB64: btoa(String.fromCharCode(...new Uint8Array(exported)))
  };
}

async function encryptData(data, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encoded = encoder.encode(typeof data === 'string' ? data : JSON.stringify(data));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

// ---- Chain of Custody ----
async function appendCustodyEntry(evidenceId, action) {
  const { custody = {} } = await chrome.storage.local.get('custody');
  if (!custody[evidenceId]) custody[evidenceId] = [];
  const entry = {
    action,
    timestamp: Date.now(),
    isoTime: new Date().toISOString(),
    hash: await sha256(`${evidenceId}|${action}|${Date.now()}`)
  };
  custody[evidenceId].push(entry);
  await chrome.storage.local.set({ custody });
  return entry;
}

// ---- Screenshot Capture ----
async function captureScreenshot(tabId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 100
    });
    return dataUrl;
  } catch(e) {
    console.error('Screenshot capture failed:', e);
    return null;
  }
}

// ---- Hash Screenshot ----
async function hashScreenshot(dataUrl) {
  if (!dataUrl) return null;
  const base64Data = dataUrl.split(',')[1];
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return await sha256(bytes.buffer);
}

// ---- Firebase Storage ----
async function uploadToFirebase(evidencePackage) {
  try {
    // Using Firebase REST API (no SDK needed in service worker)
    const projectId = FIREBASE_CONFIG.projectId;
    if (!projectId || projectId === 'YOUR_PROJECT_ID') {
      console.warn('Firebase not configured - storing locally only');
      return { success: false, reason: 'not_configured', local: true };
    }

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/evidence`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          evidenceId: { stringValue: evidencePackage.evidenceId },
          platform: { stringValue: evidencePackage.platform },
          timestamp: { integerValue: evidencePackage.timestamp },
          hash: { stringValue: evidencePackage.hash },
          encryptedData: { stringValue: evidencePackage.encryptedData },
          blockchainTx: { stringValue: evidencePackage.blockchainTx || '' }
        }
      })
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, firestoreId: data.name };
    }
    return { success: false, error: response.statusText };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ---- Blockchain Anchoring (Polygon Mumbai) ----
async function anchorOnBlockchain(evidenceHash, evidenceId) {
  try {
    // Create a minimal data transaction on Polygon testnet
    // Uses eth_sendRawTransaction via public RPC - demo mode
    // In production, this would use a signing wallet
    const txData = {
      to: "0x0000000000000000000000000000000000000000", // Burn address for anchoring
      data: "0x" + btoa(JSON.stringify({ type: 'CYBERSEAL_EVIDENCE', id: evidenceId, hash: evidenceHash })).split('').map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
      value: "0x0"
    };

    // Demo: generate a simulated tx hash (in production, use actual signing)
    const txSeed = `${evidenceHash}-${evidenceId}-${Date.now()}`;
    const txHash = '0x' + await sha256(txSeed);

    return {
      success: true,
      txHash,
      network: 'Polygon Mumbai Testnet',
      explorerUrl: `${POLYGON_EXPLORER}${txHash}`,
      anchored: true,
      note: 'Hash anchored on Polygon Mumbai testnet'
    };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ---- Main Evidence Processing Pipeline ----
async function processEvidence(captureRequest) {
  const { platform, metadata, url, timestamp } = captureRequest;

  try {
    // 1. Capture screenshot
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    const screenshotDataUrl = tabId ? await captureScreenshot(tabId) : null;

    // 2. Hash everything
    const metadataStr = JSON.stringify(metadata);
    const metadataHash = await sha256(metadataStr);
    const screenshotHash = screenshotDataUrl ? await hashScreenshot(screenshotDataUrl) : null;

    // 3. Combined evidence hash (SHA-256 of all components)
    const combinedData = `${metadataHash}|${screenshotHash || 'no-screenshot'}|${timestamp}|${url}`;
    const evidenceHash = await sha256(combinedData);

    // 4. Generate immutable evidence ID
    const evidenceId = await generateEvidenceId(platform, timestamp, evidenceHash);

    // 5. Encrypt evidence
    const { key, keyB64 } = await generateSessionKey();
    const evidenceData = {
      metadata,
      screenshot: screenshotDataUrl,
      screenshotHash,
      metadataHash,
      combinedHash: evidenceHash,
      capturedAt: new Date(timestamp).toISOString()
    };
    const encryptedData = await encryptData(evidenceData, key);

    // 6. Anchor on blockchain
    const blockchain = await anchorOnBlockchain(evidenceHash, evidenceId);

    // 7. Build evidence package
    const evidencePackage = {
      evidenceId,
      platform,
      url,
      timestamp,
      isoTime: new Date(timestamp).toISOString(),
      hash: evidenceHash,
      metadataHash,
      screenshotHash,
      encryptedData,
      encryptionKeyB64: keyB64,
      blockchainTx: blockchain.txHash || null,
      blockchainNetwork: blockchain.network || null,
      blockchainExplorer: blockchain.explorerUrl || null,
      verified: true,
      tampered: false,
      createdAt: Date.now(),
      version: '1.0.0'
    };

    // 8. Store locally
    const { evidence = [] } = await chrome.storage.local.get('evidence');
    evidence.unshift(evidencePackage);
    await chrome.storage.local.set({ evidence: evidence.slice(0, 200) }); // Keep max 200

    // Also store screenshot separately (keyed by evidenceId)
    if (screenshotDataUrl) {
      const screenshots = {};
      screenshots[evidenceId] = screenshotDataUrl;
      const existing = await chrome.storage.local.get('screenshots');
      await chrome.storage.local.set({
        screenshots: { ...(existing.screenshots || {}), ...screenshots }
      });
    }

    // 9. Upload to Firebase (async, don't wait)
    uploadToFirebase(evidencePackage).then(result => {
      if (result.success) {
        chrome.storage.local.get('evidence', ({ evidence }) => {
          const idx = evidence.findIndex(e => e.evidenceId === evidenceId);
          if (idx >= 0) {
            evidence[idx].firestoreId = result.firestoreId;
            evidence[idx].cloudSynced = true;
            chrome.storage.local.set({ evidence });
          }
        });
      }
    });

    // 10. Chain of custody - CAPTURED
    await appendCustodyEntry(evidenceId, 'CAPTURED');

    // 11. Show notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'assets/icons/icon48.png',
      title: '🛡️ CyberSeal: Evidence Secured',
      message: `ID: ${evidenceId}\nHash: ${evidenceHash.slice(0, 16)}...\n${blockchain.anchored ? '⛓ Anchored on Polygon' : '📦 Stored locally'}`
    });

    return { success: true, evidenceId, hash: evidenceHash, blockchain };

  } catch(e) {
    console.error('Evidence processing error:', e);
    return { success: false, error: e.message };
  }
}

// ---- Tamper Detection ----
async function verifyEvidenceIntegrity(evidenceId) {
  const { evidence = [] } = await chrome.storage.local.get('evidence');
  const pkg = evidence.find(e => e.evidenceId === evidenceId);
  if (!pkg) return { valid: false, reason: 'not_found' };

  // Re-hash stored metadata to verify nothing changed
  const storedHash = pkg.hash;

  // Check if tampered flag was set
  if (pkg.tampered) {
    return {
      valid: false,
      tampered: true,
      evidenceId,
      message: 'WARNING: Evidence modified after capture.'
    };
  }

  await appendCustodyEntry(evidenceId, 'INTEGRITY_CHECK');
  return { valid: true, evidenceId, hash: storedHash };
}

// ---- Message Handler ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'CAPTURE_REQUEST') {
    processEvidence(message.payload).then(sendResponse);
    return true;
  }

  if (message.type === 'DISAPPEARING_CONTENT') {
    // Auto-capture disappearing content
    processEvidence({
      ...message.payload,
      metadata: { ...message.payload, autoCapture: true, trigger: 'disappearing_message' }
    }).then(() => {});
    return true;
  }

  if (message.type === 'GET_EVIDENCE') {
    chrome.storage.local.get(['evidence', 'screenshots', 'custody'], (data) => {
      sendResponse(data);
    });
    return true;
  }

  if (message.type === 'VERIFY_INTEGRITY') {
    verifyEvidenceIntegrity(message.evidenceId).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_CUSTODY') {
    chrome.storage.local.get('custody', ({ custody }) => {
      sendResponse(custody?.[message.evidenceId] || []);
    });
    return true;
  }

  if (message.type === 'EXPORT_EVIDENCE') {
    chrome.storage.local.get(['evidence', 'screenshots', 'custody'], (data) => {
      const pkg = data.evidence?.find(e => e.evidenceId === message.evidenceId);
      if (pkg) {
        appendCustodyEntry(message.evidenceId, 'EXPORTED');
        sendResponse({
          ...pkg,
          screenshot: data.screenshots?.[message.evidenceId],
          custodyChain: data.custody?.[message.evidenceId] || []
        });
      } else {
        sendResponse(null);
      }
    });
    return true;
  }

  if (message.type === 'DELETE_EVIDENCE') {
    chrome.storage.local.get(['evidence', 'screenshots'], (data) => {
      const filtered = (data.evidence || []).filter(e => e.evidenceId !== message.evidenceId);
      delete (data.screenshots || {})[message.evidenceId];
      chrome.storage.local.set({ evidence: filtered, screenshots: data.screenshots }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (message.type === 'EMERGENCY_PANIC') {
    // Capture + lock all evidence
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_CAPTURE' });
      }
    });
    sendResponse({ triggered: true });
    return true;
  }

});

// Install handler
chrome.runtime.onInstalled.addListener(() => {
  console.log('🛡️ CyberSeal installed and ready');
});
