// ============================================================
// CyberSeal — Popup Script
// Handles capture, vault, report generation, chain of custody
// ============================================================

// ---- Utilities ----
function toast(msg, type = 'success', duration = 2500) {
  const t = document.getElementById('globalToast');
  t.textContent = msg;
  t.className = `cs-toast show ${type === 'error' ? 'error' : type === 'warn' ? 'warn' : ''}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

function showLoading(text = 'Processing...') {
  document.getElementById('loadingOverlay').style.display = 'flex';
  document.getElementById('loadingText').textContent = text;
}

function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

function formatTime(ts) {
  return new Date(ts).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true
  });
}

function truncHash(h) {
  if (!h) return '—';
  return h.slice(0, 8) + '...' + h.slice(-8);
}

// ---- Platform Detection ----
const PLATFORM_ICONS = {
  instagram: '📸', whatsapp: '💬', discord: '🎮',
  twitter: '🐦', telegram: '✈️', facebook: '👥', reddit: '🤖', unknown: '🌐'
};
const PLATFORM_NAMES = {
  instagram: 'Instagram', whatsapp: 'WhatsApp Web', discord: 'Discord',
  twitter: 'X / Twitter', telegram: 'Telegram Web', facebook: 'Facebook',
  reddit: 'Reddit', unknown: 'Unknown Platform'
};

async function detectCurrentPlatform() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) return resolve({ platform: 'unknown', url: '' });
      const url = tabs[0].url || '';
      const host = new URL(url).hostname;
      const map = {
        'instagram.com': 'instagram', 'whatsapp.com': 'whatsapp',
        'discord.com': 'discord', 'twitter.com': 'twitter', 'x.com': 'twitter',
        'telegram.org': 'telegram', 'facebook.com': 'facebook', 'reddit.com': 'reddit'
      };
      for (const [domain, p] of Object.entries(map)) {
        if (host.includes(domain)) return resolve({ platform: p, url });
      }
      resolve({ platform: 'unknown', url });
    });
  });
}

function updatePlatformBar(platform, url) {
  document.getElementById('platformIcon').textContent = PLATFORM_ICONS[platform] || '?';
  document.getElementById('platformName').textContent = PLATFORM_NAMES[platform] || 'Unknown';
  const shortUrl = url.replace(/^https?:\/\//, '').slice(0, 45);
  document.getElementById('platformUrl').textContent = shortUrl || '—';

  const supported = ['instagram','whatsapp','discord','twitter','telegram','facebook','reddit'];
  const badge = document.getElementById('platformShield');
  if (supported.includes(platform)) {
    badge.innerHTML = '<span>PROTECTED</span>';
    badge.style.borderColor = 'rgba(0,255,200,0.5)';
    badge.style.color = 'var(--accent)';
    document.getElementById('statusBadge').style.borderColor = 'rgba(0,255,200,0.4)';
    document.getElementById('statusText').textContent = 'Active';
  } else {
    badge.innerHTML = '<span>UNSUPPORTED</span>';
    badge.style.borderColor = 'rgba(255,187,0,0.4)';
    badge.style.color = 'var(--warn)';
    document.getElementById('statusText').textContent = 'Standby';
  }
}

// ---- CAPTURE ----
async function triggerCapture() {
  const btn = document.getElementById('panicBtn');
  btn.classList.add('capturing');
  showLoading('🔐 Capturing evidence...');

  try {
    const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
    const tab = tabs[0];
    if (!tab) throw new Error('No active tab');

    // Get metadata from content script
    const metadataResponse = await new Promise(resolve => {
      chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_METADATA' }, res => {
        resolve(res || { metadata: { url: tab.url, title: tab.title }, platform: 'unknown' });
      });
    });

    // Send capture request to background
    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'CAPTURE_REQUEST',
        payload: {
          platform: metadataResponse.platform || 'unknown',
          metadata: metadataResponse.metadata || {},
          url: tab.url,
          timestamp: Date.now(),
          mode: 'popup'
        }
      }, resolve);
    });

    if (result?.success) {
      toast(`✓ Evidence captured: ${result.evidenceId}`);
      updateLastCapture(result);
      await loadStats();
      await loadVault();
    } else {
      toast('Capture failed: ' + (result?.error || 'unknown'), 'error');
    }
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    btn.classList.remove('capturing');
    hideLoading();
  }
}

function updateLastCapture(result) {
  const el = document.getElementById('lastCapture');
  el.style.display = 'block';
  document.getElementById('lastCaptureId').textContent = result.evidenceId;
  document.getElementById('lastCaptureHash').textContent = 'SHA-256: ' + (result.hash || '').slice(0, 32) + '...';
  const chainEl = document.getElementById('lastCaptureChain');
  if (result.blockchain?.txHash) {
    chainEl.textContent = '⛓ Anchored: ' + result.blockchain.txHash.slice(0, 20) + '...';
    chainEl.style.color = 'var(--accent2)';
  } else {
    chainEl.textContent = '📦 Stored locally (configure Firebase/Polygon for cloud)';
    chainEl.style.color = 'var(--text-dim)';
  }
}

// ---- STATS ----
async function loadStats() {
  const data = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_EVIDENCE' }, r));
  const evidence = data?.evidence || [];
  document.getElementById('statTotal').textContent = evidence.length;
  document.getElementById('statChained').textContent = evidence.filter(e => e.blockchainTx).length;
  document.getElementById('statSynced').textContent = evidence.filter(e => e.cloudSynced).length;
}

// ---- VAULT ----
async function loadVault() {
  const data = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_EVIDENCE' }, r));
  const evidence = data?.evidence || [];
  renderEvidenceList(evidence);
  updateCustodySelect(evidence);
}

function renderEvidenceList(evidence, filter = '', platform = '') {
  const list = document.getElementById('evidenceList');
  let filtered = evidence.filter(e => {
    if (filter && !e.evidenceId.toLowerCase().includes(filter.toLowerCase())) return false;
    if (platform && e.platform !== platform) return false;
    return true;
  });

  if (!filtered.length) {
    list.innerHTML = `
      <div class="cs-empty-state">
        <div class="cs-empty-icon">🛡️</div>
        <div class="cs-empty-text">${evidence.length ? 'No matches found' : 'No evidence captured yet'}</div>
        <div class="cs-empty-sub">Use the Capture tab to start</div>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(e => `
    <div class="cs-evidence-card ${e.tampered ? 'tampered' : ''}" data-id="${e.evidenceId}">
      <div class="cs-ec-top">
        <span class="cs-ec-platform">${(e.platform || 'UNK').toUpperCase().slice(0,3)}</span>
        <span class="cs-ec-id">${e.evidenceId}</span>
        <span class="cs-ec-time">${formatTime(e.timestamp)}</span>
      </div>
      <div class="cs-ec-hash">SHA-256: ${truncHash(e.hash)}</div>
      ${e.blockchainTx ? `<div style="font-family:var(--mono);font-size:8px;color:var(--accent2);margin-bottom:4px">⛓ ${e.blockchainNetwork}: ${truncHash(e.blockchainTx)}</div>` : ''}
      ${e.tampered ? `<div class="cs-tamper-warn">⚠ WARNING: Evidence modified after capture.</div>` : ''}
      <div class="cs-ec-actions">
        <button class="cs-ec-btn primary" data-action="report" data-id="${e.evidenceId}">📋 Report</button>
        <button class="cs-ec-btn" data-action="verify" data-id="${e.evidenceId}">🔍 Verify</button>
        <button class="cs-ec-btn" data-action="custody" data-id="${e.evidenceId}">🔗 Custody</button>
        <button class="cs-ec-btn danger" data-action="delete" data-id="${e.evidenceId}">✕</button>
      </div>
    </div>
  `).join('');

  // Attach button handlers
  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'report') generateReportForId(id);
      if (action === 'verify') verifyEvidence(id);
      if (action === 'custody') showCustodyForId(id);
      if (action === 'delete') deleteEvidence(id);
    });
  });
}

