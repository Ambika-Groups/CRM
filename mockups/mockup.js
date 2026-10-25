/*
 * Ambika Group CRM mockups: shared shell (navigation, top bar, theme switch), icons and small
 * interactions. Mockup-only code; the Phase 1 app implements the same behaviour in React.
 *
 * A page declares: <body data-page="dashboard" data-title="Home" data-crumbs="Home|Projects"
 *   data-role="owner"> and puts its content in <main class="content">.
 * ?theme=light|dark overrides the stored theme (used for screenshots).
 */
(function () {
  "use strict";

  // ---------- icons (Lucide-style line icons, square caps to match the brand) ----------
  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
    folder: '<path d="M3 5h6l2 2h10v13H3z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.2c2.1.7 3.5 2.8 3.5 5.8"/>',
    receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    package: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    contact: '<rect x="3" y="4" width="18" height="16"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17c.6-1.8 2-2.8 3.5-2.8s2.9 1 3.5 2.8M15 9h3M15 13h3"/>',
    file: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h7"/>',
    signature: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M8.5 17c1.5-3 2.5-3 3 0s1.5 1 3-1 1.5 1 2.5 1"/>',
    calculator: '<rect x="5" y="2" width="14" height="20"/><path d="M8 6h8v4H8zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
    calendar: '<rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    truck: '<path d="M2 6h12v10H2zM14 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    building: '<rect x="5" y="3" width="14" height="18"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
    chart: '<path d="M3 3v18h18"/><path d="M8 17v-6M13 17V7M18 17v-9"/>',
    settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    grid: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    "chevron-right": '<path d="m9 6 6 6-6 6"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8"/><path d="M6 14h12v7H6z"/>',
    message: '<path d="M4 20l1.5-4A8 8 0 1 1 9 19.5z"/><path d="M9 10h.01M12 10h.01M15 10h.01"/>',
    "wifi-off": '<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M19 12.5a10 10 0 0 0-2.4-1.7M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 11 5M12 20h.01"/>',
    camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    "arrow-left": '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    pin: '<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14-5L4 8M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2M20 20v-4h-4"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    "more-v": '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    rupee: '<path d="M6 4h12M6 9h12M6 4h3a5 5 0 0 1 0 10H6l8 7"/>',
    hard: '<path d="M2 18h20M4 18v-3a8 8 0 0 1 16 0v3M10 7V4h4v3"/>',
    lock: '<rect x="4" y="11" width="16" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
  };
  function icon(name, cls) {
    return '<svg class="icon' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }
  window.agIcon = icon;

  // ---------- theme ----------
  var root = document.documentElement;
  function applyTheme(t) {
    root.setAttribute("data-theme", t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", t === "dark" ? "#121212" : "#F5F5F5");
    document.querySelectorAll("[data-theme-switch]").forEach(function (s) {
      s.setAttribute("aria-checked", t === "dark" ? "true" : "false");
      var i = s.querySelector(".ts-icon");
      if (i) i.innerHTML = icon(t === "dark" ? "moon" : "sun");
    });
  }

  // ---------- navigation ----------
  var NAV_FULL = [
    ["dashboard", "home", "Home", "index.html"],
    ["projects", "folder", "Projects", "project.html"],
    ["labour", "users", "Workers & attendance", "attendance.html"],
    ["expenses", "receipt", "Expenses", "expenses.html"],
    ["purchases", "package", "Purchases & stock", "#"],
    ["clients", "contact", "Clients & enquiries", "#"],
    ["bills", "file", "Quotes & bills", "invoice.html"],
    ["contracts", "signature", "Contracts", "contract.html"],
    ["accounts", "calculator", "Accounts", "#"],
    ["calendar", "calendar", "Calendar & tasks", "#"],
    ["machines", "truck", "Machines", "#"],
    ["properties", "building", "Properties", "#"],
    ["reports", "chart", "Reports", "#"],
    ["settings", "settings", "Settings", "#"]
  ];
  var BOTTOM = [
    ["dashboard", "home", "Home", "index.html"],
    ["labour", "users", "Attendance", "attendance.html"],
    ["expenses", "receipt", "Expenses", "expenses.html"],
    ["projects", "folder", "Projects", "project.html"],
    ["more", "grid", "More", "#"]
  ];
  // Pages under "More" on phones light up the More tab.
  var MORE_PAGES = { bills: 1, contracts: 1 };

  var USERS = {
    owner: { initials: "AM", name: "Anil Mishra", role: "Owner" },
    supervisor: { initials: "RY", name: "Ramesh Yadav", role: "Supervisor · Shiv Nagar" }
  };

  function switchHtml(cls) {
    return '<button class="theme-switch' + (cls ? " " + cls : "") + '" role="switch" aria-checked="false" data-theme-switch><span class="ts-icon">' + icon("sun") +
      '</span><span class="ts-label">Dark mode</span><span class="track"><span class="thumb"></span></span></button>';
  }

  function buildShell() {
    var b = document.body;
    var page = b.getAttribute("data-page");
    var title = b.getAttribute("data-title") || "";
    var crumbs = (b.getAttribute("data-crumbs") || title).split("|");
    var user = USERS[b.getAttribute("data-role") || "owner"];
    var supervisor = b.getAttribute("data-role") === "supervisor";
    var main = document.querySelector("main.content");

    var navItems = supervisor ? NAV_FULL.filter(function (n) { return ["dashboard", "labour", "expenses", "projects", "purchases", "calendar"].indexOf(n[0]) >= 0; }) : NAV_FULL;
    var side = '<nav class="sidenav" aria-label="Main"><div class="brand-mark"><span class="ag">AG</span><span class="name">Ambika Group</span></div><ul>' +
      navItems.map(function (n) {
        return '<li><a href="' + n[3] + '"' + (n[0] === page ? ' aria-current="page"' : "") + ">" + icon(n[1]) + "<span>" + n[2] + "</span></a></li>";
      }).join("") + "</ul></nav>";

    var bottom = '<nav class="bottom-nav" aria-label="Main">' + BOTTOM.map(function (n) {
      var cur = n[0] === page || (n[0] === "more" && MORE_PAGES[page]);
      return '<a href="' + n[3] + '"' + (cur ? ' aria-current="page"' : "") + ">" + icon(n[1]) + "<span>" + n[2] + "</span></a>";
    }).join("") + "</nav>";

    var crumbHtml = crumbs.map(function (c, i) {
      return i === crumbs.length - 1 ? '<span aria-current="page">' + c + "</span>" : '<a href="#">' + c + "</a>" + icon("chevron-right", "icon-sm");
    }).join("");

    var top = '<header class="topbar">' +
      '<span class="title">' + title + "</span>" +
      '<nav class="crumbs" aria-label="Breadcrumb">' + crumbHtml + "</nav>" +
      '<span class="search-field tb-wide" role="button" tabindex="0" aria-label="Search">' + icon("search") + '<span class="search-text">Search projects, workers, bills</span><kbd>Ctrl K</kbd></span>' +
      (supervisor ? "" : '<span class="lang-toggle tb-desk" role="group" aria-label="Language"><button aria-pressed="true">EN</button><button aria-pressed="false" class="hi">हिं</button></span>') +
      '<span class="sync-state tb-desk">' + icon("check-circle", "icon-sm") + "Synced</span>" +
      '<button class="icon-btn" aria-label="Notifications, 3 new">' + icon("bell") + "</button>" +
      // Tablet and desktop: the switch sits in the top bar. Phones: first row of the ⋮ menu (brand.md v2.2).
      switchHtml("tb-wide") +
      '<button class="avatar-btn tb-wide" aria-label="Profile and settings"><span class="avatar">' + user.initials + '</span><span class="who"><b>' + user.name + "</b>" + user.role + "</span></button>" +
      '<span class="overflow-wrap tb-narrow"><button class="icon-btn" aria-label="More: dark mode, search, language, profile" aria-haspopup="menu" aria-expanded="false" data-overflow>' + icon("more-v") + "</button>" +
      '<div class="overflow-menu" role="menu" hidden>' +
        '<div class="om-row om-phone" role="none">' + switchHtml("") + "</div>" +
        '<button class="om-row" role="menuitem">' + icon("search") + "Search</button>" +
        (supervisor ? "" : '<div class="om-row" role="none">' + icon("info") + 'Language<span class="lang-toggle" role="group" aria-label="Language" style="margin-left:auto"><button aria-pressed="true">EN</button><button aria-pressed="false" class="hi">हिं</button></span></div>') +
        '<div class="om-row om-tablet" role="none">' + icon("check-circle") + "Synced: everything is saved</div>" +
        '<button class="om-row" role="menuitem"><span class="avatar">' + user.initials + "</span><span><b>" + user.name + '</b><br><span class="caption">' + user.role + " · Profile and theme settings</span></span></button>" +
      "</div></span>" +
      "</header>";

    var wrap = document.createElement("div");
    wrap.className = "app";
    wrap.innerHTML = side + '<div class="main">' + top + "</div>";
    var before = document.querySelector("[data-before-content]");
    if (before) wrap.querySelector(".main").appendChild(before);
    wrap.querySelector(".main").appendChild(main);
    b.insertBefore(wrap, b.firstChild);
    b.insertAdjacentHTML("beforeend", bottom);
  }

  // ---------- helpers for pages ----------
  window.agMoney = function (rupees, opts) {
    opts = opts || {};
    var neg = rupees < 0; rupees = Math.abs(rupees);
    var whole = Math.floor(rupees + 1e-9), paise = Math.round((rupees - whole) * 100);
    var s = String(whole), last3 = s.slice(-3), rest = s.slice(0, -3);
    if (rest) last3 = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
    var out = "₹" + last3 + (opts.paise || paise ? "." + String(paise).padStart(2, "0") : "");
    return (neg ? "−" : "") + out;
  };

  // Ring charts (donut / sunburst). Segments are separated by a 2 px surface-coloured gap
  // (design-tokens §4) and every segment is labelled in an adjacent legend.
  function arc(cx, cy, r0, r1, a0, a1) {
    var large = a1 - a0 > Math.PI ? 1 : 0;
    function pt(r, a) { return (cx + r * Math.sin(a)).toFixed(2) + " " + (cy - r * Math.cos(a)).toFixed(2); }
    if (a1 - a0 >= 2 * Math.PI - 1e-6) a1 = a0 + 2 * Math.PI - 1e-4;
    return "M" + pt(r1, a0) + " A" + r1 + " " + r1 + " 0 " + large + " 1 " + pt(r1, a1) +
      " L" + pt(r0, a1) + " A" + r0 + " " + r0 + " 0 " + large + " 0 " + pt(r0, a0) + "Z";
  }
  // rings: [{ r0, r1, segments: [{ value, color, start?, label }] }]; start/total let an outer
  // ring cover only part of the circle (drill-down under one parent).
  window.agRings = function (rings, size, centre) {
    var c = size / 2, out = '<svg viewBox="0 0 ' + size + " " + size + '" width="100%" style="max-width:' + size + 'px" role="img" aria-label="' + (centre && centre.aria || "Chart") + '">';
    rings.forEach(function (ring) {
      var total = ring.total || ring.segments.reduce(function (s, x) { return s + x.value; }, 0);
      var a = ring.from || 0, span = ring.span || 2 * Math.PI;
      ring.segments.forEach(function (sg) {
        var a1 = a + span * sg.value / total;
        out += '<path d="' + arc(c, c, ring.r0, ring.r1, a, a1) + '" fill="' + sg.color + '" stroke="var(--color-surface)" stroke-width="2"><title>' + (sg.label || "") + "</title></path>";
        a = a1;
      });
    });
    if (centre) {
      out += '<text x="' + c + '" y="' + (c - 6) + '" text-anchor="middle" font-size="13" fill="var(--color-text-secondary)">' + centre.top + "</text>" +
        '<text x="' + c + '" y="' + (c + 16) + '" text-anchor="middle" font-size="18" font-weight="600" fill="var(--color-text)" style="font-variant-numeric:tabular-nums">' + centre.value + "</text>";
    }
    return out + "</svg>";
  };

  function wire() {
    document.querySelectorAll("[data-icon]").forEach(function (el) {
      el.outerHTML = icon(el.getAttribute("data-icon"), el.getAttribute("data-icon-class"));
    });
    document.querySelectorAll("[data-theme-switch]").forEach(function (s) {
      s.addEventListener("click", function () {
        var t = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
        try { localStorage.setItem("ag-theme", t); } catch (e) {}
        applyTheme(t);
      });
    });
    document.querySelectorAll("[data-open]").forEach(function (b) {
      b.addEventListener("click", function () { document.getElementById(b.getAttribute("data-open")).hidden = false; });
    });
    document.querySelectorAll("[data-overflow]").forEach(function (b) {
      var menu = b.parentElement.querySelector(".overflow-menu");
      b.addEventListener("click", function () {
        menu.hidden = !menu.hidden;
        b.setAttribute("aria-expanded", String(!menu.hidden));
      });
    });
    document.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () { document.getElementById(b.getAttribute("data-close")).hidden = true; });
    });
    document.querySelectorAll("[aria-pressed]").forEach(function (b) {
      if (b.closest(".lang-toggle")) return;
      var group = b.closest("[data-single]");
      if (!group) return;
      b.addEventListener("click", function () {
        group.querySelectorAll("[aria-pressed]").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
      });
    });
    applyTheme(root.getAttribute("data-theme") || "light");
  }

  document.addEventListener("DOMContentLoaded", function () {
    buildShell();
    wire();
    if (window.agPage) window.agPage();
    document.querySelectorAll("[data-icon]").forEach(function (el) {
      el.outerHTML = icon(el.getAttribute("data-icon"), el.getAttribute("data-icon-class"));
    });
    document.documentElement.setAttribute("data-ready", "1");
  });
})();
