
function parseHTML(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.cloneNode(true);
}

function debounce(func, wait) {
  let timeout;
  return function () {
    const context = this;
    const args = arguments;
    const later = function () {
      timeout = null;
      func.apply(context, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const cookieInput = document.querySelector("#cookie-input");
cookieInput.value = localStorage.getItem("vrchat-cookie") || "";
cookieInput.addEventListener("input", () => {
  localStorage.setItem("vrchat-cookie", cookieInput.value);
});

const accessKeyInput = document.querySelector("#access-key-input");
accessKeyInput.value = localStorage.getItem("vrchat-access-key") || "";
accessKeyInput.addEventListener("input", () => {
  localStorage.setItem("vrchat-access-key", accessKeyInput.value);
});

async function updateImportDate() {
  const lastImportDate = (await fetch("/api/extras/last-import-date").then(res => res.json())).data;
  document.querySelector("#last-import-date").textContent = lastImportDate ? `${((Date.now() - new Date(lastImportDate).getTime()) / 1000 / 60 / 60).toFixed(3)} hours ago imported` : "never imported";
}

const avatarList = document.querySelector("#avatar-list");

const extraAvatarsFilters = document.querySelector("#extra-avatar-filters");

extraAvatarsFilters.addEventListener("change", async () => {
  updateAvatars();
});

async function updateAvatars() {
  let search = document.querySelector("#avatars-search-input").value;
  let avatars = (await fetch(`/api/favs${search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`).then(res => res.json())).data.avatars;

  switch (extraAvatarsFilters.value) {
    case "without_uploaded_image": {
      avatars = avatars.filter(i => !i.images.has_uploaded_image);
      break;
    }
    case "with_uploaded_image": {
      avatars = avatars.filter(i => i.images.has_uploaded_image);
      break;
    }
  }

  avatarList.innerHTML = "";
  document.querySelector("#avatar-count").textContent = avatars.length;
  avatars.forEach(({ avatar, images }) => {
    const avatarElement = parseHTML(`<div class="avatar-item">
      <div class="image image-default" style="background-image: url('/avatar_images/${avatar.id}/image.png');"></div>
      ${images.has_uploaded_image ? `<div class="image image-uploaded-image" style="background-image: url('/avatar_images/${avatar.id}/uploaded_image.png');"></div>` : ""}
      <div class="info">
        <h3>${avatar.name} by ${avatar.author.name}</h3>
        <p>${avatar.description}</p>
        <p>${avatar.tags.join(", ")}</p>
        <div class="notes">
          <p class="note">${avatar.note}</p>
          <p class="note">${avatar.id}</p>
        </div>
      </div>
      <button class="upload-image small">Upload Image</button>
      <button class="delete-button small">Delete</button>
      <button class="select-button">Select</button>
    </div>`);

    avatarElement.querySelector(".upload-image").addEventListener("click", async () => {
      if (!confirm("Are you sure to change preview of this avatar.")) return;

      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png";
      input.onchange = async () => {
        if (!input.files[0]) return;

        const base64 = await fileToBase64(input.files[0]);

        const res = await fetch(`/api/avatars/${avatar.id}/upload-image?access_key=${encodeURIComponent(accessKeyInput.value)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ image: base64 })
        });

        if (res.ok) {
          alert("Image uploaded successfully");
          updateAvatars();
        } else {
          let j = await res.json();
          alert("Failed to upload image error: " + j.error);
        }
      };
      input.click();
    });

    avatarElement.querySelector(".delete-button").addEventListener("click", async () => {
      if (!confirm("Are you sure you want to delete this avatar?")) return;

      const res = await fetch(`/api/avatars/${avatar.id}?access_key=${encodeURIComponent(accessKeyInput.value)}`, {
        method: "DELETE"
      });

      if (res.ok) {
        alert("Avatar deleted successfully");
        updateAvatars();
      } else {
        let j = await res.json();
        alert("Failed to delete avatar error: " + j.error);
      }
    });

    avatarElement.querySelector(".select-button").addEventListener("click", async () => {
      const cookie = cookieInput.value;
      if (!cookie) {
        alert("Please enter a cookie");
        return;
      }

      const res = await fetch(`/api/avatars/${avatar.id}/select`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ cookie })
      });

      if (res.ok) {
        alert("Avatar selected successfully");
      } else {
        let j = await res.json();
        alert("Failed to select avatar error: " + j.error);
      }
    });
    avatarList.appendChild(avatarElement);
  });
}

updateImportDate();
updateAvatars();

document.querySelector("#import-avatars-button").addEventListener("click", async (e) => {
  const cookie = cookieInput.value;
  if (!cookie) {
    alert("Please enter a cookie");
    return;
  }

  const note = document.querySelector("#import-note").value;

  e.target.disabled = true;
  const res = await fetch(`/api/favs/import?access_key=${encodeURIComponent(accessKeyInput.value)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ cookie, note })
  });

  e.target.disabled = false;
  let j = await res.json();
  if (res.ok) {
    alert(`Imported new ${j.data} avatars successfully`);
    updateAvatars();
    updateImportDate();
  } else {
    alert("Failed to import error: " + j.error);
  }
});

document.querySelector("#avatars-search-input").addEventListener("input", debounce(async (e) => {
  updateAvatars();
}, 500));