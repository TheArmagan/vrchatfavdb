//!/usr/bin/env node

const express = require("express");
const app = express();
const fs = require("fs");
const path = require("path");
const aaq = require("async-and-quick");
const cookieParser = require('set-cookie-parser');
const { WebhookClient } = require("discord.js");

process.title = "VRChat Favorite Database";
console.log("VRChat Favorite Database by TheArmagan");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const CWD = process.cwd();
const DATA_DIR = path.join(CWD, "data");
const AVATARS_DIR = path.join(DATA_DIR, "avatars");
const AVATAR_IMAGES_DIR = path.join(DATA_DIR, "avatar_images");
const EXTRAS_DIR = path.join(DATA_DIR, "extras");
const VIEWS_DIR = path.join(__dirname, "views");

{
  let access_key = "change_me!";
  if (fs.existsSync(path.join(CWD, "./vrchatfavdb_access_key.txt"))) {
    access_key = fs.readFileSync(path.join(CWD, "./vrchatfavdb_access_key.txt"), "utf8") || "change_me!";
    fs.rmSync(path.join(CWD, "./vrchatfavdb_access_key.txt"));
  }
  if (!fs.existsSync(path.join(CWD, "./config.json"))) fs.writeFileSync(path.join(CWD, "./config.json"), JSON.stringify({
    access_key,
    http: {
      port: 3000,
      public_url: "http://localhost:3000"
    },
    discord: {
      webhook_urls: {
        avatars_imported: "",
        avatar_updated: "",
        avatar_deleted: ""
      }
    }
  }, null, 2), "utf8");
}
const CONFIG = JSON.parse(fs.readFileSync(path.join(CWD, "./config.json"), "utf8").trim());

/** @type {Record<string, WebhookClient>} */
const webhookClients = Object.entries(CONFIG?.discord?.webhook_urls || {}).reduce((acc, [key, value]) => {
  value = value?.trim();
  if (value) acc[key] = new WebhookClient({ url: value }, { allowedMentions: { parse: [] } });
  return acc;
}, {});

[
  DATA_DIR,
  AVATARS_DIR,
  EXTRAS_DIR,
  AVATAR_IMAGES_DIR,
  VIEWS_DIR
].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { }
});

app.use(express.static(VIEWS_DIR));
app.use("/data", express.static(DATA_DIR));

app.use(express.json({
  limit: "50mb"
}));

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error("Failed to download file", await res.text());
    return false;
  }
  await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

let cachedAvatars = [];

async function updateAvatarsCache() {
  const fileNames = await fs.promises.readdir(AVATARS_DIR);
  cachedAvatars = await aaq.quickMap(fileNames, async (fileName) => {
    let avatar = JSON.parse(await fs.promises.readFile(path.join(AVATARS_DIR, fileName), "utf8"));
    return {
      avatar,
      images: {
        has_image: fs.existsSync(path.join(AVATAR_IMAGES_DIR, avatar.id, "image.png")),
        has_uploaded_image: fs.existsSync(path.join(AVATAR_IMAGES_DIR, avatar.id, "uploaded_image.png"))
      }
    };
  });
  cachedAvatars.sort((a, b) => a.avatar.name.localeCompare(b.avatar.name));
  cachedAvatars.sort((a, b) => new Date(b.avatar.fetched_at) > new Date(a.avatar.fetched_at) ? 1 : -1);
  return cachedAvatars;
}

function buildSearchIndex(avatar) {
  return `${avatar.id} ${avatar.name} ${avatar.description} ${avatar.author.name} ${avatar.id} ${avatar.author.id} ${avatar.note || ""} ${avatar.import_note || ""} ${avatar.tags.join(" ")}`.trim().toLowerCase();
}

updateAvatarsCache();

