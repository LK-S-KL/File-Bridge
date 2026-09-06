(function () {
  "use strict";

  var DEFAULT_ROOT = "/Volumes/团队文件-剪辑共享/0813-MIniMax";
  var MAX_SCAN_FILES = 10000;
  var LABELS = ["none", "red", "orange", "yellow", "green", "blue", "purple"];

  var nodeAvailable = typeof require === "function";
  var fs = nodeAvailable ? require("fs") : null;
  var path = nodeAvailable ? require("path") : null;
  var os = nodeAvailable ? require("os") : null;
  var crypto = nodeAvailable ? require("crypto") : null;
  var childProcess = nodeAvailable ? require("child_process") : null;
  var csInterface = typeof CSInterface === "function" ? new CSInterface() : null;
  var mediaTools = nodeAvailable ? FnOSMediaTools.create({ fs: fs, path: path, os: os, crypto: crypto, childProcess: childProcess }) : null;
  var lutTools = nodeAvailable ? FnOSLutTools.create({ fs: fs, path: path }) : null;
  var stateStore = nodeAvailable ? FnOSStateStore.create({ fs: fs, path: path, os: os }) : null;
  var fileOps = nodeAvailable ? FnOSFileOps.create({ fs: fs, path: path, childProcess: childProcess }) : null;
  var assetOps = nodeAvailable ? FnOSAssetOps.create({ fs: fs, path: path, childProcess: childProcess }) : null;
  var projectPackager = nodeAvailable ? FnOSProjectPackager.create({ fs: fs, path: path, platform: process.platform }) : null;
  var persisted = stateStore ? stateStore.load() : FnOSStateStore.defaults();

  var state = {
    hostId: "BROWSER",
    roots: persisted.roots,
    assetMeta: persisted.assetMeta,
    libraryCache: persisted.libraryCache || {},
    preferences: persisted.preferences,
    assets: [],
    visibleAssets: [],
    assetById: {},
    selectedId: null,
    selectedIds: {},
    selectionAnchorId: null,
    contextId: null,
    folderScope: null,
    copiedLabel: null,
    filter: "all",
    favoriteOnly: false,
    query: "",
    filters: {
      size: "all",
      extensions: [],
      label: "all",
      rootId: "all",
      metadataOnly: false
    },
    scanning: false,
    activeScanSignal: null,
    dialogAction: null,
    scanGeneration: 0
  };

  var viewerState = {
    asset: null,
    media: null,
    metadata: null,
    inPoint: 0,
    outPoint: null,
    hasIn: false,
    hasOut: false,
    loop: false,
    profile: "source",
    audioProxyPath: "",
    audioProxyStatus: "idle",
    loadToken: 0,
    frameRequest: 0,
    isSeeking: false,
    timeDisplayMode: "timecode",
    sourcePlayable: false,
    autoProxyReady: "",
    autoKeepSource: false,
    autoTimer: null
  };

  var lutState = { asset: null, lut: null, original: null, processed: null, renderFrame: 0 };
  var previewQueue = [];
  var activePreviewJobs = 0;
  var renderGeneration = 0;
  var visualObserver = null;
  var altPressed = false;
  var audioHover = { timer: null, media: null, assetId: null };

  var elements = {};
  var filterTimer = null;
  var noticeTimer = null;
  var preferenceTimer = null;
  var metadataHoverToken = 0;
  var resizeFrame = 0;

  function byId(id) { return document.getElementById(id); }

  function cacheElements() {
    [
      "appShell", "hostLabel", "refreshButton", "locationsButton", "addFolderButton", "upFolderButton", "mountStatus", "rootLabel",
      "selectAllButton", "searchToggleButton", "favoriteOnlyButton", "sortButton", "sortPopover", "sortSelect", "sortDirectionButton", "filterButton", "viewModeButton", "cardStyleButton", "packageProjectButton",
      "searchInput", "clearSearchButton", "toolbarSearchPopover", "filterBadge", "zoomRange", "resultCount", "resultActionsButton", "resultActionsPopover", "createFolderFromResultsButton", "uploadFilesButton", "notice", "operationProgress", "operationProgressLabel", "operationProgressBar", "assetGrid", "emptyState", "emptyTitle", "emptyMessage",
      "statusText", "locationsPopover", "locationsList", "addFolderFromPopover", "toggleAllRootsButton", "filterPopover",
      "resetFiltersButton", "sizeFilter", "extensionFilter", "labelFilter", "labelFilterChoices", "rootFilter", "metadataOnlyFilter",
      "contextMenu", "insertSubmenuRow", "contextAePlaceButton", "contextLabelChoices", "copyLabelButton", "pasteLabelButton", "clearLabelButton", "folderSubmenuRow", "folderSubmenu", "metadataHover", "metadataPanel", "metadataTitle", "metadataPreview", "metadataLoading",
      "metadataList", "closeMetadataButton", "viewer", "viewerTitle", "viewerSubtitle", "closeViewerButton", "viewerStage", "viewerMediaLayer", "viewerBusy",
      "viewerTimeline", "timelineTrackWrap", "viewerScrubber", "viewerInMark", "viewerOutMark", "frameBackButton", "playPauseButton", "frameForwardButton", "viewerTimecode",
      "loopButton", "volumeButton", "volumeRange", "screenshotButton", "qualityButton", "viewerQualityMenu", "viewerMarks", "lutViewer", "lutViewerTitle", "lutViewerSubtitle",
      "closeLutViewerButton", "lutCanvas", "lutSplitRange", "lutOpacityRange", "installLutButton", "fileActionDialog", "dialogTitle",
      "dialogMessage", "renameField", "renameInput", "dialogCancelButton", "dialogConfirmButton"
    ].forEach(function (id) { elements[id] = byId(id); });
    elements.searchField = elements.toolbarSearchPopover ? elements.toolbarSearchPopover.querySelector(".search-field") : document.querySelector(".search-field");
    elements.filterButtons = document.querySelectorAll(".filter-button");
  }

  function ensureContextMenuExtensions() {
    var labelMenu;
    var labelTitle;
    var info;
    var infoHint;
    var favorite;
    var clear;
    if (!elements.contextMenu) { return; }
    labelMenu = elements.contextMenu.querySelector(".label-menu");
    labelTitle = labelMenu && labelMenu.children && labelMenu.children[0] && labelMenu.children[0].tagName === "SPAN" ? labelMenu.children[0] : null;
    if (labelTitle) { labelTitle.textContent = "色彩标签"; }
    info = elements.contextMenu.querySelector("button.info-command");
    infoHint = info && info.querySelector("span");
    if (infoHint) { infoHint.remove(); }
    favorite = elements.contextMenu.querySelector('[data-command="favorite"]');
    if (favorite && !favorite.getAttribute("data-label-normalized")) {
      favorite.setAttribute("data-label-normalized", "true");
      favorite.textContent = "收藏";
    }
    clear = elements.contextMenu.querySelector('[data-command="clear-label"]');
    if (!clear && elements.pasteLabelButton) {
      clear = document.createElement("button");
      clear.type = "button";
      clear.id = "clearLabelButton";
      clear.setAttribute("data-command", "clear-label");
      clear.textContent = "清除标签";
      elements.pasteLabelButton.insertAdjacentElement("afterend", clear);
    }
    elements.clearLabelButton = clear || null;
  }

  function stableRootId(rootPath) {
    if (crypto) {
      return crypto.createHash("sha1").update(String(rootPath)).digest("hex").slice(0, 12);
    }
    return "root-" + String(rootPath).length;
  }

  function displayNameForPath(rootPath) {
    if (!path) { return String(rootPath).split("/").pop() || rootPath; }
    return path.basename(rootPath) || rootPath;
  }

  function initializeRoots() {
    var legacy;
    if (state.roots.length) {
      if (!state.preferences.activeRootId || !state.roots.some(function (root) { return root.id === state.preferences.activeRootId; })) {
        state.preferences.activeRootId = state.roots[0].id;
        persistPreferences();
      }
      return;
    }
    legacy = localStorage.getItem("seekBridge.rootPath");
    state.roots = [{
      id: stableRootId(legacy || DEFAULT_ROOT),
      path: legacy || DEFAULT_ROOT,
      label: displayNameForPath(legacy || DEFAULT_ROOT),
      enabled: true
    }];
    state.preferences.activeRootId = state.roots[0].id;
    persistRoots();
    persistPreferences();
  }

  function persistRoots() {
    if (!stateStore) { return; }
    stateStore.mutate(function (latest) { latest.roots = state.roots; });
  }

  function persistPreferences() {
    if (!stateStore) { return; }
    stateStore.mutate(function (latest) { latest.preferences = state.preferences; });
  }

  function schedulePreferencePersist() {
    clearTimeout(preferenceTimer);
    preferenceTimer = setTimeout(persistPreferences, 240);
  }

  function normalizeAssetKey(value) {
    var normalized = String(value || "").replace(/\\/g, "/");
    return FolderPlatformIsWindows() ? normalized.toLowerCase() : normalized;
  }

  function FolderPlatformIsWindows() {
    return typeof process !== "undefined" && process.platform === "win32";
  }

  function localMetaFor(asset) {
    return state.assetMeta[normalizeAssetKey(asset.path)] || { favorite: false, label: "none", metadataCached: false };
  }

  function updateLocalMeta(asset, patch) {
    var key = normalizeAssetKey(asset.path);
    var updated;
    if (!stateStore) {
      state.assetMeta[key] = Object.assign({}, localMetaFor(asset), patch);
      return state.assetMeta[key];
    }
    persisted = stateStore.mutate(function (latest) {
      latest.assetMeta[key] = Object.assign({}, latest.assetMeta[key] || {}, patch);
    });
    state.assetMeta = persisted.assetMeta;
    updated = state.assetMeta[key];
    return updated;
  }

  function migrateLocalMeta(oldPath, newPath) {
    var oldKey = normalizeAssetKey(oldPath);
    var newKey = normalizeAssetKey(newPath);
    if (!stateStore) {
      if (state.assetMeta[oldKey]) {
        state.assetMeta[newKey] = state.assetMeta[oldKey];
        delete state.assetMeta[oldKey];
      }
      return;
    }
    persisted = stateStore.mutate(function (latest) {
      if (latest.assetMeta[oldKey]) {
        latest.assetMeta[newKey] = latest.assetMeta[oldKey];
        delete latest.assetMeta[oldKey];
      }
    });
    state.assetMeta = persisted.assetMeta;
  }

  function detectHost() {
    var environment;
    try {
      environment = csInterface && csInterface.getHostEnvironment();
      state.hostId = environment && environment.appId ? environment.appId : "BROWSER";
    } catch (error) {
      state.hostId = "BROWSER";
    }
    elements.hostLabel.textContent = state.hostId === "PPRO" ? "Premiere Pro" : state.hostId === "AEFT" ? "After Effects" : "界面预览";
    elements.screenshotButton.hidden = state.hostId !== "PPRO";
    elements.packageProjectButton.hidden = state.hostId !== "PPRO";
  }

  function bindEvents() {
    elements.refreshButton.addEventListener("click", scanAssets);
    elements.locationsButton.addEventListener("click", function (event) {
      event.stopPropagation();
      togglePopover(elements.locationsPopover, elements.locationsButton);
    });
    elements.addFolderButton.addEventListener("click", chooseFolder);
    elements.addFolderFromPopover.addEventListener("click", chooseFolder);
    elements.upFolderButton.addEventListener("click", leaveFolderScope);
    elements.toggleAllRootsButton.addEventListener("click", toggleAllRoots);
    if (elements.createFolderFromResultsButton) { elements.createFolderFromResultsButton.addEventListener("click", function () { hidePopover(elements.resultActionsPopover, elements.resultActionsButton); openCreateFolderDialog(); }); }
    if (elements.uploadFilesButton) { elements.uploadFilesButton.addEventListener("click", function () { hidePopover(elements.resultActionsPopover, elements.resultActionsButton); chooseExternalFiles(); }); }
    elements.locationsList.addEventListener("click", function (event) {
      var remove = event.target.closest("button[data-root-remove]");
      var select = event.target.closest("button[data-root-select]");
      if (remove) { removeRoot(remove.getAttribute("data-root-remove")); return; }
      if (select) { activateRoot(select.getAttribute("data-root-select")); }
    });
    elements.locationsList.addEventListener("change", function (event) {
      var toggle = event.target.closest("input[data-root-toggle]");
      if (toggle) { setRootEnabled(toggle.getAttribute("data-root-toggle"), toggle.checked); }
    });
    elements.searchInput.addEventListener("input", function () {
      state.query = elements.searchInput.value;
      elements.searchField.classList.toggle("has-value", !!state.query);
      clearTimeout(filterTimer);
      filterTimer = setTimeout(applyFilters, 90);
    });
    elements.clearSearchButton.addEventListener("click", function () {
      elements.searchInput.value = "";
      state.query = "";
      elements.searchField.classList.remove("has-value");
      applyFilters();
      elements.searchInput.focus();
    });
    if (elements.searchToggleButton) {
      elements.searchToggleButton.addEventListener("click", function (event) {
        event.stopPropagation();
        toggleSearchPopover();
      });
    }

    Array.prototype.forEach.call(elements.filterButtons, function (button) {
      button.addEventListener("click", function () {
        state.filter = button.getAttribute("data-filter") || "all";
        Array.prototype.forEach.call(elements.filterButtons, function (item) { item.classList.toggle("is-active", item === button); });
        applyFilters();
      });
    });

    elements.favoriteOnlyButton.addEventListener("click", function () {
      state.favoriteOnly = !state.favoriteOnly;
      elements.favoriteOnlyButton.classList.toggle("is-active", state.favoriteOnly);
      elements.favoriteOnlyButton.setAttribute("aria-pressed", state.favoriteOnly ? "true" : "false");
      applyFilters();
    });
    elements.selectAllButton.addEventListener("click", toggleSelectAllAssets);
    if (elements.resultActionsButton) { elements.resultActionsButton.addEventListener("click", function (event) { event.stopPropagation(); togglePopover(elements.resultActionsPopover, elements.resultActionsButton); }); }
    elements.sortButton.addEventListener("click", function (event) { event.stopPropagation(); togglePopover(elements.sortPopover, elements.sortButton); });
    elements.viewModeButton.addEventListener("click", toggleViewMode);
    if (elements.cardStyleButton) { elements.cardStyleButton.addEventListener("click", toggleCardStyle); }
    elements.packageProjectButton.addEventListener("click", packageCurrentProject);
    elements.sortSelect.value = state.preferences.sortBy;
    elements.sortSelect.addEventListener("change", function () {
      state.preferences.sortBy = elements.sortSelect.value;
      persistPreferences();
      applyFilters();
    });
    elements.sortDirectionButton.addEventListener("click", function () {
      state.preferences.sortDirection = state.preferences.sortDirection === "asc" ? "desc" : "asc";
      syncSortDirection();
      persistPreferences();
      applyFilters();
    });
    elements.filterButton.addEventListener("click", function (event) {
      event.stopPropagation();
      togglePopover(elements.filterPopover, elements.filterButton);
    });
    [elements.sizeFilter, elements.extensionFilter, elements.labelFilter, elements.rootFilter, elements.metadataOnlyFilter].forEach(function (control) {
      control.addEventListener(control === elements.extensionFilter ? "input" : "change", readAdvancedFilters);
    });
    elements.labelFilterChoices.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-filter-label]");
      if (!button) { return; }
      elements.labelFilter.value = button.getAttribute("data-filter-label");
      Array.prototype.forEach.call(elements.labelFilterChoices.querySelectorAll("button"), function (item) { item.classList.toggle("is-active", item === button); });
      readAdvancedFilters();
    });
    elements.resetFiltersButton.addEventListener("click", resetAdvancedFilters);
    elements.zoomRange.value = String(state.preferences.zoom);
    elements.zoomRange.addEventListener("input", function () {
      state.preferences.zoom = Number(elements.zoomRange.value);
      syncGridZoom();
      schedulePreferencePersist();
    });

    elements.assetGrid.addEventListener("click", function (event) {
      var card = closestCard(event.target);
      var favorite = event.target.closest("button.favorite-toggle");
      var clickedAsset;
      if (favorite && card) {
        event.preventDefault(); event.stopPropagation();
        toggleFavorite(assetForId(card.getAttribute("data-asset-id")));
        return;
      }
      if (card) {
        clickedAsset = assetForId(card.getAttribute("data-asset-id"));
        selectAsset(card.getAttribute("data-asset-id"), { toggle: event.metaKey || event.ctrlKey, range: event.shiftKey });
        if (!clickedAsset || clickedAsset.type !== "video") { stopAudioHover(); }
        if (clickedAsset && clickedAsset.type === "video" && !event.metaKey && !event.ctrlKey && !event.shiftKey) { playSelectionAudio(clickedAsset); }
      }
    });
    elements.assetGrid.addEventListener("dblclick", function (event) {
      var card = closestCard(event.target);
      if (card && !event.target.closest("button")) {
        var doubleAsset = assetForId(card.getAttribute("data-asset-id"));
        selectAsset(card.getAttribute("data-asset-id"), { only: true });
        if (doubleAsset && doubleAsset.type === "folder") { enterFolderScope(doubleAsset); }
        else { openViewer(doubleAsset); }
      }
    });
    elements.assetGrid.addEventListener("keydown", function (event) {
      var card = closestCard(event.target);
      if (!card) { return; }
      if (event.key === "Enter") {
        var keyAsset = assetForId(card.getAttribute("data-asset-id"));
        selectAsset(card.getAttribute("data-asset-id"), { only: true });
        if (keyAsset && keyAsset.type === "folder") { enterFolderScope(keyAsset); }
        else { openViewer(keyAsset); }
      } else if (event.key === " ") {
        event.preventDefault();
        selectAsset(card.getAttribute("data-asset-id"), { toggle: true });
      }
    });
    elements.assetGrid.addEventListener("contextmenu", openContextMenu);
    elements.assetGrid.addEventListener("dragstart", startAssetDrag);
    elements.assetGrid.addEventListener("dragend", function (event) {
      var card = closestCard(event.target);
      if (card) { card.classList.remove("is-dragging"); }
    });
    elements.assetGrid.addEventListener("mouseover", beginSpritePreview);
    elements.assetGrid.addEventListener("mousemove", scrubSpritePreview);
    elements.assetGrid.addEventListener("mouseout", endSpritePreview);
    elements.assetGrid.addEventListener("dragover", handleLibraryDragOver);
    elements.assetGrid.addEventListener("dragleave", function (event) { var card = closestCard(event.target); if (card && (!event.relatedTarget || !card.contains(event.relatedTarget))) { card.classList.remove("is-drop-target"); } });
    elements.assetGrid.addEventListener("drop", handleLibraryDrop);

    elements.contextMenu.addEventListener("click", handleContextCommand);
    elements.contextMenu.addEventListener("mouseover", function (event) {
      var item = event.target.closest("button.info-command");
      var asset = assetForId(state.contextId);
      if (item && asset && (!event.relatedTarget || !item.contains(event.relatedTarget))) { showMetadataHover(asset, item); }
    });
    elements.contextMenu.addEventListener("mouseout", function (event) {
      var item = event.target.closest("button.info-command");
      if (item && (!event.relatedTarget || !item.contains(event.relatedTarget))) { hideMetadataHover(); }
    });
    elements.contextLabelChoices.addEventListener("click", function (event) {
      var choice = event.target.closest("button[data-label]");
      var assets = selectedAssets();
      if (choice && assets.length) {
        assets.forEach(function (asset) { setColorLabel(asset, choice.getAttribute("data-label"), true); });
        if (state.filters.label !== "all") { applyFilters(); } else { renderAssets(); }
        closeContextMenu();
      }
    });

    elements.closeMetadataButton.addEventListener("click", closeMetadata);
    elements.closeViewerButton.addEventListener("click", closeViewer);
    elements.viewerStage.addEventListener("dragstart", startViewerDrag);
    elements.playPauseButton.addEventListener("click", toggleViewerPlayback);
    elements.frameBackButton.addEventListener("click", function () { navigateViewerAsset(-1); });
    elements.frameForwardButton.addEventListener("click", function () { navigateViewerAsset(1); });
    if (elements.markInButton) { elements.markInButton.addEventListener("click", markViewerIn); }
    if (elements.markOutButton) { elements.markOutButton.addEventListener("click", markViewerOut); }
    if (elements.timelineTrackWrap) {
      elements.timelineTrackWrap.addEventListener("click", handleTimelineMouse);
      elements.timelineTrackWrap.addEventListener("contextmenu", handleTimelineMouse);
    }
    elements.loopButton.addEventListener("click", toggleViewerLoop);
    elements.qualityButton.addEventListener("click", function (event) { event.stopPropagation(); elements.viewerQualityMenu.hidden = !elements.viewerQualityMenu.hidden; elements.qualityButton.setAttribute("aria-expanded", elements.viewerQualityMenu.hidden ? "false" : "true"); });
    elements.viewerQualityMenu.addEventListener("click", chooseViewerQuality);
    elements.volumeButton.addEventListener("click", toggleViewerMute);
    elements.volumeRange.addEventListener("input", updateViewerVolume);
    elements.viewerTimecode.addEventListener("click", toggleViewerTimeDisplay);
    elements.viewerScrubber.addEventListener("input", seekViewerFromSlider);
    elements.viewerScrubber.addEventListener("change", function () { viewerState.isSeeking = false; });
    elements.screenshotButton.addEventListener("click", captureViewerFrame);
    elements.closeLutViewerButton.addEventListener("click", closeLutViewer);
    elements.lutSplitRange.addEventListener("input", scheduleLutRender);
    elements.lutOpacityRange.addEventListener("input", scheduleLutRender);
    elements.installLutButton.addEventListener("click", installCurrentLut);
    elements.dialogCancelButton.addEventListener("click", closeDialog);
    elements.dialogConfirmButton.addEventListener("click", confirmDialogAction);
    elements.renameInput.addEventListener("keydown", function (event) { if (event.key === "Enter") { confirmDialogAction(); } });

    document.addEventListener("click", function (event) {
      if (!elements.locationsPopover.contains(event.target) && event.target !== elements.locationsButton) { hidePopover(elements.locationsPopover, elements.locationsButton); }
      if (!elements.sortPopover.contains(event.target) && event.target !== elements.sortButton) { hidePopover(elements.sortPopover, elements.sortButton); }
      if (!elements.filterPopover.contains(event.target) && event.target !== elements.filterButton) { hidePopover(elements.filterPopover, elements.filterButton); }
      if (elements.resultActionsPopover && !elements.resultActionsPopover.contains(event.target) && event.target !== elements.resultActionsButton) { hidePopover(elements.resultActionsPopover, elements.resultActionsButton); }
      if (elements.toolbarSearchPopover && !elements.toolbarSearchPopover.contains(event.target) && event.target !== elements.searchToggleButton) { hideSearchPopover(); }
      if (!elements.viewerQualityMenu.contains(event.target) && event.target !== elements.qualityButton) { elements.viewerQualityMenu.hidden = true; elements.qualityButton.setAttribute("aria-expanded", "false"); }
      if (!elements.contextMenu.contains(event.target)) { closeContextMenu(); }
    });
    document.addEventListener("keydown", function (event) {
      var editing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target && event.target.tagName || "");
      if (event.key === "Alt") { altPressed = true; }
      if (!elements.viewer.hidden && !editing) {
        if (event.key === " " || event.code === "Space") { event.preventDefault(); event.stopImmediatePropagation(); closeViewer(); return; }
        if (event.key.toLowerCase() === "i") { markViewerIn(); return; }
        if (event.key.toLowerCase() === "o") { markViewerOut(); return; }
        if (event.key === "ArrowLeft") { event.preventDefault(); stepViewerFrame(-1); return; }
        if (event.key === "ArrowRight") { event.preventDefault(); stepViewerFrame(1); return; }
      }
      if (event.key !== "Escape") { return; }
      if (!elements.fileActionDialog.hidden) { closeDialog(); }
      else if (!elements.lutViewer.hidden) { closeLutViewer(); }
      else if (!elements.viewer.hidden) { closeViewer(); }
      else if (!elements.metadataPanel.hidden) { closeMetadata(); }
      else { closeContextMenu(); hidePopover(elements.locationsPopover, elements.locationsButton); hidePopover(elements.sortPopover, elements.sortButton); hidePopover(elements.filterPopover, elements.filterButton); if (elements.resultActionsPopover) { hidePopover(elements.resultActionsPopover, elements.resultActionsButton); } hideSearchPopover(); }
    });
    document.addEventListener("keydown", function (event) {
      var asset;
      if ((event.key !== " " && event.code !== "Space") || !elements.viewer.hidden || !elements.lutViewer.hidden || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target && event.target.tagName || "")) { return; }
      asset = selectedAsset();
      if (asset) { event.preventDefault(); if (asset.type === "folder") { enterFolderScope(asset); } else { openViewer(asset); } }
    });
    document.addEventListener("keyup", function (event) { if (event.key === "Alt") { altPressed = false; } });
    window.addEventListener("blur", function () { altPressed = false; });
    window.addEventListener("resize", function () {
      if (resizeFrame) { cancelAnimationFrame(resizeFrame); }
      resizeFrame = requestAnimationFrame(function () { resizeFrame = 0; syncGridZoom(); });
    });
    window.addEventListener("beforeunload", function () { if (preferenceTimer) { clearTimeout(preferenceTimer); persistPreferences(); } });
  }

  function closestCard(target) {
    while (target && target !== elements.assetGrid) {
      if (target.classList && target.classList.contains("asset-card")) { return target; }
      target = target.parentNode;
    }
    return null;
  }

  function togglePopover(popover, trigger) {
    var show;
    var rect;
    if (!popover || !trigger) { return; }
    show = popover.hidden;
    hidePopover(elements.locationsPopover, elements.locationsButton);
    hidePopover(elements.sortPopover, elements.sortButton);
    hidePopover(elements.filterPopover, elements.filterButton);
    if (elements.resultActionsPopover && popover !== elements.resultActionsPopover) { hidePopover(elements.resultActionsPopover, elements.resultActionsButton); }
    if (elements.toolbarSearchPopover && popover !== elements.toolbarSearchPopover) { hideSearchPopover(); }
    popover.hidden = !show;
    trigger.setAttribute("aria-expanded", show ? "true" : "false");
    if (show && (popover === elements.sortPopover || popover === elements.filterPopover || popover === elements.resultActionsPopover)) {
      rect = trigger.getBoundingClientRect();
      popover.style.maxHeight = Math.max(48, window.innerHeight - 16) + "px";
      popover.style.top = Math.max(8, Math.min(window.innerHeight - popover.offsetHeight - 8, rect.bottom + 7)) + "px";
      popover.style.left = Math.max(8, Math.min(window.innerWidth - popover.offsetWidth - 8, rect.left)) + "px";
      popover.style.right = "auto";
    }
  }

  function hidePopover(popover, trigger) {
    if (!popover) { return; }
    popover.hidden = true;
    if (trigger) { trigger.setAttribute("aria-expanded", "false"); }
  }

  function toggleSearchPopover() {
    var show = elements.toolbarSearchPopover.hidden;
    var rect;
    var left;
    var top;
    if (show) {
      hidePopover(elements.locationsPopover, elements.locationsButton);
      hidePopover(elements.sortPopover, elements.sortButton);
      hidePopover(elements.filterPopover, elements.filterButton);
      hidePopover(elements.resultActionsPopover, elements.resultActionsButton);
    }
    elements.toolbarSearchPopover.hidden = !show;
    elements.searchToggleButton.setAttribute("aria-expanded", show ? "true" : "false");
    elements.searchToggleButton.classList.toggle("is-active", show);
    if (show) {
      rect = elements.searchToggleButton.getBoundingClientRect();
      left = Math.max(8, Math.min(window.innerWidth - elements.toolbarSearchPopover.offsetWidth - 8, rect.left));
      top = Math.max(8, Math.min(window.innerHeight - elements.toolbarSearchPopover.offsetHeight - 8, rect.bottom + 7));
      elements.toolbarSearchPopover.style.left = left + "px";
      elements.toolbarSearchPopover.style.top = top + "px";
      elements.searchInput.focus();
    }
    state.preferences.searchOpen = show;
    schedulePreferencePersist();
  }

  function hideSearchPopover() {
    if (!elements.toolbarSearchPopover) { return; }
    elements.toolbarSearchPopover.hidden = true;
    if (elements.searchToggleButton) {
      elements.searchToggleButton.setAttribute("aria-expanded", "false");
      elements.searchToggleButton.classList.remove("is-active");
    }
    if (state.preferences.searchOpen) { state.preferences.searchOpen = false; schedulePreferencePersist(); }
  }

  function chooseExternalFiles() {
    var result;
    var destination = currentDestination();
    if (!destination || !assetOps) { showNotice("请先勾选一个可用素材位置。", true, 4000); return; }
    if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialogEx) { showNotice("当前环境无法打开文件选择器。", true, 4500); return; }
    result = window.cep.fs.showOpenDialogEx(true, false, "上传素材到当前路径", destination.path, []);
    if (!result || result.err !== 0 || !result.data || !result.data.length) { return; }
    showNotice("正在复制 " + result.data.length + " 项素材…", false, 0);
    assetOps.copyExternalFiles({ roots: state.roots, rootId: destination.rootId, destinationPath: destination.path, sourcePaths: result.data, onProgress: showOperationProgress }).then(function () {
      showNotice("素材已上传到当前路径。", false, 3500); scanAssets();
    }).catch(function (error) { showNotice("上传失败：" + friendlyError(error), true, 6500); });
  }

  function chooseFolder() {
    var result;
    if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialogEx) {
      showNotice("请在 Premiere Pro 或 After Effects 中添加素材位置。", true);
      return;
    }
    result = window.cep.fs.showOpenDialogEx(false, true, "添加 fnOS 素材位置", state.roots.length ? state.roots[0].path : DEFAULT_ROOT, []);
    if (result && result.err === 0 && result.data && result.data.length) { addRoot(result.data[0]); }
  }

  function isNestedPath(candidate, existing) {
    var relative = path.relative(existing, candidate);
    return relative === "" || (relative && relative.indexOf("..") !== 0 && !path.isAbsolute(relative));
  }

  function addRoot(rootPath) {
    var finished = false;
    var timeout;
    function finishCheck(message, isError) {
      if (finished) { return false; }
      finished = true; clearTimeout(timeout);
      elements.addFolderButton.disabled = false; elements.addFolderFromPopover.disabled = false;
      if (message) { showNotice(message, !!isError, isError ? 5000 : 4000); }
      return true;
    }
    if (!nodeAvailable) { showNotice("请在 Adobe 面板中添加真实素材位置。", true, 4000); return; }
    elements.addFolderButton.disabled = true; elements.addFolderFromPopover.disabled = true;
    showNotice("正在检查素材位置…", false, 0);
    timeout = setTimeout(function () { finishCheck("检查素材位置超时；面板仍可继续使用，请确认 SMB 连接后重试。", true); }, 20000);
    fs.stat(rootPath, function (statError, stat) {
      if (finished) { return; }
      if (statError || !stat || !stat.isDirectory()) {
        finishCheck("所选素材位置当前不可读取。", true); return;
      }
      fs.realpath(rootPath, function (realError, resolved) {
        var canonical = realError ? path.resolve(rootPath) : resolved;
        var conflict = state.roots.some(function (root) {
          var existing = path.resolve(root.path);
          return isNestedPath(canonical, existing) || isNestedPath(existing, canonical);
        });
        if (finished) { return; }
        if (conflict) { finishCheck("这个位置已经添加，或与现有位置互相包含。", true); return; }
        if (!finishCheck("已添加素材位置。", false)) { return; }
        state.roots.push({ id: stableRootId(canonical), path: canonical, label: displayNameForPath(canonical), enabled: true });
        state.preferences.activeRootId = state.roots[state.roots.length - 1].id;
        persistRoots(); persistPreferences(); renderLocations(); scanAssets();
      });
    });
  }

  function removeRoot(rootId) {
    if (state.roots.length <= 1) {
      showNotice("至少保留一个素材位置。", true, 4000);
      return;
    }
    state.roots = state.roots.filter(function (root) { return root.id !== rootId; });
    if (state.filters.rootId === rootId) { state.filters.rootId = "all"; }
    if (state.preferences.activeRootId === rootId) { state.preferences.activeRootId = state.roots[0].id; persistPreferences(); }
    persistRoots();
    renderLocations();
    scanAssets();
  }

  function renderLocations() {
    var onlineCount = 0;
    elements.locationsList.innerHTML = "";
    elements.rootFilter.innerHTML = '<option value="all">全部位置</option>';
    state.roots.forEach(function (root) {
      var row = document.createElement("div");
      var toggle = document.createElement("input");
      var select = document.createElement("button");
      var dot = document.createElement("span");
      var copy = document.createElement("div");
      var name = document.createElement("strong");
      var pathText = document.createElement("span");
      var remove = document.createElement("button");
      var option = document.createElement("option");
      var online = root.online !== false;
      if (online) { onlineCount += 1; }
      row.className = "location-item";
      row.classList.toggle("is-active", root.id === state.preferences.activeRootId);
      toggle.type = "checkbox"; toggle.className = "location-toggle"; toggle.checked = root.enabled !== false;
      toggle.setAttribute("data-root-toggle", root.id); toggle.setAttribute("aria-label", "选择 " + (root.label || root.path));
      select.type = "button"; select.className = "location-select"; select.setAttribute("data-root-select", root.id);
      dot.className = "status-dot " + (online ? "is-online" : "is-offline");
      copy.className = "location-copy";
      name.textContent = root.label || displayNameForPath(root.path);
      pathText.textContent = root.path;
      pathText.title = root.path;
      copy.appendChild(name); copy.appendChild(pathText);
      remove.type = "button"; remove.textContent = "×"; remove.title = "移除此素材位置"; remove.setAttribute("data-root-remove", root.id);
      select.appendChild(dot); select.appendChild(copy);
      row.appendChild(toggle); row.appendChild(select); row.appendChild(remove);
      elements.locationsList.appendChild(row);
      option.value = root.id; option.textContent = root.label || displayNameForPath(root.path); elements.rootFilter.appendChild(option);
    });
    if (!state.roots.some(function (root) { return root.id === state.filters.rootId; })) { state.filters.rootId = "all"; }
    elements.rootFilter.value = state.filters.rootId;
    var scanningRoots = rootsForCurrentScan();
    elements.rootLabel.textContent = state.folderScope ? state.folderScope.path : scanningRoots.length === 1 ? scanningRoots[0].path : scanningRoots.length ? scanningRoots.length + " 组素材位置" : "未选择素材位置";
    elements.rootLabel.title = state.roots.map(function (root) { return root.path; }).join("\n");
    elements.mountStatus.className = "status-dot " + (onlineCount === state.roots.length ? "is-online" : onlineCount ? "is-partial" : "is-offline");
    elements.toggleAllRootsButton.textContent = scanningRoots.length === state.roots.length && state.roots.length ? "取消全选" : "全选";
    elements.upFolderButton.hidden = !state.folderScope;
  }

  function rootsForCurrentScan() {
    return state.roots.filter(function (root) { return root.enabled !== false; });
  }

  function activateRoot(rootId) {
    var root = state.roots.filter(function (item) { return item.id === rootId; })[0];
    if (!root) { return; }
    state.preferences.activeRootId = rootId;
    state.folderScope = null;
    persistPreferences();
    renderLocations();
  }

  function setRootEnabled(rootId, enabled) {
    var target = state.roots.filter(function (root) { return root.id === rootId; })[0];
    if (!target) { return; }
    target.enabled = !!enabled;
    if (enabled) { state.preferences.activeRootId = rootId; persistPreferences(); }
    else if (state.preferences.activeRootId === rootId) {
      var nextRoot = state.roots.filter(function (root) { return root.enabled !== false; })[0];
      state.preferences.activeRootId = nextRoot ? nextRoot.id : ""; persistPreferences();
    }
    state.folderScope = null;
    persistRoots();
    renderLocations();
    scanAssets();
  }

  function toggleAllRoots() {
    var enable = rootsForCurrentScan().length !== state.roots.length;
    state.roots.forEach(function (root) { root.enabled = enable; });
    state.preferences.activeRootId = enable && state.roots.length ? state.roots[0].id : ""; persistPreferences();
    state.folderScope = null; persistRoots(); renderLocations(); scanAssets();
  }

  function scanRootWithWatchdog(root, progress, cancelSignal) {
    return new Promise(function (resolve) {
      var watchdog;
      function armWatchdog() {
        clearTimeout(watchdog);
        watchdog = setTimeout(function () {
          showNotice("SMB 响应较慢，仍在后台读取；现有素材可以继续使用。", false, 0);
        }, 15000);
      }
      armWatchdog();
      if (cancelSignal.cancelled) { clearTimeout(watchdog); resolve({ assets: [], warnings: [], truncated: false, offline: false, cancelled: true }); return; }
      SeekLibrary.scanLibraryAsync(root.path, { fs: fs, path: path }, { maxFiles: MAX_SCAN_FILES, maxDepth: 10, batchSize: 40, includeDirectories: true, cancelSignal: cancelSignal }, function (snapshot) {
        armWatchdog(); progress(snapshot);
      }).then(function (result) {
        clearTimeout(watchdog); resolve(result);
      }, function (error) {
        clearTimeout(watchdog);
        resolve({ assets: [], warnings: [root.path + ": " + friendlyError(error)], truncated: false, offline: true });
      });
    });
  }

  function scanAssets() {
    var combined = [];
    var seen = {};
    var warnings = 0;
    var offline = 0;
    var truncated = 0;
    var roots;
    var token;
    var chain;
    var scanSignal;
    var cacheChanged = false;
    if (state.scanning) { state.pendingScan = true; if (state.activeScanSignal) { state.activeScanSignal.cancelled = true; } return; }
    if (!nodeAvailable) { loadPreviewAssets(); return; }
    roots = rootsForCurrentScan();
    if (!roots.length) {
      state.assets = []; rebuildAssetMap(); applyFilters();
      showNotice("当前浏览范围没有选中素材位置。", true, 4000);
      return;
    }
    state.scanning = true;
    state.pendingScan = false;
    scanSignal = { cancelled: false };
    state.activeScanSignal = scanSignal;
    token = ++state.scanGeneration;
    elements.refreshButton.disabled = true;
    elements.refreshButton.classList.add("is-spinning");
    elements.rootLabel.textContent = "正在读取 " + roots.length + " 组素材…";
    elements.statusText.textContent = "正在读取素材位置…";
    chain = Promise.resolve();
    roots.forEach(function (root, rootIndex) {
      chain = chain.then(function () {
        return scanRootWithWatchdog(root, function (progress) {
          if (token !== state.scanGeneration) { return; }
          elements.rootLabel.textContent = "正在读取 " + (rootIndex + 1) + "/" + roots.length + " · 已发现 " + (combined.length + progress.found) + " 项";
        }, scanSignal);
      }).then(function (result) {
        if (result.cancelled) { return; }
        root.online = !result.offline;
        if (result.offline) {
          offline += 1;
          result.assets = (state.libraryCache[root.id] || []).map(function (asset) { var cached = Object.assign({}, asset); cached.offline = true; return cached; });
        } else {
          state.libraryCache[root.id] = result.assets.map(function (asset) { return { name: asset.name, path: asset.path, relativePath: asset.relativePath, folder: asset.folder, extension: asset.extension, type: asset.type, size: asset.size, modifiedMs: asset.modifiedMs }; });
          cacheChanged = true;
        }
        if (result.truncated) { truncated += 1; }
        warnings += result.warnings.length;
        result.assets.forEach(function (asset) {
          var key = normalizeAssetKey(asset.path);
          if (seen[key]) { return; }
          seen[key] = true;
          asset.rootId = root.id;
          asset.rootPath = root.path;
          asset.rootLabel = root.label || displayNameForPath(root.path);
          asset.id = root.id + ":" + asset.relativePath;
          asset.domId = crypto.createHash("sha1").update(asset.id).digest("hex").slice(0, 16);
          combined.push(asset);
        });
      });
    });
    chain.then(function () {
      if (scanSignal.cancelled) { return; }
      state.assets = combined;
      if (state.folderScope && !combined.some(function (asset) { return asset.type === "folder" && asset.rootId === state.folderScope.rootId && asset.path === state.folderScope.path; })) { state.folderScope = null; }
      rebuildAssetMap();
      renderLocations();
      elements.statusText.textContent = "已读取 " + combined.length + " 项素材";
      if (offline) { showNotice(offline + " 组素材离线，其余位置仍可使用。", false, 5500); }
      else if (truncated) { showNotice(truncated + " 组素材达到扫描上限，建议选择更小的文件夹。", false, 5500); }
      else if (warnings) { showNotice("有 " + warnings + " 个子位置暂时无法读取。", false, 5500); }
      applyFilters();
      if (cacheChanged && stateStore) {
        setTimeout(function () { persisted = stateStore.mutate(function (latest) { latest.libraryCache = state.libraryCache; }); state.libraryCache = persisted.libraryCache; }, 0);
      }
    }).catch(function (error) {
      showNotice("读取素材失败：" + friendlyError(error), true, 0);
    }).then(function () {
      state.scanning = false;
      if (state.activeScanSignal === scanSignal) { state.activeScanSignal = null; }
      if (token === state.scanGeneration) { state.scanGeneration += 1; }
      elements.refreshButton.disabled = false;
      elements.refreshButton.classList.remove("is-spinning");
      renderLocations();
      if (state.pendingScan) { setTimeout(scanAssets, 0); }
    });
  }

  function loadPreviewAssets() {
    var examples = [
      ["EVO4-Pro_产品特写.mov", "video", 238412800], ["fnOS_界面录屏.mp4", "video", 98304000],
      ["Seek_封面主视觉.png", "image", 6021120], ["发布会_环境声.wav", "audio", 48128000],
      ["工作流示意图.jpg", "image", 3184128], ["用户采访_A机位.mp4", "video", 438412800],
      ["fnOS_Neutral_Film.cube", "lut", 94682], ["品牌资产", "folder", 0]
    ];
    if (window.location.search.indexOf("stress=1") !== -1) {
      examples = [];
      for (var stressIndex = 0; stressIndex < 620; stressIndex += 1) { examples.push(["压力测试素材_" + String(stressIndex + 1).padStart(4, "0") + ".mp4", "video", 1024 * 1024 * (1 + stressIndex % 90)]); }
    }
    state.roots = [{ id: "preview", path: "/Volumes/团队文件-剪辑共享/预览", label: "团队素材预览", enabled: true }];
    state.preferences.activeRootId = "preview";
    state.assets = examples.map(function (example, index) {
      return { id: "preview:" + index, domId: "preview-" + index, name: example[0], path: state.roots[0].path + "/" + example[0], relativePath: example[0], folder: "团队素材预览", extension: example[0].split(".").pop().toLowerCase(), type: example[1], size: example[2], modifiedMs: Date.now() - index * 3600000, rootId: "preview", rootPath: state.roots[0].path, rootLabel: state.roots[0].label };
    });
    state.assets[0].mediaMetadata = {
      format: "MOV", formatShort: "mov", duration: 18.542, totalBitrate: 84200000,
      videoCodec: "H.265 / HEVC", videoProfile: "Main 10", videoBitrate: 83600000,
      audioCodec: "AAC", audioProfile: "LC", audioBitrate: 320000,
      resolution: "3840 × 2160", frameRate: 25, colorSpace: "bt2020 / smpte2084 / bt2020nc",
      colorPrimaries: "bt2020", colorTransfer: "smpte2084", colorMatrix: "bt2020nc", colorRange: "tv",
      dynamicRange: "HDR10", dynamicRangeConfidence: "高", alpha: "无", alphaConfidence: "高",
      pixelFormat: "yuv420p10le", bitDepth: "10 bit", fieldOrder: "progressive",
      sampleAspectRatio: "1:1", displayAspectRatio: "16:9", audioSampleRate: 48000,
      audioChannels: "stereo", timecode: "01:00:00:00", streamCount: 2, creationTime: "2026-09-05T08:30:00Z"
    };
    rebuildAssetMap(); renderLocations(); elements.statusText.textContent = "界面预览模式"; applyFilters();
    if (window.location.search.indexOf("metadata=1") !== -1) { selectAsset(state.assets[0].domId); openMetadata(state.assets[0]); }
    if (window.location.search.indexOf("viewer=1") !== -1) { selectAsset(state.assets[0].domId); openViewer(state.assets[0]); }
  }

  function rebuildAssetMap() {
    state.assetById = {};
    state.assets.forEach(function (asset) { state.assetById[asset.domId] = asset; });
  }

  function assetForId(id) { return id ? state.assetById[id] || null : null; }
  function selectedAsset() { return assetForId(state.selectedId); }
  function readAdvancedFilters() {
    state.filters.size = elements.sizeFilter.value;
    state.filters.extensions = elements.extensionFilter.value.toLowerCase().split(/[\s,，]+/).filter(Boolean).map(function (value) { return value.replace(/^\./, ""); });
    state.filters.label = elements.labelFilter.value;
    state.filters.rootId = elements.rootFilter.value;
    state.filters.metadataOnly = elements.metadataOnlyFilter.checked;
    syncFilterBadge();
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyFilters, 100);
  }

  function resetAdvancedFilters() {
    elements.sizeFilter.value = "all"; elements.extensionFilter.value = ""; elements.labelFilter.value = "all"; elements.rootFilter.value = "all"; elements.metadataOnlyFilter.checked = false;
    readAdvancedFilters();
    Array.prototype.forEach.call(elements.labelFilterChoices.querySelectorAll("button"), function (item) { item.classList.toggle("is-active", item.getAttribute("data-filter-label") === "all"); });
  }

  function syncFilterBadge() {
    var count = 0;
    if (state.filters.size !== "all") { count += 1; }
    if (state.filters.extensions.length) { count += 1; }
    if (state.filters.label !== "all") { count += 1; }
    if (state.filters.rootId !== "all") { count += 1; }
    if (state.filters.metadataOnly) { count += 1; }
    elements.filterBadge.hidden = count === 0;
    elements.filterBadge.textContent = String(count);
    elements.filterButton.classList.toggle("is-active", count > 0);
  }

  function assetMatches(asset) {
    var local = localMetaFor(asset);
    var megabyte = 1024 * 1024;
    if (state.folderScope && (asset.rootId !== state.folderScope.rootId || path.dirname(asset.path) !== state.folderScope.path)) { return false; }
    if (!SeekLibrary.matches(asset, state.query, state.filter)) { return false; }
    if (state.favoriteOnly && !local.favorite) { return false; }
    if (state.filters.size === "small" && asset.size >= 100 * megabyte) { return false; }
    if (state.filters.size === "medium" && (asset.size < 100 * megabyte || asset.size > 1024 * megabyte)) { return false; }
    if (state.filters.size === "large" && asset.size <= 1024 * megabyte) { return false; }
    if (state.filters.extensions.length && state.filters.extensions.indexOf(asset.extension) === -1) { return false; }
    if (state.filters.label === "none" && local.label && local.label !== "none") { return false; }
    if (state.filters.label !== "all" && state.filters.label !== "none" && local.label !== state.filters.label) { return false; }
    if (state.filters.rootId !== "all" && asset.rootId !== state.filters.rootId) { return false; }
    if (state.filters.metadataOnly && !asset.mediaMetadata && !local.metadataCached) { return false; }
    return true;
  }

  function enterFolderScope(folder) {
    if (!folder || folder.type !== "folder") { return; }
    state.folderScope = { rootId: folder.rootId, path: folder.path };
    state.preferences.activeRootId = folder.rootId;
    state.selectedIds = {}; state.selectedId = null; state.selectionAnchorId = null;
    persistPreferences(); renderLocations(); applyFilters();
  }

  function leaveFolderScope() {
    var scope = state.folderScope;
    var root;
    var parent;
    if (!scope) { return; }
    root = state.roots.filter(function (item) { return item.id === scope.rootId; })[0];
    parent = path.dirname(scope.path);
    state.folderScope = root && parent !== root.path && parent.indexOf(root.path + path.sep) === 0 ? { rootId: scope.rootId, path: parent } : null;
    state.selectedIds = {}; state.selectedId = null; state.selectionAnchorId = null;
    renderLocations(); applyFilters();
  }

  function currentDestination() {
    var active = state.roots.filter(function (root) { return root.id === state.preferences.activeRootId && root.enabled !== false; })[0] || rootsForCurrentScan()[0];
    return active ? { rootId: active.id, path: state.folderScope && state.folderScope.rootId === active.id ? state.folderScope.path : active.path } : null;
  }

  function compareAssets(left, right) {
    var by = state.preferences.sortBy;
    var direction = state.preferences.sortDirection === "asc" ? 1 : -1;
    var leftValue;
    var rightValue;
    var leftPinned = localMetaFor(left).pinned === true;
    var rightPinned = localMetaFor(right).pinned === true;
    if (leftPinned !== rightPinned) { return leftPinned ? -1 : 1; }
    if (left.type === "folder" && right.type !== "folder") { return -1; }
    if (right.type === "folder" && left.type !== "folder") { return 1; }
    if (by === "name") { return left.name.localeCompare(right.name, "zh-CN", { numeric: true }) * direction; }
    if (by === "type") { return ((left.type + left.extension).localeCompare(right.type + right.extension) || left.name.localeCompare(right.name, "zh-CN", { numeric: true })) * direction; }
    if (by === "size") { leftValue = left.size; rightValue = right.size; }
    else if (by === "duration") { leftValue = left.mediaMetadata && left.mediaMetadata.duration || 0; rightValue = right.mediaMetadata && right.mediaMetadata.duration || 0; }
    else { leftValue = left.modifiedMs; rightValue = right.modifiedMs; }
    if (leftValue === rightValue) { return left.name.localeCompare(right.name, "zh-CN", { numeric: true }); }
    return (leftValue - rightValue) * direction;
  }

  function applyFilters() {
    state.visibleAssets = state.assets.filter(assetMatches).sort(compareAssets);
    renderAssets();
  }

  function renderAssets() {
    var fragment = document.createDocumentFragment();
    var renderList = state.visibleAssets;
    var selectedVisible = false;
    var visuals = [];
    renderGeneration += 1;
    previewQueue = [];
    if (visualObserver) { visualObserver.disconnect(); visualObserver = null; }
    if (typeof IntersectionObserver === "function") {
      visualObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var task = entry.target.__fnosVisualTask;
          if (!entry.isIntersecting || !task) { return; }
          visualObserver.unobserve(entry.target); delete entry.target.__fnosVisualTask;
          enqueuePreview(function () { return generateVisual(task.asset, entry.target, task.generation); });
        });
      }, { root: elements.assetGrid, rootMargin: "220px" });
    }
    elements.assetGrid.innerHTML = "";
    elements.assetGrid.setAttribute("data-card-style", state.preferences.cardStyle === "clean" ? "clean" : "info");
    elements.assetGrid.classList.toggle("is-clean-card", state.preferences.cardStyle === "clean");
    if (renderList.length) { elements.assetGrid.hidden = false; }
    elements.resultCount.textContent = state.visibleAssets.length + " 项";
    renderList.forEach(function (asset) {
      var local = localMetaFor(asset);
      var card = document.createElement("article");
      var thumb = document.createElement("div");
      var sprite = document.createElement("div");
      var progress = document.createElement("div");
      var type = document.createElement("span");
      var favorite = document.createElement("button");
      var duration = document.createElement("span");
      var pinned = document.createElement("span");
      var proxy = document.createElement("span");
      var offlineBadge = document.createElement("span");
      var copy = document.createElement("div");
      var name = document.createElement("span");
      var details = document.createElement("span");
      card.className = "asset-card";
      card.setAttribute("data-asset-id", asset.domId);
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", asset.name + "，双击预览，右键更多操作");
      card.draggable = asset.type !== "folder";
      card.classList.toggle("is-folder", asset.type === "folder");
      card.title = asset.type === "folder" ? "双击打开；可把已选素材拖入此文件夹" : state.hostId === "PPRO" && asset.type !== "lut" ? "拖到 Premiere 素材箱、源监视器或时间线" : state.hostId === "AEFT" ? "AE 暂不支持从扩展直接拖入，请使用右键菜单" : "";
      if (state.selectedIds[asset.domId]) { card.classList.add("is-selected"); card.setAttribute("aria-selected", "true"); selectedVisible = true; }
      else { card.setAttribute("aria-selected", "false"); }
      thumb.className = "asset-thumb";
      sprite.className = "sprite-preview";
      progress.className = "scrub-progress";
      type.className = "asset-type"; type.textContent = asset.extension || asset.type;
      type.hidden = asset.type === "folder";
      thumb.appendChild(createPlaceholder(asset)); thumb.appendChild(sprite); thumb.appendChild(progress); thumb.appendChild(type);
      favorite.type = "button"; favorite.className = "favorite-toggle" + (local.favorite ? " is-favorite" : "");
      favorite.textContent = local.favorite ? "★" : "☆"; favorite.title = local.favorite ? "取消收藏" : "收藏";
      favorite.setAttribute("aria-label", favorite.title); favorite.draggable = false; favorite.hidden = asset.type === "folder"; thumb.appendChild(favorite);
      if (local.label && local.label !== "none") { var label = document.createElement("span"); label.className = "color-label"; label.setAttribute("data-label", local.label); thumb.appendChild(label); }
      if (local.pinned) { pinned.className = "pin-badge"; pinned.title = "已置顶"; thumb.appendChild(pinned); }
      if (/_Proxy_(?:1080|720|480|360)p(?:-\d+)?\.mp4$/i.test(asset.name)) { proxy.className = "proxy-badge"; proxy.textContent = "PROXY"; thumb.appendChild(proxy); }
      if (asset.offline) { offlineBadge.className = "offline-badge"; offlineBadge.textContent = "OFFLINE"; thumb.appendChild(offlineBadge); card.classList.add("is-offline"); }
      duration.className = "duration-badge"; duration.hidden = true; thumb.appendChild(duration);
      copy.className = "asset-copy";
      name.className = "asset-name"; name.textContent = asset.name; name.title = asset.name;
      details.className = "asset-details"; details.textContent = asset.type === "folder" ? "文件夹" : typeLabel(asset.type) + " · " + SeekLibrary.formatBytes(asset.size);
      copy.appendChild(name); copy.appendChild(details); card.appendChild(thumb); card.appendChild(copy); fragment.appendChild(card);
      visuals.push({ asset: asset, thumb: thumb, generation: renderGeneration });
    });
    elements.assetGrid.appendChild(fragment);
    visuals.forEach(function (item, index) { requestVisual(item.asset, item.thumb, index, item.generation); });
    if (!selectedVisible && state.selectedId && !state.selectedIds[state.selectedId]) { state.selectedId = null; }
    syncSelectAllButton();
    if (!state.visibleAssets.length) {
      elements.assetGrid.hidden = true;
      showEmpty(state.assets.length ? "没有匹配的素材" : "没有可用素材", state.assets.length ? "调整搜索、收藏或筛选条件。" : "添加一个包含视频、图片、音频或 LUT 的素材位置。");
    } else {
      elements.assetGrid.hidden = false; elements.emptyState.hidden = true;
    }
  }

  function createPlaceholder(asset) {
    var placeholder = document.createElement("div");
    placeholder.className = "generic-thumb";
    placeholder.textContent = asset.type === "video" ? "VID" : asset.type === "image" ? "IMG" : asset.type === "lut" ? "LUT" : asset.type === "folder" ? "" : "AUD";
    if (asset.type === "folder") { placeholder.classList.add("folder-thumb"); }
    return placeholder;
  }

  function requestVisual(asset, thumb, index, generation) {
    if (visualObserver) {
      thumb.__fnosVisualTask = { asset: asset, generation: generation };
      visualObserver.observe(thumb);
    } else if (index < 120) {
      enqueuePreview(function () { return generateVisual(asset, thumb, generation); });
    }
  }

  function enqueuePreview(job) {
    previewQueue.push(job);
    pumpPreviewQueue();
  }

  function pumpPreviewQueue() {
    var job;
    var promise;
    while (activePreviewJobs < 2 && previewQueue.length) {
      job = previewQueue.shift();
      activePreviewJobs += 1;
      try { promise = Promise.resolve(job()); }
      catch (error) { promise = Promise.reject(error); }
      promise.then(previewJobDone, previewJobDone);
    }
  }

  function previewJobDone() {
    activePreviewJobs = Math.max(0, activePreviewJobs - 1);
    pumpPreviewQueue();
  }

  function generateVisual(asset, thumb, generation) {
    var directImages = ["jpg", "jpeg", "jpe", "png", "webp", "gif", "bmp", "svg"];
    var visualPromise = Promise.resolve();
    if (generation !== renderGeneration || !document.documentElement.contains(thumb) || asset.offline) { return visualPromise; }
    if (asset.type === "image" && directImages.indexOf(asset.extension) !== -1) {
      installImage(thumb, SeekLibrary.fileUrl(asset.path), asset.name, "poster-image", asset);
    } else if (mediaTools && asset.type === "image" && ["psd", "psb", "ai", "eps"].indexOf(asset.extension) !== -1) {
      visualPromise = mediaTools.previewStillFor(asset.path).then(function (filePath) { if (generation === renderGeneration && document.documentElement.contains(thumb)) { installImage(thumb, SeekLibrary.fileUrl(filePath), asset.name, "poster-image", asset); } });
    } else if (mediaTools && asset.type === "video") {
      visualPromise = mediaTools.posterFor(asset.path).then(function (filePath) { if (generation === renderGeneration && document.documentElement.contains(thumb)) { installImage(thumb, SeekLibrary.fileUrl(filePath), asset.name, "poster-image", asset); } });
    } else if (mediaTools && asset.type === "audio") {
      visualPromise = mediaTools.waveformFor(asset.path).then(function (filePath) { if (generation === renderGeneration && document.documentElement.contains(thumb)) { installImage(thumb, SeekLibrary.fileUrl(filePath), asset.name, "waveform-image", asset); } });
    } else if (asset.type === "lut") {
      visualPromise = renderLutThumbnail(asset, thumb, generation);
    }
    return visualPromise.catch(function () {}).then(function () {
      if (!mediaTools || asset.type === "lut" || asset.type === "folder" || generation !== renderGeneration) { return; }
      return mediaTools.metadataFor(asset.path).then(function (metadata) {
        asset.mediaMetadata = metadata;
        updateCardMediaBadge(asset, thumb);
      }).catch(function () {});
    });
  }

  function installImage(container, source, label, className, asset) {
    var image = document.createElement("img");
    image.alt = label; image.draggable = false; image.className = className || "";
    image.onload = function () {
      var placeholder = container.querySelector(".generic-thumb");
      if (placeholder) { placeholder.remove(); }
      if (asset && asset.type === "image" && !asset.mediaMetadata) {
        asset.displayDimensions = image.naturalWidth + " × " + image.naturalHeight;
        updateCardMediaBadge(asset, container);
      }
    };
    image.onerror = function () { image.remove(); };
    image.src = source;
    container.insertBefore(image, container.firstChild);
  }

  function formatShortDuration(seconds) {
    var value = Math.max(0, Number(seconds) || 0);
    var hours = Math.floor(value / 3600);
    var minutes = Math.floor((value % 3600) / 60);
    var remainder = Math.floor(value % 60);
    return (hours ? String(hours).padStart(2, "0") + ":" : "") + String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0");
  }

  function updateCardMediaBadge(asset, thumb) {
    var badge = thumb && thumb.querySelector(".duration-badge");
    var metadata = asset.mediaMetadata;
    var card = thumb && thumb.closest(".asset-card");
    if (!badge) { return; }
    if ((asset.type === "video" || asset.type === "audio") && metadata && metadata.duration !== null) {
      badge.textContent = formatShortDuration(metadata.duration); badge.hidden = false;
    } else if (asset.type === "image" && (metadata && metadata.resolution || asset.displayDimensions)) {
      badge.textContent = metadata && metadata.resolution || asset.displayDimensions; badge.hidden = false;
    }
  }

  function beginSpritePreview(event) {
    var card = closestCard(event.target);
    var asset;
    var thumb;
    var sprite;
    if (!card || (event.relatedTarget && card.contains(event.relatedTarget))) { return; }
    asset = assetForId(card.getAttribute("data-asset-id"));
    if (asset && asset.type === "audio") { beginAudioHover(asset); return; }
    if (!asset || asset.type !== "video" || !mediaTools) { return; }
    thumb = card.querySelector(".asset-thumb");
    sprite = thumb.querySelector(".sprite-preview");
    if (sprite.getAttribute("data-ready") === "true") { thumb.classList.add("is-scrubbing"); return; }
    if (sprite.getAttribute("data-loading") === "true") { return; }
    sprite.setAttribute("data-loading", "true");
    mediaTools.spriteFor(asset.path).then(function (result) {
      if (!document.documentElement.contains(sprite)) { return; }
      sprite.style.backgroundImage = 'url("' + SeekLibrary.fileUrl(result.path) + '")';
      sprite.setAttribute("data-ready", "true");
      sprite.removeAttribute("data-loading");
      thumb.classList.add("is-scrubbing");
    }).catch(function () { sprite.removeAttribute("data-loading"); });
  }

  function scrubSpritePreview(event) {
    var card = closestCard(event.target);
    var asset;
    var thumb;
    var sprite;
    var rect;
    var ratio;
    var frame;
    var column;
    var row;
    if (!card) { return; }
    asset = assetForId(card.getAttribute("data-asset-id"));
    if (!asset || asset.type !== "video") { return; }
    thumb = card.querySelector(".asset-thumb"); sprite = thumb.querySelector(".sprite-preview");
    if (sprite.getAttribute("data-ready") !== "true") { return; }
    rect = thumb.getBoundingClientRect(); ratio = Math.max(0, Math.min(.999, (event.clientX - rect.left) / rect.width));
    frame = Math.floor(ratio * FnOSMediaTools.SPRITE_FRAMES); column = frame % FnOSMediaTools.SPRITE_COLUMNS; row = Math.floor(frame / FnOSMediaTools.SPRITE_COLUMNS);
    sprite.style.backgroundPosition = (column / (FnOSMediaTools.SPRITE_COLUMNS - 1) * 100) + "% " + (row / (FnOSMediaTools.SPRITE_ROWS - 1) * 100) + "%";
    thumb.style.setProperty("--scrub-progress", Math.round(ratio * 100) + "%"); thumb.classList.add("is-scrubbing");
  }

  function endSpritePreview(event) {
    var card = closestCard(event.target);
    if (!card || (event.relatedTarget && card.contains(event.relatedTarget))) { return; }
    card.querySelector(".asset-thumb").classList.remove("is-scrubbing");
    stopAudioHover();
  }

  function beginAudioHover(asset) {
    if (asset.offline) { return; }
    stopAudioHover();
    audioHover.assetId = asset.domId;
    audioHover.timer = setTimeout(function () {
      var media;
      if (audioHover.assetId !== asset.domId) { return; }
      media = new Audio(SeekLibrary.fileUrl(asset.path)); media.preload = "auto"; media.volume = .72;
      audioHover.media = media;
      safePlay(media);
    }, 180);
  }

  function playSelectionAudio(asset) {
    var media;
    if (!asset || asset.offline || !asset.path || typeof Audio !== "function") { return; }
    stopAudioHover();
    media = new Audio(SeekLibrary.fileUrl(asset.path));
    media.preload = "auto";
    media.volume = .72;
    audioHover.assetId = asset.domId;
    audioHover.media = media;
    media.addEventListener("ended", function () {
      if (audioHover.media === media) { audioHover.media = null; audioHover.assetId = null; }
    });
    safePlay(media);
  }

  function stopAudioHover() {
    clearTimeout(audioHover.timer); audioHover.timer = null; audioHover.assetId = null;
    if (audioHover.media) { try { audioHover.media.pause(); audioHover.media.removeAttribute("src"); audioHover.media.load(); } catch (error) {} audioHover.media = null; }
  }

  function selectedAssets() {
    return state.assets.filter(function (asset) { return !!state.selectedIds[asset.domId]; });
  }

  function selectAsset(id, options) {
    var asset = assetForId(id);
    var settings = options || {};
    var anchorIndex;
    var targetIndex;
    var from;
    var to;
    var i;
    if (!asset) { return; }
    if (settings.range && state.selectionAnchorId) {
      anchorIndex = state.visibleAssets.map(function (item) { return item.domId; }).indexOf(state.selectionAnchorId);
      targetIndex = state.visibleAssets.map(function (item) { return item.domId; }).indexOf(id);
      if (anchorIndex !== -1 && targetIndex !== -1) {
        if (!settings.toggle) { state.selectedIds = {}; }
        from = Math.min(anchorIndex, targetIndex); to = Math.max(anchorIndex, targetIndex);
        for (i = from; i <= to; i += 1) { state.selectedIds[state.visibleAssets[i].domId] = true; }
      }
    } else if (settings.toggle) {
      if (state.selectedIds[id]) { delete state.selectedIds[id]; }
      else { state.selectedIds[id] = true; }
      state.selectionAnchorId = id;
    } else {
      state.selectedIds = {}; state.selectedIds[id] = true; state.selectionAnchorId = id;
    }
    state.selectedId = id;
    if (!state.selectedIds[id]) {
      var remaining = selectedAssets();
      state.selectedId = remaining.length ? remaining[remaining.length - 1].domId : null;
    }
    Array.prototype.forEach.call(elements.assetGrid.querySelectorAll(".asset-card"), function (card) {
      var selected = !!state.selectedIds[card.getAttribute("data-asset-id")];
      card.classList.toggle("is-selected", selected); card.setAttribute("aria-selected", selected ? "true" : "false");
    });
    syncSelectAllButton();
  }

  function syncSelectAllButton() {
    var allSelected = !!state.visibleAssets.length && state.visibleAssets.every(function (asset) { return !!state.selectedIds[asset.domId]; });
    if (!elements.selectAllButton) { return; }
    elements.selectAllButton.setAttribute("aria-pressed", allSelected ? "true" : "false");
    elements.selectAllButton.setAttribute("aria-checked", allSelected ? "true" : "false");
    elements.selectAllButton.setAttribute("data-hint", allSelected ? "取消勾选当前素材" : "勾选当前素材");
    elements.selectAllButton.classList.toggle("is-active", allSelected);
    elements.selectAllButton.title = allSelected ? "取消全选" : "全选当前素材";
  }

  function toggleSelectAllAssets() {
    var allSelected = state.visibleAssets.length && state.visibleAssets.every(function (asset) { return !!state.selectedIds[asset.domId]; });
    state.selectedIds = {};
    if (!allSelected) { state.visibleAssets.forEach(function (asset) { state.selectedIds[asset.domId] = true; }); }
    state.selectedId = !allSelected && state.visibleAssets.length ? state.visibleAssets[state.visibleAssets.length - 1].domId : null;
    state.selectionAnchorId = state.selectedId;
    syncSelectAllButton();
    renderAssets();
  }

  function findCard(id) {
    var cards = elements.assetGrid.querySelectorAll(".asset-card");
    var i;
    for (i = 0; i < cards.length; i += 1) { if (cards[i].getAttribute("data-asset-id") === id) { return cards[i]; } }
    return null;
  }

  function typeLabel(type) { return type === "video" ? "视频" : type === "image" ? "图片" : type === "lut" ? "LUT" : type === "folder" ? "文件夹" : "音频"; }

  function startAssetDrag(event) {
    var card = closestCard(event.target);
    var asset = card && assetForId(card.getAttribute("data-asset-id"));
    var assets;
    var paths;
    var adobePaths;
    stopAudioHover();
    if (event.target.closest && event.target.closest("button")) { event.preventDefault(); return; }
    if (!asset || asset.type === "folder" || asset.offline || !nodeAvailable) { event.preventDefault(); if (asset && asset.offline) { showNotice("素材位置离线，重新连接 SMB 后再拖动。", true, 4000); } return; }
    if (!state.selectedIds[asset.domId]) { selectAsset(asset.domId, { only: true }); }
    assets = selectedAssets().filter(function (item) { return item.type !== "folder"; });
    paths = assets.map(function (item) { return item.path; });
    adobePaths = assets.filter(function (item) { return item.type !== "lut"; }).map(function (item) { return item.path; });
    if (!paths.length) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("application/x-lk-file-bridge-assets", JSON.stringify(assets.map(function (item) { return item.domId; })));
    if (state.hostId === "PPRO" && adobePaths.length) { populateAdobeDragData(event, adobePaths); }
    else { event.dataTransfer.setData("text/plain", paths.join("\n")); }
    card.classList.add("is-dragging");
    elements.statusText.textContent = state.hostId === "PPRO" ? "拖到 Premiere 或插件文件夹" : "拖到插件中的文件夹";
  }

  function populateAdobeDragData(event, input) {
    var paths = Array.isArray(input) ? input : [input];
    FnOSInteractionTools.writeAdobeDragData(event.dataTransfer, paths, SeekLibrary.fileUrl);
  }

  function handleLibraryDragOver(event) {
    var card = closestCard(event.target);
    var folder = card && assetForId(card.getAttribute("data-asset-id"));
    var internal = event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], "application/x-lk-file-bridge-assets") !== -1;
    var external = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length;
    if ((internal && folder && folder.type === "folder") || (!internal && external)) {
      event.preventDefault(); event.dataTransfer.dropEffect = internal ? "move" : "copy";
      if (folder && folder.type === "folder") { card.classList.add("is-drop-target"); }
    }
  }

  function sourcePathsFromDrop(dataTransfer) {
    var paths = [];
    var uriText;
    var i;
    for (i = 0; dataTransfer.files && i < dataTransfer.files.length; i += 1) {
      if (dataTransfer.files[i].path) { paths.push(dataTransfer.files[i].path); }
    }
    if (!paths.length) {
      uriText = dataTransfer.getData("text/uri-list") || "";
      uriText.split(/\r?\n/).filter(function (line) { return line && line.charAt(0) !== "#"; }).forEach(function (url) {
        if (url.indexOf("file://") === 0) { try { paths.push(decodeURIComponent(url.replace(/^file:\/\//, ""))); } catch (error) {} }
      });
    }
    return paths;
  }

  function handleLibraryDrop(event) {
    var card = closestCard(event.target);
    var folder = card && assetForId(card.getAttribute("data-asset-id"));
    var rawIds = event.dataTransfer.getData("application/x-lk-file-bridge-assets");
    var destination;
    var ids;
    var assets;
    var paths;
    event.preventDefault();
    Array.prototype.forEach.call(elements.assetGrid.querySelectorAll(".is-drop-target"), function (item) { item.classList.remove("is-drop-target"); });
    if (rawIds && folder && folder.type === "folder") {
      try { ids = JSON.parse(rawIds); } catch (error) { ids = []; }
      assets = ids.map(assetForId).filter(function (asset) { return asset && asset.type !== "folder"; });
      if (assets.length) { moveAssetsToFolder(assets, { getAttribute: function (name) { return name === "data-root-id" ? folder.rootId : folder.path; } }); }
      return;
    }
    paths = sourcePathsFromDrop(event.dataTransfer);
    destination = folder && folder.type === "folder" ? { rootId: folder.rootId, path: folder.path } : currentDestination();
    if (!paths.length || !destination || !assetOps) { showNotice("请先勾选目标素材位置，再拖入本地素材。", true, 4500); return; }
    showNotice("正在复制 " + paths.length + " 项到当前素材路径…", false, 0);
    assetOps.copyExternalFiles({ roots: state.roots, rootId: destination.rootId, destinationPath: destination.path, sourcePaths: paths, onProgress: showOperationProgress }).then(function () {
      showNotice("外部素材已复制到当前路径。", false, 3800); scanAssets();
    }).catch(function (error) { showNotice("复制失败：" + friendlyError(error), true, 6500); });
  }

  function openContextMenu(event) {
    var card = closestCard(event.target);
    var asset;
    var left;
    var top;
    var favoriteButton;
    var assets;
    var single;
    if (!card) { return; }
    stopAudioHover();
    event.preventDefault(); event.stopPropagation();
    state.contextId = card.getAttribute("data-asset-id");
    if (!state.selectedIds[state.contextId]) { selectAsset(state.contextId, { only: true }); }
    asset = assetForId(state.contextId); assets = selectedAssets(); single = assets.length === 1;
    favoriteButton = elements.contextMenu.querySelector('[data-command="favorite"]');
    favoriteButton.textContent = assets.every(function (item) { return localMetaFor(item).favorite; }) ? "取消收藏" : "收藏";
    elements.contextMenu.querySelector('[data-command="pin"]').textContent = assets.every(function (item) { return localMetaFor(item).pinned; }) ? "取消置顶" : "置顶";
    var transcodeMenu = elements.contextMenu.querySelector(".transcode-menu");
    if (transcodeMenu) { transcodeMenu.hidden = !assets.length || assets.some(function (item) { return item.type !== "video"; }); }
    elements.contextMenu.querySelector('[data-command="play"]').disabled = !single;
    elements.contextMenu.querySelector('[data-command="info"]').disabled = !single || asset.type === "folder";
    elements.contextMenu.querySelector('[data-command="import"]').hidden = state.hostId === "BROWSER" || assets.some(function (item) { return item.type === "lut" || item.type === "folder"; });
    elements.insertSubmenuRow.hidden = state.hostId !== "PPRO" || assets.some(function (item) { return item.type === "lut" || item.type === "folder"; });
    elements.contextAePlaceButton.hidden = state.hostId !== "AEFT" || assets.some(function (item) { return item.type === "lut" || item.type === "folder"; });
    elements.contextMenu.querySelector('[data-command="reveal"]').disabled = !single;
    elements.contextMenu.querySelector('[data-command="rename"]').disabled = !single;
    elements.contextMenu.querySelector('[data-command="duplicate"]').disabled = assets.some(function (item) { return item.type === "folder"; });
    elements.copyLabelButton.disabled = !asset || !localMetaFor(asset).label || localMetaFor(asset).label === "none";
    elements.pasteLabelButton.disabled = !state.copiedLabel;
    if (elements.clearLabelButton) { elements.clearLabelButton.disabled = !assets.length || assets.every(function (item) { return !localMetaFor(item).label || localMetaFor(item).label === "none"; }); }
    renderLabelChoices(assets);
    renderFolderSubmenu(assets);
    elements.contextMenu.hidden = false;
    elements.contextMenu.style.maxHeight = Math.max(120, window.innerHeight - 8) + "px";
    elements.contextMenu.style.overflowY = "auto";
    left = Math.min(event.clientX, window.innerWidth - elements.contextMenu.offsetWidth - 6);
    top = Math.min(event.clientY, window.innerHeight - elements.contextMenu.offsetHeight - 6);
    left = Math.max(4, left);
    top = Math.max(4, top);
    elements.contextMenu.style.left = left + "px";
    elements.contextMenu.style.top = top + "px";
  }

  function renderLabelChoices(assets) {
    var labels = assets.map(function (asset) { return localMetaFor(asset).label || "none"; });
    var current = labels.every(function (label) { return label === labels[0]; }) ? labels[0] : "mixed";
    elements.contextLabelChoices.innerHTML = "";
    LABELS.forEach(function (label) {
      var button = document.createElement("button");
      button.type = "button"; button.className = "label-choice" + (current === label ? " is-selected" : ""); button.setAttribute("data-label", label); button.title = label === "none" ? "移除标签" : label;
      elements.contextLabelChoices.appendChild(button);
    });
  }

  function closeContextMenu() { elements.contextMenu.hidden = true; hideMetadataHover(); state.contextId = null; }

  function handleContextCommand(event) {
    var button = event.target.closest("button[data-command]");
    var asset = assetForId(state.contextId);
    var command;
    var assets = selectedAssets();
    if (!button || !asset) { return; }
    command = button.getAttribute("data-command");
    if (command === "play") { if (asset.type === "folder") { enterFolderScope(asset); } else { openViewer(asset); } }
    else if (command === "info") { showMetadataHover(asset, button); return; }
    else if (command === "import") { runHostActionForAssets(assets, false, "current").catch(function () {}); }
    else if (command === "insert") { runHostActionForAssets(assets, true, button.getAttribute("data-position") || "current").catch(function () {}); }
    else if (command === "favorite") { setFavoriteForAssets(assets); }
    else if (command === "pin") { setPinnedForAssets(assets); }
    else if (command === "transcode") { transcodeAssets(assets, button.getAttribute("data-profile")); }
    else if (command === "duplicate") { duplicateAssets(assets); }
    else if (command === "move-folder") { moveAssetsToFolder(assets, button); }
    else if (command === "copy-label") { state.copiedLabel = localMetaFor(asset).label; showNotice("标签已复制。", false, 2200); }
    else if (command === "paste-label") { assets.forEach(function (item) { setColorLabel(item, state.copiedLabel, true); }); renderAssets(); }
    else if (command === "clear-label") { assets.forEach(function (item) { setColorLabel(item, "none", true); }); if (state.filters.label !== "all") { applyFilters(); } else { renderAssets(); } }
    else if (command === "new-folder") { closeContextMenu(); openCreateFolderDialog(); return; }
    else if (command === "reveal") { revealAsset(asset); }
    else if (command === "rename") { openRenameDialog(asset); }
    else if (command === "trash") { openTrashDialog(assets); }
    closeContextMenu();
  }

  function toggleFavorite(asset) {
    if (!asset) { return; }
    updateLocalMeta(asset, { favorite: !localMetaFor(asset).favorite });
    if (state.favoriteOnly) { applyFilters(); }
    else { updateCardLocalMeta(asset); }
  }

  function setColorLabel(asset, label, silent) {
    updateLocalMeta(asset, { label: LABELS.indexOf(label) !== -1 ? label : "none" });
    if (!silent) {
      if (state.filters.label !== "all") { applyFilters(); }
      else { updateCardLocalMeta(asset); }
    }
  }

  function setFavoriteForAssets(assets) {
    var favorite = !assets.every(function (asset) { return localMetaFor(asset).favorite; });
    assets.forEach(function (asset) { updateLocalMeta(asset, { favorite: favorite }); });
    if (state.favoriteOnly) { applyFilters(); } else { renderAssets(); }
  }

  function setPinnedForAssets(assets) {
    var pinned = !assets.every(function (asset) { return localMetaFor(asset).pinned; });
    assets.forEach(function (asset) { updateLocalMeta(asset, { pinned: pinned }); });
    applyFilters();
  }

  function renderFolderSubmenu(assets) {
    var folders = state.assets.filter(function (asset) {
      return asset.type === "folder" && !assets.some(function (selected) { return selected.path === asset.path; });
    });
    var trigger = elements.folderSubmenuRow.children[0];
    elements.folderSubmenu.innerHTML = "";
    trigger.disabled = false;
    trigger.setAttribute("aria-disabled", (!folders.length || assets.some(function (asset) { return asset.type === "folder"; })) ? "true" : "false");
    trigger.classList.toggle("is-disabled", !folders.length || assets.some(function (asset) { return asset.type === "folder"; }));
    folders.forEach(function (folder) {
      var button = document.createElement("button");
      button.type = "button"; button.setAttribute("data-command", "move-folder"); button.setAttribute("data-root-id", folder.rootId); button.setAttribute("data-folder-path", folder.path);
      button.textContent = folder.rootLabel + " / " + folder.relativePath;
      elements.folderSubmenu.appendChild(button);
    });
    if (!folders.length) {
      var empty = document.createElement("span"); empty.className = "submenu-empty"; empty.textContent = "没有可用文件夹"; elements.folderSubmenu.appendChild(empty);
    }
    var create = document.createElement("button");
    create.type = "button"; create.setAttribute("data-command", "new-folder"); create.textContent = "新建文件夹";
    elements.folderSubmenu.appendChild(create);
  }

  function duplicateAssets(assets) {
    var files = assets.filter(function (asset) { return asset.type !== "folder"; });
    if (!assetOps || !files.length) { return; }
    showNotice("正在创建 " + files.length + " 个副本…", false, 0);
    assetOps.createCopies({ roots: state.roots, assets: files, onProgress: showOperationProgress }).then(function () {
      showNotice("副本已创建。", false, 3500); scanAssets();
    }).catch(function (error) { showNotice("创建副本失败：" + friendlyError(error), true, 6500); });
  }

  function moveAssetsToFolder(assets, button) {
    var files = assets.filter(function (asset) { return asset.type !== "folder"; });
    if (!assetOps || !files.length) { return; }
    showNotice("正在移动 " + files.length + " 项素材…", false, 0);
    assetOps.moveAssetsToFolder({ roots: state.roots, destinationRootId: button.getAttribute("data-root-id"), destinationPath: button.getAttribute("data-folder-path"), assets: files, onProgress: showOperationProgress }).then(function (results) {
      results.forEach(function (result) { if (result.changed) { migrateLocalMeta(result.sourcePath, result.path); } });
      state.selectedIds = {}; state.selectedId = null; showNotice("素材已添加到文件夹。", false, 3500); scanAssets();
    }).catch(function (error) { showNotice("移动失败：" + friendlyError(error), true, 6500); });
  }

  function showOperationProgress(event) {
    var ratio;
    if (!event || !event.total) { return; }
    ratio = Math.round(event.completed / event.total * 100);
    elements.statusText.textContent = "正在处理 " + event.completed + "/" + event.total + "（" + ratio + "%）";
  }

  function updateCardLocalMeta(asset) {
    var card = findCard(asset.domId);
    var local = localMetaFor(asset);
    var favorite;
    var color;
    if (!card) { return; }
    favorite = card.querySelector(".favorite-toggle");
    favorite.classList.toggle("is-favorite", !!local.favorite); favorite.textContent = local.favorite ? "★" : "☆";
    favorite.title = local.favorite ? "取消收藏" : "收藏"; favorite.setAttribute("aria-label", favorite.title);
    color = card.querySelector(".color-label");
    if (!local.label || local.label === "none") { if (color) { color.remove(); } return; }
    if (!color) { color = document.createElement("span"); color.className = "color-label"; card.querySelector(".asset-thumb").appendChild(color); }
    color.setAttribute("data-label", local.label);
  }

  function showMetadataHover(asset, anchor) {
    var rect = anchor.getBoundingClientRect();
    var token = asset.domId;
    var requestToken = ++metadataHoverToken;
    elements.metadataHover.setAttribute("data-asset-id", token);
    elements.metadataHover.innerHTML = '<div class="metadata-hover-loading">正在读取媒体信息…</div>';
    elements.metadataHover.hidden = false;
    if (window.innerWidth < 520) {
      elements.metadataHover.style.top = Math.max(8, Math.min(window.innerHeight - 260, rect.bottom + 5)) + "px";
      elements.metadataHover.style.left = "8px";
    } else {
      elements.metadataHover.style.top = Math.max(8, Math.min(window.innerHeight - 260, rect.top - 8)) + "px";
      elements.metadataHover.style.left = (rect.right + 282 < window.innerWidth ? rect.right + 7 : Math.max(8, rect.left - 279)) + "px";
    }
    if (!mediaTools || asset.type === "lut") {
      elements.metadataHover.querySelector(".metadata-hover-loading").textContent = asset.type === "lut" ? "LUT 文件 · " + SeekLibrary.formatBytes(asset.size) : "当前环境无法读取媒体元数据。";
      return;
    }
    mediaTools.metadataFor(asset.path).then(function (metadata) {
      var dl;
      var rows;
      var loading;
      if (requestToken !== metadataHoverToken || elements.metadataHover.hidden || elements.metadataHover.getAttribute("data-asset-id") !== token) { return; }
      asset.mediaMetadata = metadata;
      rows = metadataRows(asset, metadata).filter(function (row) { return ["文件格式", "时长", "文件大小", "总码率", "视频编码", "音频编码", "分辨率", "帧率", "色彩空间", "动态范围", "Alpha 通道", "位深"].indexOf(row[0]) !== -1; });
      dl = document.createElement("dl");
      rows.forEach(function (row) { var dt = document.createElement("dt"); var dd = document.createElement("dd"); dt.textContent = row[0]; dd.textContent = row[1]; dl.appendChild(dt); dl.appendChild(dd); });
      loading = elements.metadataHover.querySelector(".metadata-hover-loading");
      if (loading) { loading.replaceWith(dl); }
    }).catch(function (error) {
      var loading;
      if (requestToken !== metadataHoverToken || elements.metadataHover.hidden || elements.metadataHover.getAttribute("data-asset-id") !== token) { return; }
      loading = elements.metadataHover.querySelector(".metadata-hover-loading");
      if (loading) { loading.textContent = "无法读取：" + friendlyError(error); }
    });
  }

  function hideMetadataHover() { metadataHoverToken += 1; elements.metadataHover.hidden = true; elements.metadataHover.removeAttribute("data-asset-id"); }

  function transcodeAsset(asset, profile) {
    var temporaryPath;
    if (!mediaTools || !asset || asset.type !== "video") { return Promise.reject(new Error("只有视频素材支持分辨率转码。")); }
    temporaryPath = path.join(path.dirname(asset.path), "." + path.basename(asset.path, path.extname(asset.path)).slice(0, 120) + "-" + process.pid + "-" + Date.now() + ".lkfb-part.mp4");
    return mediaTools.transcodeTo(asset.path, temporaryPath, profile, function (progress) { showTranscodeProgress(asset.name, progress.ratio); }).then(function () {
      return mediaTools.claimTranscodeOutput(temporaryPath, asset.path, profile);
    }).catch(function (error) {
      mediaTools.cleanupTranscodeTemporary(temporaryPath, asset.path);
      throw error;
    });
  }

  function transcodeAssets(assets, profile) {
    var videos = assets.filter(function (asset) { return asset.type === "video"; });
    var results = [];
    if (!videos.length) { showNotice("只有视频素材支持分辨率转码。", true, 4000); return; }
    elements.operationProgress.hidden = false;
    videos.reduce(function (promise, asset, index) {
      return promise.then(function () {
        elements.operationProgressLabel.textContent = "转码 " + (index + 1) + "/" + videos.length + " · " + asset.name;
        return transcodeAsset(asset, profile).then(function (destination) { results.push(destination); });
      });
    }, Promise.resolve()).then(function () {
      showTranscodeProgress("转码完成", 1);
      setTimeout(function () { elements.operationProgress.hidden = true; }, 1600);
      showNotice("已完成 " + results.length + " 项转码。", false, 5000); scanAssets();
    }).catch(function (error) {
      elements.operationProgress.hidden = true;
      showNotice("转码失败，源文件未改变：" + friendlyError(error), true, 7000);
    });
  }

  function showTranscodeProgress(label, ratio) {
    var percent = Math.max(0, Math.min(100, Math.round((Number(ratio) || 0) * 100)));
    elements.operationProgress.hidden = false;
    elements.operationProgressLabel.textContent = label + " · " + percent + "%";
    elements.operationProgressBar.style.transform = "scaleX(" + (percent / 100) + ")";
  }

  function openViewer(asset) {
    var media;
    var audioViewer;
    var waveform;
    var token;
    stopAudioHover();
    if (!asset) { return; }
    if (asset.offline) { showNotice("素材当前离线；重新连接原 SMB 路径后可恢复预览。", true, 5000); return; }
    if (asset.type === "lut") { openLutViewer(asset); return; }
    closeViewer();
    if (mediaTools) { mediaTools.prioritizeViewer(); }
    state.selectedId = asset.domId;
    viewerState.asset = asset;
    viewerState.metadata = asset.mediaMetadata || null;
    viewerState.inPoint = 0;
    viewerState.outPoint = null;
    viewerState.hasIn = false; viewerState.hasOut = false;
    viewerState.loop = false;
    viewerState.profile = "auto";
    viewerState.audioProxyPath = "";
    viewerState.audioProxyStatus = "idle";
    viewerState.timeDisplayMode = "timecode"; viewerState.sourcePlayable = false; viewerState.autoProxyReady = ""; viewerState.autoKeepSource = false;
    token = ++viewerState.loadToken;
    elements.viewerTitle.textContent = asset.name;
    elements.viewerSubtitle.textContent = typeLabel(asset.type) + " · " + SeekLibrary.formatBytes(asset.size);
    elements.viewerMediaLayer.innerHTML = "";
    elements.viewer.hidden = false;
    elements.viewerBusy.hidden = true;
    elements.viewerTimeline.hidden = asset.type === "image";
    elements.screenshotButton.hidden = state.hostId !== "PPRO" || asset.type !== "video";
    elements.qualityButton.hidden = asset.type !== "video";
    elements.qualityButton.textContent = "AUTO";
    Array.prototype.forEach.call(elements.viewerQualityMenu.querySelectorAll("button"), function (item) { item.classList.toggle("is-active", item.getAttribute("data-quality") === "auto"); });
    elements.loopButton.classList.remove("is-active");
    elements.loopButton.setAttribute("aria-pressed", "false");
    elements.viewerScrubber.value = "0";
    setViewerPlayState(false);
    elements.viewerTimecode.textContent = "00:00:00:00";
    updateViewerMarks();
    if (asset.type === "video") {
      media = document.createElement("video");
      media.controls = false; media.preload = "auto"; media.playsInline = true; media.draggable = state.hostId === "PPRO";
      media.setAttribute("draggable", state.hostId === "PPRO" ? "true" : "false");
      media.addEventListener("click", toggleViewerPlayback);
      elements.viewerMediaLayer.appendChild(media);
      viewerState.media = media;
      bindViewerMedia(media);
      loadViewerProfile("auto", false);
      if (mediaTools && state.hostId === "PPRO") {
        viewerState.audioProxyStatus = "preparing";
        mediaTools.audioProxyFor(asset.path).then(function (audioPath) {
          if (viewerState.loadToken >= token && viewerState.asset === asset) { viewerState.audioProxyPath = audioPath; viewerState.audioProxyStatus = "ready"; }
        }).catch(function () { if (viewerState.asset === asset) { viewerState.audioProxyStatus = "unavailable"; } });
      }
    } else if (asset.type === "audio") {
      audioViewer = document.createElement("div"); audioViewer.className = "audio-viewer";
      waveform = document.createElement("div"); waveform.className = "generic-thumb"; waveform.textContent = "正在生成波形…"; audioViewer.appendChild(waveform);
      media = document.createElement("audio"); media.src = SeekLibrary.fileUrl(asset.path); media.controls = false; media.preload = "auto"; media.draggable = state.hostId === "PPRO"; audioViewer.appendChild(media); elements.viewerMediaLayer.appendChild(audioViewer);
      viewerState.media = media; bindViewerMedia(media);
      safePlay(media);
      if (mediaTools) { mediaTools.waveformFor(asset.path).then(function (filePath) { var image; if (viewerState.asset !== asset || !document.documentElement.contains(waveform)) { return; } image = document.createElement("img"); image.src = SeekLibrary.fileUrl(filePath); image.alt = asset.name + " 波形"; image.draggable = false; waveform.replaceWith(image); }).catch(function () { if (document.documentElement.contains(waveform)) { waveform.textContent = "无法生成波形"; } }); }
    } else {
      media = document.createElement("img"); media.alt = asset.name; media.draggable = state.hostId === "PPRO"; media.setAttribute("draggable", state.hostId === "PPRO" ? "true" : "false");
      media.addEventListener("load", function () { if (viewerState.asset === asset) { elements.viewerSubtitle.textContent = media.naturalWidth + " × " + media.naturalHeight + " · " + String(asset.extension || "图片").toUpperCase() + " · " + SeekLibrary.formatBytes(asset.size); } });
      elements.viewerMediaLayer.appendChild(media);
      if (mediaTools && ["psd", "psb", "ai", "eps"].indexOf(asset.extension) !== -1) {
        elements.viewerBusy.hidden = false; elements.viewerBusy.textContent = "正在生成设计文件预览…";
        mediaTools.previewStillFor(asset.path).then(function (previewPath) { if (viewerState.asset === asset) { media.src = SeekLibrary.fileUrl(previewPath); elements.viewerBusy.hidden = true; } }).catch(function (error) { elements.viewerBusy.hidden = true; showNotice("无法预览该设计文件：" + friendlyError(error), true, 5500); });
      } else { media.src = SeekLibrary.fileUrl(asset.path); }
      viewerState.media = media;
    }
    if (mediaTools && asset.type !== "image") {
      mediaTools.metadataFor(asset.path).then(function (metadata) {
        if (viewerState.asset !== asset) { return; }
        asset.mediaMetadata = metadata; viewerState.metadata = metadata;
        updateViewerSubtitle(); updateViewerTimeline();
      }).catch(function () {});
    } else { updateViewerSubtitle(); }
  }

  function closeViewer() {
    var closingAsset = viewerState.asset;
    viewerState.loadToken += 1;
    clearTimeout(viewerState.autoTimer); viewerState.autoTimer = null;
    if (closingAsset && mediaTools) { mediaTools.cancelViewerJobs(closingAsset.path); }
    if (viewerState.frameRequest) { cancelAnimationFrame(viewerState.frameRequest); viewerState.frameRequest = 0; }
    Array.prototype.forEach.call(elements.viewerMediaLayer.querySelectorAll("video,audio"), function (media) { media.pause(); media.removeAttribute("src"); media.load(); });
    elements.viewerMediaLayer.innerHTML = ""; elements.viewer.hidden = true; elements.viewerBusy.hidden = true;
    elements.viewerQualityMenu.hidden = true; elements.qualityButton.setAttribute("aria-expanded", "false");
    viewerState.asset = null; viewerState.media = null; viewerState.metadata = null; viewerState.audioProxyPath = ""; viewerState.audioProxyStatus = "idle";
  }

  function bindViewerMedia(media) {
    media.addEventListener("loadedmetadata", function () {
      if (media !== viewerState.media) { return; }
      if (viewerState.outPoint === null || viewerState.outPoint > media.duration) { viewerState.outPoint = isFinite(media.duration) ? media.duration : null; }
      updateViewerMarks(); updateViewerTimeline();
    });
    media.addEventListener("canplay", function () { if (media === viewerState.media && (media.tagName !== "VIDEO" || media.videoWidth > 0)) { viewerState.sourcePlayable = true; } });
    media.addEventListener("play", function () { setViewerPlayState(true); startViewerClock(); });
    media.addEventListener("pause", function () { setViewerPlayState(false); updateViewerTimeline(); });
    media.addEventListener("timeupdate", updateViewerTimeline);
    media.addEventListener("ended", function () {
      if (viewerState.loop && viewerState.media === media) { media.currentTime = viewerState.inPoint; safePlay(media); }
      else { setViewerPlayState(false); }
    });
    media.addEventListener("error", function () {
      viewerState.sourcePlayable = false;
      if (viewerState.asset && viewerState.asset.type === "video" && viewerState.autoProxyReady) {
        switchViewerSource(viewerState.autoProxyReady, Number(media.currentTime) || 0, true);
      } else if (viewerState.asset && viewerState.asset.type === "video" && viewerState.profile !== "auto" && media.getAttribute("data-fallback") !== "true") {
        media.setAttribute("data-fallback", "true"); showNotice("当前格式无法直接播放，正在准备自动代理…", false, 4000); loadViewerProfile("auto", true);
      }
    });
  }

  function setViewerPlayState(playing) {
    elements.playPauseButton.innerHTML = playing ? '<span class="icon-pause" aria-hidden="true"></span>' : '<span class="icon-play" aria-hidden="true"></span>';
    elements.playPauseButton.title = playing ? "暂停" : "播放";
    elements.playPauseButton.setAttribute("aria-label", playing ? "暂停" : "播放");
  }

  function safePlay(media) {
    var result;
    if (!media || typeof media.play !== "function") { return; }
    try { result = media.play(); if (result && typeof result.catch === "function") { result.catch(function () {}); } } catch (error) {}
  }

  function chooseViewerQuality(event) {
    var button = event.target.closest("button[data-quality]");
    if (!button) { return; }
    Array.prototype.forEach.call(elements.viewerQualityMenu.querySelectorAll("button"), function (item) { item.classList.toggle("is-active", item === button); });
    elements.viewerQualityMenu.hidden = true; elements.qualityButton.setAttribute("aria-expanded", "false");
    loadViewerProfile(button.getAttribute("data-quality"), true);
  }

  function toggleViewerMute() {
    var media = viewerState.media;
    if (!media || typeof media.muted !== "boolean") { return; }
    media.muted = !media.muted;
    elements.volumeButton.classList.toggle("is-muted", media.muted);
    elements.volumeRange.value = media.muted ? "0" : String(media.volume || 1);
  }

  function updateViewerVolume() {
    var media = viewerState.media;
    var value = Math.max(0, Math.min(1, Number(elements.volumeRange.value) || 0));
    if (!media || typeof media.volume !== "number") { return; }
    media.volume = value; media.muted = value === 0; elements.volumeButton.classList.toggle("is-muted", media.muted);
  }

  function toggleViewerTimeDisplay() {
    viewerState.timeDisplayMode = viewerState.timeDisplayMode === "frames" ? "timecode" : "frames";
    updateViewerTimeline();
  }

  function loadViewerProfile(profile, preserveTime) {
    var asset = viewerState.asset;
    var media = viewerState.media;
    var currentTime = preserveTime && media ? Number(media.currentTime) || 0 : 0;
    var wasPlaying = media && !media.paused;
    var token;
    var targetProfile;
    if (!asset || asset.type !== "video" || !media) { return; }
    viewerState.profile = profile;
    elements.qualityButton.textContent = profile === "source" ? "SRC" : profile === "auto" ? "AUTO" : String(profile).toUpperCase();
    token = ++viewerState.loadToken;
    clearTimeout(viewerState.autoTimer); viewerState.autoTimer = null;
    if (profile === "source") {
      elements.viewerBusy.hidden = true; switchViewerSource(asset.path, currentTime, wasPlaying || currentTime === 0); return;
    }
    if (profile === "auto") {
      viewerState.sourcePlayable = false; viewerState.autoProxyReady = ""; viewerState.autoKeepSource = false;
      switchViewerSource(asset.path, currentTime, wasPlaying || currentTime === 0);
      targetProfile = viewerState.metadata && Number(viewerState.metadata.height) >= 1800 ? "1080" : "720";
      viewerState.autoTimer = setTimeout(function () {
        viewerState.autoKeepSource = viewerState.sourcePlayable; elements.viewerBusy.hidden = true;
        if (viewerState.autoKeepSource && mediaTools) { mediaTools.cancelPreviewJob(asset.path); }
      }, 4000);
      if (!mediaTools) { return; }
      elements.viewerBusy.hidden = false; elements.viewerBusy.textContent = "AUTO · 正在准备流畅预览…";
      mediaTools.previewProxyFor(asset.path, targetProfile).then(function (previewPath) {
        if (token !== viewerState.loadToken || viewerState.profile !== "auto") { return; }
        viewerState.autoProxyReady = previewPath;
        if (!viewerState.autoKeepSource || !viewerState.sourcePlayable) { clearTimeout(viewerState.autoTimer); elements.viewerBusy.hidden = true; switchViewerSource(previewPath, Number(media.currentTime) || currentTime, !media.paused || !viewerState.sourcePlayable); }
      }).catch(function () { if (token === viewerState.loadToken) { elements.viewerBusy.hidden = true; } });
      return;
    }
    elements.viewerBusy.hidden = false; elements.viewerBusy.textContent = "正在生成 " + profile + "p 播放代理…";
    (mediaTools ? mediaTools.previewProxyFor(asset.path, profile) : Promise.resolve(asset.path)).then(function (previewPath) {
      if (token !== viewerState.loadToken || media !== viewerState.media) { return; }
      elements.viewerBusy.hidden = true; switchViewerSource(previewPath, currentTime, wasPlaying || currentTime === 0);
    }).catch(function (error) {
      if (token !== viewerState.loadToken) { return; }
      if (error && error.code === "JOB_CANCELLED" && viewerState.asset === asset && viewerState.profile === profile) {
        setTimeout(function () { if (viewerState.asset === asset && viewerState.profile === profile) { loadViewerProfile(profile, preserveTime); } }, 120);
        return;
      }
      elements.viewerBusy.hidden = true;
      showNotice("无法准备播放代理：" + friendlyError(error), true, 6500);
    });
  }

  function switchViewerSource(filePath, currentTime, shouldPlay) {
    var media = viewerState.media;
    if (!media || !filePath) { return; }
    media.addEventListener("loadedmetadata", function restorePosition() {
      if (media !== viewerState.media) { return; }
      if (isFinite(media.duration)) { media.currentTime = Math.max(0, Math.min(Number(currentTime) || 0, Math.max(0, media.duration - .001))); }
      if (shouldPlay) { safePlay(media); }
      updateViewerTimeline();
    }, { once: true });
    media.src = SeekLibrary.fileUrl(filePath); media.load();
  }

  function updateViewerSubtitle() {
    var asset = viewerState.asset;
    var metadata = viewerState.metadata;
    var pieces;
    if (!asset) { return; }
    if (!metadata) { elements.viewerSubtitle.textContent = typeLabel(asset.type) + " · " + SeekLibrary.formatBytes(asset.size); return; }
    pieces = [metadata.resolution, metadata.videoCodecShort && metadata.videoCodecShort !== "无" ? String(metadata.videoCodecShort).toUpperCase() : metadata.audioCodecShort && metadata.audioCodecShort !== "无" ? String(metadata.audioCodecShort).toUpperCase() : "", metadata.frameRate ? metadata.frameRate.toFixed(3).replace(/\.000$/, "") + " fps" : ""];
    elements.viewerSubtitle.textContent = pieces.filter(Boolean).join(" · ");
  }

  function viewerFrameRate() { return Math.max(1, Number(viewerState.metadata && viewerState.metadata.frameRate) || 25); }

  function formatViewerTimecode(seconds) {
    return FnOSTimecode.formatAt(seconds, viewerFrameRate(), viewerState.metadata && viewerState.metadata.timecode);
  }

  function updateViewerTimeline() {
    var media = viewerState.media;
    var duration;
    if (!media || typeof media.currentTime !== "number") { return; }
    duration = isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
    elements.viewerTimecode.textContent = viewerState.timeDisplayMode === "frames" ? Math.max(0, Math.round(media.currentTime * viewerFrameRate())) + " F" : formatViewerTimecode(media.currentTime);
    if (!viewerState.isSeeking && duration) { elements.viewerScrubber.value = String(Math.round(media.currentTime / duration * 1000)); }
  }

  function startViewerClock() {
    if (viewerState.frameRequest) { cancelAnimationFrame(viewerState.frameRequest); }
    function tick() {
      var media = viewerState.media;
      var outPoint = viewerState.outPoint;
      if (!media || media.paused) { viewerState.frameRequest = 0; return; }
      if (outPoint !== null && media.currentTime >= outPoint - .5 / viewerFrameRate()) {
        if (viewerState.loop) { media.currentTime = viewerState.inPoint; safePlay(media); }
        else { media.pause(); media.currentTime = outPoint; }
      }
      updateViewerTimeline();
      viewerState.frameRequest = requestAnimationFrame(tick);
    }
    viewerState.frameRequest = requestAnimationFrame(tick);
  }

  function toggleViewerPlayback() {
    var media = viewerState.media;
    if (!media || typeof media.play !== "function") { return; }
    if (media.paused) {
      if (viewerState.outPoint !== null && (media.currentTime < viewerState.inPoint || media.currentTime >= viewerState.outPoint)) { media.currentTime = viewerState.inPoint; }
      safePlay(media);
    } else { media.pause(); }
  }

  function stepViewerFrame(direction) {
    var media = viewerState.media;
    var min;
    var max;
    if (!media || typeof media.currentTime !== "number") { return; }
    media.pause(); min = viewerState.inPoint || 0; max = viewerState.outPoint === null ? (isFinite(media.duration) ? media.duration : Infinity) : viewerState.outPoint;
    media.currentTime = Math.max(min, Math.min(max, media.currentTime + direction / viewerFrameRate())); updateViewerTimeline();
  }

  function navigateViewerAsset(direction) {
    var current = viewerState.asset;
    var mediaAssets;
    var index;
    var next;
    if (!current) { return; }
    mediaAssets = state.visibleAssets.filter(function (asset) { return asset.type === "video" || asset.type === "audio" || asset.type === "image"; });
    index = mediaAssets.map(function (asset) { return asset.domId; }).indexOf(current.domId);
    if (index === -1) { return; }
    next = mediaAssets[index + direction];
    if (!next) { return; }
    selectAsset(next.domId, { only: true });
    openViewer(next);
  }

  function markViewerIn() {
    var media = viewerState.media;
    var frame;
    var maxIn;
    if (!media || typeof media.currentTime !== "number") { return; }
    frame = 1 / viewerFrameRate();
    maxIn = viewerState.outPoint !== null ? viewerState.outPoint - frame : isFinite(media.duration) ? media.duration - frame : media.currentTime;
    viewerState.inPoint = Math.max(0, Math.min(media.currentTime, Math.max(0, maxIn)));
    viewerState.hasIn = true;
    updateViewerMarks();
  }

  function markViewerOut() {
    var media = viewerState.media;
    var frame;
    var duration;
    if (!media || typeof media.currentTime !== "number") { return; }
    frame = 1 / viewerFrameRate(); duration = isFinite(media.duration) ? media.duration : Infinity;
    viewerState.outPoint = Math.min(duration, Math.max(media.currentTime, viewerState.inPoint + frame));
    viewerState.hasOut = true;
    updateViewerMarks();
  }

  function updateViewerMarks() {
    var media = viewerState.media;
    var duration = media && isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
    elements.viewerMarks.textContent = "I " + formatViewerTimecode(viewerState.inPoint) + " / O " + (viewerState.outPoint === null ? "—" : formatViewerTimecode(viewerState.outPoint));
    elements.viewerInMark.hidden = !viewerState.hasIn || !duration;
    elements.viewerOutMark.hidden = !viewerState.hasOut || !duration;
    if (duration) {
      elements.viewerInMark.style.left = Math.max(0, Math.min(100, viewerState.inPoint / duration * 100)) + "%";
      elements.viewerOutMark.style.left = Math.max(0, Math.min(100, viewerState.outPoint / duration * 100)) + "%";
      if (elements.timelineTrackWrap) {
        elements.timelineTrackWrap.style.setProperty("--timeline-in", Math.max(0, Math.min(100, viewerState.inPoint / duration * 100)) + "%");
        elements.timelineTrackWrap.style.setProperty("--timeline-out", Math.max(0, Math.min(100, (viewerState.outPoint === null ? duration : viewerState.outPoint) / duration * 100)) + "%");
        elements.timelineTrackWrap.classList.toggle("has-range", viewerState.hasIn && viewerState.hasOut && viewerState.outPoint > viewerState.inPoint);
        elements.timelineTrackWrap.setAttribute("data-has-range", viewerState.hasIn && viewerState.hasOut && viewerState.outPoint > viewerState.inPoint ? "true" : "false");
      }
    } else if (elements.timelineTrackWrap) {
      elements.timelineTrackWrap.classList.remove("has-range");
      elements.timelineTrackWrap.setAttribute("data-has-range", "false");
    }
  }

  function timelineTimeFromPointer(event) {
    var media = viewerState.media;
    var rect;
    var ratio;
    if (!media || !elements.timelineTrackWrap || !isFinite(media.duration) || media.duration <= 0) { return null; }
    rect = elements.timelineTrackWrap.getBoundingClientRect();
    ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    return ratio * media.duration;
  }

  function handleTimelineMouse(event) {
    var seconds;
    if (!viewerState.media || event.target === elements.viewerScrubber && !event.shiftKey && !event.altKey && event.type !== "contextmenu") { return; }
    seconds = timelineTimeFromPointer(event);
    if (seconds === null) { return; }
    if (event.type === "contextmenu" || event.altKey || event.button === 2) {
      event.preventDefault();
      viewerState.media.currentTime = seconds;
      markViewerOut();
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      viewerState.media.currentTime = seconds;
      markViewerIn();
      return;
    }
    if (event.target !== elements.viewerScrubber) {
      event.preventDefault();
      viewerState.media.currentTime = seconds;
      updateViewerTimeline();
    }
  }

  function toggleViewerLoop() {
    viewerState.loop = !viewerState.loop;
    elements.loopButton.classList.toggle("is-active", viewerState.loop);
    elements.loopButton.setAttribute("aria-pressed", viewerState.loop ? "true" : "false");
  }

  function seekViewerFromSlider() {
    var media = viewerState.media;
    if (!media || !isFinite(media.duration) || media.duration <= 0) { return; }
    viewerState.isSeeking = true;
    media.currentTime = Math.max(0, Math.min(media.duration - .001, Number(elements.viewerScrubber.value) / 1000 * media.duration));
    updateViewerTimeline();
  }

  function startViewerDrag(event) {
    var asset = viewerState.asset;
    var result;
    if (state.hostId !== "PPRO" || !asset || asset.type === "lut") { event.preventDefault(); return; }
    result = FnOSInteractionTools.viewerDragPath(asset, event.altKey || altPressed, viewerState.audioProxyPath);
    if (!result.ok) { event.preventDefault(); showNotice(viewerState.audioProxyStatus === "unavailable" ? "该视频没有可用音轨，无法仅拖入音频。" : "仅音频副本仍在准备，请稍后再按住 Alt 拖动。", viewerState.audioProxyStatus === "unavailable", 4000); return; }
    populateAdobeDragData(event, result.path);
  }

  function captureViewerFrame() {
    var asset = viewerState.asset;
    var media = viewerState.media;
    if (state.hostId !== "PPRO" || !asset || asset.type !== "video" || !mediaTools) { return; }
    elements.screenshotButton.disabled = true;
    showNotice("正在从原始视频生成当前帧…", false, 0);
    mediaTools.captureFrameForProject(asset.path, media.currentTime).then(function (filePath) {
      return runHostActionForPath(filePath, false, "截图", "current", { directImport: true });
    }).then(function () { showNotice("截图已生成并导入 Premiere 项目。", false, 4500); })
      .catch(function (error) { showNotice("截图失败：" + friendlyError(error), true, 6500); })
      .then(function () { elements.screenshotButton.disabled = false; });
  }

  function drawDefaultLutSample(context, width, height) {
    var sky = context.createLinearGradient(0, 0, 0, height);
    var field = context.createLinearGradient(0, height * .55, 0, height);
    sky.addColorStop(0, "#9da7a9"); sky.addColorStop(1, "#b9b1a4");
    field.addColorStop(0, "#7f8878"); field.addColorStop(1, "#5f675b");
    context.fillStyle = sky; context.fillRect(0, 0, width, height * .62);
    context.fillStyle = "#777d79"; context.beginPath(); context.moveTo(0, height * .58); context.lineTo(width * .22, height * .32); context.lineTo(width * .39, height * .53); context.lineTo(width * .62, height * .27); context.lineTo(width, height * .57); context.lineTo(width, height * .68); context.lineTo(0, height * .68); context.fill();
    context.fillStyle = "#656d68"; context.beginPath(); context.moveTo(0, height * .63); context.lineTo(width * .28, height * .46); context.lineTo(width * .5, height * .62); context.lineTo(width * .78, height * .4); context.lineTo(width, height * .62); context.lineTo(width, height * .72); context.lineTo(0, height * .72); context.fill();
    context.fillStyle = field; context.fillRect(0, height * .62, width, height * .38);
    context.fillStyle = "rgba(111,130,135,.72)"; context.beginPath(); context.moveTo(width * .42, height); context.lineTo(width * .54, height * .62); context.lineTo(width * .67, height * .62); context.lineTo(width * .83, height); context.fill();
    context.fillStyle = "rgba(193,154,114,.72)"; context.beginPath(); context.moveTo(width * .19, height); context.lineTo(width * .46, height * .63); context.lineTo(width * .51, height * .63); context.lineTo(width * .34, height); context.fill();
    context.fillStyle = "rgba(207,190,149,.75)"; context.beginPath(); context.arc(width * .78, height * .2, Math.max(5, width * .035), 0, Math.PI * 2); context.fill();
    [[.08,.68,"#77775e"],[.13,.66,"#68715d"],[.88,.69,"#727b61"],[.93,.65,"#626a59"]].forEach(function (tree) {
      context.fillStyle = tree[2]; context.beginPath(); context.arc(width * tree[0], height * tree[1], width * .045, 0, Math.PI * 2); context.fill();
    });
    context.fillStyle = "rgba(224,211,196,.65)"; context.fillRect(width * .035, height * .055, width * .13, height * .025);
    context.fillStyle = "rgba(65,68,66,.7)"; context.fillRect(width * .035, height * .086, width * .09, height * .016);
  }

  function defaultLutSample(width, height) {
    var canvas = document.createElement("canvas");
    var context;
    canvas.width = width; canvas.height = height; context = canvas.getContext("2d");
    drawDefaultLutSample(context, width, height);
    return { canvas: canvas, data: context.getImageData(0, 0, width, height) };
  }

  function renderLutThumbnail(asset, thumb, generation) {
    var sample = defaultLutSample(256, 144);
    var context = sample.canvas.getContext("2d");
    var promise = lutTools ? lutTools.parseFile(asset.path) : Promise.resolve(null);
    return promise.then(function (lut) {
      var processed = lut ? FnOSLutTools.applyToImageData(sample.data, lut, { opacity: 1 }) : sample.data;
      context.putImageData(processed, 0, 0);
      if (generation === renderGeneration && document.documentElement.contains(thumb)) { installImage(thumb, sample.canvas.toDataURL("image/jpeg", .86), asset.name, "poster-image", asset); }
    }).catch(function () {
      context.putImageData(sample.data, 0, 0);
      if (generation === renderGeneration && document.documentElement.contains(thumb)) { installImage(thumb, sample.canvas.toDataURL("image/jpeg", .82), asset.name, "poster-image", asset); }
    });
  }

  function openLutViewer(asset) {
    var sample;
    var context;
    closeViewer();
    closeLutViewer();
    lutState.asset = asset; lutState.lut = null;
    elements.lutViewerTitle.textContent = asset.name;
    elements.lutViewerSubtitle.textContent = "正在解析 .CUBE · 参考风景灰片";
    elements.lutSplitRange.value = "50"; elements.lutOpacityRange.value = "100";
    elements.installLutButton.disabled = true;
    elements.lutViewer.hidden = false;
    sample = defaultLutSample(elements.lutCanvas.width, elements.lutCanvas.height);
    context = elements.lutCanvas.getContext("2d"); context.putImageData(sample.data, 0, 0);
    lutState.original = sample.data; lutState.processed = sample.data;
    if (!lutTools || !nodeAvailable) {
      elements.lutViewerSubtitle.textContent = "界面预览 · 参考风景灰片";
      return;
    }
    lutTools.parseFile(asset.path).then(function (lut) {
      if (lutState.asset !== asset) { return; }
      lutState.lut = lut;
      lutState.processed = FnOSLutTools.applyToImageData(lutState.original, lut, { opacity: 1 });
      elements.lutViewerSubtitle.textContent = (lut.title ? lut.title + " · " : "") + lut.size + (lut.type === "3d" ? "³ 3D LUT" : " 点 1D LUT") + " · sRGB 8-bit 近似预览";
      elements.installLutButton.disabled = false;
      renderCurrentLutPreview();
    }).catch(function (error) { elements.lutViewerSubtitle.textContent = "无法解析 LUT：" + friendlyError(error); });
  }

  function renderCurrentLutPreview() {
    if (!lutState.original || !lutState.processed) { return; }
    FnOSLutTools.renderSplit(elements.lutCanvas.getContext("2d"), lutState.original, lutState.processed, Number(elements.lutSplitRange.value) / 100, Number(elements.lutOpacityRange.value) / 100);
  }

  function scheduleLutRender() {
    if (lutState.renderFrame) { return; }
    lutState.renderFrame = requestAnimationFrame(function () { lutState.renderFrame = 0; renderCurrentLutPreview(); });
  }

  function closeLutViewer() {
    if (lutState.renderFrame) { cancelAnimationFrame(lutState.renderFrame); lutState.renderFrame = 0; }
    elements.lutViewer.hidden = true;
    lutState.asset = null; lutState.lut = null; lutState.original = null; lutState.processed = null;
  }

  function installCurrentLut() {
    var asset = lutState.asset;
    var directory;
    var base;
    var extension;
    if (!asset || !nodeAvailable) { return; }
    directory = path.join(os.homedir(), "Library", "Application Support", "Adobe", "Common", "LUTs", "Creative");
    base = path.basename(asset.path, path.extname(asset.path)).slice(0, 120); extension = path.extname(asset.path) || ".cube";
    fs.mkdirSync(directory, { recursive: true });
    elements.installLutButton.disabled = true;
    (function copyUnique(index) {
      var destination = path.join(directory, base + (index > 1 ? "-" + index : "") + extension);
      fs.copyFile(asset.path, destination, fs.constants.COPYFILE_EXCL, function (error) {
        if (error && error.code === "EEXIST") { copyUnique(index + 1); return; }
        elements.installLutButton.disabled = false;
        if (error) { showNotice("复制 LUT 失败：" + friendlyError(error), true, 6500); return; }
        showNotice("已复制到 Lumetri 的 Creative LUT 目录；重启 Premiere 后可选择。", false, 7000);
      });
    }(1));
  }

  function displayMediaFormat(asset, metadata) {
    var extension = String(asset && asset.extension || path && path.extname(asset && asset.name || "").replace(/^\./, "") || "").toLowerCase();
    var known = {
      mp4: "MP4", m4v: "M4V", mov: "MOV", mxf: "MXF", avi: "AVI", mkv: "MKV", webm: "WebM",
      wav: "WAV", mp3: "MP3", aac: "AAC", m4a: "M4A", flac: "FLAC", aiff: "AIFF", aif: "AIFF",
      jpg: "JPEG", jpeg: "JPEG", png: "PNG", webp: "WebP", gif: "GIF", bmp: "BMP", psd: "PSD", psb: "PSB", ai: "AI", eps: "EPS", cube: "CUBE"
    };
    if (known[extension]) { return known[extension]; }
    if (metadata && metadata.formatShort) { return String(metadata.formatShort).split(",")[0].toUpperCase(); }
    return metadata && metadata.format || "未知";
  }

  function metadataRows(asset, metadata) {
    return [
      ["文件格式", displayMediaFormat(asset, metadata)], ["时长", FnOSMediaTools.formatDuration(metadata.duration)],
      ["文件大小", SeekLibrary.formatBytes(asset.size)], ["总码率", FnOSMediaTools.formatBitrate(metadata.totalBitrate)],
      ["视频编码", metadata.videoCodec], ["视频 Profile", metadata.videoProfile], ["视频码率", FnOSMediaTools.formatBitrate(metadata.videoBitrate)],
      ["音频编码", metadata.audioCodec], ["音频 Profile", metadata.audioProfile], ["音频码率", FnOSMediaTools.formatBitrate(metadata.audioBitrate)], ["分辨率", metadata.resolution],
      ["帧率", metadata.frameRate ? metadata.frameRate.toFixed(3).replace(/\.000$/, "") + " fps" : "不适用"],
      ["色彩空间", metadata.colorSpace], ["色域 / Primaries", metadata.colorPrimaries], ["传递函数", metadata.colorTransfer],
      ["矩阵系数", metadata.colorMatrix], ["色彩范围", metadata.colorRange],
      ["动态范围", metadata.dynamicRange],
      ["Alpha 通道", metadata.alpha],
      ["像素格式", metadata.pixelFormat], ["位深", metadata.bitDepth], ["扫描方式", metadata.fieldOrder],
      ["像素宽高比", metadata.sampleAspectRatio], ["显示宽高比", metadata.displayAspectRatio],
      ["音频采样率", metadata.audioSampleRate ? metadata.audioSampleRate + " Hz" : "不适用"], ["音频声道", metadata.audioChannels],
      ["时间码", metadata.timecode], ["媒体流数量", String(metadata.streamCount)], ["媒体创建时间", metadata.creationTime],
      ["修改日期", new Date(asset.modifiedMs).toLocaleString("zh-CN")], ["素材位置", asset.rootLabel], ["完整路径", asset.path]
    ];
  }

  function openMetadata(asset) {
    state.selectedId = asset.domId;
    elements.metadataTitle.textContent = ""; elements.metadataPreview.innerHTML = ""; elements.metadataList.innerHTML = ""; elements.metadataLoading.hidden = false; elements.metadataPanel.hidden = false;
    var card = findCard(asset.domId); var previewImage = card && card.querySelector(".asset-thumb img");
    if (previewImage) { var image = document.createElement("img"); image.src = previewImage.src; image.alt = ""; elements.metadataPreview.appendChild(image); }
    else { elements.metadataPreview.appendChild(createPlaceholder(asset)); }
    if (!mediaTools && asset.mediaMetadata) {
      elements.metadataLoading.hidden = true;
      metadataRows(asset, asset.mediaMetadata).forEach(function (row) { var dt = document.createElement("dt"); var dd = document.createElement("dd"); dt.textContent = row[0]; dd.textContent = row[1]; elements.metadataList.appendChild(dt); elements.metadataList.appendChild(dd); });
      return;
    }
    if (!mediaTools) { elements.metadataLoading.textContent = "界面预览模式不读取真实元数据。"; return; }
    mediaTools.metadataFor(asset.path).then(function (metadata) {
      asset.mediaMetadata = metadata;
      elements.metadataLoading.hidden = true;
      metadataRows(asset, metadata).forEach(function (row) { var dt = document.createElement("dt"); var dd = document.createElement("dd"); dt.textContent = row[0]; dd.textContent = row[1]; elements.metadataList.appendChild(dt); elements.metadataList.appendChild(dd); });
      if (state.preferences.sortBy === "duration") { applyFilters(); }
    }).catch(function (error) { elements.metadataLoading.textContent = "无法读取元数据：" + friendlyError(error); });
  }

  function closeMetadata() { elements.metadataPanel.hidden = true; }

  function openRenameDialog(asset) {
    var extensionLength = asset.extension ? asset.extension.length + 1 : 0;
    state.dialogAction = { type: asset.type === "folder" ? "rename-folder" : "rename", assetId: asset.domId };
    elements.dialogTitle.textContent = asset.type === "folder" ? "重命名文件夹" : "重命名源文件";
    elements.dialogMessage.textContent = asset.type === "folder" ? "这会修改当前素材位置中的真实文件夹名称。" : "这会修改当前素材位置上的真实文件名；若素材已导入 Adobe 工程，工程可能显示离线。不可在这里更改扩展名。";
    elements.renameField.hidden = false; elements.renameInput.value = asset.name;
    elements.dialogConfirmButton.textContent = "重命名"; elements.dialogConfirmButton.className = "button button-primary";
    elements.fileActionDialog.hidden = false; elements.renameInput.focus(); elements.renameInput.setSelectionRange(0, asset.name.length - extensionLength);
  }

  function openCreateFolderDialog() {
    var destination = currentDestination();
    if (!destination || !assetOps) { showNotice("请先勾选一个可用素材位置。", true, 4000); return; }
    state.dialogAction = { type: "create-folder", destination: destination };
    elements.dialogTitle.textContent = "新建文件夹";
    elements.dialogMessage.textContent = "文件夹会创建在当前素材路径下。";
    elements.renameField.hidden = false; elements.renameInput.value = "新建文件夹";
    elements.dialogConfirmButton.textContent = "创建"; elements.dialogConfirmButton.className = "button button-primary";
    elements.fileActionDialog.hidden = false; elements.renameInput.focus(); elements.renameInput.select();
  }

  function openTrashDialog(input) {
    var assets = Array.isArray(input) ? input : [input];
    assets = assets.filter(Boolean);
    if (!assets.length) { return; }
    state.dialogAction = { type: "trash", assetIds: assets.map(function (asset) { return asset.domId; }) };
    elements.dialogTitle.textContent = assets.length > 1 ? "删除这 " + assets.length + " 项？" : "删除“" + assets[0].name + "”？";
    elements.dialogMessage.textContent = "删除该文件会删除本地文件。系统会先尝试移入 macOS 废纸篓；若 SMB 共享不支持可恢复删除，操作会失败并保留原文件，不会执行永久删除。已导入 Adobe 的引用可能离线。";
    elements.renameField.hidden = true; elements.dialogConfirmButton.textContent = "移到废纸篓"; elements.dialogConfirmButton.className = "button button-danger";
    elements.fileActionDialog.hidden = false;
  }

  function closeDialog() { elements.fileActionDialog.hidden = true; state.dialogAction = null; }

  function confirmDialogAction() {
    var action = state.dialogAction;
    var asset = action && assetForId(action.assetId);
    elements.dialogConfirmButton.disabled = true;
    if (action && action.type === "create-folder") {
      assetOps.createFolder({ roots: state.roots, rootId: action.destination.rootId, parentPath: action.destination.path, name: elements.renameInput.value, onProgress: showOperationProgress }).then(function () {
        closeDialog(); elements.dialogConfirmButton.disabled = false; showNotice("文件夹已创建。", false, 3500); scanAssets();
      }).catch(function (error) { elements.dialogConfirmButton.disabled = false; showNotice("创建失败：" + friendlyError(error), true, 6000); });
      return;
    }
    if (action && action.type === "trash") { performTrash((action.assetIds || []).map(assetForId).filter(Boolean)); return; }
    if (!asset) { elements.dialogConfirmButton.disabled = false; closeDialog(); return; }
    if (action.type === "rename-folder") {
      assetOps.renameFolder({ roots: state.roots, folder: asset, newName: elements.renameInput.value, onProgress: showOperationProgress }).then(function (result) {
        if (result.changed) { migrateLocalMeta(result.oldPath, result.path); }
        closeDialog(); elements.dialogConfirmButton.disabled = false; showNotice("文件夹已重命名。", false, 3500); scanAssets();
      }).catch(function (error) { elements.dialogConfirmButton.disabled = false; showNotice("重命名失败：" + friendlyError(error), true, 6000); });
      return;
    }
    if (!fileOps) { elements.dialogConfirmButton.disabled = false; closeDialog(); return; }
    try { fileOps.validateSource(asset, state.roots); }
    catch (error) { elements.dialogConfirmButton.disabled = false; showNotice(error.message, true, 6000); closeDialog(); return; }
    if (action.type === "rename") { performRename(asset); }
    else { performTrash(asset); }
  }

  function performRename(asset) {
    var result;
    try {
      result = fileOps.rename(asset, state.roots, elements.renameInput.value);
      if (!result.changed) { closeDialog(); elements.dialogConfirmButton.disabled = false; return; }
      migrateLocalMeta(result.oldPath, result.path);
      closeDialog(); elements.dialogConfirmButton.disabled = false;
      showNotice("已重命名。若 Adobe 工程提示离线，请重新链接新文件名。", false, 5500); scanAssets();
    } catch (error) {
      elements.dialogConfirmButton.disabled = false; showNotice("重命名失败：" + friendlyError(error), true, 6500);
    }
  }

  function performTrash(assets) {
    assets = Array.isArray(assets) ? assets.filter(Boolean) : [assets].filter(Boolean);
    if (!assets.length || !assetOps) { elements.dialogConfirmButton.disabled = false; closeDialog(); return; }
    assetOps.moveToTrash({ roots: state.roots, targets: assets, onProgress: showOperationProgress }).then(function () {
      elements.dialogConfirmButton.disabled = false;
      closeDialog(); state.selectedIds = {}; state.selectedId = null; showNotice("已移到 macOS 废纸篓，可从废纸篓恢复。", false, 4500); scanAssets();
    }).catch(function (error) {
      elements.dialogConfirmButton.disabled = false;
      showNotice("无法移到废纸篓，原文件已保留：" + friendlyError(error), true, 7000);
    });
  }

  function packageCurrentProject() {
    var destinationResult;
    var payload;
    var script;
    if (state.hostId !== "PPRO" || !csInterface || !projectPackager) { showNotice("项目素材打包仅支持 Premiere Pro。", true, 4500); return; }
    if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialogEx) { showNotice("无法打开目标文件夹选择器。", true, 4500); return; }
    destinationResult = window.cep.fs.showOpenDialogEx(false, true, "选择项目素材打包位置", currentDestination() ? currentDestination().path : "", []);
    if (!destinationResult || destinationResult.err !== 0 || !destinationResult.data || !destinationResult.data.length) { return; }
    payload = JSON.stringify({
      roots: state.roots.map(function (root) { return { id: root.id, path: root.path, label: root.label || displayNameForPath(root.path) }; }),
      captureRoots: mediaTools && mediaTools.captureDirectory ? [{ id: "plugin-capture", path: mediaTools.captureDirectory, label: "Plugin screenshots" }] : []
    });
    script = "SeekBridge.listUsedPremiereMedia(" + JSON.stringify(payload) + ")";
    elements.operationProgress.hidden = false; elements.operationProgressLabel.textContent = "正在读取 Premiere 时间线素材…"; elements.operationProgressBar.style.transform = "scaleX(0)";
    elements.packageProjectButton.disabled = true;
    csInterface.evalScript(script, function (rawResult) {
      var hostResult;
      try { hostResult = JSON.parse(rawResult); }
      catch (error) { hostResult = { ok: false, message: rawResult || "Premiere 没有返回素材清单。" }; }
      if (!hostResult.ok) { finishProjectPackageError(new Error(hostResult.message || "无法读取 Premiere 时间线素材。")); return; }
      if (!hostResult.media || !hostResult.media.length) { finishProjectPackageError(new Error("当前 Premiere 项目的时间线没有使用已配置路径中的素材。")); return; }
      projectPackager.packageProject({ destination: destinationResult.data[0], roots: state.roots, media: hostResult.media, project: hostResult, flatten: true, onProgress: renderPackageProgress }).then(function (result) {
        elements.packageProjectButton.disabled = false; elements.operationProgress.hidden = true;
        if (result.complete) { showNotice("项目素材打包完成，共复制 " + result.copied.length + " 个实际使用文件。", false, 7000); }
        else { showNotice("打包完成，但有 " + (result.offline.length + result.failed.length + result.skipped.length) + " 项离线或未复制；详情见打包清单。", true, 9000); }
        revealDirectory(result.destination);
      }).catch(finishProjectPackageError);
    });
  }

  function renderPackageProgress(progress) {
    var percent = Math.max(0, Math.min(100, Math.round((Number(progress.percent) || 0) * 100)));
    elements.operationProgress.hidden = false;
    elements.operationProgressLabel.textContent = progress.phase === "inspect" ? "核对实际使用素材 " + progress.completed + "/" + progress.total : progress.phase === "copy" ? "复制项目素材 " + progress.completed + "/" + progress.total + " · " + percent + "%" : "生成打包清单…";
    elements.operationProgressBar.style.transform = "scaleX(" + (percent / 100) + ")";
  }

  function finishProjectPackageError(error) {
    elements.packageProjectButton.disabled = false; elements.operationProgress.hidden = true;
    showNotice("项目素材打包失败：" + friendlyError(error), true, 8500);
  }

  function revealDirectory(directory) {
    if (!directory || !nodeAvailable) { return; }
    var processHandle = childProcess.spawn("/usr/bin/open", [directory], { detached: true });
    processHandle.on("error", function () {}); processHandle.unref();
  }

  function runHostActionForAssets(assets, placeAtCurrentTime, position) {
    var files = (assets || []).filter(function (asset) { return asset && asset.type !== "folder" && asset.type !== "lut"; });
    var completed = 0;
    if (!files.length) { return Promise.reject(new Error("没有可执行的媒体素材。")); }
    if (placeAtCurrentTime && position !== "end") { files = files.slice().reverse(); }
    return files.reduce(function (promise, asset) {
      return promise.then(function () { return runHostActionForPath(asset.path, placeAtCurrentTime, asset.name, position).then(function () { completed += 1; }); });
    }, Promise.resolve()).then(function () {
      showNotice(placeAtCurrentTime ? "已插入 " + completed + " 项素材。" : "已导入 " + completed + " 项素材。", false, 4200);
    }).catch(function (error) {
      showNotice("Adobe 操作未完成：" + friendlyError(error), true, 6500);
      throw error;
    });
  }

  function runHostActionForPath(filePath, placeAtCurrentTime, label, position, options) {
    var method;
    var payload;
    var script;
    if (!csInterface || state.hostId === "BROWSER") { return Promise.reject(new Error("请在 Premiere Pro 或 After Effects 中执行此操作。")); }
    method = placeAtCurrentTime ? (state.hostId === "AEFT" ? "importMediaToComp" : "importMediaToSequence") : "importMedia";
    payload = JSON.stringify({ path: filePath, position: position || "current", directImport: !!(options && options.directImport) }); script = "SeekBridge." + method + "(" + JSON.stringify(payload) + ")";
    return new Promise(function (resolve, reject) {
      csInterface.evalScript(script, function (rawResult) {
        var result;
        try { result = JSON.parse(rawResult); } catch (error) { result = { ok: false, code: "INVALID_RESPONSE", message: rawResult || "Adobe 没有返回结果。" }; }
        if (result.ok) { resolve({ path: filePath, label: label || path.basename(filePath) }); }
        else { reject(new Error(hostErrorMessage(result))); }
      });
    });
  }

  function hostErrorMessage(result) {
    var messages = { NO_PROJECT: "请先新建或打开一个 Adobe 工程。", NO_ACTIVE_SEQUENCE: "请先打开一条 Premiere 时间线。", NO_ACTIVE_COMP: "请先打开一个 After Effects 合成。", FILE_NOT_FOUND: "素材文件暂时不可用，请检查 fnOS 连接。", IMPORT_FAILED: "Adobe 无法导入这个文件，可能是不支持该格式。", INSERT_FAILED: "素材已导入，但没能放到当前时间。请检查时间线轨道。", ADD_TO_COMP_FAILED: "素材已导入，但没能加入当前合成。" };
    return messages[result.code] || result.message || "Adobe 操作失败，请重试。";
  }

  function revealAsset(asset) {
    var process;
    if (!asset || !nodeAvailable) { return; }
    process = childProcess.spawn("/usr/bin/open", ["-R", asset.path], { detached: true });
    process.on("error", function () { showNotice("无法在 Finder 中显示这个文件。", true, 4000); }); process.unref();
  }
  function syncSortDirection() {
    var asc = state.preferences.sortDirection === "asc";
    elements.sortDirectionButton.textContent = asc ? "↑ 升序" : "↓ 降序"; elements.sortDirectionButton.title = asc ? "升序" : "降序";
  }
  function syncGridZoom() {
    var size = Math.max(88, Math.min(260, Number(state.preferences.zoom) || 128));
    var available = elements.assetGrid && elements.assetGrid.clientWidth ? Math.max(88, elements.assetGrid.clientWidth - 4) : size;
    var effectiveSize = Math.min(size, available);
    var ratio = (size - 88) / 172;
    elements.assetGrid.classList.remove("grid-small", "grid-medium", "grid-large");
    elements.assetGrid.style.setProperty("--card-min", effectiveSize + "px");
    elements.assetGrid.style.setProperty("--badge-font", (6 + ratio * 2).toFixed(2) + "px");
    elements.assetGrid.style.setProperty("--badge-line", (9 + ratio * 2).toFixed(2) + "px");
    elements.assetGrid.style.setProperty("--favorite-size", (19 + ratio * 7).toFixed(2) + "px");
    elements.assetGrid.style.setProperty("--favorite-font", (12 + ratio * 5).toFixed(2) + "px");
    elements.assetGrid.style.setProperty("--label-size", (6 + ratio * 2).toFixed(2) + "px");
    elements.assetGrid.style.setProperty("--zoom-thumb-size", (8 + ratio * 7).toFixed(2) + "px");
    if (elements.zoomRange) {
      elements.zoomRange.style.setProperty("--zoom-thumb-size", (8 + ratio * 7).toFixed(2) + "px");
      elements.zoomRange.style.setProperty("--zoom-min-dot", (4 + ratio * 2).toFixed(2) + "px");
      elements.zoomRange.style.setProperty("--zoom-max-dot", (8 + ratio * 4).toFixed(2) + "px");
    }
  }
  function toggleViewMode() {
    state.preferences.viewMode = state.preferences.viewMode === "list" ? "card" : "list";
    persistPreferences(); syncViewMode(); syncGridZoom(); renderAssets();
  }
  function syncViewMode() {
    var list = state.preferences.viewMode === "list";
    elements.assetGrid.classList.toggle("is-list-view", list);
    elements.zoomRange.disabled = list;
    elements.zoomRange.closest(".zoom-control").classList.toggle("is-disabled", list);
    elements.zoomRange.setAttribute("aria-disabled", list ? "true" : "false");
    elements.viewModeButton.classList.toggle("is-active", list);
    elements.viewModeButton.querySelector("span").className = list ? "icon-view-list" : "icon-view-grid";
    elements.viewModeButton.setAttribute("aria-label", list ? "切换到卡片模式" : "切换到列表模式");
    syncCardStyle();
  }
  function toggleCardStyle() {
    state.preferences.cardStyle = state.preferences.cardStyle === "clean" ? "info" : "clean";
    persistPreferences();
    syncCardStyle();
    renderAssets();
  }
  function syncCardStyle() {
    var clean = state.preferences.cardStyle === "clean";
    elements.assetGrid.classList.toggle("is-clean-card", clean);
    elements.assetGrid.setAttribute("data-card-style", clean ? "clean" : "info");
    if (elements.cardStyleButton) {
      elements.cardStyleButton.hidden = state.preferences.viewMode === "list";
      elements.cardStyleButton.classList.toggle("is-active", clean);
      elements.cardStyleButton.setAttribute("aria-pressed", clean ? "true" : "false");
      elements.cardStyleButton.setAttribute("aria-label", clean ? "切换到信息卡模式" : "切换到纯净卡模式");
    }
  }
  function showEmpty(title, message) { elements.emptyTitle.textContent = title; elements.emptyMessage.textContent = message; elements.emptyState.hidden = false; }
  function showNotice(message, isError, duration) { clearTimeout(noticeTimer); elements.notice.hidden = false; elements.notice.textContent = message; elements.notice.classList.toggle("is-error", !!isError); if (duration !== 0) { noticeTimer = setTimeout(function () { elements.notice.hidden = true; }, duration || 4000); } }
  function friendlyError(error) { if (!error) { return "未知错误"; } if (error.code === "EACCES" || error.code === "EPERM") { return "没有操作权限"; } if (error.code === "ENOENT" || error.message === "FILE_NOT_FOUND") { return "路径不存在或共享位置已离线"; } if (error.message === "SOURCE_TIMEOUT") { return "共享位置响应超时"; } if (error.code === "JOB_CANCELLED") { return "任务已取消"; } return error.message || String(error); }

  function init() {
    cacheElements(); ensureContextMenuExtensions(); initializeRoots(); detectHost(); bindEvents();
    renderLocations(); syncSortDirection(); syncGridZoom(); syncViewMode(); syncCardStyle(); syncSelectAllButton(); syncFilterBadge();
    if (state.preferences.searchOpen) { toggleSearchPopover(); }
    scanAssets();
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); } else { init(); }
}());
