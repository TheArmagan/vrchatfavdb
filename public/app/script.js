
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

async function updateAvatars(search = "") {
  const avatars = (await fetch(`/api/favs${search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`).then(res => res.json())).data;
  avatarList.innerHTML = "";
  document.querySelector("#avatar-count").textContent = avatars.length;
  avatars.forEach(avatar => {
    const avatarElement = parseHTML(`<div class="avatar-item">
      <div class="image" style="background-image: url('/avatars/${avatar.id}/image.png');"></div>
      <div class="info">
        <h3>${avatar.name} by ${avatar.author.name}</h3>
        <p>${avatar.description}</p>
        <p>${avatar.tags.join(", ")}</p>
        <div class="notes">
          <p class="note">${avatar.note}</p>
          <p class="note">${avatar.id}</p>
        </div>
      </div>
      <button class="delete-button small">Delete</button>
      <button class="select-button">Select</button>
    </div>`);

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

  if (res.ok) {
    alert("Imported successfully");
    updateAvatars();
    updateImportDate();
  } else {
    let j = await res.json();
    alert("Failed to import error: " + j.error);
  }
});

document.querySelector("#avatars-search-input").addEventListener("input", debounce(async (e) => {
  updateAvatars(e.target.value);
}, 500));