app.post("/api/favs/import", async (req, res) => {
  const vrChatCookie = req.body.cookie;
  const note = req.body.note;

  if (req.query.access_key !== CONFIG.access_key) {
    return res.status(403).send({ ok: false, error: "Invalid access key" });
  }

  const apiRes = await fetch(
    "https://vrchat.com/api/1/avatars/favorites?n=300&offset=0",
    {
      headers: {
        "cookie": vrChatCookie,
        "user-agent": USER_AGENT,
      }
    }
  );

  if (!apiRes.ok) {
    let t = await apiRes.text();
    console.error("Failed to fetch favorites from VRChat API", t);
    res.status(apiRes.status).send({ ok: false, error: t });
    return;
  }

  const avatars = await apiRes.json();

  let oldCount = cachedAvatars.length;

  let resAvatars = [];
  let fetchedAt = new Date().toISOString();
  await aaq.quickForEach(avatars, async (avatar) => {
    const avatarImagesDir = path.join(AVATAR_IMAGES_DIR, avatar.id);
    const jsonPath = path.join(AVATARS_DIR, `${avatar.id}.json`);
    if (!fs.existsSync(avatarImagesDir)) await fs.promises.mkdir(avatarImagesDir, { recursive: true });
    const ogJson = fs.existsSync(jsonPath) ? JSON.parse(await fs.promises.readFile(jsonPath, "utf8")) : {};
    let obj = {
      ...ogJson,
      id: avatar.id,
      author: {
        id: avatar.authorId,
        name: avatar.authorName
      },
      name: avatar.name,
      description: avatar.description,
      tags: avatar.tags,
      created_at: avatar.created_at,
      updated_at: avatar.updated_at,
      fetched_at: fetchedAt,
      import_note: note
    };
    obj.search_index = buildSearchIndex(obj);
    resAvatars.push(obj);
    await Promise.all([
      downloadFile(avatar.imageUrl, path.join(avatarImagesDir, "image.png")),
      fs.promises.writeFile(jsonPath, JSON.stringify(obj, null, 2))
    ]);
  });

  await fs.promises.writeFile(path.join(EXTRAS_DIR, `last_import_date.json`), JSON.stringify({ value: fetchedAt }, null, 2));

  await updateAvatarsCache();

  const diff = cachedAvatars.length - oldCount;

  if (diff > 0) {
    webhookClients.avatars_imported?.send({
      embeds: [{
        title: "Avatars Imported",
        url: CONFIG.http.public_url,
        description: `New **${diff}** avatars imported from VRChat.`,
        color: 0x248046,
        timestamp: new Date().toISOString()
      }]
    });
  }


  return res.send({ ok: true, data: diff });
});

app.get("/api/favs", async (req, res) => {
  res.send({ ok: true, data: cachedAvatars });
});

app.get("/api/avatars/:id", async (req, res) => {
  const avatar = cachedAvatars.find(i => i.avatar.id === req.params.id);
  if (!avatar) return res.status(404).send({ ok: false });
  return res.send({ ok: true, data: avatar });
});

app.patch("/api/avatars/:id", async (req, res) => {
  let avatar = cachedAvatars.find(i => i.avatar.id === req.params.id);
  if (!avatar) return res.status(404).send({ ok: false });

  if (req.query.access_key !== CONFIG.access_key) {
    return res.status(403).send({ ok: false, error: "Invalid access key" });
  }

  let obj = {
    ...avatar.avatar,
    ...req.body
  }

  obj.search_index = buildSearchIndex(obj);

  await fs.promises.writeFile(path.join(AVATARS_DIR, `${avatar.avatar.id}.json`), JSON.stringify(obj, null, 2));

  await updateAvatarsCache();

  avatar = cachedAvatars.find(i => i.avatar.id === req.params.id);

  webhookClients.avatar_updated?.send({
    embeds: [{
      title: "Avatar Updated",
      url: CONFIG.http.public_url,
      description: `**[${obj.name}](${CONFIG.http.public_url}/app?q=${obj.id})** has been updated.${obj.note ? `\nNote: ${obj.note}` : ""}`,
      color: 0xf0b232,
      image:
        avatar.images.has_uploaded_image ? { url: `${CONFIG.http.public_url}/data/avatar_images/${obj.id}/uploaded_image.png` }
          : avatar.images.has_image ? { url: `${CONFIG.http.public_url}/data/avatar_images/${obj.id}/image.png` } : undefined,
      timestamp: new Date().toISOString()
    }]
  });

  return res.send({ ok: true, data: obj });
});

