/**
 * The view's one first-party script (node P2-N037; the specification of
 * P2-N028, section 3, "The view updates itself"). Served at
 * `VIEW_APP_SCRIPT_PATH` by its own route, loaded with `defer` from
 * `<head>` (src/view/html.ts, `pageShell`), so this module keeps
 * running across a body replacement.
 *
 * What it does, on a page whose header carries `data-live="true"`:
 *
 * - Polls `GET /view/version` every 20 seconds while the tab is
 *   visible, and once more when the tab becomes visible again.
 * - When the answered SHA differs from the page's own `data-sha`, it
 *   re-fetches the current page (same path and query) and replaces
 *   `<body>`'s content with the fetched page's, keeping the scroll
 *   position and which `<details>` the owner had open or closed.
 * - Unless a text field on the page holds text the owner typed and
 *   has not sent: then it shows "The plan changed" with an "Update"
 *   button instead, and the owner's typed text is kept until they
 *   click it.
 *
 * A page read at a named ref (`data-live="false"`) never polls: it
 * shows that commit (section 3, "A page read at a named ref does not
 * update"). Without this script every page still works exactly as it
 * did before this node: the one addition is what runs on top.
 */

export const VIEW_APP_SCRIPT = `(function () {
  "use strict";

  var POLL_MS = 20000;
  var TEXT_FIELDS = 'input[type="text"], input:not([type]), textarea';

  function isLive() {
    var header = document.querySelector("header[data-live]");
    return !!header && header.getAttribute("data-live") === "true";
  }

  function currentSha() {
    var el = document.querySelector("[data-sha]");
    return el ? el.textContent.trim() : null;
  }

  function hasTypedText() {
    var fields = document.querySelectorAll(TEXT_FIELDS);
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].value.trim() !== "") return true;
    }
    return false;
  }

  /** Every node's own \`<details>\`, open or not, keyed by its \`li\`'s
   * \`data-node\` (the fold state the owner has, not the server's
   * default). */
  function detailsState() {
    var state = {};
    var all = document.querySelectorAll("li[data-node] > details");
    for (var i = 0; i < all.length; i++) {
      var li = all[i].parentElement;
      var id = li && li.getAttribute("data-node");
      if (id) state[id] = all[i].open;
    }
    return state;
  }

  function restoreDetailsState(state) {
    var all = document.querySelectorAll("li[data-node] > details");
    for (var i = 0; i < all.length; i++) {
      var li = all[i].parentElement;
      var id = li && li.getAttribute("data-node");
      if (id && Object.prototype.hasOwnProperty.call(state, id)) {
        all[i].open = state[id];
      }
    }
  }

  function showChangedBanner() {
    if (document.querySelector("[data-plan-changed]")) return;
    var main = document.querySelector("main");
    if (!main) return;
    var p = document.createElement("p");
    p.className = "committed";
    p.setAttribute("data-plan-changed", "");
    p.appendChild(document.createTextNode("The plan changed. "));
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = "Update";
    button.addEventListener("click", function () {
      replacePage(true);
    });
    p.appendChild(button);
    main.insertBefore(p, main.firstChild);
  }

  function replacePage(force) {
    if (!force && hasTypedText()) {
      showChangedBanner();
      return;
    }
    var scrollX = window.scrollX;
    var scrollY = window.scrollY;
    var folds = detailsState();
    fetch(location.pathname + location.search, {
      credentials: "same-origin",
    })
      .then(function (res) {
        if (!res.ok) throw new Error("fetch failed");
        return res.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        document.title = doc.title;
        document.body.innerHTML = doc.body.innerHTML;
        restoreDetailsState(folds);
        window.scrollTo(scrollX, scrollY);
      })
      .catch(function () {
        // Left as it was; the next poll tries again.
      });
  }

  function poll() {
    if (!isLive()) return;
    fetch("/view/version", { credentials: "same-origin" })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        var sha = currentSha();
        if (data && data.sha && sha && data.sha !== sha) {
          replacePage(false);
        }
      })
      .catch(function () {
        // Network error: the next tick tries again.
      });
  }

  if (isLive()) {
    window.setInterval(function () {
      if (document.visibilityState === "visible") poll();
    }, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") poll();
    });
  }
})();
`;
