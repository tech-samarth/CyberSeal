// ============================================================
// CyberSeal - Cryptographic Core
// All hashing, encryption, and evidence ID utilities
// ============================================================

export const CryptoCore = {

  // Generate SHA-256 hash of any data
  async sha256(data) {
    const encoder = new TextEncoder();
    const dataBuffer = typeof data === 'string' ? encoder.encode(data) : data;
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // Generate SHA-256 of image blob
  async sha256Blob(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    return this.sha256(arrayBuffer);
  },

  // Generate immutable evidence ID
  async generateEvidenceId(platform, timestamp, hash) {
    const seed = `${platform}-${timestamp}-${hash}`;
    const idHash = await this.sha256(seed);
    return `CS-${platform.toUpperCase().slice(0,3)}-${idHash.slice(0,8).toUpperCase()}-${idHash.slice(8,16).toUpperCase()}`;
  },

  // Generate AES-GCM encryption key
  async generateEncryptionKey() {
    return await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  },

  // Export key to base64
  async exportKey(key) {
    const exported = await crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
  },

  // Import key from base64
  async importKey(keyB64) {
    const raw = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  },

  // Encrypt data with AES-GCM
  async encrypt(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encoded = typeof data === 'string' ? encoder.encode(data) : data;
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  },

  // Decrypt data with AES-GCM
  async decrypt(encryptedB64, key) {
    const combined = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decrypted);
  },

  // Verify hash hasn't changed (tamper detection)
  async verifyIntegrity(data, expectedHash) {
    const currentHash = await this.sha256(JSON.stringify(data));
    return {
      valid: currentHash === expectedHash,
      currentHash,
      expectedHash,
      tampered: currentHash !== expectedHash
    };
  },

  // Generate chain-of-custody signature
  async generateCustodyEntry(evidenceId, action, actorId) {
    const timestamp = Date.now();
    const entryData = `${evidenceId}|${action}|${actorId}|${timestamp}`;
    const hash = await this.sha256(entryData);
    return {
      evidenceId,
      action,
      actorId,
      timestamp,
      hash,
      isoTime: new Date(timestamp).toISOString()
    };
  }
};

export default CryptoCore;