app.delete("/api/avatars/:id", async (req, res) => {
  const avatar = cachedAvatars.find(i => i.avatar.id === req.params.id);
  if (!avatar) return res.status(404).send({ ok: false });

  if (req.query.access_key !== CONFIG.access_key) {
    return res.status(403).send({ ok: false, error: "Invalid access key" });
  }

  await webhookClients.avatar_deleted?.send({
    embeds: [{
      title: "Avatar Deleted",
      url: CONFIG.http.public_url,
      description: `**${avatar.avatar.name}** has been deleted.${avatar.avatar.note ? `\nNote: ${avatar.avatar.note}` : ""}`,
      color: 0xef5859,
      image:
        avatar.images.has_uploaded_image ? { url: `${CONFIG.http.public_url}/data/avatar_images/${avatar.avatar.id}/uploaded_image.png` }
          : avatar.images.has_image ? { url: `${CONFIG.http.public_url}/data/avatar_images/${avatar.avatar.id}/image.png` } : undefined,
      timestamp: new Date().toISOString()
    }]
  });

  await fs.promises.rm(path.join(AVATARS_DIR, `${avatar.avatar.id}.json`), { recursive: true }).catch(() => { });
  await fs.promises.rm(path.join(AVATAR_IMAGES_DIR, avatar.avatar.id), { recursive: true }).catch(() => { });

  await updateAvatarsCache();

  return res.send({ ok: true });
});

app.post("/api/avatars/:id/upload-image", async (req, res) => {
  const avatar = cachedAvatars.find(i => i.avatar.id === req.params.id);
  if (!avatar) return res.status(404).send({ ok: false });

  if (req.query.access_key !== CONFIG.access_key) {
    return res.status(403).send({ ok: false, error: "Invalid access key" });
  }

  try {
    const image = req.body.image.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(image, "base64");
    await fs.promises.writeFile(path.join(AVATAR_IMAGES_DIR, avatar.avatar.id, "uploaded_image.png"), imageBuffer);
  } catch (e) {
    console.error("Failed to upload image", e);
    return res.status(500).send({ ok: false, error: e.message });
  }

  await updateAvatarsCache();

  webhookClients.avatar_updated?.send({
    embeds: [{
      title: "Avatar Image Updated",
      url: CONFIG.http.public_url,
      description: `**[${avatar.avatar.name}](${CONFIG.http.public_url}/app?q=${avatar.avatar.id})** image has been updated.`,
      color: 0xf0b232,
      image: { url: `${CONFIG.http.public_url}/data/avatar_images/${avatar.avatar.id}/uploaded_image.png` },
      timestamp: new Date().toISOString()
    }]
  });

  return res.send({ ok: true });
});


app.post("/api/avatars/:id/select", async (req, res) => {
  const avatar = cachedAvatars.find(i => i.avatar.id === req.params.id);
  if (!avatar) return res.status(404).send({ ok: false });

  const vrChatCookie = req.body.cookie;

  const apiRes = await fetch(
    `https://vrchat.com/api/1/avatars/${avatar.avatar.id}/select`,
    {
      method: "PUT",
      headers: {
        "cookie": vrChatCookie,
        "user-agent": USER_AGENT,
      }
    }
  );

  if (!apiRes.ok) {
    let t = await apiRes.text();
    console.error("Failed to select avatar", t);
    res.status(apiRes.status).send({ ok: false, error: t });
    return;
  }

  return res.send({ ok: true });
});

app.post("/api/cache/update", async (req, res) => {
  if (req.query.access_key !== CONFIG.access_key) {
    return res.status(403).send({ ok: false, error: "Invalid access key" });
  }
  await updateAvatarsCache();
  return res.send({ ok: true });
});

