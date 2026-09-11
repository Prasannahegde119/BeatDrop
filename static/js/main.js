/**
 * BeatDrop Frontend Application Engine
 * Orchestrates search, real-time download streaming (SSE), and media playback.
 */

document.addEventListener("DOMContentLoaded", () => {
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
  const historyList = document.getElementById("history-list");
  const historyEmpty = document.getElementById("history-empty");
  let toastRegion = document.getElementById("toast-region");
  if (!toastRegion) {
    toastRegion = document.createElement("div");
    toastRegion.id = "toast-region";
    toastRegion.className = "toast-region";
    toastRegion.setAttribute("aria-live", "polite");
    document.body.appendChild(toastRegion);
  }

  // Player Modal Elements
  const playerModal = document.getElementById("player-modal");
  const closePlayerBtn = document.getElementById("close-player");
  const modalSongTitle = document.getElementById("modal-song-title");
  const html5Video = document.getElementById("html5-video");
  const html5Audio = document.getElementById("html5-audio");
  const playerTrackIcon = document.getElementById("player-track-icon");
  // Inline player elements
  const playerQueueContainer = document.getElementById('player-queue');
  const inlineNowTitle = document.getElementById('inline-now-title');
  const inlineQueueCount = document.getElementById('inline-queue-count');
  const clearQueueBtn = document.getElementById('clear-queue');
  const inlinePlayBtn = document.getElementById('inline-play');
  const inlinePlayIcon = document.getElementById('inline-play-icon');
  const inlineNextBtn = document.getElementById('inline-next');
  const inlinePrevBtn = document.getElementById('inline-prev');
  const inlinePlayerArt = document.getElementById('inline-player-art');
  const inlineArtImg = document.getElementById('inline-art-img');
  const inlinePlayerIcon = document.getElementById('inline-player-icon');
  const volumeSlider = document.getElementById('volume-slider');
  const volumeIcon = document.getElementById('player-volume-icon');
  // Player Controls
  const playerControls = document.getElementById("player-controls");
  const playerPlayBtn = document.getElementById("player-play");
  const playerPlayIcon = document.getElementById("player-play-icon");
  const playerNextBtn = document.getElementById("player-next");
  const playerPrevBtn = document.getElementById("player-prev");
  const playerShuffleBtn = document.getElementById("player-shuffle");
  const playerRepeatBtn = document.getElementById("player-repeat");
  const queueCountEl = document.getElementById("queue-count");
  const seekSlider = document.getElementById("seek-slider");
  const timeCurrent = document.getElementById("time-current");
  const timeDuration = document.getElementById("time-duration");

  // Playback Queue State
  let playerQueue = []; // { name, type }
  let currentIndex = -1;
  let isShuffle = false;
  let repeatMode = "off"; // off | one | all
  let userSeeking = false;

  // Initialize application library data
  refreshLibrary();
  // Load download history on start
  refreshHistory();
  // MusicPlayer will initialize itself after its definition below

  // Wire Quick Filter Tag Pills
  document.querySelectorAll(".tag-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const query = pill.dataset.query;
      if (query && searchInput) {
        searchInput.value = query;
        if (clearSearch) clearSearch.style.display = "flex";
        triggerSearch();
      }
    });
  });

  // Event Listeners for Search Input
  searchInput.addEventListener("input", () => {
    clearSearch.style.display = searchInput.value ? "flex" : "none";
  });

  clearSearch.addEventListener("click", () => {
    searchInput.value = "";
    clearSearch.style.display = "none";
    searchInput.focus();
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      triggerSearch();
    }
  });

  searchButton.addEventListener("click", triggerSearch);
  refreshLibraryBtn.addEventListener("click", refreshLibrary);
  mixLibraryBtn.addEventListener("click", createDjMix);

  // Close Player Modal events
  closePlayerBtn.addEventListener("click", closePlayer);
  playerModal
    .querySelector(".modal-backdrop")
    .addEventListener("click", closePlayer);

  // Player control handlers
  playerPlayBtn.addEventListener("click", togglePlayPause);
  playerNextBtn.addEventListener("click", playNextTrack);
  playerPrevBtn.addEventListener("click", playPrevTrack);
  playerShuffleBtn.addEventListener("click", () => {
    isShuffle = !isShuffle;
    playerShuffleBtn.classList.toggle("active", isShuffle);
  });
  playerRepeatBtn.addEventListener("click", () => {
    repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
    // update icon state (simple visual cue)
    playerRepeatBtn.classList.toggle("active", repeatMode !== "off");
    playerRepeatBtn.title = `Repeat: ${repeatMode}`;
  });

  seekSlider.addEventListener("input", (e) => {
    userSeeking = true;
    const pct = Number(e.target.value);
    const media = currentMedia();
    if (!media || !media.duration || isNaN(media.duration)) return;
    const time = (pct / 100) * media.duration;
    timeCurrent.textContent = formatSecondsToTime(time);
  });

  seekSlider.addEventListener("change", (e) => {
    const pct = Number(e.target.value);
    const media = currentMedia();
    if (!media || !media.duration || isNaN(media.duration)) return;
    const time = (pct / 100) * media.duration;
    media.currentTime = time;
    userSeeking = false;
  });

  // Inline player handlers
  if (clearQueueBtn) clearQueueBtn.addEventListener('click', () => {
    playerQueue = [];
    currentIndex = -1;
    renderQueue();
    updateInlineNow();
  });
  if (inlinePlayBtn) inlinePlayBtn.addEventListener('click', togglePlayPause);
  if (inlineNextBtn) inlineNextBtn.addEventListener('click', playNextTrack);
  if (inlinePrevBtn) inlinePrevBtn.addEventListener('click', playPrevTrack);

  /**
   * Executes a search on YouTube via the Flask API
   */
  async function triggerSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    // Visual state updates
    searchLoader.style.display = "flex";
    resultsGrid.style.display = "none";
    resultsGrid.innerHTML = "";

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query)}`,
      );
      const data = await response.json();

      searchLoader.style.display = "none";

      if (response.ok) {
        if (data.length === 0) {
          resultsGrid.innerHTML = `
                        <div class="empty-state" style="grid-column: 1/-1;">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                            <p>No results found. Try adjusting your query keywords.</p>
                        </div>
                    `;
        } else {
          renderSearchResults(data);
        }
        resultsGrid.style.display = "grid";
      } else {
        showErrorMessage(data.error || "Failed to complete search query.");
      }
    } catch (error) {
      searchLoader.style.display = "none";
      showErrorMessage("Network error occurred while fetching search results.");
    }
  }

  /**
   * Renders search results list cards
   */
  function renderSearchResults(results) {
    results.forEach((video) => {
      const card = document.createElement("div");
      card.className = "video-card glass-card";

      // Format duration from seconds to MM:SS
      const durationStr = formatDuration(video.duration);

      card.innerHTML = `
                <div class="thumbnail-container">
                    <img src="${video.thumbnail}" class="video-thumbnail" alt="${video.title}" loading="lazy" onerror="this.onerror=null;this.src='/static/images/beatdrop-icon.svg';">
                    <span class="video-duration">${durationStr}</span>
                </div>
                <div class="video-details">
                    <h3 class="video-title" title="${video.title}">${video.title}</h3>
                    <span class="video-uploader">${video.uploader}</span>
                    <div class="download-actions">
                        <button class="btn btn-primary dl-audio-btn" data-url="${video.url}">
                            <i class="fa-solid fa-music"></i> Audio (MP3)
                        </button>
                        <button class="btn btn-secondary dl-video-btn" data-url="${video.url}">
                            <i class="fa-solid fa-video"></i> Video (MP4)
                        </button>
                    </div>
                </div>
            `;

      // Wire download triggers
      card.querySelector(".dl-audio-btn").addEventListener("click", () => {
        startDownload(video.url, "audio");
      });
      card.querySelector(".dl-video-btn").addEventListener("click", () => {
        startDownload(video.url, "video");
      });

      resultsGrid.appendChild(card);
    });
  }

  /**
   * Starts the download stream (SSE) for the selected YouTube URL
   */
  function startDownload(url, mode) {
    // Clear empty state from active downloads list if present
    if (noDownloads) {
      noDownloads.style.display = "none";
    }

    // Create a unique task ID
    const taskId = "task-" + Date.now();

    // Create DOM element for active task
    const taskCard = document.createElement("div");
    taskCard.className = "download-task-card";
    taskCard.id = taskId;
    taskCard.innerHTML = `
            <div class="download-task-header">
                <div class="task-state-icon" aria-hidden="true">
                    <i class="fa-solid fa-arrow-down"></i>
                </div>
                <div class="download-task-info">
                    <h4 class="download-task-title">Loading metadata...</h4>
                    <div class="download-task-meta">
                        <span class="task-type-badge">${mode === "audio" ? "MP3" : "MP4"}</span>
                        <span class="task-transfer">Preparing download...</span>
                    </div>
                </div>
                <div class="task-progress-percentage"><span class="task-percent-value">0</span>%</div>
                <button class="task-cancel-btn" type="button" aria-label="Cancel download" title="Cancel download">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width: 0%"></div>
            </div>
            <div class="download-task-status-row">
                <span class="task-status-text">Connecting to streaming server...</span>
                <div class="download-task-speed-eta">
                    <span class="task-speed"><i class="fa-solid fa-gauge-high"></i> -- MB/s</span>
                    <span class="task-eta"><i class="fa-solid fa-clock"></i> --</span>
                </div>
            </div>
        `;
    activeDownloadsList.appendChild(taskCard);
    updateActiveCount();

    // Smoothly scroll active tasks panel into view
    const downloadsPanel = document.getElementById("downloads-panel-wrapper");
    if (downloadsPanel) {
      downloadsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // Initiate Server-Sent Events source
    const sseUrl = `/api/download?url=${encodeURIComponent(url)}&mode=${mode}&task_id=${encodeURIComponent(taskId)}`;
    const eventSource = new EventSource(sseUrl);
    showToast(
      `${mode === "audio" ? "Audio" : "Video"} download added to Active Tasks.`,
      "info",
    );
    requestNotificationPermission().then((permission) => {
      if (permission === "granted") {
        notifySystem(
          "BeatDrop download started",
          `Your ${mode} download has been added to Active Tasks.`,
        );
      }
    });

    // References to task card elements
    const titleEl = taskCard.querySelector(".download-task-title");
    const percentValEl = taskCard.querySelector(".task-percent-value");
    const fillBarEl = taskCard.querySelector(".progress-bar-fill");
    const statusTextEl = taskCard.querySelector(".task-status-text");
    const speedEl = taskCard.querySelector(".task-speed");
    const etaEl = taskCard.querySelector(".task-eta");
    const transferEl = taskCard.querySelector(".task-transfer");
    const stateIconEl = taskCard.querySelector(".task-state-icon");
    const cancelButton = taskCard.querySelector(".task-cancel-btn");

    cancelButton.addEventListener("click", async () => {
      cancelButton.disabled = true;
      cancelButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      statusTextEl.textContent = "Cancelling download...";

      try {
        const response = await fetch(
          `/api/download/${encodeURIComponent(taskId)}/cancel`,
          { method: "POST" },
        );
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Unable to cancel download");
        }
      } catch (error) {
        cancelButton.disabled = false;
        cancelButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        statusTextEl.textContent = error.message;
        showToast(error.message, "error");
      }
    });

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.status === "starting") {
        if (data.title) titleEl.textContent = data.title;
        statusTextEl.textContent = "Starting download...";
        transferEl.textContent = "Getting file information...";
      } else if (data.status === "downloading") {
        percentValEl.textContent = data.percent;
        fillBarEl.style.width = `${data.percent}%`;
        statusTextEl.textContent = "Downloading media";
        transferEl.textContent = `${data.downloaded_formatted} of ${data.total_formatted}`;
        if (speedEl) {
          speedEl.style.display = "inline-flex";
          speedEl.innerHTML = `<i class="fa-solid fa-gauge-high"></i> ${data.speed_formatted}`;
        }
        if (etaEl) {
          etaEl.style.display = "inline-flex";
          etaEl.innerHTML = `<i class="fa-solid fa-clock"></i> ${data.eta_formatted}`;
        }
      } else if (data.status === "processing") {
        taskCard.dataset.state = "processing";
        percentValEl.textContent = "100";
        fillBarEl.style.width = "100%";
        fillBarEl.style.background =
          "linear-gradient(90deg, var(--color-secondary) 0%, var(--color-success) 100%)";
        statusTextEl.textContent = data.message || "Converting audio format with FFmpeg...";
        transferEl.textContent = "Almost ready";
        if (speedEl) speedEl.style.display = "none";
        if (etaEl) etaEl.style.display = "none";
        stateIconEl.innerHTML = '<i class="fa-solid fa-compact-disc fa-spin"></i>';
      } else if (data.status === "completed") {
        taskCard.dataset.state = "completed";
        statusTextEl.textContent = "Download Complete!";
        statusTextEl.style.color = "var(--color-success)";
        transferEl.textContent = "Saved to your local library";
        stateIconEl.innerHTML = '<i class="fa-solid fa-check"></i>';
        if (cancelButton) cancelButton.remove();
        showToast(`Download complete: ${data.title}`, "success");
        notifySystem(
          "Download complete",
          `${data.title} is ready in your local library.`,
        );
        eventSource.close();

        // Refresh library list to display the newly saved file
        refreshLibrary();
        refreshHistory();

        // Remove task card after 3 seconds
        setTimeout(() => {
          taskCard.style.opacity = "0";
          taskCard.style.transform = "translateX(20px)";
          taskCard.style.transition = "all 0.5s ease";
          setTimeout(() => {
            taskCard.remove();
            checkActiveDownloadsEmpty();
          }, 500);
        }, 3000);
      } else if (data.status === "error") {
        taskCard.dataset.state = "error";
        statusTextEl.textContent = `Error: ${data.message}`;
        statusTextEl.style.color = "var(--color-danger)";
        fillBarEl.style.background = "var(--color-danger)";
        stateIconEl.innerHTML =
          '<i class="fa-solid fa-triangle-exclamation"></i>';
        if (cancelButton) cancelButton.remove();
        if (data.message && (data.message.toLowerCase().includes("bot") || data.message.toLowerCase().includes("cookie"))) {
          const fixBtn = document.createElement("button");
          fixBtn.className = "fix-cookies-btn";
          fixBtn.innerHTML = '<i class="fa-solid fa-cookie-bite"></i> Add YouTube Cookies';
          fixBtn.onclick = () => openCookiesModal();
          statusTextEl.parentElement.appendChild(fixBtn);
        }
        showToast(`Download failed: ${data.message}`, "error");
        notifySystem("Download failed", data.message);
        eventSource.close();
        setTimeout(() => {
          taskCard.remove();
          checkActiveDownloadsEmpty();
        }, 7000);
      } else if (data.status === "cancelled") {
        taskCard.dataset.state = "cancelled";
        statusTextEl.textContent = "Download cancelled";
        transferEl.textContent = "No file was saved";
        statusTextEl.style.color = "#fbbf24";
        fillBarEl.style.background = "#f59e0b";
        stateIconEl.innerHTML = '<i class="fa-solid fa-ban"></i>';
        if (cancelButton) cancelButton.remove();
        showToast("Download cancelled.", "info");
        eventSource.close();
        setTimeout(() => {
          taskCard.remove();
          checkActiveDownloadsEmpty();
        }, 3000);
      }
    };

    eventSource.onerror = () => {
      // If browser is actively reconnecting to SSE stream, do not fail task
      if (eventSource.readyState === EventSource.CONNECTING) {
        statusTextEl.textContent = "Reconnecting download stream...";
        return;
      }
      
      // If eventSource closed, check if conversion finished in background
      if (taskCard.dataset.state !== "completed") {
        refreshLibrary();
        refreshHistory();
        setTimeout(() => {
          if (taskCard.dataset.state !== "completed") {
            statusTextEl.textContent = "Processing complete. Check Local Library.";
            statusTextEl.style.color = "var(--color-success)";
            taskCard.dataset.state = "completed";
            stateIconEl.innerHTML = '<i class="fa-solid fa-check"></i>';
            if (cancelButton) cancelButton.remove();
            setTimeout(() => {
              taskCard.remove();
              checkActiveDownloadsEmpty();
            }, 3000);
          }
        }, 1500);
      }
      eventSource.close();
    };
  }

  /**
   * Updates stat counter and checks if active downloads list is empty
   */
  function updateActiveCount() {
    const statActiveCount = document.getElementById("stat-active-count");
    if (statActiveCount) {
      const cards = activeDownloadsList.querySelectorAll(".download-task-card");
      statActiveCount.textContent = `${cards.length} Active`;
    }
  }

  /**
   * Checks if there are no active downloads left to show the empty placeholder
   */
  function checkActiveDownloadsEmpty() {
    updateActiveCount();
    if (
      activeDownloadsList.querySelectorAll(".download-task-card").length === 0
    ) {
      if (noDownloads) {
        noDownloads.style.display = "flex";
      }
    }
  }

  /**
   * Fetches saved downloads library files from local backend directory
   */
  async function refreshLibrary() {
    try {
      const response = await fetch("/api/library");
      const files = await response.json();

      libraryGrid.innerHTML = "";

      if (response.ok) {
        const statLibraryCount = document.getElementById("stat-library-count");
        if (statLibraryCount) {
          statLibraryCount.textContent = `${files.length} Track${files.length === 1 ? '' : 's'}`;
        }

        if (files.length === 0) {
          libraryEmpty.style.display = "flex";
        } else {
          libraryEmpty.style.display = "none";
          renderLibrary(files);
        }
      } else {
        console.error("Failed to retrieve media library:", files.error);
      }
    } catch (error) {
      console.error("Error fetching library:", error);
    }
  }

  /** Fetches the persistent history of completed downloads. */
  async function refreshHistory() {
    if (!historyList) return;
    try {
      const response = await fetch("/api/history");
      const entries = await response.json();
      if (!response.ok) return;

      historyList.innerHTML = "";
      if (historyEmpty) historyEmpty.style.display = entries.length ? "none" : "flex";
      entries.forEach((entry) => {
        const item = document.createElement("div");
        item.className = "history-item";
        item.innerHTML = `
                    <div class="history-icon ${entry.type === "audio" ? "lib-icon-audio" : "lib-icon-video"}"><i class="fa-solid ${entry.type === "audio" ? "fa-music" : "fa-video"}"></i></div>
                    <div class="history-details"><h4></h4><span></span></div>
                    <span class="history-date"></span>
                `;
        item.querySelector("h4").textContent = entry.title;
        item.querySelector(".history-details span").textContent =
          `${entry.type === "audio" ? "MP3" : "MP4"} · ${entry.size}`;
        item.querySelector(".history-date").textContent = formatHistoryDate(
          entry.created,
        );
        historyList.appendChild(item);
      });
    } catch (error) {
      console.error("Error fetching download history:", error);
    }
  }

  /**
   * Renders local library files into cards
   */
  function renderLibrary(files) {
    files.forEach((file) => {
      const card = document.createElement("div");
      card.className = "library-card";

      const isMixFile = file.name.startsWith("dj-mix-");
      const iconClass =
        file.type === "audio"
          ? "fa-solid fa-music lib-icon-audio"
          : "fa-solid fa-video lib-icon-video";
      const iconBoxClass =
        file.type === "audio"
          ? "library-icon-box lib-icon-audio"
          : "library-icon-box lib-icon-video";

      // Extract file extension and format nice labels
      const displayTitle = getTitleWithoutExt(file.name);

      card.innerHTML = `
                <div class="library-card-select">
                    <input type="checkbox" class="mix-select" data-name="${file.name}" ${file.type === "audio" && !isMixFile ? "" : "disabled"} aria-label="Select ${displayTitle} for DJ mix">
                </div>
                <div class="library-card-info">
                    <div class="${iconBoxClass}">
                        <i class="${iconClass}"></i>
                    </div>
                    <div class="library-card-text">
                        <h4 class="library-card-title" title="${displayTitle}">${displayTitle}</h4>
                        <div class="library-card-meta">
                            <span>${file.type.toUpperCase()}</span>
                            <span>&bull;</span>
                            <span>${file.size}</span>
                        </div>
                    </div>
                </div>
                <div class="library-card-actions">
                  <button class="btn-sm-action btn-sm-play" data-name="${file.name}" data-type="${file.type}">
                    <i class="fa-solid fa-play"></i> Play
                  </button>
                  <button class="btn-sm-action btn-sm-delete" data-name="${file.name}">
                    <i class="fa-solid fa-trash-can"></i> Delete
                  </button>
                </div>
            `;

      // Action mappings
      card.querySelector(".btn-sm-play").addEventListener("click", () => {
        openPlayer(file.name, file.type);
      });
      card.querySelector(".btn-sm-delete").addEventListener("click", () => {
        deleteFile(file.name);
      });

      libraryGrid.appendChild(card);
    });
    // After rendering library cards, ensure music player has latest files
    if (window.MusicPlayer && typeof window.MusicPlayer.setSongs === 'function') {
      window.MusicPlayer.setSongs(files);
    }
  }

  function createMixActivityCard() {
    if (noDownloads) {
      noDownloads.style.display = "none";
    }

    const taskCard = document.createElement("div");
    taskCard.className = "download-task-card mix-task-card";
    taskCard.innerHTML = `
            <div class="download-task-header">
                <div class="task-state-icon" aria-hidden="true">
                    <i class="fa-solid fa-wave-square"></i>
                </div>
                <div class="download-task-info">
                    <h4 class="download-task-title">Mixing playlist...</h4>
                    <div class="download-task-meta">
                        <span class="task-type-badge">DJ</span>
                        <span class="task-transfer">Preparing crossfades...</span>
                    </div>
                </div>
                <div class="task-progress-percentage"><span class="task-percent-value">0</span>%</div>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width: 5%"></div>
            </div>
            <div class="download-task-status-row">
                <span class="task-status-text">Starting mix...</span>
                <div class="download-task-speed-eta">
                    <span class="task-speed"><i class="fa-solid fa-gauge-high"></i> 0.0 MB/s</span>
                    <span class="task-eta"><i class="fa-solid fa-clock"></i> Preparing</span>
                </div>
            </div>
        `;

    activeDownloadsList.appendChild(taskCard);
    return {
      taskCard,
      titleEl: taskCard.querySelector(".download-task-title"),
      statusTextEl: taskCard.querySelector(".task-status-text"),
      transferEl: taskCard.querySelector(".task-transfer"),
      percentValEl: taskCard.querySelector(".task-percent-value"),
      fillBarEl: taskCard.querySelector(".progress-bar-fill"),
      stateIconEl: taskCard.querySelector(".task-state-icon"),
    };
  }

  async function createDjMix() {
    const selected = Array.from(
      document.querySelectorAll(".mix-select:not(:disabled):checked"),
    ).map((input) => input.dataset.name);

    if (!selected.length) {
      showToast(
        "Please select at least one song before creating a DJ mix.",
        "error",
      );
      return;
    }

    const mixActivity = createMixActivityCard();
    mixActivity.titleEl.textContent = `Mixing ${selected.length} song${selected.length > 1 ? "s" : ""}`;
    mixActivity.statusTextEl.textContent = "Building your DJ mix...";
    mixActivity.transferEl.textContent = `${selected.length} selected tracks`;
    mixActivity.percentValEl.textContent = "5";
    mixActivity.fillBarEl.style.width = "5%";

    let taskId = null;
    let mixComplete = false;

    try {
      const response = await fetch("/api/mix-audio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: selected, fade_duration: 1.2 }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to create DJ mix");
      }

      taskId = data.task_id;
      if (!taskId) {
        throw new Error("Mix task ID was not returned.");
      }

      const pollMixStatus = async () => {
        try {
          const statusResponse = await fetch(
            `/api/mix-status/${encodeURIComponent(taskId)}`,
          );
          const statusData = await statusResponse.json();

          if (!statusResponse.ok) {
            throw new Error(statusData.error || "Mix status unavailable");
          }

          const value = Math.max(5, Number(statusData.progress) || 5);
          mixActivity.percentValEl.textContent = String(value);
          mixActivity.fillBarEl.style.width = `${value}%`;
          mixActivity.transferEl.textContent = statusData.filename
            ? `Ready: ${statusData.filename}`
            : `${selected.length} selected tracks`;

          if (statusData.status === "processing") {
            mixActivity.statusTextEl.textContent = "Mixing songs together...";
            return setTimeout(pollMixStatus, 800);
          }

          if (statusData.status === "completed") {
            mixActivity.percentValEl.textContent = "100";
            mixActivity.fillBarEl.style.width = "100%";
            mixActivity.transferEl.textContent = `Ready: ${statusData.filename}`;
            mixActivity.statusTextEl.textContent = "DJ mix ready";
            mixActivity.stateIconEl.innerHTML =
              '<i class="fa-solid fa-check"></i>';
            mixComplete = true;
            showToast(`DJ mix created: ${statusData.filename}`, "success");
            refreshLibrary();
            refreshHistory();
            setTimeout(() => {
              mixActivity.taskCard.style.opacity = "0";
              mixActivity.taskCard.style.transform = "translateX(20px)";
              mixActivity.taskCard.style.transition = "all 0.5s ease";
              setTimeout(() => mixActivity.taskCard.remove(), 500);
            }, 2500);
            return;
          }

          if (statusData.status === "failed") {
            throw new Error(statusData.error || "Unable to build DJ mix.");
          }

          return setTimeout(pollMixStatus, 800);
        } catch (error) {
          console.error("MIX_STATUS_ERROR", error);
          if (!mixComplete) {
            mixActivity.statusTextEl.textContent =
              error.message || "Unable to build DJ mix.";
            mixActivity.transferEl.textContent = "Mix failed";
            mixActivity.fillBarEl.style.background = "var(--color-danger)";
            mixActivity.stateIconEl.innerHTML =
              '<i class="fa-solid fa-triangle-exclamation"></i>';
            showToast(error.message || "Unable to build DJ mix.", "error");
            setTimeout(() => {
              mixActivity.taskCard.style.opacity = "0";
              mixActivity.taskCard.style.transform = "translateX(20px)";
              mixActivity.taskCard.style.transition = "all 0.5s ease";
              setTimeout(() => mixActivity.taskCard.remove(), 500);
            }, 3500);
          }
        }
      };

      pollMixStatus();
    } catch (error) {
      console.error("MIX_ERROR", error);
      mixActivity.statusTextEl.textContent =
        error.message || "Unable to build DJ mix.";
      mixActivity.transferEl.textContent = "Mix failed";
      mixActivity.fillBarEl.style.background = "var(--color-danger)";
      mixActivity.stateIconEl.innerHTML =
        '<i class="fa-solid fa-triangle-exclamation"></i>';
      showToast(error.message || "Unable to build DJ mix.", "error");
      setTimeout(() => {
        mixActivity.taskCard.style.opacity = "0";
        mixActivity.taskCard.style.transform = "translateX(20px)";
        mixActivity.taskCard.style.transition = "all 0.5s ease";
        setTimeout(() => mixActivity.taskCard.remove(), 500);
      }, 3500);
    }
  }

  /**
   * Triggers file deletion through backend API
   */
  async function deleteFile(filename) {
    if (
      !confirm(
        `Are you sure you want to permanently delete "${getTitleWithoutExt(filename)}"?`,
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `/api/delete/${encodeURIComponent(filename)}`,
        {
          method: "DELETE",
        },
      );
      const data = await response.json();

      if (response.ok) {
        refreshLibrary();
      } else {
        alert(`Error deleting file: ${data.error}`);
      }
    } catch (error) {
      console.error("Delete network failure:", error);
      alert("Failed to request file deletion.");
    }
  }

  /**
   * Opens the media player modal and runs media source
   */
  function openPlayer(filename, type) {
    if (type === "audio") {
      if (window.MusicPlayer && typeof window.MusicPlayer.playSongByName === 'function') {
        window.MusicPlayer.playSongByName(filename);
        // Scroll to Spotify player section smoothly
        const spotifyWrapper = document.getElementById('spotify-music-player-wrapper');
        if (spotifyWrapper) {
          spotifyWrapper.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }
    }

    // Video playback using modal player
    enqueueTrack({ name: filename, type });
    playCurrent(playerQueue.length - 1);

    try {
      if (playerModal && typeof playerModal.classList !== 'undefined') {
        playerModal.classList.add("active");
      }
    } catch (err) {
      console.error('Error opening video player modal:', err);
    }
  }

  function createInlineAudioPlayer(filename, type) {
    // Remove existing temp player if present
    const existing = document.getElementById('temp-inline-player');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'temp-inline-player';
    wrapper.style.position = 'fixed';
    wrapper.style.right = '18px';
    wrapper.style.bottom = '18px';
    wrapper.style.zIndex = 9999;
    wrapper.style.background = 'rgba(0,0,0,0.7)';
    wrapper.style.padding = '10px';
    wrapper.style.borderRadius = '10px';
    wrapper.style.boxShadow = '0 8px 30px rgba(0,0,0,0.6)';

    const title = document.createElement('div');
    title.textContent = getTitleWithoutExt(filename);
    title.style.color = '#fff';
    title.style.fontSize = '0.95rem';
    title.style.marginBottom = '6px';
    wrapper.appendChild(title);

    const audioEl = document.createElement('audio');
    audioEl.controls = true;
    audioEl.src = `/api/play/${encodeURIComponent(filename)}`;
    audioEl.style.width = '260px';
    audioEl.autoplay = true;
    wrapper.appendChild(audioEl);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'btn-sm-action';
    closeBtn.style.marginLeft = '8px';
    closeBtn.addEventListener('click', () => wrapper.remove());
    wrapper.appendChild(closeBtn);

    document.body.appendChild(wrapper);
    audioEl.play().catch((e) => {
      console.warn('Autoplay blocked or failed:', e);
    });
  }

  function enqueueTrack(track) {
    playerQueue.push(track);
    if (queueCountEl) queueCountEl.textContent = String(playerQueue.length);
    if (inlineQueueCount) inlineQueueCount.textContent = String(playerQueue.length);
    renderQueue();
    saveQueue();
  }

  function currentMedia() {
    if (currentIndex < 0 || currentIndex >= playerQueue.length) return null;
    return playerQueue[currentIndex].type === "audio" ? html5Audio : html5Video;
  }

  function playCurrent(index) {
    if (!playerQueue.length || index < 0 || index >= playerQueue.length) return;
    currentIndex = index;
    const track = playerQueue[currentIndex];
    modalSongTitle.textContent = getTitleWithoutExt(track.name);
    const mediaUrl = `/api/play/${encodeURIComponent(track.name)}`;

    // Reset both players (guard against missing elements)
    if (html5Audio) {
      try { html5Audio.pause(); } catch (e) {}
      try { html5Audio.src = ""; } catch (e) {}
      try { html5Audio.style.display = "none"; } catch (e) {}
    }
    if (html5Video) {
      try { html5Video.pause(); } catch (e) {}
      try { html5Video.src = ""; } catch (e) {}
      try { html5Video.style.display = "none"; } catch (e) {}
    }

    if (track.type === "audio") {
      playerTrackIcon.className = "player-track-icon lib-icon-audio";
      playerTrackIcon.innerHTML = '<i class="fa-solid fa-music"></i>';
      html5Audio.src = mediaUrl;
      html5Audio.style.display = "block";
      html5Audio.load();
      html5Audio.play().catch((e) => console.log("Autoplay blocked:", e));
    } else {
      playerTrackIcon.className = "player-track-icon lib-icon-video";
      playerTrackIcon.innerHTML = '<i class="fa-solid fa-video"></i>';
      if (html5Video) {
        html5Video.src = mediaUrl;
        html5Video.style.display = "block";
        html5Video.load();
        html5Video.play().catch((e) => console.log("Autoplay blocked:", e));
      }
    }
    updateQueueUI();
    attachMediaEvents();
    saveQueue();
  }

  function updateQueueUI() {
    if (queueCountEl) queueCountEl.textContent = String(playerQueue.length);
    // Update play icon to pause
    if (playerPlayIcon) playerPlayIcon.className = "fa-solid fa-pause";
    if (inlinePlayIcon) inlinePlayIcon.className = "fa-solid fa-pause";
    if (inlineQueueCount) inlineQueueCount.textContent = String(playerQueue.length);
  }

  function togglePlayPause() {
    const media = currentMedia();
    if (!media) return;
    if (media.paused) {
      media.play();
      if (playerPlayIcon) playerPlayIcon.className = "fa-solid fa-pause";
      if (inlinePlayIcon) inlinePlayIcon.className = "fa-solid fa-pause";
    } else {
      media.pause();
      if (playerPlayIcon) playerPlayIcon.className = "fa-solid fa-play";
      if (inlinePlayIcon) inlinePlayIcon.className = "fa-solid fa-play";
    }
  }

  function playNextTrack() {
    if (!playerQueue.length) return;
    if (isShuffle) {
      const next = Math.floor(Math.random() * playerQueue.length);
      playCurrent(next);
      return;
    }
    const nextIndex = currentIndex + 1;
    if (nextIndex < playerQueue.length) {
      playCurrent(nextIndex);
    } else if (repeatMode === "all") {
      playCurrent(0);
    } else {
      // end of queue
      const media = currentMedia();
      if (media) {
        try { media.pause(); } catch (e) {}
      } else {
        if (html5Audio) try { html5Audio.pause(); } catch (e) {}
        if (html5Video) try { html5Video.pause(); } catch (e) {}
      }
      if (playerPlayIcon) playerPlayIcon.className = "fa-solid fa-play";
      if (inlinePlayIcon) inlinePlayIcon.className = "fa-solid fa-play";
    }
  }

  function playPrevTrack() {
    if (!playerQueue.length) return;
    if (isShuffle) {
      const next = Math.floor(Math.random() * playerQueue.length);
      playCurrent(next);
      return;
    }
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      playCurrent(prevIndex);
    } else if (repeatMode === "all") {
      playCurrent(playerQueue.length - 1);
    }
  }

  function attachMediaEvents() {
    const attach = (el) => {
      if (!el || el.dataset.eventsAttached) return;
      el.addEventListener("timeupdate", () => {
        if (userSeeking) return;
        if (el !== currentMedia()) return;
        const pct = (el.currentTime / (el.duration || 1)) * 100;
        seekSlider.value = isFinite(pct) ? String(Math.floor(pct)) : "0";
        timeCurrent.textContent = formatSecondsToTime(el.currentTime);
        timeDuration.textContent = formatSecondsToTime(el.duration || 0);
      });

      el.addEventListener("ended", () => {
        if (el !== currentMedia()) return;
        if (repeatMode === "one") {
          el.currentTime = 0;
          el.play();
          return;
        }
        playNextTrack();
      });

      el.addEventListener("play", () => {
        if (el !== currentMedia()) return;
        playerPlayIcon.className = "fa-solid fa-pause";
      });
      el.addEventListener("pause", () => {
        if (el !== currentMedia()) return;
        playerPlayIcon.className = "fa-solid fa-play";
      });

      el.dataset.eventsAttached = "1";
    };

    attach(html5Audio);
    attach(html5Video);
    renderQueue();
  }

  // Persist queue to localStorage
  function saveQueue() {
    try {
      const payload = { queue: playerQueue, index: currentIndex };
      localStorage.setItem('beatdrop_player_queue', JSON.stringify(payload));
    } catch (e) { console.warn('Unable to save queue', e); }
  }

  function loadQueue() {
    try {
      const raw = localStorage.getItem('beatdrop_player_queue');
      if (!raw) return;
      const payload = JSON.parse(raw);
      if (Array.isArray(payload.queue)) {
        playerQueue = payload.queue;
        currentIndex = typeof payload.index === 'number' ? payload.index : -1;
        renderQueue();
        updateInlineNow();
      }
    } catch (e) { console.warn('Unable to load queue', e); }
  }

  // Volume handling
  function setVolume(v) {
    const val = Math.min(1, Math.max(0, Number(v) || 0));
    if (html5Audio) html5Audio.volume = val;
    if (html5Video) html5Video.volume = val;
    if (volumeSlider) volumeSlider.value = Math.round(val * 100);
    try { localStorage.setItem('beatdrop_volume', String(val)); } catch (e) {}
    if (volumeIcon) {
      volumeIcon.className =
        val === 0 ? 'fa-solid fa-volume-xmark'
        : val < 0.5 ? 'fa-solid fa-volume-low'
        : 'fa-solid fa-volume-high';
      volumeIcon.title = val === 0 ? 'Unmute' : `Volume: ${Math.round(val * 100)}%`;
    }
    return val;
  }

  function toggleMute() {
    const current = html5Audio ? html5Audio.volume : 0;
    setVolume(current > 0 ? 0 : (Number(localStorage.getItem('beatdrop_volume')) || 0.5));
  }

  if (volumeIcon) {
    volumeIcon.addEventListener('click', toggleMute);
  }
  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      setVolume(Number(e.target.value) / 100);
    });
    // load saved volume (default to 50% so audio is not silent on first run)
    try {
      const sv = Number(localStorage.getItem('beatdrop_volume'));
      const vol = (!isNaN(sv) && sv > 0) ? sv : 0.5;
      setVolume(vol);
    } catch (e) {
      setVolume(0.5);
    }
  }

  // On init, restore queue
  loadQueue();

  function renderQueue() {
    if (!playerQueueContainer) return;
    playerQueueContainer.innerHTML = '';
    playerQueue.forEach((t, idx) => {
      const item = document.createElement('div');
      item.className = 'player-queue-item' + (idx === currentIndex ? ' playing' : '');
      item.innerHTML = `<div class="title">${getTitleWithoutExt(t.name)}</div><div class="actions"><button class="btn-sm-action btn-queue-play" data-idx="${idx}" title="Play"><i class="fa-solid fa-play"></i></button><button class="btn-sm-action btn-queue-remove" data-idx="${idx}" title="Remove"><i class="fa-solid fa-trash-can"></i></button></div>`;
      playerQueueContainer.appendChild(item);
    });

    // wire up play/remove
    playerQueueContainer.querySelectorAll('.btn-queue-play').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        playCurrent(idx);
      });
    });
    playerQueueContainer.querySelectorAll('.btn-queue-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        playerQueue.splice(idx,1);
        if (idx === currentIndex) {
          currentIndex = Math.min(idx, playerQueue.length-1);
          if (currentIndex >=0) playCurrent(currentIndex);
          else {
            // stopped
            if (html5Audio) html5Audio.pause();
            if (html5Video) html5Video.pause();
            updateInlineNow();
          }
        } else if (idx < currentIndex) {
          currentIndex -= 1;
        }
        renderQueue();
        if (inlineQueueCount) inlineQueueCount.textContent = String(playerQueue.length);
        if (queueCountEl) queueCountEl.textContent = String(playerQueue.length);
      });
    });
    updateInlineNow();
  }


  function updateInlineNow() {
    if (inlineNowTitle) inlineNowTitle.textContent = (currentIndex >=0 && playerQueue[currentIndex]) ? getTitleWithoutExt(playerQueue[currentIndex].name) : 'Nothing playing';
    const targetIconEl = (typeof inlinePlayerIcon !== 'undefined' && inlinePlayerIcon) ? inlinePlayerIcon : inlinePlayerArt;
    if (targetIconEl) targetIconEl.innerHTML = (currentIndex >=0 && playerQueue[currentIndex] && playerQueue[currentIndex].type === 'video') ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-music"></i>';
    if (inlineQueueCount) inlineQueueCount.textContent = String(playerQueue.length);
  }

  /**
   * Closes the active media players and hides the modal
   */
  function closePlayer() {
    if (html5Audio) {
      html5Audio.pause();
      html5Audio.src = "";
    }
    if (html5Video) {
      html5Video.pause();
      html5Video.src = "";
    }

    // Reset active playback pointer so pause/resume and reopen behave cleanly
    currentIndex = -1;
    if (playerPlayIcon) playerPlayIcon.className = "fa-solid fa-play";
    if (inlinePlayIcon) inlinePlayIcon.className = "fa-solid fa-play";
    renderQueue();
    saveQueue();

    playerModal.classList.remove("active");
  }

  // --- Helper Utilities ---

  function getTitleWithoutExt(filename) {
    return filename.substring(0, filename.lastIndexOf(".")) || filename;
  }

  function formatDuration(seconds) {
    if (!seconds) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function formatSecondsToTime(sec) {
    if (!isFinite(sec) || isNaN(sec) || sec <= 0) return "0:00";
    const s = Math.floor(sec);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  /* ==========================
     Spotify Music Player Engine
     Provides a full Spotify-like player experience with queue, shuffle, repeat, seekbar, and search filter.
     ========================== */
  const MusicPlayer = (function () {
    const songListEl = document.getElementById('song-list');
    const spotifyEmptyEl = document.getElementById('spotify-empty');
    const searchInput = document.getElementById('mp-search');

    // controls
    const npPlay = document.getElementById('np-play');
    const npPlayIcon = document.getElementById('np-play-icon');
    const npPrev = document.getElementById('np-prev');
    const npNext = document.getElementById('np-next');
    const npShuffle = document.getElementById('np-shuffle');
    const npRepeat = document.getElementById('np-repeat');
    const npSeek = document.getElementById('np-seek');
    const npCurrent = document.getElementById('np-current');
    const npDuration = document.getElementById('np-duration');
    const npVolume = document.getElementById('np-volume');
    const spVolumeBtn = document.getElementById('sp-volume-btn');
    const spVolIcon = document.getElementById('sp-vol-icon');
    const npTitle = document.getElementById('np-title');
    const npArtist = document.getElementById('np-artist');
    const npArt = document.getElementById('np-art');

    let songs = [];
    let current = -1;
    let playOrder = [];
    let orderPos = 0;
    let isPlaying = false;
    let shuffle = false;
    let repeatMode = 'off'; // 'off' | 'all' | 'one'

    let audio = html5Audio;
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'html5-audio';
      audio.style.display = 'none';
      document.body.appendChild(audio);
    }

    function setSongs(list) {
      songs = (list || []).filter(s => s.type === 'audio');
      if (spotifyEmptyEl) {
        spotifyEmptyEl.style.display = songs.length === 0 ? 'flex' : 'none';
      }
      renderSongList(songs);
      resetPlayOrder();
    }

    function renderSongList(list) {
      if (!songListEl) return;
      songListEl.innerHTML = '';
      list.forEach((s, idx) => {
        const row = document.createElement('div');
        row.className = 'song-row' + (idx === current ? ' playing' : '');
        row.dataset.idx = idx;
        const displayTitle = getTitleWithoutExt(s.name);
        row.innerHTML = `
          <div class="song-art"> <i class="fa-solid fa-compact-disc"></i> </div>
          <div class="song-meta">
            <div class="song-title" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</div>
            <div class="song-sub">MP3 · ${s.size}</div>
          </div>
          <div class="song-duration"><i class="fa-solid fa-play"></i></div>
        `;
        row.addEventListener('click', () => {
          playIndex(idx);
        });
        songListEl.appendChild(row);
      });
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function playIndex(idx) {
      if (!songs || !songs.length || idx < 0 || idx >= songs.length) return;
      const song = songs[idx];
      if (!song) return;
      current = idx;

      // Stop video player if playing
      if (html5Video) {
        try { html5Video.pause(); html5Video.src = ""; html5Video.style.display = "none"; } catch (e) {}
      }

      const url = `/api/play/${encodeURIComponent(song.name)}`;
      try {
        audio.src = url;
        const p = audio.play();
        if (p && p.catch) {
          p.catch(err => console.warn('Audio playback waiting for user interaction:', err));
        }
      } catch (err) {
        console.error('Error while trying to play audio:', err);
      }

      isPlaying = true;
      updateNowPlaying();
      updatePlayIcon(true);
      highlightPlaying();
      ensureOrderContainsCurrent();
    }

    function playSongByName(filename) {
      const idx = songs.findIndex(s => s.name === filename);
      if (idx !== -1) {
        playIndex(idx);
      } else {
        // Enqueue dynamically if not yet in library list
        songs.push({ name: filename, type: 'audio', size: 'Audio Track' });
        renderSongList(songs);
        playIndex(songs.length - 1);
      }
    }

    function ensureOrderContainsCurrent() {
      if (playOrder.indexOf(current) === -1) {
        playOrder.splice(orderPos + 1, 0, current);
      }
      orderPos = playOrder.indexOf(current);
    }

    function playNext() {
      if (!songs.length) return;
      if (shuffle) {
        orderPos++;
        if (orderPos >= playOrder.length) {
          if (repeatMode === 'all') { resetPlayOrder(); orderPos = 0; }
          else { audio.pause(); isPlaying = false; updatePlayIcon(false); return; }
        }
        playIndex(playOrder[orderPos]);
        return;
      }
      const next = current + 1;
      if (next < songs.length) {
        playIndex(next);
      } else if (repeatMode === 'all') {
        playIndex(0);
      } else {
        audio.pause();
        isPlaying = false;
        updatePlayIcon(false);
      }
    }

    function playPrevFn() {
      if (!songs.length) return;
      if (shuffle) {
        orderPos = Math.max(0, orderPos - 1);
        playIndex(playOrder[orderPos]);
        return;
      }
      const prev = current - 1;
      if (prev >= 0) {
        playIndex(prev);
      } else if (repeatMode === 'all') {
        playIndex(songs.length - 1);
      }
    }

    function updateNowPlaying() {
      const s = songs[current];
      const titleStr = s ? getTitleWithoutExt(s.name) : 'Select a track to play';
      if (npTitle) npTitle.textContent = titleStr;
      if (npArtist) npArtist.textContent = s ? 'Local Collection' : 'Spotify Player';
      if (npArt) {
        const discIcon = npArt.querySelector('.sp-disc-spin');
        if (discIcon) {
          if (isPlaying) discIcon.classList.add('active');
          else discIcon.classList.remove('active');
        }
      }
      if (s) updateMediaSession(titleStr, 'BeatDrop Local Collection');
    }

    function updateMediaSession(songTitle, artistName) {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: songTitle || 'BeatDrop Track',
          artist: artistName || 'BeatDrop Local Library',
          album: 'Local Audio Collection',
          artwork: [
            { src: '/static/images/pwa-icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/static/images/pwa-icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/static/images/beatdrop-icon.svg', sizes: 'any', type: 'image/svg+xml' }
          ]
        });

        try {
          navigator.mediaSession.setActionHandler('play', () => {
            if (audio && audio.paused) {
              audio.play();
              isPlaying = true;
              updatePlayIcon(true);
            }
          });
          navigator.mediaSession.setActionHandler('pause', () => {
            if (audio && !audio.paused) {
              audio.pause();
              isPlaying = false;
              updatePlayIcon(false);
            }
          });
          navigator.mediaSession.setActionHandler('previoustrack', () => playPrevFn());
          navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
          navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime && audio.duration) {
              audio.currentTime = details.seekTime;
            }
          });
        } catch (e) {
          console.warn('MediaSession handler registration warning:', e);
        }
      }
    }

    function updatePlayIcon(playing) {
      if (npPlayIcon) npPlayIcon.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
      if (npArt) {
        const discIcon = npArt.querySelector('.sp-disc-spin');
        if (discIcon) {
          if (playing) discIcon.classList.add('active');
          else discIcon.classList.remove('active');
        }
      }
    }

    function highlightPlaying() {
      if (!songListEl) return;
      songListEl.querySelectorAll('.song-row').forEach(r => r.classList.remove('playing'));
      const el = songListEl.querySelector(`.song-row[data-idx="${current}"]`);
      if (el) el.classList.add('playing');
    }

    function resetPlayOrder() {
      playOrder = songs.map((_, i) => i);
      if (shuffle) shuffleArray(playOrder);
      orderPos = current >= 0 ? playOrder.indexOf(current) : 0;
    }

    function shuffleArray(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
    }

    // Event controls wiring
    if (npPlay) {
      npPlay.addEventListener('click', () => {
        if (!audio.src || current === -1) {
          if (songs.length) playIndex(0);
          return;
        }
        if (audio.paused) {
          audio.play();
          isPlaying = true;
          updatePlayIcon(true);
        } else {
          audio.pause();
          isPlaying = false;
          updatePlayIcon(false);
        }
      });
    }

    if (npNext) npNext.addEventListener('click', playNext);
    if (npPrev) npPrev.addEventListener('click', playPrevFn);

    if (npShuffle) {
      npShuffle.addEventListener('click', () => {
        shuffle = !shuffle;
        npShuffle.classList.toggle('active', shuffle);
        showToast(shuffle ? "Spotify Shuffle enabled" : "Shuffle disabled", "info");
        resetPlayOrder();
      });
    }

    if (npRepeat) {
      npRepeat.addEventListener('click', () => {
        repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
        npRepeat.classList.toggle('active', repeatMode !== 'off');
        npRepeat.title = `Repeat Mode: ${repeatMode.toUpperCase()}`;
        showToast(`Repeat mode: ${repeatMode.toUpperCase()}`, "info");
      });
    }

    audio.addEventListener('timeupdate', () => {
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      if (npSeek) npSeek.value = isFinite(pct) ? pct : 0;
      if (npCurrent) npCurrent.textContent = formatSecondsToTime(audio.currentTime || 0);
      if (npDuration) npDuration.textContent = formatSecondsToTime(audio.duration || 0);
    });

    if (npSeek) {
      npSeek.addEventListener('input', (e) => {
        const pct = Number(e.target.value);
        if (audio.duration) {
          audio.currentTime = (pct / 100) * audio.duration;
        }
      });
    }

    if (npVolume) {
      npVolume.addEventListener('input', (e) => {
        const val = Number(e.target.value) / 100;
        audio.volume = val;
        try { localStorage.setItem('beatdrop_volume', String(val)); } catch (e) {}
        updateVolumeIcon(val);
      });
    }

    if (spVolumeBtn) {
      spVolumeBtn.addEventListener('click', () => {
        if (audio.volume > 0) {
          audio.volume = 0;
          if (npVolume) npVolume.value = 0;
          updateVolumeIcon(0);
        } else {
          const sv = Number(localStorage.getItem('beatdrop_volume')) || 0.7;
          audio.volume = sv;
          if (npVolume) npVolume.value = Math.round(sv * 100);
          updateVolumeIcon(sv);
        }
      });
    }

    function updateVolumeIcon(val) {
      if (!spVolIcon) return;
      spVolIcon.className = val === 0 ? 'fa-solid fa-volume-xmark' : val < 0.5 ? 'fa-solid fa-volume-low' : 'fa-solid fa-volume-high';
    }

    audio.addEventListener('ended', () => {
      if (!isPlaying) return;
      if (repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play();
        return;
      }
      playNext();
    });

    // Search filter for Spotify song list
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        if (!songListEl) return;
        songListEl.querySelectorAll('.song-row').forEach(r => {
          const t = r.querySelector('.song-title').textContent.toLowerCase();
          r.style.display = t.includes(q) ? 'flex' : 'none';
        });
      });
    }

    function init() {
      try {
        fetch('/api/library')
          .then(r => r.json())
          .then(list => { setSongs(list || []); });
      } catch (e) {}

      try {
        const v = Number(localStorage.getItem('beatdrop_volume'));
        const vol = (!isNaN(v) && v >= 0) ? v : 0.7;
        audio.volume = vol;
        if (npVolume) npVolume.value = Math.round(vol * 100);
        updateVolumeIcon(vol);
      } catch (e) {}
    }

    return { init, setSongs, playIndex, playSongByName };
  })();

  try { MusicPlayer.init(); } catch (e) { console.warn('MusicPlayer init failed', e); }
  try { window.MusicPlayer = MusicPlayer; } catch (e) {}

  function formatHistoryDate(timestamp) {
    return new Date(timestamp * 1000).toLocaleString([], {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function showErrorMessage(msg) {
    showToast(msg, "error");
  }

  /**
   * Shows a short, non-blocking in-app notification.
   */
  function showToast(message, type = "info") {
    // Notifications are optional UI feedback; they must never block a download.
    if (!toastRegion) return;

    const icon =
      type === "success"
        ? "fa-circle-check"
        : type === "error"
          ? "fa-circle-exclamation"
          : "fa-circle-down";
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span></span><button aria-label="Dismiss notification"><i class="fa-solid fa-xmark"></i></button>`;
    toast.querySelector("span").textContent = message;
    toast
      .querySelector("button")
      .addEventListener("click", () => dismissToast(toast));
    toastRegion.appendChild(toast);
    window.setTimeout(
      () => dismissToast(toast),
      type === "success" ? 6500 : 4500,
    );
  }

  /** Requests permission during a user click so desktop alerts can be shown. */
  function requestNotificationPermission() {
    if (!("Notification" in window)) {
      return Promise.resolve("unsupported");
    }
    return Notification.permission === "default"
      ? Notification.requestPermission()
      : Promise.resolve(Notification.permission);
  }

  /** Shows an operating-system notification when the browser has permission. */
  function notifySystem(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  }

  function dismissToast(toast) {
    if (!toast || toast.classList.contains("toast-leaving")) return;
    toast.classList.add("toast-leaving");
    window.setTimeout(() => toast.remove(), 220);
  }

  /* ==========================================
     PWA SERVICE WORKER & INSTALL PROMPT HANDLER
     ========================================== */
  let deferredPwaPrompt = null;
  const pwaInstallBtn = document.getElementById("pwa-install-btn");

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").then(
        (reg) => console.log("[ServiceWorker] Registered with scope:", reg.scope),
        (err) => console.warn("[ServiceWorker] Registration failed:", err)
      );
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    if (pwaInstallBtn) {
      pwaInstallBtn.style.display = "inline-flex";
    }
  });

  if (pwaInstallBtn) {
    pwaInstallBtn.addEventListener("click", async () => {
      if (!deferredPwaPrompt) return;
      deferredPwaPrompt.prompt();
      const { outcome } = await deferredPwaPrompt.userChoice;
      if (outcome === "accepted") {
        showToast("BeatDrop installed to your device!", "success");
      }
      deferredPwaPrompt = null;
      pwaInstallBtn.style.display = "none";
    });
  }

  window.addEventListener("appinstalled", () => {
    showToast("BeatDrop app installed successfully!", "success");
    if (pwaInstallBtn) pwaInstallBtn.style.display = "none";
  });

  /* ==========================================
     LIVE DJ MICROPHONE WEB AUDIO ENGINE
     ========================================== */
  let micAudioContext = null;
  let micStream = null;
  let micSourceNode = null;
  let micGainNode = null;
  let isMicActive = false;
  let autoDuckingEnabled = true;

  const djMicToggleBtn = document.getElementById("dj-mic-toggle-btn");
  const djMicIcon = document.getElementById("dj-mic-icon");
  const djMicLabel = document.getElementById("dj-mic-label");
  const djMicVisualizer = document.getElementById("dj-mic-visualizer");
  const djMicGainInput = document.getElementById("dj-mic-gain");
  const djMicGainVal = document.getElementById("dj-mic-gain-val");
  const djDuckingToggle = document.getElementById("dj-ducking-toggle");

  if (djMicToggleBtn) {
    djMicToggleBtn.addEventListener("click", toggleDjMicrophone);
  }

  if (djMicGainInput) {
    djMicGainInput.addEventListener("input", (e) => {
      const val = Number(e.target.value);
      if (djMicGainVal) djMicGainVal.textContent = `${val}%`;
      if (micGainNode && micAudioContext) {
        micGainNode.gain.setValueAtTime(val / 100, micAudioContext.currentTime);
      }
    });
  }

  if (djDuckingToggle) {
    djDuckingToggle.addEventListener("click", () => {
      autoDuckingEnabled = !autoDuckingEnabled;
      djDuckingToggle.classList.toggle("active", autoDuckingEnabled);
      showToast(autoDuckingEnabled ? "Auto-Ducking Enabled" : "Auto-Ducking Disabled", "info");
      applyMusicDucking();
    });
  }

  async function toggleDjMicrophone() {
    if (isMicActive) {
      stopDjMicrophone();
    } else {
      await startDjMicrophone();
    }
  }

  async function startDjMicrophone() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast("Microphone access is not supported by your browser.", "error");
        return;
      }

      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      micAudioContext = new AudioCtx();

      micSourceNode = micAudioContext.createMediaStreamSource(micStream);
      micGainNode = micAudioContext.createGain();

      const initialGain = djMicGainInput ? Number(djMicGainInput.value) / 100 : 1.0;
      micGainNode.gain.setValueAtTime(initialGain, micAudioContext.currentTime);

      micSourceNode.connect(micGainNode);
      micGainNode.connect(micAudioContext.destination);

      isMicActive = true;
      if (djMicToggleBtn) djMicToggleBtn.classList.add("active");
      if (djMicIcon) djMicIcon.className = "fa-solid fa-microphone text-rose-500 fa-pulse";
      if (djMicLabel) djMicLabel.textContent = "DJ Mic LIVE";
      if (djMicVisualizer) djMicVisualizer.style.display = "flex";

      applyMusicDucking();
      showToast("Live DJ Microphone Active!", "success");
    } catch (err) {
      console.error("[DJ Mic Error]", err);
      showToast("Unable to access microphone: " + (err.message || "Permission denied"), "error");
      stopDjMicrophone();
    }
  }

  function stopDjMicrophone() {
    isMicActive = false;
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    if (micAudioContext) {
      try { micAudioContext.close(); } catch (e) {}
      micAudioContext = null;
    }
    if (djMicToggleBtn) djMicToggleBtn.classList.remove("active");
    if (djMicIcon) djMicIcon.className = "fa-solid fa-microphone-slash";
    if (djMicLabel) djMicLabel.textContent = "DJ Mic OFF";
    if (djMicVisualizer) djMicVisualizer.style.display = "none";

    applyMusicDucking();
  }

  function applyMusicDucking() {
    const audioEl = document.getElementById("spotify-audio");
    if (!audioEl) return;
    if (isMicActive && autoDuckingEnabled) {
      audioEl.dataset.originalVol = audioEl.volume;
      audioEl.volume = Math.max(0.1, audioEl.volume * 0.35);
    } else if (audioEl.dataset.originalVol) {
      audioEl.volume = Number(audioEl.dataset.originalVol);
    }
  }

  // ==========================================================================
  // YOUTUBE COOKIES MODAL HANDLERS
  // ==========================================================================
  const cookiesModal = document.getElementById("cookies-modal");
  const cookiesModalBtn = document.getElementById("cookies-modal-btn");
  const closeCookiesModalBtn = document.getElementById("close-cookies-modal");
  const cookiesModalBackdrop = document.getElementById("cookies-modal-backdrop");
  const cookiesTextarea = document.getElementById("cookies-textarea");
  const cookiesFileInput = document.getElementById("cookies-file-input");
  const cookiesFileName = document.getElementById("cookies-file-name");
  const saveCookiesBtn = document.getElementById("save-cookies-btn");
  const deleteCookiesBtn = document.getElementById("delete-cookies-btn");
  const cookiesStatusText = document.getElementById("cookies-status-text");
  const cookiesActiveBanner = document.getElementById("cookies-active-banner");
  const cookiesInactiveBanner = document.getElementById("cookies-inactive-banner");
  const cookiesLineCount = document.getElementById("cookies-line-count");

  function openCookiesModal() {
    if (cookiesModal) {
      cookiesModal.style.display = "flex";
      cookiesModal.classList.add("active");
      fetchCookiesStatus();
    }
  }

  function closeCookiesModal() {
    if (cookiesModal) {
      cookiesModal.classList.remove("active");
      setTimeout(() => { cookiesModal.style.display = "none"; }, 250);
    }
  }

  if (cookiesModalBtn) cookiesModalBtn.addEventListener("click", openCookiesModal);
  if (closeCookiesModalBtn) closeCookiesModalBtn.addEventListener("click", closeCookiesModal);
  if (cookiesModalBackdrop) cookiesModalBackdrop.addEventListener("click", closeCookiesModal);

  async function fetchCookiesStatus() {
    try {
      const response = await fetch("/api/cookies");
      const data = await response.json();
      if (response.ok) {
        if (data.has_cookies) {
          if (cookiesStatusText) cookiesStatusText.textContent = `Cookies: Active (${data.lines})`;
          if (cookiesModalBtn) cookiesModalBtn.classList.add("cookies-active-pill");
          if (cookiesActiveBanner) cookiesActiveBanner.style.display = "flex";
          if (cookiesInactiveBanner) cookiesInactiveBanner.style.display = "none";
          if (cookiesLineCount) cookiesLineCount.textContent = data.lines;
          if (deleteCookiesBtn) deleteCookiesBtn.style.display = "inline-flex";
        } else {
          if (cookiesStatusText) cookiesStatusText.textContent = "Cookies: None";
          if (cookiesModalBtn) cookiesModalBtn.classList.remove("cookies-active-pill");
          if (cookiesActiveBanner) cookiesActiveBanner.style.display = "none";
          if (cookiesInactiveBanner) cookiesInactiveBanner.style.display = "flex";
          if (deleteCookiesBtn) deleteCookiesBtn.style.display = "none";
        }
      }
    } catch (err) {
      console.error("Failed to fetch cookies status:", err);
    }
  }

  // Fetch initial cookies status on page load
  fetchCookiesStatus();

  if (cookiesFileInput) {
    cookiesFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        if (cookiesFileName) cookiesFileName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (evt) => {
          if (cookiesTextarea) cookiesTextarea.value = evt.target.result;
        };
        reader.readAsText(file);
      }
    });
  }

  if (saveCookiesBtn) {
    saveCookiesBtn.addEventListener("click", async () => {
      const text = cookiesTextarea ? cookiesTextarea.value.trim() : "";
      if (!text) {
        showToast("Please paste Netscape cookies text or upload a cookies.txt file.", "error");
        return;
      }
      saveCookiesBtn.disabled = true;
      saveCookiesBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
      try {
        const response = await fetch("/api/cookies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cookies: text })
        });
        const data = await response.json();
        if (response.ok) {
          showToast(`YouTube cookies saved (${data.lines} entries loaded)!`, "success");
          fetchCookiesStatus();
          closeCookiesModal();
        } else {
          showToast(data.error || "Failed to save cookies.", "error");
        }
      } catch (err) {
        showToast("Error saving cookies: " + err.message, "error");
      } finally {
        saveCookiesBtn.disabled = false;
        saveCookiesBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save &amp; Apply Cookies';
      }
    });
  }

  if (deleteCookiesBtn) {
    deleteCookiesBtn.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to clear your saved YouTube cookies?")) return;
      try {
        const response = await fetch("/api/cookies", { method: "DELETE" });
        const data = await response.json();
        if (response.ok) {
          if (cookiesTextarea) cookiesTextarea.value = "";
          if (cookiesFileName) cookiesFileName.textContent = "No file chosen";
          showToast("YouTube cookies cleared.", "info");
          fetchCookiesStatus();
        } else {
          showToast(data.error || "Failed to clear cookies.", "error");
        }
      } catch (err) {
        showToast("Error clearing cookies: " + err.message, "error");
      }
    });
  }
});

