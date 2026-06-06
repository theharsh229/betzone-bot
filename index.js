const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// ── In-memory state (resets on server restart) ──────────────────────────────
let config = {
  token: '',
  channel: '',
  schedules: [], // { id, time (HH:MM), template, customMsg, active }
  running: false
};

let stats = { sent: 0, failed: 0 };
let logs = [];
let timers = {};

// ── Helpers ──────────────────────────────────────────────────────────────────
function addLog(type, msg) {
  const entry = { type, msg, time: new Date().toLocaleTimeString('en-GB') };
  logs.unshift(entry);
  if (logs.length > 100) logs.pop();
  console.log(`[${entry.time}] [${type.toUpperCase()}] ${msg}`);
}

async function sendToTelegram(text) {
  if (!config.token || !config.channel) {
    addLog('err', 'Bot not configured');
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.channel, text, parse_mode: 'HTML' })
    });
    const data = await res.json();
    if (data.ok) {
      stats.sent++;
      addLog('ok', `✅ Sent to ${config.channel}`);
      return true;
    } else {
      stats.failed++;
      addLog('err', `❌ ${data.description}`);
      return false;
    }
  } catch (e) {
    stats.failed++;
    addLog('err', `❌ ${e.message}`);
    return false;
  }
}

const TEMPLATES = {
  football: `🎯 BET ZONE INDIA VIP 🎯\n\n⚽ Today's Top Football Tip\n\n🔥 Check our latest analysis!\n📈 High confidence pick available\n\n💰 Bet smart. Win big.\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22906`,
  cricket:  `🎯 BET ZONE INDIA VIP 🎯\n\n🏏 Today's Cricket Tip\n\n🔥 Top pick for today's match!\n📈 High confidence selection\n\n💰 Bet smart. Win big.\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22906`,
  casino:   `🎰 BET ZONE INDIA VIP 🎰\n\n🔥 Today's Best Casino Offer!\n\n💰 Exclusive bonus for our members\n🎁 Limited time offer\n\n⚠️ 18+ | T&Cs Apply\n📢 @betzone22906`,
  tennis:   `🎾 BET ZONE INDIA VIP 🎾\n\n🔥 Today's Tennis Pick!\n\n📈 Top confidence selection\n💰 Great odds available\n\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22906`,
  basketball:`🏀 BET ZONE INDIA VIP 🏀\n\n🔥 NBA Top Pick Today!\n\n📈 High value selection\n💰 Bet smart. Win big.\n\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22906`,
  kabaddi:  `🤼 BET ZONE INDIA VIP 🤼\n\n🔥 PKL Kabaddi Tip!\n\n📈 Today's best Kabaddi pick\n💰 Great value odds\n\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22906`,
  promo:    `💰 BET ZONE INDIA VIP 💰\n\n🎁 PROMO CODE ALERT!\n\n🏷️ Code: BETZONE100\n💵 Bonus: ₹500 Free Bet\n⏰ Expires: Today Only!\n\n⚠️ 18+ | New customers only\n📢 @betzone22906`,
  vip:      `👑 BET ZONE INDIA VIP 👑\n\n🔐 VIP ACCESS OPEN!\n\n🌟 Join our premium channel\n💎 Exclusive tips daily\n📊 90%+ accuracy this month\n\n📢 @betzone22906`,
  alert:    `🚨 BET ZONE INDIA VIP 🚨\n\n⚡ URGENT BETTING ALERT!\n\n🔥 Big match starting soon\n💰 Don't miss this opportunity\n\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22906`,
  goodnight:  `🌙 BET ZONE INDIA VIP 🌙\n\n✅ Today's Results Summary\n\n📊 Check our win record\n🙏 Thanks for following!\n\nSee you tomorrow 🌅\n📢 @betzone22906`,
  ipl:        `🏏 BET ZONE INDIA VIP 🏏\n\n🔥 IPL / T20 MATCH TIP!\n\n🏆 Today's IPL Pick\n➡️ Team A vs Team B\n📅 Today | ⏰ 19:30 IST\n\n🎯 Our Pick: Team A Win\n📊 Odds: 1.85\n📈 Confidence: ⭐⭐⭐⭐ High\n\n💰 Bet smart. Win big.\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22906`,
  horseracing:`🐎 BET ZONE INDIA VIP 🐎\n\n🏇 HORSE RACING TIP!\n\n🏆 Race: Today's Feature Race\n🐴 Our Pick: Horse Name\n🏟️ Venue: Race Course\n⏰ Time: 15:00\n\n📊 Odds: 3.50\n📈 Confidence: ⭐⭐⭐ Medium\n🧠 Great form, top jockey\n\n💰 Bet smart. Win big.\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22906`,
  accumulator:`⚽ BET ZONE INDIA VIP ⚽\n\n🎯 FOOTBALL ACCUMULATOR!\n\n🔥 Today's ACCA Pick:\n\n1️⃣ Match 1 → Team A Win (1.80)\n2️⃣ Match 2 → Over 2.5 Goals (1.70)\n3️⃣ Match 3 → Team B Win (2.00)\n4️⃣ Match 4 → Both Teams Score (1.75)\n\n💰 Combined Odds: ~10.71\n📈 Confidence: ⭐⭐⭐ Medium\n\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22906`,
  freetip:    `🆓 BET ZONE INDIA VIP 🆓\n\n🎁 TODAY'S FREE TIP!\n\n⚽ Match: Team A vs Team B\n🎯 Pick: Team A Win\n📊 Odds: 2.00\n📈 Confidence: ⭐⭐⭐⭐ High\n\n✅ FREE for all members!\n💎 Want more? Join VIP!\n\n⚠️ 18+ | Gamble Responsibly\n📢 @betzone22906`,
  result:     `📊 BET ZONE INDIA VIP 📊\n\n✅ RESULT ANNOUNCEMENT!\n\n⚽ Match: Team A vs Team B\n🎯 Our Pick: Team A Win\n📌 Result: Team A Won 2-0\n\n💰 Status: ✅ WON!\n🏆 Odds Were: 2.10\n\n🔥 Another winner for our members!\n📈 This month: 18W / 4L\n\n📢 @betzone22906`,
  weekend:    `🎉 BET ZONE INDIA VIP 🎉\n\n🌟 WEEKEND SPECIAL OFFER!\n\n💰 Deposit ₹500 → Get ₹1000\n🎁 100% Weekend Bonus!\n⏰ Valid: This Weekend Only\n\n✅ How to claim:\n1️⃣ Register via our link\n2️⃣ Deposit ₹500+\n3️⃣ Use code: WEEKEND100\n4️⃣ Bonus credited instantly!\n\n⚠️ 18+ | T&Cs Apply\n📢 @betzone22906`,
  refer:      `👥 BET ZONE INDIA VIP 👥\n\n💸 REFER & EARN PROGRAM!\n\n🤝 Refer a friend → Earn ₹200\n🎁 Your friend gets ₹100 bonus too!\n\n✅ Steps:\n1️⃣ Share your referral link\n2️⃣ Friend registers & deposits\n3️⃣ You both get rewarded!\n\n🔗 No limit on referrals!\n💰 Unlimited earning potential\n\n📢 @betzone22906`,
  livematch:  `🔴 BET ZONE INDIA VIP 🔴\n\n⚡ LIVE MATCH ALERT!\n\n🎮 MATCH IS LIVE NOW!\n⚽ Team A vs Team B\n⏱️ Current Score: 0 - 0\n\n🔥 In-Play Tip:\n➡️ Back Team A Next Goal\n📊 Live Odds: 2.20\n\n⚠️ Act fast — odds changing!\n18+ | Gamble Responsibly\n📢 @betzone22906`
};