app.get("/api/extras/last-import-date", async (req, res) => {
  const dir = path.join(EXTRAS_DIR, `last_import_date.json`);
  if (!fs.existsSync(dir)) return res.send({ ok: true, data: null });
  const lastImportDate = JSON.parse(await fs.promises.readFile(dir, "utf8"))?.value;
  return res.send({ ok: true, data: lastImportDate });
});

app.post("/api/vrc/auth/step1", async (req, res) => {

  const username = req.body.username;
  const password = req.body.password;

  if (!username || !password) {
    return res.status(400).send({ ok: false, error: "Missing username or password" });
  }

  const apiRes = await fetch(
    "https://vrchat.com/api/1/auth/user",
    {
      headers: {
        "authorization": `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "user-agent": USER_AGENT,
      }
    }
  );

  if (!apiRes.ok) {
    let t = await apiRes.text();
    console.error("Failed to authenticate", t);
    res.status(apiRes.status).send({ ok: false, error: t.includes("Invalid Username") ? "Invalid username or password." : t });
    return;
  }

  const json = await apiRes.json();

  const cookies = cookieParser.parse(apiRes.headers.getSetCookie());

  const authCookie = cookies.find(i => i.name === "auth");
  return res.send({
    ok: true,
    data: {
      auth: {
        value: authCookie.value,
        expires: authCookie.expires?.toISOString()
      },
      nextStep: json?.requiresTwoFactorAuth || []
    }
  });
});

app.post("/api/vrc/auth/step2", async (req, res) => {

  const authCookie = req.body.authCookie;
  const code = req.body.code;
  const type = req.body.type?.toLowerCase();

  if (!authCookie || !code || !["totp", "otp", "emailotp"].includes(type)) {
    return res.status(400).send({ ok: false, error: "Missing authCookie, code or invalid type." });
  }

  const apiRes = await fetch(
    `https://vrchat.com/api/1/auth/twofactorauth/${type}/verify`,
    {
      method: "POST",
      headers: {
        "cookie": `auth=${authCookie}`,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify({ code })
    }
  );

  if (!apiRes.ok) {
    let t = await apiRes.text();
    console.error("Failed to authenticate", t);
    res.status(apiRes.status).send({ ok: false, error: t });
    return;
  }

  const cookies = cookieParser.parse(apiRes.headers.getSetCookie());

  const twoFactorAuthCookie = cookies.find(i => i.name === "twoFactorAuth");
  return res.send({
    ok: true,
    data: {
      twoFactorAuth: {
        value: twoFactorAuthCookie.value,
        expires: twoFactorAuthCookie.expires?.toISOString()
      }
    }
  });
});

const userResponseCache = new Map();

app.post("/api/vrc/user", async (req, res) => {
  const vrChatCookie = req.body.cookie;

  if (req.query.access_key !== CONFIG.access_key) {
    return res.status(403).send({ ok: false, error: "Invalid access key" });
  }

  if (userResponseCache.has(vrChatCookie)) {
    return res.send({ ok: true, data: userResponseCache.get(vrChatCookie) });
  }

  const apiRes = await fetch(
    "https://vrchat.com/api/1/auth/user",
    {
      headers: {
        "cookie": vrChatCookie,
        "user-agent": USER_AGENT,
      }
    }
  );

  if (!apiRes.ok) {
    let t = await apiRes.text();
    console.error("Failed to fetch user", t);
    res.status(apiRes.status).send({ ok: false, error: t });
    return;
  }

  const json = await apiRes.json();

  userResponseCache.set(vrChatCookie, json);
  return res.send({ ok: true, data: json });
});

setInterval(() => {
  userResponseCache.clear();
}, 60000 * 10);

app.listen(parseInt(process.env.PORT || CONFIG.http.port || 3000), () => {
  console.log(`http://localhost:${process.env.PORT || CONFIG.http.port || 3000}/app`);
});