async function deleteEvidence(id) {
  if (!confirm(`Delete evidence ${id}? This cannot be undone.`)) return;
  await new Promise(r => chrome.runtime.sendMessage({ type: 'DELETE_EVIDENCE', evidenceId: id }, r));
  toast('Evidence deleted');
  await loadVault();
  await loadStats();
}

async function verifyEvidence(id) {
  showLoading('Verifying integrity...');
  const result = await new Promise(r => chrome.runtime.sendMessage({ type: 'VERIFY_INTEGRITY', evidenceId: id }, r));
  hideLoading();
  if (result.valid) {
    toast(`✓ ${id}: Integrity verified`, 'success');
  } else {
    toast(`⚠ ${id}: ${result.message || 'Tampered!'}`, 'error', 4000);
  }
}

// ---- REPORT GENERATION ----
async function generateReportForId(evidenceId) {
  // Switch to report tab and pre-select this ID
  switchTab('report');
  window._reportEvidenceId = evidenceId;
  toast(`Evidence ${evidenceId} selected for report`);
}

async function generateReport(specificId = null) {
  const incScreenshots = document.getElementById('incScreenshots').checked;
  const incMetadata = document.getElementById('incMetadata').checked;
  const incHashes = document.getElementById('incHashes').checked;
  const incBlockchain = document.getElementById('incBlockchain').checked;
  const incCustody = document.getElementById('incCustody').checked;
  const incTimeline = document.getElementById('incTimeline').checked;
  const incAI = document.getElementById('incAI').checked;
  const victimName = document.getElementById('reportVictimName').value;
  const caseNum = document.getElementById('reportCaseNum').value;
  const notes = document.getElementById('reportNotes').value;

  showLoading('⚖️ Generating legal report...');

  // Get all evidence or specific
  const data = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_EVIDENCE' }, r));
  const allEvidence = data?.evidence || [];

  if (!allEvidence.length) {
    hideLoading();
    toast('No evidence to include in report', 'warn');
    return;
  }

  const targetEvidence = specificId
    ? allEvidence.filter(e => e.evidenceId === specificId)
    : allEvidence;

  // Gather screenshots and custody for each
  const enriched = await Promise.all(targetEvidence.map(async e => {
    const full = await new Promise(r => chrome.runtime.sendMessage({
      type: 'EXPORT_EVIDENCE',
      evidenceId: e.evidenceId
    }, r));
    return full || e;
  }));

  // AI Summary (if enabled and API available)
  let aiSummary = '';
  if (incAI) {
    try {
      aiSummary = await generateAISummary(enriched);
    } catch(err) {
      aiSummary = 'AI analysis unavailable - Anthropic API key required in extension settings.';
    }
  }

  // Generate timeline
  const timeline = buildTimeline(enriched);

  // Build PDF HTML
  const reportHtml = buildReportHTML({
    evidence: enriched,
    timeline,
    aiSummary,
    victimName,
    caseNum,
    notes,
    options: { incScreenshots, incMetadata, incHashes, incBlockchain, incCustody, incTimeline, incAI }
  });

  // Open in new tab for printing/saving as PDF
  const blob = new Blob([reportHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({ url });

  hideLoading();
  toast('📋 Report opened in new tab — use Ctrl+P to save as PDF');
}

async function generateAISummary(evidenceList) {
  // Call Anthropic API for AI analysis
  const summaryData = evidenceList.map(e => ({
    platform: e.platform,
    url: e.url,
    time: e.isoTime,
    id: e.evidenceId
  }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `You are a forensic analyst writing for a legal report. Analyze this cyberbullying evidence and write a professional 3-paragraph incident summary suitable for law enforcement submission.

Evidence collected:
${JSON.stringify(summaryData, null, 2)}

Write a factual, professional summary covering: what platforms were involved, timeline of incidents, and why this evidence is legally significant. Use formal language appropriate for court submission.`
      }]
    })
  });

  if (!response.ok) throw new Error('API error');
  const result = await response.json();
  return result.content?.[0]?.text || '';
}

