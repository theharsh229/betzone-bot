const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let config = {
  token: process.env.BOT_TOKEN || '',
  channel: process.env.CHANNEL_ID || '',
  oddsApiKey: process.env.ODDS_API_KEY || '',
  oddsSport: process.env.ODDS_SPORT || 'soccer_epl',
  running: false,
  schedules: []
};

let stats = { sent: 0, failed: 0 };
let logs = [];
let timers = {};
let postHistory = [];

const TEMPLATES = {
  football: `🎯 BET ZONE INDIA VIP 🎯\n\n⚽ Today's Football Tip\n🔥 Pick: Home Win / Draw\n📈 Confidence: ⭐⭐⭐ Medium\n\n💰 Bet smart. Win big.\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22096`,
  cricket: `🎯 BET ZONE INDIA VIP 🎯\n\n🏏 Today's Cricket Tip\n🔥 Pick: Top team to win\n📈 Confidence: ⭐⭐⭐⭐ High\n\n💰 Bet smart. Win big.\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22096`,
  ipl: `🏏 BET ZONE INDIA VIP 🏏\n\n🔥 IPL / T20 MATCH TIP!\n🏆 Match: Team A vs Team B\n📅 Today | ⏰ 19:30 IST\n🎯 Pick: Team A Win\n📊 Odds: 1.85\n📈 Confidence: ⭐⭐⭐⭐ High\n\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22096`,
  basketball: `🏀 BET ZONE INDIA VIP 🏀\n\n🔥 Basketball Pick Today\n🎯 Pick: Home Team + Points\n📈 Confidence: ⭐⭐⭐ Medium\n\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22096`,
  tennis: `🎾 BET ZONE INDIA VIP 🎾\n\n🔥 Tennis Pick\n🎯 Pick: Player A to Win\n📊 Odds: 1.90\n📈 Confidence: ⭐⭐⭐⭐ High\n\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22096`,
  kabaddi: `🤼 BET ZONE INDIA VIP 🤼\n\n🔥 Kabaddi Tip\n🎯 Pick: Team A Win\n📈 Confidence: ⭐⭐⭐ Medium\n\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22096`,
  casino: `🎰 BET ZONE INDIA VIP 🎰\n\n🔥 Casino Offer Alert\n🎁 Limited time bonus\n💰 Check now\n\n⚠️ 18+ | T&Cs Apply\n📢 @betzone22096`,
  promo: `💰 BET ZONE INDIA VIP 💰\n\n🎁 PROMO CODE ALERT\n🏷️ Code: BETZONE100\n💵 Bonus: ₹500 Free Bet\n⏰ Today only\n\n⚠️ 18+ | T&Cs Apply\n📢 @betzone22096`,
  vip: `👑 BET ZONE INDIA VIP 👑\n\n🔐 VIP ACCESS OPEN\n💎 Premium tips daily\n📊 Better analysis, faster alerts\n\n📢 @betzone22096`,
  alert: `🚨 BET ZONE INDIA VIP 🚨\n\n⚡ URGENT ALERT\n🔥 Big match starting soon\n💰 Don't miss this opportunity\n\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22096`,
  result: `📊 BET ZONE INDIA VIP 📊\n\n✅ RESULT UPDATE\n🎯 Pick: Team A Win\n📌 Result: WON ✅\n🏆 Odds: 2.10\n\n📢 @betzone22096`,
  refer: `👥 BET ZONE INDIA VIP 👥\n\n💸 Refer & Earn\n🤝 Invite friends and earn rewards\n🔗 Unlimited referrals\n\n📢 @betzone22096`,
  liveodds: `📡 Live Odds Auto Post`
};

function addLog(type, msg) {
  const entry = { type, msg: String(msg), time: new Date().toLocaleString('en-IN') };
  logs.unshift(entry);
  logs = logs.slice(0, 150);
  console.log(`[${entry.time}] [${type}] ${entry.msg}`);
}

function safeChannel() {
  return config.channel && config.channel.trim();
}

