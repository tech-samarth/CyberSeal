// ============================================================
// CyberSeal - Platform Metadata Extractors
// Extracts sender IDs, message content, timestamps per platform
// ============================================================

export const PlatformExtractors = {

  // Detect current platform
  detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('whatsapp.com')) return 'whatsapp';
    if (host.includes('discord.com')) return 'discord';
    if (host.includes('twitter.com') || host.includes('x.com')) return 'twitter';
    if (host.includes('telegram.org')) return 'telegram';
    if (host.includes('facebook.com')) return 'facebook';
    if (host.includes('reddit.com')) return 'reddit';
    return 'unknown';
  },

  // Master extractor - routes to platform-specific
  extract(platform) {
    const base = {
      platform,
      url: window.location.href,
      pageTitle: document.title,
      captureTime: new Date().toISOString(),
      captureTimestamp: Date.now(),
      userAgent: navigator.userAgent,
      screenResolution: `${screen.width}x${screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
    };

    const specific = this[platform] ? this[platform]() : {};
    return { ...base, ...specific };
  },

  instagram() {
    const data = { platform: 'Instagram' };
    try {
      // Extract username from profile page
      const profileLink = document.querySelector('a[href*="/"][role="link"] span');
      if (profileLink) data.targetUsername = profileLink.textContent.trim();

      // Extract from DM thread
      const dmHeader = document.querySelector('header a[href*="/"]');
      if (dmHeader) data.conversationWith = dmHeader.href.match(/\/([^/]+)\/?$/)?.[1];

      // Extract messages
      const messages = [];
      document.querySelectorAll('[role="row"]').forEach(row => {
        const text = row.innerText?.trim();
        if (text) messages.push(text);
      });
      data.visibleMessages = messages.slice(0, 20);

      // Story/reel detection
      data.isStory = window.location.href.includes('/stories/');
      data.isReel = window.location.href.includes('/reel/');

      // Post ID from URL
      const postMatch = window.location.href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
      if (postMatch) data.contentId = postMatch[2];

    } catch(e) { data.extractionNote = 'Partial extraction'; }
    return data;
  },

  whatsapp() {
    const data = { platform: 'WhatsApp Web' };
    try {
      // Chat title / contact name
      const chatHeader = document.querySelector('#main header span[title]');
      if (chatHeader) data.conversationWith = chatHeader.getAttribute('title');

      // Extract messages with timestamps
      const messages = [];
      document.querySelectorAll('.message-in, .message-out').forEach(msg => {
        const text = msg.querySelector('.selectable-text')?.innerText;
        const time = msg.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text');
        const sender = msg.classList.contains('message-out') ? 'You' : data.conversationWith;
        if (text) messages.push({ sender, text, time, direction: msg.classList.contains('message-out') ? 'sent' : 'received' });
      });
      data.messages = messages;

      // Detect disappearing messages
      data.isDisappearing = !!document.querySelector('[data-icon="timer-disappearing-messages"]');

      // Group chat detection
      const groupMembers = document.querySelectorAll('span[data-testid="member-count"]');
      data.isGroupChat = groupMembers.length > 0;

    } catch(e) { data.extractionNote = 'Partial extraction'; }
    return data;
  },

  discord() {
    const data = { platform: 'Discord' };
    try {
      // Server and channel name
      const serverName = document.querySelector('[class*="nameText"]')?.textContent?.trim();
      const channelName = document.querySelector('[class*="channelName"]')?.textContent?.trim();
      data.serverName = serverName;
      data.channelName = channelName;

      // Extract messages with author names
      const messages = [];
      document.querySelectorAll('[class*="messageContent"]').forEach((msg, i) => {
        const wrapper = msg.closest('[class*="message_"]');
        const author = wrapper?.querySelector('[class*="username"]')?.textContent?.trim();
        const timestamp = wrapper?.querySelector('time')?.getAttribute('datetime');
        if (msg.textContent) {
          messages.push({ author, content: msg.textContent.trim(), timestamp });
        }
      });
      data.messages = messages.slice(0, 30);

      // Server ID and channel ID from URL
      const urlMatch = window.location.href.match(/channels\/(\d+)\/(\d+)/);
      if (urlMatch) {
        data.serverId = urlMatch[1];
        data.channelId = urlMatch[2];
      }

      // User ID from local storage
      try {
        const token = document.body.innerHTML.match(/"token":"([^"]+)"/);
        data.hasToken = !!token;
      } catch(e) {}

    } catch(e) { data.extractionNote = 'Partial extraction'; }
    return data;
  },

  twitter() {
    const data = { platform: 'X / Twitter' };
    try {
      // Tweet author
      const articleAuthor = document.querySelector('[data-testid="User-Name"]');
      if (articleAuthor) {
        const spans = articleAuthor.querySelectorAll('span');
        data.authorDisplayName = spans[0]?.textContent?.trim();
        data.authorHandle = spans[spans.length - 1]?.textContent?.trim();
      }

      // Tweet text
      const tweetText = document.querySelector('[data-testid="tweetText"]');
      if (tweetText) data.tweetContent = tweetText.innerText;

      // Tweet ID from URL
      const tweetMatch = window.location.href.match(/status\/(\d+)/);
      if (tweetMatch) data.tweetId = tweetMatch[1];

      // Extract multiple tweets in feed
      const tweets = [];
      document.querySelectorAll('article[data-testid="tweet"]').forEach(tweet => {
        const text = tweet.querySelector('[data-testid="tweetText"]')?.innerText;
        const author = tweet.querySelector('[data-testid="User-Name"]')?.textContent;
        const time = tweet.querySelector('time')?.getAttribute('datetime');
        if (text) tweets.push({ text, author, time });
      });
      data.visibleTweets = tweets.slice(0, 10);

      // DM context
      data.isDM = window.location.href.includes('/messages');

    } catch(e) { data.extractionNote = 'Partial extraction'; }
    return data;
  },

  telegram() {
    const data = { platform: 'Telegram Web' };
    try {
      // Chat name
      const chatName = document.querySelector('.peer-title')?.textContent?.trim();
      data.conversationWith = chatName;

      // Messages
      const messages = [];
      document.querySelectorAll('.message').forEach(msg => {
        const text = msg.querySelector('.text-content')?.innerText?.trim();
        const sender = msg.querySelector('.peer-title')?.textContent?.trim();
        const time = msg.querySelector('.time')?.textContent?.trim();
        if (text) messages.push({ sender, text, time });
      });
      data.messages = messages.slice(0, 30);

      // Group or private
      data.chatType = document.querySelector('.group-status') ? 'group' : 'private';

    } catch(e) { data.extractionNote = 'Partial extraction'; }
    return data;
  },

  facebook() {
    const data = { platform: 'Facebook' };
    try {
      // Profile being viewed
      const profileName = document.querySelector('[data-pagelet="ProfileTilesFeed"] h1')?.textContent?.trim();
      if (profileName) data.profileName = profileName;

      // Post content
      const posts = [];
      document.querySelectorAll('[data-ad-preview="message"]').forEach(post => {
        posts.push(post.innerText?.trim());
      });
      data.visiblePosts = posts.slice(0, 10);

      // Messenger DM
      data.isMessenger = window.location.href.includes('/messages');

    } catch(e) { data.extractionNote = 'Partial extraction'; }
    return data;
  },

  reddit() {
    const data = { platform: 'Reddit' };
    try {
      // Subreddit
      const subMatch = window.location.href.match(/r\/([^/]+)/);
      if (subMatch) data.subreddit = subMatch[1];

      // Post title
      const postTitle = document.querySelector('[data-test-id="post-content"] h1')?.textContent?.trim()
        || document.querySelector('h1._eYtD2XCVieq6emjKBH3m')?.textContent?.trim();
      data.postTitle = postTitle;

      // Comments
      const comments = [];
      document.querySelectorAll('[data-testid="comment"]').forEach(comment => {
        const author = comment.querySelector('[data-testid="comment_author_link"]')?.textContent;
        const body = comment.querySelector('.RichTextJSON-root')?.innerText?.trim();
        if (body) comments.push({ author, body });
      });
      data.visibleComments = comments.slice(0, 15);

    } catch(e) { data.extractionNote = 'Partial extraction'; }
    return data;
  }
};

export default PlatformExtractors;
