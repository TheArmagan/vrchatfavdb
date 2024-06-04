const LS_COOKIE = "VRCFAVDB;App;Cookie";
const LS_ACCESS_KEY = "VRCFAVDB;App;AccessKey";

const app = window.app = Vue.createApp({
  data() {
    return {
      avatars: [],
      search: "",
      selectedAvatar: null,
      selectedControlsTab: "",
      extraAvatarsFilters: "all",
      searching: true,
      selectedAvatarId: ""
    };
  },
  mounted() {
    window.internalApp = this;
    this.updateAvatars();
  },
  methods: {
    async updateAvatars() {
      this.searching = true;
      this.avatars = [];
      let avatars = (await fetch("/api/favs").then(res => res.json())).data;
      this.avatars = avatars;
      this.searching = false;
    },
  },
  computed: {
    searchedAvatars() {
      let avatars = this.avatars.slice();
      let search = this.search.trim().toLowerCase().split(/ +?/).map(i => ({
        negative: i.startsWith("-"),
        value: i.replace(/^-/, "")
      })).filter(i => i.value.trim());
      if (search.length) {
        avatars = avatars.filter(i => {
          return search.every(s => {
            return i.avatar.search_index.includes(s.value) !== s.negative;
          });
        });
      }

      switch (this.extraAvatarsFilters) {
        case "without_uploaded_image": {
          avatars = avatars.filter(i => !i.images.has_uploaded_image);
          break;
        }
        case "with_uploaded_image": {
          avatars = avatars.filter(i => i.images.has_uploaded_image);
          break;
        }
        case "without_note": {
          avatars = avatars.filter(i => !i.avatar.note);
          break;
        }
        case "with_note": {
          avatars = avatars.filter(i => i.avatar.note);
          break;
        }
      }

      return avatars;
    }
  }
});

const componentScripts = {
  "settings-tab": {
    data() {
      return {
        cookie: "",
        accessKey: ""
      };
    },
    watch: {
      cookie(value) {
        localStorage.setItem(LS_COOKIE, value);
      },
      accessKey(value) {
        localStorage.setItem(LS_ACCESS_KEY, value);
      }
    },
    mounted() {
      this.cookie = localStorage.getItem(LS_COOKIE) || "";
      this.accessKey = localStorage.getItem(LS_ACCESS_KEY) || "";
    },
    methods: {
      copyCookie() {
        navigator.clipboard.writeText(this.cookie);
        alert("Cookie copied!");
      }
    }
  },
  "import-tab": {
    data() {
      return {
        lastImportDateString: "Loading...",
        note: "",
        loading: false
      };
    },
    mounted() {
      this.updateImportDate();
    },
    methods: {
      async updateImportDate() {
        let data = (await fetch("/api/extras/last-import-date").then(res => res.json())).data;
        this.lastImportDateString = data ? new Date(data).toLocaleString() : "Never imported";
      },
      async importAvatars() {
        const cookie = localStorage.getItem(LS_COOKIE);
        if (!cookie) return alert("Please enter your VRChat cookie first.");
        const accessKey = localStorage.getItem(LS_ACCESS_KEY);
        if (!accessKey) return alert("Please enter your access key first.");

        const note = this.note;

        this.loading = true;
        const res = await fetch(`/api/favs/import?access_key=${encodeURIComponent(accessKey)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ cookie, note })
        });

        this.loading = false;
        let json = await res.json();
        if (!res.ok) return alert(`Failed to import avatars: ${json.error}`);

        alert(`Success fully added new ${json.data} avatars!`);
        window.internalApp.updateAvatars();
        this.updateImportDate();
      }
    }
  },
  "avatar-model": {
    props: ["data", "selected"],
    data() {
      return {
        loading: false,
        defaultShowUploaded: false,
        showUploaded: false,
        extended: false,
        note: ""
      };
    },
    mounted() {
      this.defaultShowUploaded = this.data.images.has_uploaded_image;
      this.showUploaded = this.defaultShowUploaded;
      this.note = this.data.avatar.note || "";
    },
    methods: {
      select() {
        window.internalApp.selectedAvatarId = this.data.avatar.id;
        this.showUploaded = this.defaultShowUploaded;
      },
      async saveNote() {
        const accessKey = localStorage.getItem(LS_ACCESS_KEY);
        if (!accessKey) return alert("Please enter your access key first.");

        const res = await fetch(`/api/avatars/${this.data.avatar.id}?access_key=${encodeURIComponent(accessKey)}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ note: this.note })
        });

        let json = await res.json();
        if (!res.ok) {
          alert(`Failed to save note: ${json.error || "Unknown error"}`);
          return;
        }

        let av = window.internalApp.avatars.find(i => i.avatar.id === this.data.avatar.id);
        if (av) {
          av.avatar.note = json.data.note;
          av.avatar.search_index = json.data.search_index;
        }

        alert("Note saved successfully!");
      },
      async copyId() {
        await navigator.clipboard.writeText(this.data.avatar.id);
        alert("Avatar Id copied!");
      },
      uploadImage() {
        const accessKey = localStorage.getItem(LS_ACCESS_KEY);
        if (!accessKey) return alert("Please enter your access key first.");

        if (!confirm("Do you really want to upload image?")) return;

        const avatarId = this.data.avatar.id;

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png";
        input.onchange = async () => {
          if (!input.files[0]) return;

          const base64 = await fileToBase64(input.files[0]);

          const res = await fetch(`/api/avatars/${avatarId}/upload-image?access_key=${encodeURIComponent(accessKey)}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ image: base64 })
          });

          let json = await res.json();
          if (!res.ok) {
            alert(`Failed to upload image: ${json.error}`);
            return;
          }

          alert("Image uploaded successfully!");
          window.internalApp.updateAvatars();
        };
        input.click();
      },
      async deleteAvatar() {
        const accessKey = localStorage.getItem(LS_ACCESS_KEY);
        if (!accessKey) return alert("Please enter your access key first.");

        if (!confirm("Do you really want to delete image?")) return;

        const avatarId = this.data.avatar.id;

        const res = await fetch(`/api/avatars/${avatarId}?access_key=${encodeURIComponent(accessKey)}`, {
          method: "DELETE"
        });

        let json = await res.json();
        if (!res.ok) {
          alert(`Failed to delete avatar!`);
          return;
        }

        alert("Avatar deleted successfully!");
        window.internalApp.updateAvatars();
      },
      async selectAvatar() {
        const cookie = localStorage.getItem(LS_COOKIE);
        if (!cookie) return alert("Please enter your VRChat cookie first.");

        const res = await fetch(`/api/avatars/${this.data.avatar.id}/select`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ cookie })
        });

        const json = await res.json();

        if (!res.ok) {
          alert(`Failed to select avatar: ${json.error}`);
          return;
        }

        alert("Avatar selected successfully!");
      }
    }
  }
}

document.querySelectorAll("[component]").forEach((el) => {
  app.component(el.getAttribute("component"), {
    template: el.innerHTML,
    ...(componentScripts[el.getAttribute("component")] || {})
  });
});

app.mount("#app");

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}