async function telegramApi(method, body) {
  if (!config.token) throw new Error('Bot token missing');
  const res = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

async function sendToTelegram(text, template = 'custom') {
  if (!config.token || !safeChannel()) {
    stats.failed++;
    addLog('err', 'Bot not configured');
    return { ok: false, error: 'Bot not configured' };
  }
  try {
    const result = await telegramApi('sendMessage', {
      chat_id: config.channel,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    stats.sent++;
    const post = {
      message_id: result.message_id,
      date: new Date().toISOString(),
      template,
      text: text.slice(0, 500),
      views: result.views || null
    };
    postHistory.unshift(post);
    postHistory = postHistory.slice(0, 100);
    addLog('ok', `Message sent to ${config.channel}`);
    return { ok: true, result, post };
  } catch (e) {
    stats.failed++;
    addLog('err', e.message);
    return { ok: false, error: e.message };
  }
}

function msUntil(timeStr) {
  if (!/^\d{2}:\d{2}$/.test(timeStr || '')) return 60000;
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

function stopTimer(id) {
  if (timers[id]) clearTimeout(timers[id]);
  delete timers[id];
}

function scheduleOne(s) {
  stopTimer(s.id);
  if (!config.running || !s.active) return;
  const delay = msUntil(s.time);
  addLog('info', `Scheduled ${s.template} at ${s.time}`);
  timers[s.id] = setTimeout(async () => {
    if (!config.running) return;
    let msg = s.customMsg || TEMPLATES[s.template] || TEMPLATES.football;
    if (s.template === 'liveodds') msg = await createLiveOddsPost();
    await sendToTelegram(msg, s.template);
    scheduleOne(s);
  }, delay);
}

function restartSchedules() {
  Object.keys(timers).forEach(stopTimer);
  if (config.running) config.schedules.forEach(scheduleOne);
}

async function fetchOdds(apiKey, sport) {
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=uk&markets=h2h&oddsFormat=decimal`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Odds API failed');
  return data;
}

function getOdds(match) {
  const outcomes = match.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes || [];
  return {
    home: outcomes.find(o => o.name === match.home_team)?.price || 'N/A',
    away: outcomes.find(o => o.name === match.away_team)?.price || 'N/A',
    draw: outcomes.find(o => String(o.name).toLowerCase() === 'draw')?.price || 'N/A'
  };
}

async function createLiveOddsPost() {
  if (!config.oddsApiKey) return TEMPLATES.football;
  const matches = await fetchOdds(config.oddsApiKey, config.oddsSport);
  if (!matches.length) return `🎯 BET ZONE INDIA VIP 🎯\n\nNo live odds found right now.\n\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22096`;
  const match = matches[0];
  const odds = getOdds(match);
  const dt = new Date(match.commence_time);
  return `🎯 BET ZONE INDIA VIP 🎯\n\n⚽ ${match.home_team} vs ${match.away_team}\n📅 ${dt.toLocaleDateString('en-IN')} | ⏰ ${dt.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })}\n\n🔥 TODAY'S VIP PICK:\n➡️ ${match.home_team} / Draw\n\n📊 ODDS:\n🏠 ${match.home_team}: ${odds.home}\n🤝 Draw: ${odds.draw}\n✈️ ${match.away_team}: ${odds.away}\n\n📈 Confidence: ⭐⭐⭐ Medium\n🧠 Live odds fetched automatically.\n\n💰 Bet smart. Win big.\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22096`;
}

async function getSubscriberCount() {
  if (!config.token || !safeChannel()) return null;
  try {
    const count = await telegramApi('getChatMemberCount', { chat_id: config.channel });
    return count;
  } catch (e) {
    addLog('err', `Subscriber count failed: ${e.message}`);
    return null;
  }
}

app.get('/', (req, res) => res.json({ status: 'BetZone Bot Running', stats }));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/state', (req, res) => {
  res.json({
    token: config.token ? 'saved' : '',
    channel: config.channel,
    schedules: config.schedules,
    running: config.running,
    stats,
    logs: logs.slice(0, 50),
    oddsSport: config.oddsSport,
    oddsConfigured: !!config.oddsApiKey,
    posts: postHistory.slice(0, 20)
  });
});

app.post('/config', async (req, res) => {
  try {
    const { token, channel } = req.body;
    if (!token || !channel) return res.json({ ok: false, error: 'Missing bot token or channel' });
    config.token = token.trim();
    config.channel = channel.trim();
    const me = await telegramApi('getMe');
    addLog('ok', `Bot connected: @${me.username}`);
    res.json({ ok: true, botName: me.username, channel: config.channel });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/send', async (req, res) => {
  const { text, template } = req.body;
  if (!text) return res.json({ ok: false, error: 'No text' });
  const result = await sendToTelegram(text, template || 'custom');
  res.json(result);
});

app.get('/templates', (req, res) => res.json(TEMPLATES));

app.post('/schedules', (req, res) => {
  config.schedules = Array.isArray(req.body.schedules) ? req.body.schedules : [];
  restartSchedules();
  addLog('info', `Schedules updated: ${config.schedules.length}`);
  res.json({ ok: true, schedules: config.schedules });
});

app.post('/toggle', (req, res) => {
  config.running = !config.running;
  restartSchedules();
  addLog(config.running ? 'ok' : 'info', config.running ? 'Auto posting started' : 'Auto posting stopped');
  res.json({ ok: true, running: config.running });
});

app.post('/odds/test', async (req, res) => {
  try {
    const { apiKey, sport } = req.body;
    if (!apiKey) return res.json({ ok: false, error: 'Missing Odds API key' });
    const data = await fetchOdds(apiKey, sport || 'soccer_epl');
    res.json({ ok: true, count: data.length, matches: data.slice(0, 5) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/odds/save', (req, res) => {
  const { apiKey, sport } = req.body;
  if (!apiKey) return res.json({ ok: false, error: 'Missing Odds API key' });
  config.oddsApiKey = apiKey.trim();
  config.oddsSport = sport || 'soccer_epl';
  addLog('ok', `Odds API saved for ${config.oddsSport}`);
  res.json({ ok: true });
});

app.post('/odds/send-live', async (req, res) => {
  try {
    const msg = await createLiveOddsPost();
    const result = await sendToTelegram(msg, 'liveodds');
    res.json(result);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/analytics', async (req, res) => {
  const subscribers = await getSubscriberCount();
  res.json({
    ok: true,
    subscribers,
    stats,
    posts: postHistory.slice(0, 50),
    note: 'Telegram Bot API can count subscribers if the bot has permission. Updated post view tracking is not available through normal Bot API after a message is sent.'
  });
});

app.post('/logs/clear', (req, res) => { logs = []; res.json({ ok: true }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => addLog('ok', `BetZone server started on port ${PORT}`));
