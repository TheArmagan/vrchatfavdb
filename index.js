const express = require("express");
const app = express();
const fs = require("fs");
const path = require("path");
const aaq = require("async-and-quick");
const mime = require("mime");

const PUBLIC_DIR = path.join(__dirname, "public");
const AVATARS_DIR = path.join(PUBLIC_DIR, "avatars");
const AVATAR_IMAGES_DIR = path.join(PUBLIC_DIR, "avatar_images");
const EXTRAS_DIR = path.join(PUBLIC_DIR, "extras");

const ACCESS_KEY = fs.readFileSync(path.join(__dirname, "access_key.txt"), "utf8").trim();

[
  PUBLIC_DIR,
  AVATARS_DIR,
  EXTRAS_DIR,
  AVATAR_IMAGES_DIR
].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.static(PUBLIC_DIR));
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
  console.log("Downloaded file", url, dest);
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

  let oldCount = cachedAvatars.length;

  let resAvatars = [];
  let fetchedAt = new Date().toISOString();
  await aaq.quickForEach(avatars, async (avatar) => {
    const avatarImagesDir = path.join(AVATAR_IMAGES_DIR, avatar.id);
    if (!fs.existsSync(avatarImagesDir)) await fs.promises.mkdir(avatarImagesDir, { recursive: true });
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
      downloadFile(avatar.imageUrl, path.join(avatarImagesDir, "image.png")),
      fs.promises.writeFile(path.join(AVATARS_DIR, `${avatar.id}.json`), JSON.stringify(obj, null, 2))
    ]);
  });

  await fs.promises.writeFile(path.join(EXTRAS_DIR, `last_import_date.json`), JSON.stringify({ value: fetchedAt }, null, 2));

  await updateAvatarsCache();

  const diff = cachedAvatars.length - oldCount;

  console.log("Imported avatars", diff);

  return res.send({ ok: true, data: diff });
});

app.get("/api/favs", async (req, res) => {
  const search = req.query.search?.trim()?.toLowerCase();
  if (!search) return res.send({ ok: true, data: cachedAvatars });

  return res.send({
    ok: true,
    data: cachedAvatars.filter(i => i.avatar.search_index.includes(search))
  });
});

app.get("/api/avatars/:id", async (req, res) => {
  const avatar = cachedAvatars.find(i => i.avatar.id === req.params.id);
  if (!avatar) return res.status(404).send({ ok: false });
  return res.send({ ok: true, data: avatar });
});

app.delete("/api/avatars/:id", async (req, res) => {
  const avatar = cachedAvatars.find(i => i.avatar.id === req.params.id);
  if (!avatar) return res.status(404).send({ ok: false });

  if (req.query.access_key !== ACCESS_KEY) {
    return res.status(403).send({ ok: false, error: "Invalid access key" });
  }

  await fs.promises.rm(path.join(AVATARS_DIR, `${avatar.avatar.id}.json`), { recursive: true }).catch(() => { });
  await fs.promises.rm(path.join(AVATAR_IMAGES_DIR, avatar.avatar.id), { recursive: true }).catch(() => { });

  await updateAvatarsCache();

  return res.send({ ok: true });
});

app.post("/api/avatars/:id/upload-image", async (req, res) => {
  const avatar = cachedAvatars.find(i => i.avatar.id === req.params.id);
  if (!avatar) return res.status(404).send({ ok: false });

  if (req.query.access_key !== ACCESS_KEY) {
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

app.listen(3000, () => {
  console.log("http://localhost:3000/app");
});