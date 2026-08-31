import "dotenv/config";
import { Client, GatewayIntentBits, Partials, Events } from "discord.js";

/**
 * Discord Report Sync bot (ชั่วคราว)
 * ฟังทุกห้อง แล้วยิงข้อมูลดิบเข้า SmartBoss — ฝั่ง SmartBoss เป็นคนตัดสินว่าห้องไหน
 * นับ/ไม่นับ (ตาม discord_channels) จึงไม่ต้อง hardcode รายชื่อห้องในบอท
 */

const { DISCORD_TOKEN, SMARTBOSS_URL, DISCORD_SYNC_SECRET } = process.env;
if (!DISCORD_TOKEN || !SMARTBOSS_URL || !DISCORD_SYNC_SECRET) {
  console.error("❌ ต้องตั้ง env ให้ครบ: DISCORD_TOKEN, SMARTBOSS_URL, DISCORD_SYNC_SECRET (ดู .env.example)");
  process.exit(1);
}

const INGEST = new URL("/api/report-task/discord-ingest", SMARTBOSS_URL).toString();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

/** นับเฉพาะไฟล์แนบที่เป็นรูป */
function imageCount(msg) {
  let n = 0;
  for (const a of msg.attachments.values()) {
    const ct = a.contentType || "";
    if (ct.startsWith("image/")) n++;
    else if (/\.(png|jpe?g|gif|webp|heic|heif)$/i.test(a.name || "")) n++;
  }
  return n;
}

async function forward(msg) {
  try {
    if (msg.author?.bot) return;      // ข้ามข้อความจากบอท (รวมตัวเอง)
    if (!msg.guildId) return;         // ข้าม DM
    const payload = {
      messages: [
        {
          discordChannelId: msg.channelId,
          discordUserId: msg.author.id,
          messageId: msg.id,
          postedAt: msg.createdAt.toISOString(),
          content: msg.content ?? "",
          imageCount: imageCount(msg),
        },
      ],
    };
    const res = await fetch(INGEST, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discord-sync-key": DISCORD_SYNC_SECRET,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`⚠️ ingest ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (e) {
    console.warn("⚠️ ส่งเข้า SmartBoss ไม่สำเร็จ:", e?.message ?? e);
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`✅ บอทออนไลน์: ${c.user.tag} · ยิงเข้า ${INGEST}`);
});
client.on(Events.MessageCreate, forward);
client.on(Events.MessageUpdate, (_old, msg) => {
  if (msg.partial) msg.fetch().then(forward).catch(() => {});
  else forward(msg);
});

client.login(DISCORD_TOKEN);
