const app = window.app = Vue.createApp({
  data() {
    return {
      avatars: [],
      totalAvatars: 0,
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
    getCookie() {
      return localStorage.getItem("VRCFAVDB;Cookie") || "";
    },
    getAccessKey() {
      return localStorage.getItem("VRCFAVDB;AccessKey") || "";
    },
    async updateAvatars() {
      this.searching = true;
      let search = this.search;
      this.avatars = [];
      let { avatars, total_count } = (await fetch(`/api/favs${search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`).then(res => res.json())).data;

      this.totalAvatars = total_count;

      switch (this.extraAvatarsFilters) {
        case "without_uploaded_image": {
          avatars = avatars.filter(i => !i.images.has_uploaded_image);
          break;
        }
        case "with_uploaded_image": {
          avatars = avatars.filter(i => i.images.has_uploaded_image);
          break;
        }
      }

      this.avatars = avatars;
      this.searching = false;
    },
    debouncedUpdateAvatars: debounce(function () {
      this.updateAvatars();
    }, 500),
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
        localStorage.setItem("VRCFAVDB;Cookie", value);
      },
      accessKey(value) {
        localStorage.setItem("VRCFAVDB;AccessKey", value);
      }
    },
    mounted() {
      this.cookie = localStorage.getItem("VRCFAVDB;Cookie") || "";
      this.accessKey = localStorage.getItem("VRCFAVDB;AccessKey") || "";
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
        const cookie = localStorage.getItem("VRCFAVDB;Cookie");
        if (!cookie) return alert("Please enter your VRChat cookie first.");
        const accessKey = localStorage.getItem("VRCFAVDB;AccessKey");
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
        showUploaded: false
      };
    },
    mounted() {
      this.defaultShowUploaded = this.data.images.has_uploaded_image;
      this.showUploaded = this.defaultShowUploaded;
    },
    methods: {
      select() {
        window.internalApp.selectedAvatarId = this.data.avatar.id;
        this.showUploaded = this.defaultShowUploaded;
      },
      async copyId() {
        await navigator.clipboard.writeText(this.data.avatar.id);
        alert("Avatar Id copied!");
      },
      uploadImage() {
        const accessKey = localStorage.getItem("VRCFAVDB;AccessKey");
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
        const accessKey = localStorage.getItem("VRCFAVDB;AccessKey");
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
        const cookie = localStorage.getItem("VRCFAVDB;Cookie");
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