// ── Schedule engine ──────────────────────────────────────────────────────────
function msUntil(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

function scheduleOne(s) {
  if (timers[s.id]) { clearTimeout(timers[s.id]); delete timers[s.id]; }
  if (!s.active || !config.running) return;

  const delay = msUntil(s.time);
  addLog('info', `⏰ Scheduled "${s.template}" at ${s.time} (in ${Math.round(delay/60000)}m)`);

  timers[s.id] = setTimeout(async () => {
    if (!config.running) return;
    const msg = s.customMsg || TEMPLATES[s.template] || TEMPLATES.football;
    await sendToTelegram(msg);
    scheduleOne(s); // reschedule for next day
  }, delay);
}

function startAll() {
  config.running = true;
  config.schedules.forEach(s => scheduleOne(s));
  addLog('ok', `🚀 Auto posting started (${config.schedules.filter(s=>s.active).length} active schedules)`);
}

function stopAll() {
  config.running = false;
  Object.values(timers).forEach(t => clearTimeout(t));
  timers = {};
  addLog('info', '⏹ Auto posting stopped');
}

// ── API Routes ───────────────────────────────────────────────────────────────

// Health check (keeps Railway alive)
app.get('/', (req, res) => res.json({ status: 'BetZone Bot Running 🟢', stats }));

// Get full state
app.get('/state', (req, res) => res.json({
  token: config.token ? '••••••' + config.token.slice(-6) : '',
  channel: config.channel,
  schedules: config.schedules,
  running: config.running,
  stats,
  logs: logs.slice(0, 30)
}));

// Save bot credentials
app.post('/config', async (req, res) => {
  const { token, channel } = req.body;
  if (!token || !channel) return res.json({ ok: false, error: 'Missing fields' });
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const d = await r.json();
    if (!d.ok) return res.json({ ok: false, error: d.description });
    config.token = token;
    config.channel = channel;
    addLog('ok', `Bot @${d.result.username} connected to ${channel}`);
    res.json({ ok: true, botName: d.result.username });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Save schedules
app.post('/schedules', (req, res) => {
  config.schedules = req.body.schedules || [];
  // Restart timers with new schedules
  if (config.running) {
    Object.values(timers).forEach(t => clearTimeout(t));
    timers = {};
    config.schedules.forEach(s => scheduleOne(s));
  }
  addLog('info', `📅 Schedules updated (${config.schedules.length} total)`);
  res.json({ ok: true });
});

// Start/stop auto posting
app.post('/toggle', (req, res) => {
  if (config.running) {
    stopAll();
    res.json({ ok: true, running: false });
  } else {
    startAll();
    res.json({ ok: true, running: true });
  }
});

// Send immediate post
app.post('/send', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ ok: false, error: 'No text' });
  const ok = await sendToTelegram(text);
  res.json({ ok });
});

// Get templates
app.get('/templates', (req, res) => res.json(TEMPLATES));

// Clear logs
app.post('/logs/clear', (req, res) => { logs = []; res.json({ ok: true }); });

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  addLog('ok', `BetZone server started on port ${PORT}`);
});