function buildTimeline(evidence) {
  return evidence
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(e => ({
      time: formatTime(e.timestamp),
      platform: PLATFORM_NAMES[e.platform] || e.platform,
      id: e.evidenceId,
      url: e.url
    }));
}

function buildReportHTML({ evidence, timeline, aiSummary, victimName, caseNum, notes, options }) {
  const now = new Date().toLocaleString();
  const reportId = 'RPT-' + Date.now().toString(36).toUpperCase();

  const timelineHtml = options.incTimeline && timeline.length ? `
    <section>
      <h2>📅 Incident Timeline</h2>
      <table>
        <thead><tr><th>Time</th><th>Platform</th><th>Evidence ID</th></tr></thead>
        <tbody>
          ${timeline.map(t => `<tr><td>${t.time}</td><td>${t.platform}</td><td class="mono">${t.id}</td></tr>`).join('')}
        </tbody>
      </table>
    </section>
  ` : '';

  const aiHtml = options.incAI && aiSummary ? `
    <section class="ai-section">
      <h2>🤖 AI Forensic Analysis</h2>
      <div class="ai-badge">Generated by Claude AI (Anthropic) — For informational purposes</div>
      <div class="ai-body">${aiSummary.replace(/\n/g, '<br/>')}</div>
    </section>
  ` : '';

  const evidenceHtml = evidence.map((e, i) => `
    <section class="evidence-block">
      <div class="ev-header">
        <div class="ev-num">EXHIBIT ${String.fromCharCode(65 + i)}</div>
        <div class="ev-id">${e.evidenceId}</div>
        <div class="ev-status ${e.tampered ? 'tampered' : 'verified'}">${e.tampered ? '⚠ TAMPERED' : '✓ VERIFIED'}</div>
      </div>

      <table>
        <tr><td><strong>Platform</strong></td><td>${PLATFORM_NAMES[e.platform] || e.platform}</td></tr>
        <tr><td><strong>Captured At</strong></td><td>${e.isoTime}</td></tr>
        <tr><td><strong>URL</strong></td><td class="mono">${e.url}</td></tr>
        ${options.incHashes ? `
        <tr><td><strong>SHA-256 Hash</strong></td><td class="mono hash">${e.hash}</td></tr>
        ${e.screenshotHash ? `<tr><td><strong>Screenshot Hash</strong></td><td class="mono hash">${e.screenshotHash}</td></tr>` : ''}
        ${e.metadataHash ? `<tr><td><strong>Metadata Hash</strong></td><td class="mono hash">${e.metadataHash}</td></tr>` : ''}
        ` : ''}
        ${options.incBlockchain && e.blockchainTx ? `
        <tr><td><strong>Blockchain Network</strong></td><td>${e.blockchainNetwork}</td></tr>
        <tr><td><strong>Transaction Hash</strong></td><td class="mono hash">${e.blockchainTx}</td></tr>
        <tr><td><strong>Explorer URL</strong></td><td class="mono">${e.blockchainExplorer || '—'}</td></tr>
        ` : ''}
      </table>

      ${options.incScreenshots && e.screenshot ? `
        <div class="screenshot-section">
          <strong>Captured Screenshot:</strong><br/>
          <img src="${e.screenshot}" class="screenshot" alt="Evidence screenshot" />
        </div>
      ` : ''}

      ${options.incCustody && e.custodyChain?.length ? `
        <div class="custody-section">
          <strong>Chain of Custody Log:</strong>
          <table>
            <thead><tr><th>Action</th><th>Timestamp</th><th>Entry Hash</th></tr></thead>
            <tbody>
              ${e.custodyChain.map(c => `
                <tr>
                  <td class="mono">${c.action}</td>
                  <td>${c.isoTime}</td>
                  <td class="mono hash">${c.hash}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}

      ${options.incMetadata && e.metadata ? `
        <details>
          <summary><strong>Full Metadata (click to expand)</strong></summary>
          <pre class="metadata">${JSON.stringify(e.metadata, null, 2).slice(0, 3000)}</pre>
        </details>
      ` : ''}
    </section>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>CyberSeal Legal Report — ${reportId}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #1a1a1a; background: #fff; padding: 40px; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 20pt; border-bottom: 3px double #1a1a1a; padding-bottom: 10px; margin-bottom: 20px; }
    h2 { font-size: 13pt; margin: 24px 0 12px; border-left: 4px solid #1a1a1a; padding-left: 10px; }
    section { margin-bottom: 30px; page-break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; vertical-align: top; }
    th { background: #f0f0f0; font-weight: bold; }
    .mono { font-family: 'Courier New', monospace; font-size: 9pt; }
    .hash { font-size: 8pt; word-break: break-all; }
    .header-block { background: #f8f8f8; border: 2px solid #1a1a1a; padding: 20px; margin-bottom: 30px; }
    .report-id { font-family: 'Courier New', monospace; font-size: 10pt; color: #444; }
    .evidence-block { border: 2px solid #1a1a1a; padding: 16px; margin-bottom: 24px; }
    .ev-header { display: flex; align-items: center; gap: 16px; background: #1a1a1a; color: white; padding: 8px 12px; margin: -16px -16px 14px -16px; }
    .ev-num { font-weight: bold; font-size: 12pt; font-family: 'Courier New'; }
    .ev-id { font-family: 'Courier New', monospace; font-size: 10pt; flex: 1; }
    .ev-status { font-weight: bold; font-size: 10pt; }
    .ev-status.verified { color: #00c88a; }
    .ev-status.tampered { color: #ff4444; }
    .screenshot { max-width: 100%; border: 1px solid #ccc; margin-top: 8px; }
    .screenshot-section, .custody-section { margin-top: 14px; }
    pre.metadata { background: #f8f8f8; border: 1px solid #ddd; padding: 10px; font-size: 8pt; overflow-x: auto; margin-top: 8px; white-space: pre-wrap; }
    .ai-section { background: #f0f8ff; border: 1px solid #0066cc; padding: 16px; }
    .ai-badge { font-size: 9pt; color: #0066cc; margin-bottom: 8px; font-style: italic; }
    .ai-body { line-height: 1.7; }
    .footer { margin-top: 40px; border-top: 2px solid #1a1a1a; padding-top: 16px; font-size: 9pt; color: #444; }
    .certify-box { border: 1px solid #1a1a1a; padding: 16px; margin: 20px 0; background: #fff9f0; }
    @media print {
      body { padding: 20px; }
      .evidence-block { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header-block">
    <h1>🛡️ CYBERSEAL — DIGITAL EVIDENCE REPORT</h1>
    <table>
      <tr>
        <td><strong>Report ID:</strong></td>
        <td class="report-id">${reportId}</td>
        <td><strong>Generated:</strong></td>
        <td>${now}</td>
      </tr>
      <tr>
        <td><strong>Total Evidence Items:</strong></td>
        <td>${evidence.length}</td>
        <td><strong>Case Reference:</strong></td>
        <td>${caseNum || '—'}</td>
      </tr>
      <tr>
        <td><strong>Complainant:</strong></td>
        <td>${victimName || 'Not specified'}</td>
        <td><strong>Software:</strong></td>
        <td>CyberSeal v1.0 Digital Evidence System</td>
      </tr>
    </table>
    ${notes ? `<div style="margin-top:12px"><strong>Notes:</strong> ${notes}</div>` : ''}
  </div>

  <div class="certify-box">
    <strong>CERTIFICATION:</strong> This report was generated by CyberSeal Digital Evidence System. All evidence items have been cryptographically hashed using SHA-256 and the chain of custody has been maintained from the time of capture. Any modification to the evidence files would result in a hash mismatch, invalidating the evidence. This document is intended for submission to law enforcement agencies and institutional complaint bodies.
  </div>

  ${aiHtml}
  ${timelineHtml}

  <h2>📁 Evidence Exhibits</h2>
  ${evidenceHtml}

  <div class="footer">
    <p><strong>Generated by CyberSeal Digital Evidence System</strong> — CommitHappens Hackathon Demo</p>
    <p>Report ID: ${reportId} | SHA-256 Authenticated | ${options.incBlockchain ? 'Blockchain Anchored (Polygon Network)' : 'Local Storage'}</p>
    <p style="margin-top:8px; font-style:italic;">This document contains cryptographically verified digital evidence. All hashes are immutable and can be independently verified.</p>
  </div>
</body>
</html>`;
}

// ---- CHAIN OF CUSTODY ----
function updateCustodySelect(evidence) {
  const sel = document.getElementById('custodyEvidenceSelect');
  const existing = sel.value;
  sel.innerHTML = '<option value="">Select Evidence ID...</option>';
  evidence.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.evidenceId;
    opt.textContent = `${e.evidenceId} (${e.platform})`;
    sel.appendChild(opt);
  });
  if (existing) sel.value = existing;
}

async function loadCustodyLog(evidenceId) {
  if (!evidenceId) {
    document.getElementById('custodyLog').innerHTML = '<div class="cs-custody-empty">Select an evidence ID to view access log</div>';
    return;
  }
  const chain = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_CUSTODY', evidenceId }, r));
  const log = document.getElementById('custodyLog');
  if (!chain?.length) {
    log.innerHTML = '<div class="cs-custody-empty">No custody entries found</div>';
    return;
  }
  log.innerHTML = chain.map((entry, i) => `
    <div class="cs-custody-entry">
      <div class="cs-custody-action">${i + 1}. ${entry.action}</div>
      <div class="cs-custody-time">${entry.isoTime}</div>
      <div class="cs-custody-hash">Entry Hash: ${entry.hash}</div>
    </div>
  `).join('');
}

function showCustodyForId(id) {
  switchTab('chain');
  const sel = document.getElementById('custodyEvidenceSelect');
  sel.value = id;
  loadCustodyLog(id);
}

// ---- TABS ----
function switchTab(tabName) {
  document.querySelectorAll('.cs-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.cs-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tabName}`));
}

// ---- INIT ----
async function init() {
  // Platform detection
  const { platform, url } = await detectCurrentPlatform();
  updatePlatformBar(platform, url);

  // Load stats
  await loadStats();

  // Load vault
  await loadVault();

  // Tab switching
  document.querySelectorAll('.cs-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Panic button
  document.getElementById('panicBtn').addEventListener('click', triggerCapture);

  // Vault search/filter
  document.getElementById('vaultSearch').addEventListener('input', async e => {
    const data = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_EVIDENCE' }, r));
    const filter = document.getElementById('vaultFilter').value;
    renderEvidenceList(data?.evidence || [], e.target.value, filter);
  });

  document.getElementById('vaultFilter').addEventListener('change', async e => {
    const data = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_EVIDENCE' }, r));
    const search = document.getElementById('vaultSearch').value;
    renderEvidenceList(data?.evidence || [], search, e.target.value);
  });

  document.getElementById('refreshVault').addEventListener('click', loadVault);

  // Report generation
  document.getElementById('generateReport').addEventListener('click', () => {
    generateReport(window._reportEvidenceId || null);
  });

  // Chain of custody select
  document.getElementById('custodyEvidenceSelect').addEventListener('change', e => {
    loadCustodyLog(e.target.value);
  });

  // Verify integrity button
  document.getElementById('verifyIntegrity').addEventListener('click', async () => {
    const id = document.getElementById('custodyEvidenceSelect').value;
    if (!id) { toast('Select an evidence ID first', 'warn'); return; }

    showLoading('Verifying...');
    const result = await new Promise(r => chrome.runtime.sendMessage({ type: 'VERIFY_INTEGRITY', evidenceId: id }, r));
    hideLoading();

    const badge = document.getElementById('integrityBadge');
    badge.style.display = 'flex';
    if (result.valid) {
      badge.className = 'cs-integrity-badge valid';
      document.getElementById('integrityIcon').textContent = '✓';
      document.getElementById('integrityText').textContent = 'VERIFIED';
    } else {
      badge.className = 'cs-integrity-badge invalid';
      document.getElementById('integrityIcon').textContent = '⚠';
      document.getElementById('integrityText').textContent = 'TAMPERED';
      toast('⚠ WARNING: Evidence modified after capture.', 'error', 5000);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
