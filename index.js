const express = require("express");
const app = express();
const fs = require("fs");
const path = require("path");
const aaq = require("async-and-quick");

const PUBLIC_DIR = path.join(__dirname, "public");
const AVATARS_DIR = path.join(PUBLIC_DIR, "avatars");
const EXTRAS_DIR = path.join(PUBLIC_DIR, "extras");

const ACCESS_KEY = fs.readFileSync(path.join(__dirname, "access_key.txt"), "utf8").trim();

[
  PUBLIC_DIR,
  AVATARS_DIR,
  EXTRAS_DIR
].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.static(PUBLIC_DIR));
app.use(express.json());

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error("Failed to download file", await res.text());
    return false;
  }
  await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log("Downloaded file", url, dest);
  return true;
}

let cachedAvatars = [];

async function updateAvatarsCache() {
  const avatarIds = await fs.promises.readdir(AVATARS_DIR);
  cachedAvatars = await aaq.quickMap(avatarIds, async (avatarId) => {
    return JSON.parse(await fs.promises.readFile(path.join(AVATARS_DIR, avatarId, "avatar.json"), "utf8"));
  });
  console.log("Updated avatars cache", cachedAvatars.length);
  return cachedAvatars;
}

updateAvatarsCache();

app.post("/api/favs/import", async (req, res) => {
  const vrChatCookie = req.body.cookie;
  const note = req.body.note;

  if (req.query.access_key !== ACCESS_KEY) {
    return res.status(403).send({ ok: false, error: "Invalid access key" });
  }

  const apiRes = await fetch(
    "https://vrchat.com/api/1/avatars/favorites?n=300&offset=0",
    {
      headers: {
        "cookie": vrChatCookie
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

  let resAvatars = [];
  let fetchedAt = new Date().toISOString();
  await aaq.quickForEach(avatars, async (avatar) => {
    const avatarDir = path.join(AVATARS_DIR, avatar.id);
    if (!fs.existsSync(avatarDir)) await fs.promises.mkdir(avatarDir, { recursive: true });
    let obj = {
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
      note,
      search_index: `${avatar.id} ${avatar.name} ${avatar.description} ${avatar.tags.join(" ")} ${avatar.authorName} ${note || ""} ${avatar.id} ${avatar.authorId}`.toLowerCase()
    };
    resAvatars.push(obj);
    await Promise.all([
      downloadFile(avatar.imageUrl, path.join(avatarDir, "image.png")),
      fs.promises.writeFile(path.join(avatarDir, "avatar.json"), JSON.stringify(obj, null, 2))
    ]);
  });

  await fs.promises.writeFile(path.join(EXTRAS_DIR, `last_import_date.json`), JSON.stringify({ value: fetchedAt }, null, 2));

  await updateAvatarsCache();

  return res.send({ ok: true, data: resAvatars });
});

app.get("/api/favs", async (req, res) => {
  const search = req.query.search?.trim()?.toLowerCase();
  if (!search) return res.send({ ok: true, data: cachedAvatars });

  return res.send({
    ok: true,
    data: cachedAvatars.filter(i => i.search_index.includes(search))
  });
});

app.get("/api/avatars/:id", async (req, res) => {
  const avatar = cachedAvatars.find(i => i.id === req.params.id);
  if (!avatar) return res.status(404).send({ ok: false });
  return res.send({ ok: true, data: avatar });
});

app.delete("/api/avatars/:id", async (req, res) => {
  const avatar = cachedAvatars.find(i => i.id === req.params.id);
  if (!avatar) return res.status(404).send({ ok: false });

  if (req.query.access_key !== ACCESS_KEY) {
    return res.status(403).send({ ok: false, error: "Invalid access key" });
  }

  await fs.promises.rm(path.join(AVATARS_DIR, avatar.id), { recursive: true });

  await updateAvatarsCache();

  return res.send({ ok: true });
});

app.post("/api/avatars/:id/select", async (req, res) => {
  const avatar = cachedAvatars.find(i => i.id === req.params.id);
  if (!avatar) return res.status(404).send({ ok: false });

  const vrChatCookie = req.body.cookie;

  const apiRes = await fetch(
    `https://vrchat.com/api/1/avatars/${avatar.id}/select`,
    {
      headers: {
        "cookie": vrChatCookie
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
  await updateAvatarsCache();
  return res.send({ ok: true });
});

app.get("/api/extras/last-import-date", async (req, res) => {
  const dir = path.join(EXTRAS_DIR, `last_import_date.json`);
  if (!fs.existsSync(dir)) return res.send({ ok: true, data: null });
  const lastImportDate = JSON.parse(await fs.promises.readFile(dir, "utf8"))?.value;
  return res.send({ ok: true, data: lastImportDate });
});

app.listen(3003, () => {
  console.log("http://localhost:3003/app");
});