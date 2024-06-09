function parseHTML(html) {
  const template = document.createElement('div');
  template.innerHTML = html;
  return template.firstElementChild;
}

function getContainer() {
  let container = document.querySelector("#toast-container");
  if (!container) {
    container = document.createElement('div');
    container.id = "toast-container";
    document.body.prepend(container);
  }
  return container;
}

function show(content, timeout = 10000) {
  let toastElm = parseHTML(`
    <div class="toast">
      <div class="content">${content}</div>
      <div class="close">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path fill="currentColor" d="M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093L13.4139 12.0007L18.3637 16.9504L16.9495 18.3646L11.9997 13.4149L7.04996 18.3646L5.63574 16.9504L10.5855 12.0007L5.63574 7.05093L7.04996 5.63672L11.9997 10.5865Z"></path>
        </svg>
      </div>
    </div>
  `);

  let container = getContainer();
  container.prepend(toastElm);

  requestAnimationFrame(() => {
    toastElm.classList.add("visible");
  });

  let close = toastElm.querySelector(".close");
  close.addEventListener("click", () => {
    toastElm.classList.remove("visible");
    setTimeout(() => {
      toastElm.remove();
    }, 150);
  });

  if (timeout) {
    setTimeout(() => {
      toastElm.classList.remove("visible");
      setTimeout(() => {
        toastElm.remove();
      }, 150);
    }, timeout);
  }

  return toastElm;
}

window.Toast = {
  show
};

(() => {
  const params = new URLSearchParams(location.search);
  if (params.has("__toasts")) {
    let toasts = JSON.parse(params.get("__toasts"));
    toasts.forEach(toast => {
      if (typeof toast === "string") return Toast.show(toast);
      Toast.show(toast.content, toast.timeout);
    });
    params.delete("__toasts");
    window.history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  }
})();