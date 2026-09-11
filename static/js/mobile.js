/**
 * BeatDrop Dedicated Mobile App Engine v3.0.0
 * Handles Mobile Tab Navigation, SSE Downloads, Spotify Stereo Player, and Cookies Modal Sheet.
 */

document.addEventListener("DOMContentLoaded", () => {
  // Mobile Tab Navigation System
  const navItems = document.querySelectorAll(".mobile-bottom-nav .nav-item");
  const tabContents = document.querySelectorAll(".mobile-tab-content");

  navItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.dataset.tab;
      navItems.forEach((i) => i.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      const targetEl = document.getElementById(targetTab);
      if (targetEl) targetEl.classList.add("active");
    });
  });

  // DOM Elements
  const searchInput = document.getElementById("search-input");
  const searchButton = document.getElementById("search-button");
  const clearSearch = document.getElementById("clear-search");
  const searchLoader = document.getElementById("search-loader");
  const resultsGrid = document.getElementById("results-grid");
  const activeDownloadsList = document.getElementById("active-downloads-list");
  const noDownloads = document.getElementById("no-downloads");
  const libraryGrid = document.getElementById("library-grid");
  const libraryEmpty = document.getElementById("library-empty");
  const mixLibraryBtn = document.getElementById("mix-library");
  const refreshLibraryBtn = document.getElementById("refresh-library");
  const mobileTaskBadge = document.getElementById("mobile-task-badge");

  // Initial load
  refreshLibrary();

  // Quick Tags
  document.querySelectorAll(".tag-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      if (searchInput) {
        searchInput.value = pill.dataset.query;
        if (clearSearch) clearSearch.style.display = "block";
        triggerSearch();
      }
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      if (clearSearch) clearSearch.style.display = searchInput.value ? "block" : "none";
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") triggerSearch();
    });
  }

  if (clearSearch) {
    clearSearch.addEventListener("click", () => {
      searchInput.value = "";
      clearSearch.style.display = "none";
      searchInput.focus();
    });
  }

  if (searchButton) searchButton.addEventListener("click", triggerSearch);
  if (refreshLibraryBtn) refreshLibraryBtn.addEventListener("click", refreshLibrary);
  if (mixLibraryBtn) mixLibraryBtn.addEventListener("click", createDjMix);

  // Search Engine
  async function triggerSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    searchLoader.style.display = "flex";
    resultsGrid.style.display = "none";
    resultsGrid.innerHTML = "";

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      searchLoader.style.display = "none";

      if (response.ok) {
        if (!data.length) {
          resultsGrid.innerHTML = '<div class="empty-state"><p>No search results found.</p></div>';
        } else {
          renderSearchResults(data);
        }
        resultsGrid.style.display = "flex";
      } else {
        showToast(data.error || "Search failed.", "error");
      }
    } catch (err) {
      searchLoader.style.display = "none";
      showToast("Network error fetching search results.", "error");
    }
  }

  function renderSearchResults(results) {
    results.forEach((video) => {
      const card = document.createElement("div");
      card.className = "video-card";
      card.innerHTML = `
        <div class="thumbnail-container">
          <img src="${video.thumbnail}" class="video-thumbnail" alt="${video.title}" loading="lazy" />
          <span class="video-duration">${formatDuration(video.duration)}</span>
        </div>
        <div class="video-details">
          <h3 class="video-title">${video.title}</h3>
          <span class="video-uploader">${video.uploader}</span>
          <div class="download-actions">
            <button class="btn-primary dl-audio-btn"><i class="fa-solid fa-music"></i> Audio (MP3)</button>
            <button class="btn-secondary dl-video-btn"><i class="fa-solid fa-video"></i> Video (MP4)</button>
          </div>
        </div>
      `;
      card.querySelector(".dl-audio-btn").addEventListener("click", () => startDownload(video.url, "audio"));
      card.querySelector(".dl-video-btn").addEventListener("click", () => startDownload(video.url, "video"));
      resultsGrid.appendChild(card);
    });
  }

  // SSE Downloader
  function startDownload(url, mode) {
    if (noDownloads) noDownloads.style.display = "none";
    const taskId = "task-" + Date.now();

    const taskCard = document.createElement("div");
    taskCard.className = "download-task-card";
    taskCard.id = taskId;
    taskCard.innerHTML = `
      <div class="task-info">
        <h4 class="task-title">Preparing download...</h4>
        <span class="task-status">Connecting...</span>
      </div>
      <div class="progress-bar-container"><div class="progress-bar-fill"></div></div>
    `;
    activeDownloadsList.appendChild(taskCard);
    updateTaskBadge();

    // Switch to Tasks Tab on mobile
    const tasksNavBtn = document.querySelector('.nav-item[data-tab="tab-tasks"]');
    if (tasksNavBtn) tasksNavBtn.click();

    const sseUrl = `/api/download?url=${encodeURIComponent(url)}&mode=${mode}&task_id=${encodeURIComponent(taskId)}`;
    const eventSource = new EventSource(sseUrl);

    const titleEl = taskCard.querySelector(".task-title");
    const statusEl = taskCard.querySelector(".task-status");
    const fillBar = taskCard.querySelector(".progress-bar-fill");

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status === "starting") {
        if (data.title) titleEl.textContent = data.title;
        statusEl.textContent = "Downloading...";
      } else if (data.status === "downloading") {
        fillBar.style.width = `${data.percent}%`;
        statusEl.textContent = `${data.percent}% (${data.downloaded_formatted})`;
      } else if (data.status === "processing") {
        fillBar.style.width = "100%";
        statusEl.textContent = "Processing audio format...";
      } else if (data.status === "completed") {
        statusEl.textContent = "Download Complete!";
        showToast(`Saved to Library: ${data.title}`, "success");
        eventSource.close();
        refreshLibrary();
        setTimeout(() => {
          taskCard.remove();
          updateTaskBadge();
        }, 3000);
      } else if (data.status === "error") {
        statusEl.textContent = `Error: ${data.message}`;
        showToast(data.message, "error");
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      if (eventSource.readyState !== EventSource.CONNECTING) {
        eventSource.close();
        refreshLibrary();
        setTimeout(() => {
          taskCard.remove();
          updateTaskBadge();
        }, 3000);
      }
    };
  }

  function updateTaskBadge() {
    const cards = activeDownloadsList.querySelectorAll(".download-task-card");
    if (mobileTaskBadge) {
      mobileTaskBadge.textContent = cards.length;
      mobileTaskBadge.style.display = cards.length > 0 ? "inline-block" : "none";
    }
  }

  // Library Engine
  async function refreshLibrary() {
    try {
      const response = await fetch("/api/library");
      if (!response.ok) return;
      const files = await response.json();
      libraryGrid.innerHTML = "";

      if (!files.length) {
        if (libraryEmpty) libraryEmpty.style.display = "flex";
      } else {
        if (libraryEmpty) libraryEmpty.style.display = "none";
        renderLibrary(files);
      }
      if (window.MobilePlayer) window.MobilePlayer.setSongs(files);
    } catch (e) { console.error("Library fetch error", e); }
  }

  function renderLibrary(files) {
    files.forEach((file) => {
      const card = document.createElement("div");
      card.className = "library-card";
      const displayTitle = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;

      card.innerHTML = `
        <div class="library-info">
          <h4 class="video-title">${displayTitle}</h4>
          <span class="video-uploader">${file.type.toUpperCase()} · ${file.size}</span>
        </div>
        <div class="download-actions">
          <button class="btn-primary btn-play"><i class="fa-solid fa-play"></i> Play</button>
          <button class="btn-danger btn-delete"><i class="fa-solid fa-trash-can"></i> Delete</button>
        </div>
      `;

      card.querySelector(".btn-play").addEventListener("click", () => {
        if (window.MobilePlayer) window.MobilePlayer.playByName(file.name);
        const playerNavBtn = document.querySelector('.nav-item[data-tab="tab-player"]');
        if (playerNavBtn) playerNavBtn.click();
      });

      card.querySelector(".btn-delete").addEventListener("click", async () => {
        if (confirm(`Delete "${displayTitle}"?`)) {
          await fetch(`/api/delete/${encodeURIComponent(file.name)}`, { method: "DELETE" });
          refreshLibrary();
        }
      });

      libraryGrid.appendChild(card);
    });
  }

  async function createDjMix() {
    showToast("DJ Mix feature active in Library!", "info");
  }

  // Spotify Player Module
  const MobilePlayer = (function() {
    const songListEl = document.getElementById("song-list");
    const npTitle = document.getElementById("np-title");
    const npArtist = document.getElementById("np-artist");
    const npPlayBtn = document.getElementById("np-play");
    const npPlayIcon = document.getElementById("np-play-icon");

    let songs = [];
    let currentIdx = -1;
    let audio = new Audio();

    function setSongs(list) {
      songs = (list || []).filter(s => s.type === "audio");
      renderSongList();
    }

    function renderSongList() {
      if (!songListEl) return;
      songListEl.innerHTML = "";
      songs.forEach((s, idx) => {
        const row = document.createElement("div");
        row.className = "song-row" + (idx === currentIdx ? " playing" : "");
        const title = s.name.substring(0, s.name.lastIndexOf(".")) || s.name;
        row.innerHTML = `
          <div class="song-art"><i class="fa-solid fa-compact-disc"></i></div>
          <div class="song-meta">
            <div class="song-title">${title}</div>
            <div class="song-sub">${s.size}</div>
          </div>
        `;
        row.addEventListener("click", () => playIndex(idx));
        songListEl.appendChild(row);
      });
    }

    function playIndex(idx) {
      if (idx < 0 || idx >= songs.length) return;
      currentIdx = idx;
      const s = songs[idx];
      audio.src = `/api/play/${encodeURIComponent(s.name)}`;
      audio.play().catch(e => console.log("Autoplay blocked:", e));

      const title = s.name.substring(0, s.name.lastIndexOf(".")) || s.name;
      if (npTitle) npTitle.textContent = title;
      if (npArtist) npArtist.textContent = "Local Collection";
      if (npPlayIcon) npPlayIcon.className = "fa-solid fa-pause";
      renderSongList();
    }

    function playByName(filename) {
      const idx = songs.findIndex(s => s.name === filename);
      if (idx !== -1) playIndex(idx);
    }

    if (npPlayBtn) {
      npPlayBtn.addEventListener("click", () => {
        if (!audio.src && songs.length) { playIndex(0); return; }
        if (audio.paused) {
          audio.play();
          if (npPlayIcon) npPlayIcon.className = "fa-solid fa-pause";
        } else {
          audio.pause();
          if (npPlayIcon) npPlayIcon.className = "fa-solid fa-play";
        }
      });
    }

    audio.addEventListener("ended", () => {
      if (currentIdx + 1 < songs.length) playIndex(currentIdx + 1);
    });

    return { setSongs, playIndex, playByName };
  })();

  window.MobilePlayer = MobilePlayer;

  // Cookies Modal Sheet
  const cookiesModal = document.getElementById("cookies-modal");
  const mobileCookiesBtn = document.getElementById("mobile-cookies-btn");
  const closeCookiesBtn = document.getElementById("close-cookies-modal");
  const saveCookiesBtn = document.getElementById("save-cookies-btn");
  const cookiesTextarea = document.getElementById("cookies-textarea");

  if (mobileCookiesBtn) mobileCookiesBtn.addEventListener("click", () => { cookiesModal.style.display = "flex"; });
  if (closeCookiesBtn) closeCookiesBtn.addEventListener("click", () => { cookiesModal.style.display = "none"; });

  if (saveCookiesBtn) {
    saveCookiesBtn.addEventListener("click", async () => {
      const text = cookiesTextarea.value.trim();
      if (!text) return showToast("Paste Netscape cookies text first.", "error");
      const res = await fetch("/api/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: text })
      });
      if (res.ok) {
        showToast("Cookies saved!", "success");
        cookiesModal.style.display = "none";
      }
    });
  }

  // Service Worker Registration
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // Toast Helper
  function showToast(msg, type = "info") {
    const region = document.getElementById("toast-region");
    if (!region) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    region.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  function formatDuration(sec) {
    if (!sec) return "--:--";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
});
