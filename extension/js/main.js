(function () {
  "use strict";

  var DEFAULT_ROOT = "/Volumes/团队文件-剪辑共享/0813-MIniMax";
  var MAX_SCAN_FILES = 10000;
  var LABELS = ["none", "violet", "iris", "caribbean", "lavender", "cerulean", "forest", "rose", "mango", "purple", "blue", "teal", "magenta", "tan", "green", "brown", "yellow"];
  var LUT_SAMPLE_SOURCE = "ui/assets/lut-preview-landscape-log.jpg";
  var LEGACY_LABELS = { red: "rose", orange: "mango" };
  var LABEL_NAMES = { none: "无", violet: "紫罗兰", iris: "靛蓝", caribbean: "青绿", lavender: "浅紫", cerulean: "天蓝", forest: "深绿", rose: "粉色", mango: "橙色", purple: "紫色", blue: "蓝色", teal: "青色", magenta: "玫红", tan: "浅棕", green: "绿色", brown: "棕色", yellow: "黄色" };
  var LABEL_COLOR_VALUES = { none: "#3d4245", violet: "#a690e0", iris: "#729acc", caribbean: "#36bfa8", lavender: "#c8a9dd", cerulean: "#2fbfde", forest: "#51b858", rose: "#f76fa4", mango: "#eda63b", purple: "#a983df", blue: "#5d9fe8", teal: "#36a8a0", magenta: "#d9579b", tan: "#c7a46b", green: "#62c97d", brown: "#8d684d", yellow: "#d4bd51" };

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
  var pluginFolderOps = typeof FnOSPluginFolderOps === "object" ? FnOSPluginFolderOps : null;
  var persisted = stateStore ? stateStore.load() : FnOSStateStore.defaults();

  var state = {
    hostId: "BROWSER",
    roots: persisted.roots,
    assetMeta: persisted.assetMeta,
    pluginFolders: persisted.pluginFolders || [],
    pluginRootAssetKeys: persisted.pluginRootAssetKeys || [],
    libraryCache: persisted.libraryCache || {},
    preferences: persisted.preferences,
    assets: [],
    visibleAssets: [],
    assetById: {},
    selectedId: null,
    selectedIds: {},
    selectionAnchorId: null,
    selectionMode: false,
    contextId: null,
    folderScope: null,
    assetClipboard: pluginFolderOps ? pluginFolderOps.emptyClipboard() : { mode: "", assetKeys: [], sourceFolderId: "" },
    collapsedGroups: { folders: false, files: false },
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
    scanGeneration: 0,
    pendingFocusPaths: []
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

  var lutState = { asset: null, lut: null, original: null, processed: null, renderFrame: 0, compareMode: "toggle", toggleLut: true, dividerDragging: false, loadToken: 0 };
  var lutSampleImagePromise = null;
  var previewQueue = [];
  var activePreviewJobs = 0;
  var renderGeneration = 0;
  var visualObserver = null;
  var altPressed = false;
  var audioHover = { timer: null, media: null, assetId: null };
  var selectionPreview = { media: null, assetId: null, token: 0, fallbackRequested: false, frameTimer: null };

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
      "selectAllButton", "searchToggleButton", "inlineSearchField", "favoriteOnlyButton", "sortButton", "sortPopover", "sortSelect", "sortDirectionButton", "filterButton", "viewModeButton", "listModeButton", "cardStyleButton", "packageProjectButton", "toolbarExportButton", "locationsToolbarButton",
      "searchInput", "clearSearchButton", "toolbarSearchPopover", "filterBadge", "zoomControl", "zoomRange", "resultCount", "packageProjectButton", "clearSelectionButton", "resultActionsButton", "resultActionsPopover", "createFolderFromResultsButton", "uploadFilesButton", "pasteAssetsFromResultsButton", "notice", "operationProgress", "operationProgressLabel", "operationProgressBar", "assetGrid", "emptyState", "emptyTitle", "emptyMessage", "previewDock", "previewDockOpenButton", "previewDockMedia", "previewDockTitle", "previewDockSubtitle", "previewDockProgress", "previewDockBackButton", "previewDockPlayButton", "previewDockForwardButton", "previewDockTime", "previewDockInfoList",
      "folderScopeBar", "folderBackButton",
      "statusText", "locationsPopover", "locationsList", "locationsBackButton", "closeLocationsPopover", "addFolderFromPopover", "toggleAllRootsButton", "filterPopover",
      "openLocationsSettingsButton", "createFolderFromLocationsButton", "uploadFolderFromLocationsButton",
      "resetFiltersButton", "sizeFilter", "extensionFilter", "labelFilter", "labelFilterChoices", "rootFilter", "metadataOnlyFilter",
      "contextMenu", "insertSubmenuRow", "contextAePlaceButton", "contextLabelChoices", "copyAssetsButton", "cutAssetsButton", "pasteAssetsButton", "copyLabelButton", "pasteLabelButton", "clearLabelButton", "folderSubmenuRow", "folderSubmenu", "metadataHover", "metadataPanel", "metadataTitle", "metadataPreview", "metadataLoading",
      "metadataList", "closeMetadataButton", "viewer", "viewerTitle", "viewerSubtitle", "closeViewerButton", "viewerStage", "viewerMediaLayer", "viewerBusy",
      "viewerTimeline", "timelineTrackWrap", "viewerScrubber", "viewerInMark", "viewerOutMark", "frameBackButton", "playPauseButton", "frameForwardButton", "viewerTimecode",
      "loopButton", "volumeButton", "volumeRange", "screenshotButton", "qualityButton", "viewerQualityMenu", "viewerMarks", "lutViewer", "lutViewerTitle", "lutViewerSubtitle",
      "closeLutViewerButton", "lutCanvas", "lutDivider", "lutSplitRange", "lutOpacityRange", "lutCompareToggle", "lutSplitMode", "lutSliderMode", "installLutButton", "lutApplyStatus", "fileActionDialog", "dialogTitle",
      "dialogMessage", "renameField", "renameInput", "dialogCancelButton", "dialogConfirmButton"
    ].forEach(function (id) { elements[id] = byId(id); });
    elements.searchField = elements.inlineSearchField || (elements.toolbarSearchPopover ? elements.toolbarSearchPopover.querySelector(".search-field") : document.querySelector(".search-field"));
    elements.filterButtons = document.querySelectorAll(".filter-button");
  }

  function renderLabelFilterChoices() {
    var fragment = document.createDocumentFragment();
    var allButton = document.createElement("button");
    allButton.type = "button"; allButton.setAttribute("data-filter-label", "all"); allButton.className = "is-active"; allButton.textContent = "全部"; fragment.appendChild(allButton);
    LABELS.forEach(function (label) {
      var button = document.createElement("button");
      var dot = document.createElement("i");
      button.type = "button"; button.setAttribute("data-filter-label", label); button.className = "";
      dot.setAttribute("data-label", label); dot.style.backgroundColor = LABEL_COLOR_VALUES[label] || "#3d4245"; button.appendChild(dot); button.appendChild(document.createTextNode(LABEL_NAMES[label] || label));
      fragment.appendChild(button);
    });
    elements.labelFilterChoices.innerHTML = "";
    elements.labelFilterChoices.appendChild(fragment);
    elements.labelFilter.innerHTML = "";
    var all = document.createElement("option"); all.value = "all"; all.textContent = "不限"; elements.labelFilter.appendChild(all);
    LABELS.slice(1).forEach(function (label) { var option = document.createElement("option"); option.value = label; option.textContent = LABEL_NAMES[label] || label; elements.labelFilter.appendChild(option); });
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

  function persistPluginFolders() {
    if (!stateStore) { return; }
    stateStore.mutate(function (latest) {
      latest.pluginFolders = state.pluginFolders;
      latest.pluginRootAssetKeys = state.pluginRootAssetKeys;
    });
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
    var meta = state.assetMeta[normalizeAssetKey(asset.path)] || { favorite: false, label: "none", metadataCached: false };
    meta.label = LEGACY_LABELS[meta.label] || (LABELS.indexOf(meta.label) !== -1 ? meta.label : "none");
    return meta;
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
    var folderMigration = pluginFolderOps ? pluginFolderOps.migrateAssetKey({ pluginFolders: state.pluginFolders, pluginRootAssetKeys: state.pluginRootAssetKeys }, oldKey, newKey, { caseInsensitive: FolderPlatformIsWindows() }) : null;
    if (folderMigration && folderMigration.changed) {
      state.pluginFolders = folderMigration.pluginFolders;
      state.pluginRootAssetKeys = folderMigration.pluginRootAssetKeys;
    }
    if (state.assetClipboard && state.assetClipboard.assetKeys) {
      state.assetClipboard.assetKeys = state.assetClipboard.assetKeys.map(function (key) { return key === oldKey ? newKey : key; });
    }
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
      latest.pluginFolders = state.pluginFolders;
      latest.pluginRootAssetKeys = state.pluginRootAssetKeys;
    });
    state.assetMeta = persisted.assetMeta;
    state.pluginFolders = persisted.pluginFolders;
    state.pluginRootAssetKeys = persisted.pluginRootAssetKeys;
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
    if (elements.locationsToolbarButton) {
      elements.locationsToolbarButton.addEventListener("click", function (event) {
        event.stopPropagation();
        togglePopover(elements.locationsPopover, elements.locationsToolbarButton);
      });
    }
    elements.addFolderButton.addEventListener("click", chooseFolder);
    elements.addFolderFromPopover.addEventListener("click", chooseFolder);
    if (elements.locationsBackButton) { elements.locationsBackButton.addEventListener("click", leaveFolderScope); }
    if (elements.closeLocationsPopover) { elements.closeLocationsPopover.addEventListener("click", function () { hidePopover(elements.locationsPopover, elements.locationsToolbarButton || elements.locationsButton); }); }
    if (elements.openLocationsSettingsButton) { elements.openLocationsSettingsButton.addEventListener("click", function () { if (elements.locationsList) { elements.locationsList.scrollIntoView({ block: "nearest" }); } }); }
    if (elements.createFolderFromLocationsButton) { elements.createFolderFromLocationsButton.addEventListener("click", function () { hidePopover(elements.locationsPopover, elements.locationsToolbarButton); openCreatePluginFolderDialog(); }); }
    if (elements.uploadFolderFromLocationsButton) { elements.uploadFolderFromLocationsButton.addEventListener("click", function () { hidePopover(elements.locationsPopover, elements.locationsToolbarButton); chooseExternalFiles(); }); }
    if (elements.folderBackButton) { elements.folderBackButton.addEventListener("click", leaveFolderScope); }
    elements.upFolderButton.addEventListener("click", leaveFolderScope);
    elements.toggleAllRootsButton.addEventListener("click", toggleAllRoots);
    if (elements.createFolderFromResultsButton) { elements.createFolderFromResultsButton.addEventListener("click", function () { hidePopover(elements.resultActionsPopover, elements.resultActionsButton); openCreatePluginFolderDialog(); }); }
    if (elements.uploadFilesButton) { elements.uploadFilesButton.addEventListener("click", function () { hidePopover(elements.resultActionsPopover, elements.resultActionsButton); chooseExternalFiles(); }); }
    if (elements.pasteAssetsFromResultsButton) { elements.pasteAssetsFromResultsButton.addEventListener("click", function () { hidePopover(elements.resultActionsPopover, elements.resultActionsButton); pasteAssetClipboard(currentPluginFolderScopeId()); }); }
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
    if (elements.clearSelectionButton) { elements.clearSelectionButton.addEventListener("click", clearSelectedAssets); }
    if (elements.resultActionsButton) { elements.resultActionsButton.addEventListener("click", function (event) { event.stopPropagation(); syncClipboardActions(); togglePopover(elements.resultActionsPopover, elements.resultActionsButton); }); }
    elements.sortButton.addEventListener("click", function (event) { event.stopPropagation(); togglePopover(elements.sortPopover, elements.sortButton); });
    elements.viewModeButton.addEventListener("click", function () { setViewMode("card"); });
    if (elements.listModeButton) { elements.listModeButton.addEventListener("click", function () { setViewMode("list"); }); }
    if (elements.cardStyleButton) { elements.cardStyleButton.addEventListener("click", toggleCardStyle); }
    elements.packageProjectButton.addEventListener("click", packageCurrentProject);
    if (elements.toolbarExportButton) { elements.toolbarExportButton.addEventListener("click", packageCurrentProject); }
    elements.sortSelect.value = state.preferences.sortBy;
    elements.sortSelect.addEventListener("change", function () {
      state.preferences.sortBy = elements.sortSelect.value;
      syncSortFieldLabel();
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
    if (Number(state.preferences.zoom) < 150) { state.preferences.zoom = 190; }
    elements.zoomRange.value = String(state.preferences.zoom);
    elements.zoomRange.addEventListener("input", function () {
      state.preferences.zoom = Number(elements.zoomRange.value);
      syncGridZoom();
      schedulePreferencePersist();
    });
    if (elements.zoomControl) {
      elements.zoomControl.addEventListener("click", function (event) {
        if (event.target !== elements.zoomRange && !elements.zoomRange.disabled) { event.preventDefault(); elements.zoomControl.classList.toggle("is-open"); }
      });
    }

    elements.assetGrid.addEventListener("click", function (event) {
      var groupToggle = event.target.closest("button.asset-group-heading");
      var card = closestCard(event.target);
      var favorite = event.target.closest("button.favorite-toggle");
      var clickedAsset;
      if (groupToggle) {
        event.preventDefault();
        toggleAssetGroup(groupToggle.getAttribute("data-asset-group"));
        return;
      }
      if (favorite && card) {
        event.preventDefault(); event.stopPropagation();
        toggleFavorite(assetForId(card.getAttribute("data-asset-id")));
        return;
      }
      if (card) {
        clickedAsset = assetForId(card.getAttribute("data-asset-id"));
        selectAsset(card.getAttribute("data-asset-id"), { toggle: state.selectionMode || event.metaKey || event.ctrlKey, range: event.shiftKey });
        if (!clickedAsset || clickedAsset.type !== "video") { stopAudioHover(); stopSelectedVideoPreview(); }
        if (clickedAsset && clickedAsset.type === "video" && !state.selectionMode && !event.metaKey && !event.ctrlKey && !event.shiftKey) { playSelectedVideoPreview(clickedAsset); }
        else if (state.selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) { stopSelectedVideoPreview(); }
      } else {
        stopAudioHover();
        stopSelectedVideoPreview();
      }
    });
    elements.assetGrid.addEventListener("dblclick", function (event) {
      var card = closestCard(event.target);
      if (card && !event.target.closest("button")) {
        var doubleAsset = assetForId(card.getAttribute("data-asset-id"));
        selectAsset(card.getAttribute("data-asset-id"), { only: true });
        if (doubleAsset && (doubleAsset.type === "folder" || doubleAsset.type === "plugin-folder")) { enterFolderScope(doubleAsset); }
        else { openViewer(doubleAsset); }
      }
    });
    elements.assetGrid.addEventListener("keydown", function (event) {
      var card = closestCard(event.target);
      if (!card) { return; }
      if (event.key === "Enter") {
        var keyAsset = assetForId(card.getAttribute("data-asset-id"));
        selectAsset(card.getAttribute("data-asset-id"), { only: true });
        if (keyAsset && (keyAsset.type === "folder" || keyAsset.type === "plugin-folder")) { enterFolderScope(keyAsset); }
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
    Array.prototype.forEach.call(elements.contextMenu.querySelectorAll(".submenu-row"), bindFloatingSubmenu);
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
    if (elements.previewDockOpenButton) { elements.previewDockOpenButton.addEventListener("click", function () { var asset = selectedAsset(); if (asset) { openViewer(asset); } }); }
    if (elements.previewDockPlayButton) { elements.previewDockPlayButton.addEventListener("click", function () { var asset = selectedAsset(); if (asset) { openViewer(asset); } }); }
    if (elements.previewDockBackButton) { elements.previewDockBackButton.addEventListener("click", function () { navigateDockAsset(-1); }); }
    if (elements.previewDockForwardButton) { elements.previewDockForwardButton.addEventListener("click", function () { navigateDockAsset(1); }); }
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
    elements.lutCanvas.addEventListener("pointerdown", beginLutDividerDrag);
    elements.lutCompareToggle.addEventListener("click", function () { setLutCompareMode("toggle"); });
    elements.lutSplitMode.addEventListener("click", function () { setLutCompareMode("split"); });
    elements.lutSliderMode.addEventListener("click", function () { setLutCompareMode("slider"); });
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
      if (elements.zoomControl && !elements.zoomControl.contains(event.target)) { elements.zoomControl.classList.remove("is-open"); }
      if (!elements.viewerQualityMenu.contains(event.target) && event.target !== elements.qualityButton) { elements.viewerQualityMenu.hidden = true; elements.qualityButton.setAttribute("aria-expanded", "false"); }
      if (!elements.contextMenu.contains(event.target)) { closeContextMenu(); }
    });
    document.addEventListener("keydown", function (event) {
      var editing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target && event.target.tagName || "");
      var shortcut = (event.metaKey || event.ctrlKey) && !event.altKey ? String(event.key || "").toLowerCase() : "";
      if (event.key === "Alt") { altPressed = true; }
      if (shortcut && !editing && elements.viewer.hidden && elements.lutViewer.hidden && elements.fileActionDialog.hidden) {
        if (shortcut === "c" && copyAssetsToClipboard(selectedAssets(), "copy")) { event.preventDefault(); return; }
        if (shortcut === "x" && copyAssetsToClipboard(selectedAssets(), "cut")) { event.preventDefault(); return; }
        if (shortcut === "v" && state.assetClipboard && state.assetClipboard.assetKeys.length) { event.preventDefault(); pasteAssetClipboard(currentPluginFolderScopeId()); return; }
      }
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

  function bindFloatingSubmenu(row) {
    var submenu = row.querySelector(".context-submenu");
    var closeTimer = null;
    if (!submenu) { return; }
    function show() {
      var rect;
      var width;
      var left;
      var top;
      clearTimeout(closeTimer);
      submenu.classList.add("is-floating");
      rect = row.getBoundingClientRect();
      width = submenu.offsetWidth || 168;
      left = Math.min(window.innerWidth - width - 8, rect.right - 1);
      top = Math.max(8, Math.min(window.innerHeight - submenu.offsetHeight - 8, rect.top));
      submenu.style.left = Math.max(8, left) + "px";
      submenu.style.top = top + "px";
    }
    function hide() {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(function () { if (!row.matches(":hover") && !submenu.matches(":hover")) { submenu.classList.remove("is-floating"); } }, 120);
    }
    row.addEventListener("mouseenter", show);
    row.addEventListener("mouseleave", hide);
    submenu.addEventListener("mouseenter", show);
    submenu.addEventListener("mouseleave", hide);
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
    if (popover === elements.locationsPopover) { popover.classList.toggle("is-page-popover", trigger === elements.locationsToolbarButton); }
    if (popover === elements.locationsPopover && elements.locationsToolbarButton && trigger !== elements.locationsToolbarButton) {
      elements.locationsToolbarButton.setAttribute("aria-expanded", show ? "true" : "false");
    }
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
    if (popover === elements.locationsPopover) { popover.classList.remove("is-page-popover"); }
    if (trigger) { trigger.setAttribute("aria-expanded", "false"); }
    if (popover === elements.locationsPopover && elements.locationsToolbarButton) { elements.locationsToolbarButton.setAttribute("aria-expanded", "false"); }
  }

  function toggleSearchPopover() {
    if (!elements.toolbarSearchPopover || !elements.searchToggleButton) { return; }
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
    assetOps.copyExternalFiles({ roots: state.roots, rootId: destination.rootId, destinationPath: destination.path, sourcePaths: result.data, onProgress: showOperationProgress }).then(function (copied) {
      showNotice("素材已上传到当前路径。", false, 3500); scanAssets((copied || []).map(function (item) { return item.path; }));
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
    if (elements.locationsBackButton) { elements.locationsBackButton.hidden = !state.folderScope; }
    renderFolderScopeBar();
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
      SeekLibrary.scanLibraryAsync(root.path, { fs: fs, path: path }, { maxFiles: MAX_SCAN_FILES, maxDepth: 10, batchSize: 40, includeDirectories: false, cancelSignal: cancelSignal }, function (snapshot) {
        armWatchdog(); progress(snapshot);
      }).then(function (result) {
        clearTimeout(watchdog); resolve(result);
      }, function (error) {
        clearTimeout(watchdog);
        resolve({ assets: [], warnings: [root.path + ": " + friendlyError(error)], truncated: false, offline: true });
      });
    });
  }

  function scanAssets(focusPaths) {
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
    if (focusPaths && focusPaths.length) { state.pendingFocusPaths = focusPaths.slice(); }
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
          result.assets = (state.libraryCache[root.id] || []).filter(function (asset) { return asset.type !== "folder"; }).map(function (asset) { var cached = Object.assign({}, asset); cached.offline = true; return cached; });
        } else {
          result.assets = result.assets.filter(function (asset) { return asset.type !== "folder"; });
          state.libraryCache[root.id] = result.assets.map(function (asset) { return { name: asset.name, path: asset.path, relativePath: asset.relativePath, folder: asset.folder, extension: asset.extension, type: asset.type, size: asset.size, modifiedMs: asset.modifiedMs }; });
          cacheChanged = true;
        }
        if (result.truncated) { truncated += 1; }
        warnings += result.warnings.length;
        result.assets.forEach(function (asset) {
          if (asset.type === "folder") { return; }
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
      if (state.folderScope && !state.folderScope.pluginFolderId && !combined.some(function (asset) { return asset.type === "folder" && asset.rootId === state.folderScope.rootId && asset.path === state.folderScope.path; })) { state.folderScope = null; }
      rebuildAssetMap();
      renderLocations();
      elements.statusText.textContent = "已读取 " + combined.length + " 项素材";
      if (offline) { showNotice(offline + " 组素材离线，其余位置仍可使用。", false, 5500); }
      else if (truncated) { showNotice(truncated + " 组素材达到扫描上限，建议选择更小的文件夹。", false, 5500); }
      else if (warnings) { showNotice("有 " + warnings + " 个子位置暂时无法读取。", false, 5500); }
      applyFilters();
      focusPendingAssets();
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

  function focusPendingAssets() {
    var paths = state.pendingFocusPaths || [];
    var keys;
    var matches;
    if (!paths.length) { return; }
    keys = paths.map(normalizeAssetKey);
    matches = state.assets.filter(function (asset) { return keys.indexOf(normalizeAssetKey(asset.path)) !== -1; });
    state.pendingFocusPaths = [];
    if (!matches.length) { return; }
    state.selectedIds = {};
    matches.forEach(function (asset) { state.selectedIds[asset.domId] = true; });
    state.selectedId = matches[matches.length - 1].domId;
    state.selectionAnchorId = state.selectedId;
    renderAssets();
    setTimeout(function () {
      var card = findCard(state.selectedId);
      if (card && typeof card.scrollIntoView === "function") { card.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    }, 0);
  }

  function loadPreviewAssets() {
    var examples = [
      ["EVO4-Pro_产品特写.mov", "video", 238412800], ["fnOS_界面录屏.mp4", "video", 98304000],
      ["Seek_封面主视觉.png", "image", 6021120], ["发布会_环境声.wav", "audio", 48128000],
      ["工作流示意图.jpg", "image", 3184128], ["用户采访_A机位.mp4", "video", 438412800],
      ["fnOS_Neutral_Film.cube", "lut", 94682]
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
    state.assets.concat(pluginFolderDescriptors()).forEach(function (asset) { state.assetById[asset.domId] = asset; });
  }

  function assetForId(id) { return id ? state.assetById[id] || null : null; }
  function selectedAsset() { return assetForId(state.selectedId); }

  function navigateDockAsset(direction) {
    var current = selectedAsset();
    var media = state.visibleAssets.filter(function (asset) { return asset.type === "video" || asset.type === "audio" || asset.type === "image" || asset.type === "lut"; });
    var index = current ? media.map(function (asset) { return asset.domId; }).indexOf(current.domId) : -1;
    var next = media[index + direction];
    if (!next) { return; }
    selectAsset(next.domId, { only: true });
    syncPreviewDock();
  }

  function syncPreviewDock() {
    var asset = selectedAsset();
    var card;
    var poster;
    var metadata;
    var rows;
    if (!elements.previewDock) { return; }
    if (!asset || asset.type === "plugin-folder" || asset.type === "folder") {
      elements.previewDock.hidden = true;
      return;
    }
    elements.previewDock.hidden = false;
    elements.previewDockTitle.textContent = asset.name;
    elements.previewDockSubtitle.textContent = typeLabel(asset.type) + " · " + SeekLibrary.formatBytes(asset.size);
    elements.previewDockMedia.innerHTML = "";
    card = findCard(asset.domId);
    poster = card && card.querySelector("img.poster-image");
    if (poster && poster.src) {
      var image = document.createElement("img");
      image.src = poster.src; image.alt = asset.name; image.draggable = false;
      elements.previewDockMedia.appendChild(image);
    } else {
      var placeholder = document.createElement("span");
      placeholder.className = "preview-dock-empty";
      placeholder.textContent = asset.type === "audio" ? "波形预览" : asset.type === "lut" ? "LUT 预览" : "正在生成预览";
      elements.previewDockMedia.appendChild(placeholder);
    }
    metadata = asset.mediaMetadata;
    rows = metadata ? metadataRows(asset, metadata).filter(function (row) { return ["分辨率", "帧率", "文件大小", "文件格式", "时长"].indexOf(row[0]) !== -1; }) : [["文件格式", String(asset.extension || asset.type).toUpperCase()], ["文件大小", SeekLibrary.formatBytes(asset.size)]];
    elements.previewDockInfoList.innerHTML = "";
    rows.slice(0, 5).forEach(function (row) { var dt = document.createElement("dt"); var dd = document.createElement("dd"); dt.textContent = row[0]; dd.textContent = row[1]; elements.previewDockInfoList.appendChild(dt); elements.previewDockInfoList.appendChild(dd); });
  }

  function pluginFolderParentId(folder) { return folder ? String(folder.parentId || "") : ""; }

  function pluginFolderChildren(folderId) {
    var parentId = String(folderId || "");
    return state.pluginFolders.filter(function (folder) { return pluginFolderParentId(folder) === parentId; });
  }

  function pluginFolderPathLabel(folderId) {
    var names = [];
    var current = pluginFolderById(folderId);
    var visited = {};
    while (current && !visited[current.id]) {
      visited[current.id] = true;
      names.unshift(current.name);
      current = pluginFolderById(pluginFolderParentId(current));
    }
    return names.join(" / ");
  }

  function pluginFolderAssetKeys(folderId, visited) {
    var folder = pluginFolderById(folderId);
    var seen = visited || {};
    var keys = [];
    if (!folder || seen[folder.id]) { return keys; }
    seen[folder.id] = true;
    (folder.assetKeys || []).forEach(function (key) { if (keys.indexOf(key) === -1) { keys.push(key); } });
    pluginFolderChildren(folder.id).forEach(function (child) {
      pluginFolderAssetKeys(child.id, seen).forEach(function (key) { if (keys.indexOf(key) === -1) { keys.push(key); } });
    });
    return keys;
  }

  function pluginFolderAssetCount(folder) {
    return pluginFolderAssetKeys(folder && folder.id).length;
  }

  function assetAssignedToPluginFolder(asset) {
    var key;
    if (!asset || !asset.path) { return false; }
    key = normalizeAssetKey(asset.path);
    return state.pluginFolders.some(function (folder) { return Array.isArray(folder.assetKeys) && folder.assetKeys.indexOf(key) !== -1; });
  }

  function pluginFolderDescriptors() {
    return state.pluginFolders.map(function (folder) {
      return { id: "plugin-folder:" + folder.id, domId: "plugin-folder:" + folder.id, name: folder.name, path: "plugin://" + folder.id, relativePath: folder.name, folder: "插件文件夹", extension: "", type: "plugin-folder", size: 0, modifiedMs: 0, rootId: "plugin", rootPath: "", rootLabel: "插件文件夹", pluginFolderId: folder.id, parentId: pluginFolderParentId(folder), itemCount: pluginFolderAssetCount(folder) };
    });
  }

  function pluginFolderById(folderId) { return state.pluginFolders.filter(function (folder) { return folder.id === folderId; })[0] || null; }

  function pluginFolderContains(folder, asset) { return !!folder && folder.assetKeys.indexOf(normalizeAssetKey(asset.path)) !== -1; }

  function pluginFolderModel() {
    return { pluginFolders: state.pluginFolders, pluginRootAssetKeys: state.pluginRootAssetKeys };
  }

  function pluginFolderOptions() {
    return { caseInsensitive: FolderPlatformIsWindows() };
  }

  function currentPluginFolderScopeId() {
    return state.folderScope && state.folderScope.pluginFolderId ? String(state.folderScope.pluginFolderId) : "";
  }

  function applyPluginFolderResult(result) {
    if (!result) { return; }
    state.pluginFolders = result.pluginFolders || [];
    state.pluginRootAssetKeys = result.pluginRootAssetKeys || [];
    if (result.clipboard) { state.assetClipboard = result.clipboard; }
  }

  function assignPathsToPluginFolder(folderId, paths, sourceFolderId) {
    var keys = (paths || []).map(normalizeAssetKey).filter(Boolean);
    var result;
    if (!pluginFolderOps || !pluginFolderById(folderId) || !keys.length) { return; }
    result = pluginFolderOps.paste(pluginFolderModel(), pluginFolderOps.makeClipboard("cut", keys, sourceFolderId === undefined ? currentPluginFolderScopeId() : sourceFolderId, pluginFolderOptions()), folderId, pluginFolderOptions());
    applyPluginFolderResult(result);
    persistPluginFolders();
    rebuildAssetMap();
  }

  function clipboardAssets(input) {
    var assets = (input || []).filter(Boolean);
    if (!assets.length || assets.some(function (asset) { return asset.type === "folder" || asset.type === "plugin-folder"; })) { return []; }
    return assets;
  }

  function copyAssetsToClipboard(input, mode) {
    var assets = clipboardAssets(input);
    var keys;
    if (!pluginFolderOps || !assets.length) { return false; }
    keys = assets.map(function (asset) { return normalizeAssetKey(asset.path); });
    state.assetClipboard = pluginFolderOps.makeClipboard(mode, keys, currentPluginFolderScopeId(), pluginFolderOptions());
    showNotice("已" + (mode === "cut" ? "剪切 " : "复制 ") + assets.length + " 项；前往目标位置后粘贴。", false, 3200);
    renderAssets();
    return true;
  }

  function pasteAssetClipboard(targetFolderId) {
    var clipboard = state.assetClipboard;
    var availableKeys;
    var result;
    if (!pluginFolderOps || !clipboard || !clipboard.assetKeys || !clipboard.assetKeys.length) {
      showNotice("剪贴板中没有素材。", true, 3000);
      return false;
    }
    availableKeys = state.assets.map(function (asset) { return normalizeAssetKey(asset.path); });
    try {
      result = pluginFolderOps.paste(pluginFolderModel(), clipboard, targetFolderId || "", Object.assign(pluginFolderOptions(), { availableAssetKeys: availableKeys }));
    } catch (error) {
      showNotice("无法粘贴：" + friendlyError(error), true, 4500);
      return false;
    }
    applyPluginFolderResult(result);
    if (result.changed) {
      persistPluginFolders();
      rebuildAssetMap();
      state.selectedIds = {};
      state.selectedId = null;
      state.selectionAnchorId = null;
      showNotice("已粘贴 " + result.changedAssetKeys.length + " 项" + (result.missingAssetKeys.length ? "，另有 " + result.missingAssetKeys.length + " 项暂不可用。" : "。"), !!result.missingAssetKeys.length, 4200);
      applyFilters();
    } else {
      showNotice(result.missingAssetKeys.length ? "素材暂不可用，已保留在剪贴板。" : "这些素材已在当前位置。", !!result.missingAssetKeys.length, 3500);
      renderAssets();
    }
    return result.changed;
  }

  function pasteTargetForAsset(asset) {
    return asset && asset.type === "plugin-folder" ? String(asset.pluginFolderId || "") : currentPluginFolderScopeId();
  }

  function forgetAssetReferences(assets) {
    var keys = (assets || []).filter(function (asset) { return asset && asset.path; }).map(function (asset) { return normalizeAssetKey(asset.path); });
    var result;
    if (!pluginFolderOps || !keys.length) { return; }
    result = pluginFolderOps.forgetAssetKeys(pluginFolderModel(), keys, pluginFolderOptions());
    if (result.changed) {
      applyPluginFolderResult(result);
      persistPluginFolders();
    }
    if (state.assetClipboard && state.assetClipboard.assetKeys) {
      state.assetClipboard.assetKeys = state.assetClipboard.assetKeys.filter(function (key) { return keys.indexOf(key) === -1; });
      if (!state.assetClipboard.assetKeys.length) { state.assetClipboard = pluginFolderOps.emptyClipboard(); }
    }
  }

  function assetVisibleInPluginScope(asset, folderId) {
    if (!pluginFolderOps || !asset || !asset.path) { return folderId ? pluginFolderContains(pluginFolderById(folderId), asset) : !assetAssignedToPluginFolder(asset); }
    return pluginFolderOps.isVisibleInScope(pluginFolderModel(), normalizeAssetKey(asset.path), folderId || "", pluginFolderOptions());
  }
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
    if (asset.type === "plugin-folder") {
      var parentId = String(asset.parentId || "");
      var scopeId = state.folderScope && state.folderScope.pluginFolderId ? String(state.folderScope.pluginFolderId) : "";
      if (parentId !== scopeId) { return false; }
      return !state.query || asset.name.toLowerCase().indexOf(state.query.toLowerCase()) !== -1;
    }
    if (state.folderScope && state.folderScope.pluginFolderId) {
      return assetVisibleInPluginScope(asset, state.folderScope.pluginFolderId);
    }
    if (!state.folderScope && !assetVisibleInPluginScope(asset, "")) { return false; }
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
    if (!folder || (folder.type !== "folder" && folder.type !== "plugin-folder")) { return; }
    if (folder.type === "plugin-folder") {
      state.folderScope = { pluginFolderId: folder.pluginFolderId };
    } else {
      state.folderScope = { rootId: folder.rootId, path: folder.path };
    }
    if (folder.rootId) { state.preferences.activeRootId = folder.rootId; }
    state.selectedIds = {}; state.selectedId = null; state.selectionAnchorId = null;
    persistPreferences(); renderLocations(); renderFolderScopeBar(); applyFilters();
  }

  function renderFolderScopeBar() {
    var scope = state.folderScope;
    if (!elements.folderScopeBar) { return; }
    if (!scope) {
      elements.folderScopeBar.hidden = true;
      return;
    }
    elements.folderScopeBar.hidden = false;
  }

  function leaveFolderScope() {
    var scope = state.folderScope;
    var root;
    var parent;
    if (!scope) { return; }
    if (scope.pluginFolderId) {
      var pluginFolder = pluginFolderById(scope.pluginFolderId);
      var parentId = pluginFolderParentId(pluginFolder);
      state.folderScope = parentId ? { pluginFolderId: parentId } : null;
      state.selectedIds = {}; state.selectedId = null; state.selectionAnchorId = null;
      renderLocations(); renderFolderScopeBar(); applyFilters();
      return;
    }
    root = state.roots.filter(function (item) { return item.id === scope.rootId; })[0];
    parent = path.dirname(scope.path);
    state.folderScope = root && parent !== root.path && parent.indexOf(root.path + path.sep) === 0 ? { rootId: scope.rootId, path: parent } : null;
    state.selectedIds = {}; state.selectedId = null; state.selectionAnchorId = null;
    renderLocations(); renderFolderScopeBar(); applyFilters();
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
    if (left.type === "plugin-folder" && right.type !== "plugin-folder") { return -1; }
    if (right.type === "plugin-folder" && left.type !== "plugin-folder") { return 1; }
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
    var allAssets = pluginFolderDescriptors().concat(state.assets);
    state.visibleAssets = allAssets.filter(assetMatches).sort(compareAssets);
    renderAssets();
  }

  function renderAssets() {
    var fragment = document.createDocumentFragment();
    var renderList = state.visibleAssets;
    var folderAssets = renderList.filter(function (asset) { return asset.type === "plugin-folder"; });
    var fileAssets = renderList.filter(function (asset) { return asset.type !== "plugin-folder"; });
    var effectiveClean = state.preferences.viewMode !== "list" && state.preferences.cardStyle === "clean";
    var selectedVisible = false;
    var visuals = [];
    stopSelectedVideoPreview();
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
    elements.assetGrid.setAttribute("data-card-style", effectiveClean ? "clean" : "info");
    elements.assetGrid.classList.toggle("is-clean-card", effectiveClean);
    renderList = folderAssets.concat(fileAssets);
    if (renderList.length) { elements.assetGrid.hidden = false; }
    elements.resultCount.textContent = state.visibleAssets.length + " 项";
    renderList.forEach(function (asset, index) {
      var local = localMetaFor(asset);
      var card = document.createElement("article");
      var thumb = document.createElement("div");
      var selectMark = document.createElement("span");
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
      var folderCollage;
      var placeholder;
      var groupKey = asset.type === "plugin-folder" ? "folders" : "files";
      if (index === 0 && folderAssets.length) { fragment.appendChild(createAssetGroupHeading("文件夹", folderAssets.length, "folders")); }
      if (asset.type !== "plugin-folder" && index === folderAssets.length) { fragment.appendChild(createAssetGroupHeading("文件", fileAssets.length, "files")); }
      if (state.collapsedGroups[groupKey]) { return; }
      card.className = "asset-card";
      card.setAttribute("data-asset-id", asset.domId);
      card.setAttribute("data-asset-group", groupKey);
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", asset.name + "，双击预览，右键更多操作");
      card.draggable = asset.type !== "folder" && asset.type !== "plugin-folder";
      card.classList.toggle("is-folder", asset.type === "folder" || asset.type === "plugin-folder");
      card.classList.toggle("is-pinned", !!local.pinned);
      card.classList.toggle("is-selection-mode", state.selectionMode);
      card.classList.toggle("is-cut", !!(state.assetClipboard && state.assetClipboard.mode === "cut" && state.assetClipboard.assetKeys.indexOf(normalizeAssetKey(asset.path)) !== -1));
      card.title = asset.type === "plugin-folder" ? "双击打开插件文件夹" : asset.type === "folder" ? "双击打开；可把已选素材拖入此文件夹" : state.hostId === "PPRO" && asset.type !== "lut" ? "拖到 Premiere 素材箱、源监视器或时间线" : state.hostId === "AEFT" ? "AE 暂不支持从扩展直接拖入，请使用右键菜单" : "";
      if (state.selectedIds[asset.domId]) { card.classList.add("is-selected"); card.setAttribute("aria-selected", "true"); selectedVisible = true; }
      else { card.setAttribute("aria-selected", "false"); }
      thumb.className = "asset-thumb";
      selectMark.className = "asset-select-check";
      selectMark.setAttribute("aria-hidden", "true");
      selectMark.textContent = state.selectedIds[asset.domId] ? "✓" : "";
      thumb.appendChild(selectMark);
      sprite.className = "sprite-preview";
      progress.className = "scrub-progress";
      type.className = "asset-type"; type.textContent = asset.extension || asset.type;
      type.hidden = asset.type === "folder" || asset.type === "plugin-folder";
      placeholder = createPlaceholder(asset);
      thumb.appendChild(placeholder);
      if (asset.type === "plugin-folder") {
        placeholder.hidden = true;
        folderCollage = document.createElement("div");
        folderCollage.className = "folder-collage";
        thumb.appendChild(folderCollage);
        renderPluginFolderPreview(asset, folderCollage, renderGeneration);
      } else {
        thumb.appendChild(sprite); thumb.appendChild(progress);
      }
      thumb.appendChild(type);
      favorite.type = "button"; favorite.className = "favorite-toggle" + (local.favorite ? " is-favorite" : "");
      favorite.textContent = local.favorite ? "★" : "☆"; favorite.title = local.favorite ? "取消收藏" : "收藏";
      favorite.setAttribute("aria-label", favorite.title); favorite.draggable = false; favorite.hidden = asset.type === "folder" || asset.type === "plugin-folder"; thumb.appendChild(favorite);
      if (asset.type !== "plugin-folder" && local.label && local.label !== "none") { var label = document.createElement("span"); label.className = "color-label"; label.setAttribute("data-label", local.label); thumb.appendChild(label); }
      if (asset.type !== "plugin-folder" && local.pinned) { pinned.className = "pin-badge"; pinned.title = "已置顶"; thumb.appendChild(pinned); }
      if (asset.type !== "plugin-folder" && /_Proxy_(?:1080|720|480|360)p(?:-\d+)?\.mp4$/i.test(asset.name)) { proxy.className = "proxy-badge"; proxy.textContent = "PROXY"; thumb.appendChild(proxy); }
      if (asset.type !== "plugin-folder" && asset.offline) { offlineBadge.className = "offline-badge"; offlineBadge.textContent = "OFFLINE"; thumb.appendChild(offlineBadge); card.classList.add("is-offline"); }
      duration.className = "duration-badge"; duration.hidden = true; thumb.appendChild(duration);
      copy.className = "asset-copy";
      name.className = "asset-name"; name.textContent = asset.name; name.title = asset.name;
      details.className = "asset-details"; details.textContent = asset.type === "plugin-folder" ? String(asset.itemCount || 0) + " 项" : asset.type === "folder" ? "本地文件夹" : typeLabel(asset.type) + " · " + SeekLibrary.formatBytes(asset.size);
      copy.appendChild(name); copy.appendChild(details); card.appendChild(thumb); card.appendChild(copy); fragment.appendChild(card);
      if (asset.type !== "plugin-folder") { visuals.push({ asset: asset, thumb: thumb, generation: renderGeneration }); }
    });
    elements.assetGrid.appendChild(fragment);
    visuals.forEach(function (item, index) { requestVisual(item.asset, item.thumb, index, item.generation); });
    if (!selectedVisible && state.selectedId && !state.selectedIds[state.selectedId]) { state.selectedId = null; }
    syncSelectAllButton();
    syncPreviewDock();
    if (!state.visibleAssets.length) {
      elements.assetGrid.hidden = true;
      if (state.folderScope && state.folderScope.pluginFolderId) {
        showEmpty("文件夹为空", "把素材拖入此文件夹，或使用右键添加到文件夹。");
      } else {
        showEmpty(state.assets.length ? "没有匹配的素材" : "没有可用素材", state.assets.length ? "调整搜索、收藏或筛选条件。" : "添加一个包含视频、图片、音频或 LUT 的素材位置。");
      }
    } else {
      elements.assetGrid.hidden = false; elements.emptyState.hidden = true;
    }
  }

  function createPlaceholder(asset) {
    var placeholder = document.createElement("div");
    placeholder.className = "generic-thumb";
    placeholder.textContent = asset.type === "video" ? "VID" : asset.type === "image" ? "IMG" : asset.type === "lut" ? "LUT" : asset.type === "folder" || asset.type === "plugin-folder" ? "" : "AUD";
    if (asset.type === "folder" || asset.type === "plugin-folder") { placeholder.classList.add("folder-thumb"); }
    return placeholder;
  }

  function createAssetGroupHeading(label, count, groupKey) {
    var heading = document.createElement("button");
    var chevron = document.createElement("span");
    var text = document.createElement("strong");
    var collapsed = !!state.collapsedGroups[groupKey];
    heading.type = "button";
    heading.className = "asset-group-heading" + (collapsed ? " is-collapsed" : "");
    heading.setAttribute("data-asset-group", groupKey);
    heading.setAttribute("aria-expanded", collapsed ? "false" : "true");
    chevron.className = "asset-group-chevron";
    chevron.setAttribute("aria-hidden", "true");
    text.textContent = label + " · " + count;
    heading.appendChild(chevron); heading.appendChild(text);
    heading.setAttribute("aria-label", text.textContent);
    return heading;
  }

  function toggleAssetGroup(groupKey) {
    if (groupKey !== "folders" && groupKey !== "files") { return; }
    state.collapsedGroups[groupKey] = !state.collapsedGroups[groupKey];
    renderAssets();
  }

  function folderPreviewAssets(asset) {
    var keys = pluginFolderAssetKeys(asset && asset.pluginFolderId);
    return state.assets.filter(function (item) { return keys.indexOf(normalizeAssetKey(item.path)) !== -1 && !item.offline; });
  }

  function setFolderTileImage(tile, filePath, asset, generation) {
    var image = document.createElement("img");
    if (generation !== renderGeneration) { return; }
    image.alt = asset.name; image.draggable = false;
    image.onload = function () { if (generation === renderGeneration && tile.parentNode) { tile.classList.add("has-image"); } };
    image.onerror = function () { image.remove(); };
    image.src = SeekLibrary.fileUrl(filePath);
    tile.appendChild(image);
  }

  function renderPluginFolderPreview(asset, container, generation) {
    var candidates = folderPreviewAssets(asset).slice(0, 4);
    var directImages = ["jpg", "jpeg", "jpe", "png", "webp", "gif", "bmp", "svg"];
    if (!candidates.length) {
      container.classList.add("is-empty");
      container.innerHTML = '<span class="folder-empty-icon" aria-hidden="true"><span class="icon-folder-large"></span></span>';
      return;
    }
    container.setAttribute("data-count", String(candidates.length));
    candidates.forEach(function (item) {
      var tile = document.createElement("span");
      var sourcePromise;
      tile.className = "folder-collage-tile";
      tile.textContent = String(item.extension || item.type || "").toUpperCase();
      container.appendChild(tile);
      if (directImages.indexOf(item.extension) !== -1) {
        setFolderTileImage(tile, item.path, item, generation);
      } else if (mediaTools && item.type === "video") {
        sourcePromise = mediaTools.posterFor(item.path);
        sourcePromise.then(function (filePath) { setFolderTileImage(tile, filePath, item, generation); }).catch(function () {});
      } else if (mediaTools && item.type === "image") {
        sourcePromise = mediaTools.previewStillFor(item.path);
        sourcePromise.then(function (filePath) { setFolderTileImage(tile, filePath, item, generation); }).catch(function () {});
      } else if (mediaTools && item.type === "audio") {
        sourcePromise = mediaTools.waveformFor(item.path);
        sourcePromise.then(function (filePath) { setFolderTileImage(tile, filePath, item, generation); }).catch(function () {});
      }
    });
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
        syncPreviewDock();
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
      if (state.selectedIds[asset && asset.domId]) { syncPreviewDock(); }
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

  function stopSelectedVideoPreview() {
    var media = selectionPreview.media;
    clearTimeout(selectionPreview.frameTimer);
    selectionPreview.frameTimer = null;
    selectionPreview.token += 1;
    selectionPreview.media = null;
    selectionPreview.assetId = null;
    selectionPreview.fallbackRequested = false;
    if (!media) { return; }
    try { media.pause(); media.removeAttribute("src"); media.load(); } catch (error) {}
    if (media.parentNode) { media.parentNode.classList.remove("is-selection-preview"); media.parentNode.removeChild(media); }
  }

  function selectedPreviewProfile(asset) {
    return asset && asset.mediaMetadata && Number(asset.mediaMetadata.height) >= 1800 ? "1080" : "720";
  }

  function armSelectedVideoFrameWatchdog(asset, media, token, proxySource) {
    clearTimeout(selectionPreview.frameTimer);
    selectionPreview.frameTimer = setTimeout(function () {
      if (token !== selectionPreview.token || media !== selectionPreview.media || media.getAttribute("data-video-frame-ready") === "true") { return; }
      if (proxySource) { stopSelectedVideoPreview(); }
      else { fallbackSelectedVideoPreview(asset, media, token); }
    }, proxySource ? 3200 : 1800);
  }

  function fallbackSelectedVideoPreview(asset, media, token) {
    var profile;
    if (token !== selectionPreview.token || media !== selectionPreview.media || selectionPreview.fallbackRequested) { return; }
    selectionPreview.fallbackRequested = true;
    if (!mediaTools) {
      stopSelectedVideoPreview();
      return;
    }
    profile = selectedPreviewProfile(asset);
    mediaTools.previewProxyFor(asset.path, profile).then(function (filePath) {
      if (token !== selectionPreview.token || media !== selectionPreview.media) { return; }
      media.removeAttribute("data-preview-started");
      media.removeAttribute("data-video-frame-ready");
      media.setAttribute("data-preview-source", "proxy");
      media.src = SeekLibrary.fileUrl(filePath);
      media.load();
      armSelectedVideoFrameWatchdog(asset, media, token, true);
      safePlay(media);
    }).catch(function () {
      if (token === selectionPreview.token && media === selectionPreview.media) {
        /* Restore the poster instead of leaving a failed black video layer. */
        stopSelectedVideoPreview();
      }
    });
  }

  function playSelectedVideoPreview(asset) {
    var card;
    var thumb;
    var media;
    var poster;
    var token;
    stopAudioHover();
    stopSelectedVideoPreview();
    if (!asset || asset.type !== "video" || asset.offline || !asset.path) { return; }
    card = findCard(asset.domId);
    thumb = card && card.querySelector(".asset-thumb");
    if (!thumb) { return; }
    media = document.createElement("video");
    media.className = "selection-preview-video";
    media.controls = false;
    media.preload = "auto";
    media.playsInline = true;
    media.muted = false;
    media.volume = .72;
    media.draggable = false;
    media.setAttribute("aria-hidden", "true");
    poster = thumb.querySelector("img.poster-image");
    if (poster && poster.src) { media.poster = poster.src; }
    thumb.appendChild(media);
    thumb.classList.add("is-selection-preview");
    token = selectionPreview.token;
    selectionPreview.media = media;
    selectionPreview.assetId = asset.domId;
    media.addEventListener("loadedmetadata", function () {
      if (token !== selectionPreview.token || media !== selectionPreview.media) { return; }
      try { media.currentTime = 0; } catch (error) {}
    });
    media.addEventListener("loadeddata", function () {
      if (token !== selectionPreview.token || media !== selectionPreview.media || !media.videoWidth || !media.videoHeight) { return; }
      media.setAttribute("data-video-frame-ready", "true");
      clearTimeout(selectionPreview.frameTimer);
      selectionPreview.frameTimer = null;
    });
    media.addEventListener("play", function () {
      if (token === selectionPreview.token && media === selectionPreview.media) { media.setAttribute("data-preview-started", "true"); }
    });
    media.addEventListener("canplay", function () {
      if (token !== selectionPreview.token || media !== selectionPreview.media || media.getAttribute("data-preview-started") === "true") { return; }
      safePlay(media);
    });
    media.addEventListener("error", function () {
      if (token !== selectionPreview.token || media !== selectionPreview.media) { return; }
      if (media.getAttribute("data-preview-source") === "proxy") { stopSelectedVideoPreview(); }
      else { fallbackSelectedVideoPreview(asset, media, token); }
    });
    media.addEventListener("ended", function () {
      if (token === selectionPreview.token && media === selectionPreview.media) { media.removeAttribute("data-preview-started"); }
    });
    media.src = SeekLibrary.fileUrl(asset.path);
    media.load();
    armSelectedVideoFrameWatchdog(asset, media, token, false);
    safePlay(media);
  }

  function stopAudioHover() {
    clearTimeout(audioHover.timer); audioHover.timer = null; audioHover.assetId = null;
    if (audioHover.media) { try { audioHover.media.pause(); audioHover.media.removeAttribute("src"); audioHover.media.load(); } catch (error) {} audioHover.media = null; }
  }

  function selectedAssets() {
    return state.assets.concat(pluginFolderDescriptors()).filter(function (asset) { return !!state.selectedIds[asset.domId]; });
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
    if (selectionPreview.assetId && (selectionPreview.assetId !== id || settings.toggle || settings.range || state.selectionMode)) { stopSelectedVideoPreview(); }
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
      var check = card.querySelector(".asset-select-check");
      card.classList.toggle("is-selected", selected); card.setAttribute("aria-selected", selected ? "true" : "false");
      if (check) { check.textContent = selected ? "✓" : ""; }
    });
    syncSelectAllButton();
    syncPreviewDock();
  }

  function syncSelectAllButton() {
    if (!elements.selectAllButton) { return; }
    elements.selectAllButton.setAttribute("aria-pressed", state.selectionMode ? "true" : "false");
    elements.selectAllButton.setAttribute("aria-checked", state.selectionMode ? "true" : "false");
    elements.selectAllButton.setAttribute("data-hint", state.selectionMode ? "退出勾选模式" : "进入勾选模式");
    elements.selectAllButton.classList.toggle("is-active", state.selectionMode);
    elements.selectAllButton.title = state.selectionMode ? "退出勾选模式" : "进入勾选模式";
    var chosen = selectedAssets();
    var usableChosen = chosen.filter(function (asset) { return asset.type !== "folder" && asset.type !== "plugin-folder"; });
    if (elements.resultCount) { elements.resultCount.textContent = chosen.length ? chosen.length + " 项已选" : state.visibleAssets.length + " 项"; }
    if (elements.packageProjectButton) { elements.packageProjectButton.hidden = state.hostId !== "PPRO" || !usableChosen.length; }
    if (elements.clearSelectionButton) { elements.clearSelectionButton.hidden = !chosen.length; }
  }

  function toggleSelectAllAssets() {
    state.selectionMode = !state.selectionMode;
    if (!state.selectionMode) {
      state.selectedIds = {};
      state.selectedId = null;
      state.selectionAnchorId = null;
    }
    syncSelectAllButton();
    renderAssets();
  }

  function clearSelectedAssets() {
    state.selectedIds = {};
    state.selectedId = null;
    state.selectionAnchorId = null;
    syncSelectAllButton();
    renderAssets();
  }

  function findCard(id) {
    var cards = elements.assetGrid.querySelectorAll(".asset-card");
    var i;
    for (i = 0; i < cards.length; i += 1) { if (cards[i].getAttribute("data-asset-id") === id) { return cards[i]; } }
    return null;
  }

  function typeLabel(type) { return type === "video" ? "视频" : type === "image" ? "图片" : type === "lut" ? "LUT" : type === "folder" ? "本地文件夹" : type === "plugin-folder" ? "插件文件夹" : "音频"; }

  function startAssetDrag(event) {
    var card = closestCard(event.target);
    var asset = card && assetForId(card.getAttribute("data-asset-id"));
    var assets;
    var paths;
    var adobePaths;
    stopAudioHover();
    if (event.target.closest && event.target.closest("button")) { event.preventDefault(); return; }
    if (!asset || asset.type === "folder" || asset.type === "plugin-folder" || asset.offline || !nodeAvailable) { event.preventDefault(); if (asset && asset.offline) { showNotice("素材位置离线，重新连接 SMB 后再拖动。", true, 4000); } return; }
    if (!state.selectedIds[asset.domId]) { selectAsset(asset.domId, { only: true }); }
    if (asset.type === "lut" && state.hostId === "PPRO" && csInterface) { applyLutAssetToHost(asset); }
    if (state.hostId === "PPRO" && localMetaFor(asset).label && localMetaFor(asset).label !== "none") {
      runHostActionForPath(asset.path, false, asset.name, "current", { colorLabel: localMetaFor(asset).label }).catch(function () {});
    }
    assets = selectedAssets().filter(function (item) { return item.type !== "folder"; });
    paths = assets.map(function (item) { return item.path; });
    adobePaths = assets.filter(function (item) { return item.type !== "lut"; }).map(function (item) { return item.path; });
    if (!paths.length) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("application/x-lk-file-bridge-assets", JSON.stringify(assets.map(function (item) { return item.domId; })));
    if (asset.type === "lut") { event.dataTransfer.setData("application/x-lk-file-bridge-lut", asset.path); event.dataTransfer.setData("text/plain", asset.path); }
    if (state.hostId === "PPRO" && adobePaths.length) { populateAdobeDragData(event, adobePaths); }
    else { event.dataTransfer.setData("text/plain", paths.join("\n")); }
    card.classList.add("is-dragging");
    elements.statusText.textContent = state.hostId === "PPRO" ? "拖到 Premiere 或插件文件夹" : "拖到插件中的文件夹";
  }

  function populateAdobeDragData(event, input) {
    var paths = Array.isArray(input) ? input : [input];
    FnOSInteractionTools.writeAdobeDragData(event.dataTransfer, paths, SeekLibrary.fileUrl);
  }

  function applyLutAssetToHost(asset) {
    if (!asset || !csInterface || state.hostId !== "PPRO") { return; }
    csInterface.evalScript("SeekBridge.applyLutToActiveVideo(" + JSON.stringify(JSON.stringify({ path: asset.path })) + ")", function (raw) {
      var result;
      try { result = JSON.parse(raw); } catch (error) { result = { ok: false, message: raw || "Premiere 没有返回结果。" }; }
      if (result.ok) { showNotice("LUT 已应用到当前时间线视频。", false, 4000); }
      else { showNotice(result.message || "当前时间线未选中视频。", true, 5000); }
    });
  }

  function handleLibraryDragOver(event) {
    var card = closestCard(event.target);
    var folder = card && assetForId(card.getAttribute("data-asset-id"));
    var internal = event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], "application/x-lk-file-bridge-assets") !== -1;
    var external = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length;
    if ((internal && folder && (folder.type === "folder" || folder.type === "plugin-folder")) || (!internal && external)) {
      event.preventDefault(); event.dataTransfer.dropEffect = internal ? "move" : "copy";
      if (folder && (folder.type === "folder" || folder.type === "plugin-folder")) { card.classList.add("is-drop-target"); }
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
    if (rawIds && folder && (folder.type === "folder" || folder.type === "plugin-folder")) {
      try { ids = JSON.parse(rawIds); } catch (error) { ids = []; }
      assets = ids.map(assetForId).filter(function (asset) { return asset && asset.type !== "folder" && asset.type !== "plugin-folder"; });
      if (assets.length) { moveAssetsToFolder(assets, { getAttribute: function (name) { if (name === "data-plugin-folder-id") { return folder.type === "plugin-folder" ? folder.pluginFolderId : null; } return name === "data-root-id" ? folder.rootId : folder.path; } }); }
      return;
    }
    paths = sourcePathsFromDrop(event.dataTransfer);
    destination = folder && folder.type === "folder" ? { rootId: folder.rootId, path: folder.path } : folder && folder.type === "plugin-folder" ? Object.assign(currentDestination() || {}, { pluginFolderId: folder.pluginFolderId }) : currentDestination();
    if (!paths.length || !destination || !destination.rootId || !destination.path || !assetOps) { showNotice("请先勾选目标素材位置，再拖入本地素材。", true, 4500); return; }
    showNotice("正在复制 " + paths.length + " 项到当前素材路径…", false, 0);
    assetOps.copyExternalFiles({ roots: state.roots, rootId: destination.rootId, destinationPath: destination.path, sourcePaths: paths, onProgress: showOperationProgress }).then(function (copied) {
      var copiedPaths = (copied || []).map(function (item) { return item.path; });
      if (destination.pluginFolderId) { assignPathsToPluginFolder(destination.pluginFolderId, copiedPaths, ""); }
      showNotice("外部素材已复制到当前路径。", false, 3800); scanAssets(copiedPaths);
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
    var clipboardFiles;
    var pasteTarget;
    if (!card) { return; }
    stopAudioHover();
    event.preventDefault(); event.stopPropagation();
    state.contextId = card.getAttribute("data-asset-id");
    if (!state.selectedIds[state.contextId]) { selectAsset(state.contextId, { only: true }); }
    asset = assetForId(state.contextId); assets = selectedAssets(); single = assets.length === 1;
    clipboardFiles = clipboardAssets(assets);
    pasteTarget = pasteTargetForAsset(asset);
    favoriteButton = elements.contextMenu.querySelector('[data-command="favorite"]');
    favoriteButton.textContent = assets.every(function (item) { return localMetaFor(item).favorite; }) ? "取消收藏" : "收藏";
    elements.contextMenu.querySelector('[data-command="pin"]').textContent = assets.every(function (item) { return localMetaFor(item).pinned; }) ? "取消置顶" : "置顶";
    var transcodeMenu = elements.contextMenu.querySelector(".transcode-menu");
    if (transcodeMenu) { transcodeMenu.hidden = !assets.length || assets.some(function (item) { return item.type !== "video"; }); }
    elements.contextMenu.querySelector('[data-command="play"]').disabled = !single;
    elements.contextMenu.querySelector('[data-command="info"]').disabled = !single || asset.type === "folder" || asset.type === "plugin-folder";
    elements.contextMenu.querySelector('[data-command="import"]').hidden = state.hostId === "BROWSER" || assets.some(function (item) { return item.type === "lut" || item.type === "folder" || item.type === "plugin-folder"; });
    elements.insertSubmenuRow.hidden = state.hostId !== "PPRO" || assets.some(function (item) { return item.type === "lut" || item.type === "folder" || item.type === "plugin-folder"; });
    elements.contextAePlaceButton.hidden = state.hostId !== "AEFT" || assets.some(function (item) { return item.type === "lut" || item.type === "folder" || item.type === "plugin-folder"; });
    elements.contextMenu.querySelector('[data-command="reveal"]').disabled = !single;
    elements.contextMenu.querySelector('[data-command="rename"]').disabled = !single;
    elements.contextMenu.querySelector('[data-command="duplicate"]').disabled = assets.some(function (item) { return item.type === "folder" || item.type === "plugin-folder"; });
    if (elements.copyAssetsButton) { elements.copyAssetsButton.disabled = !clipboardFiles.length || clipboardFiles.length !== assets.length; }
    if (elements.cutAssetsButton) { elements.cutAssetsButton.disabled = !clipboardFiles.length || clipboardFiles.length !== assets.length; }
    if (elements.pasteAssetsButton) {
      elements.pasteAssetsButton.disabled = !state.assetClipboard || !state.assetClipboard.assetKeys.length || state.assetClipboard.sourceFolderId === pasteTarget;
      elements.pasteAssetsButton.setAttribute("data-target-plugin-folder-id", pasteTarget);
    }
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
      button.type = "button"; button.className = "label-choice" + (current === label ? " is-selected" : ""); button.setAttribute("data-label", label); button.title = label === "none" ? "移除标签" : (LABEL_NAMES[label] || "颜色");
      button.style.backgroundColor = LABEL_COLOR_VALUES[label] || "#3d4245";
      elements.contextLabelChoices.appendChild(button);
    });
  }

  function closeContextMenu() { elements.contextMenu.hidden = true; Array.prototype.forEach.call(elements.contextMenu.querySelectorAll(".context-submenu.is-floating"), function (submenu) { submenu.classList.remove("is-floating"); submenu.style.left = ""; submenu.style.top = ""; }); hideMetadataHover(); state.contextId = null; }

  function handleContextCommand(event) {
    var button = event.target.closest("button[data-command]");
    var asset = assetForId(state.contextId);
    var command;
    var assets = selectedAssets();
    if (!button || !asset) { return; }
    command = button.getAttribute("data-command");
    if (command === "play") { if (asset.type === "folder" || asset.type === "plugin-folder") { enterFolderScope(asset); } else { openViewer(asset); } }
    else if (command === "info") { showMetadataHover(asset, button); return; }
    else if (command === "import") { runHostActionForAssets(assets, false, "current").catch(function () {}); }
    else if (command === "insert") { runHostActionForAssets(assets, true, button.getAttribute("data-position") || "current").catch(function () {}); }
    else if (command === "favorite") { setFavoriteForAssets(assets); }
    else if (command === "pin") { setPinnedForAssets(assets); }
    else if (command === "transcode") { transcodeAssets(assets, button.getAttribute("data-profile")); }
    else if (command === "duplicate") { duplicateAssets(assets); }
    else if (command === "copy-assets") { copyAssetsToClipboard(assets, "copy"); }
    else if (command === "cut-assets") { copyAssetsToClipboard(assets, "cut"); }
    else if (command === "paste-assets") { pasteAssetClipboard(button.getAttribute("data-target-plugin-folder-id") || pasteTargetForAsset(asset)); }
    else if (command === "move-folder") { moveAssetsToFolder(assets, button); }
    else if (command === "copy-label") { state.copiedLabel = localMetaFor(asset).label; showNotice("标签已复制。", false, 2200); }
    else if (command === "paste-label") { assets.forEach(function (item) { setColorLabel(item, state.copiedLabel, true); }); renderAssets(); }
    else if (command === "clear-label") { assets.forEach(function (item) { setColorLabel(item, "none", true); }); if (state.filters.label !== "all") { applyFilters(); } else { renderAssets(); } }
    else if (command === "new-folder") { closeContextMenu(); openCreatePluginFolderDialog(); return; }
    else if (command === "reveal") { revealAsset(asset); }
    else if (command === "rename") { openRenameDialog(asset); }
    else if (command === "trash") { openTrashDialog(assets); }
    closeContextMenu();
  }

  function syncClipboardActions() {
    var hasClipboard = !!(state.assetClipboard && state.assetClipboard.assetKeys && state.assetClipboard.assetKeys.length);
    if (elements.pasteAssetsFromResultsButton) {
      elements.pasteAssetsFromResultsButton.disabled = !hasClipboard || state.assetClipboard.sourceFolderId === currentPluginFolderScopeId();
    }
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
    var folders = state.pluginFolders;
    var trigger = elements.folderSubmenuRow.children[0];
    elements.folderSubmenu.innerHTML = "";
    trigger.disabled = false;
    trigger.setAttribute("aria-disabled", (!folders.length || assets.some(function (asset) { return asset.type === "folder" || asset.type === "plugin-folder"; })) ? "true" : "false");
    trigger.classList.toggle("is-disabled", !folders.length || assets.some(function (asset) { return asset.type === "folder" || asset.type === "plugin-folder"; }));
    folders.forEach(function (folder) {
      var button = document.createElement("button");
      button.type = "button"; button.setAttribute("data-command", "move-folder"); button.setAttribute("data-plugin-folder-id", folder.id);
      button.textContent = folder.name;
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
    var pluginFolderId = button.getAttribute("data-plugin-folder-id");
    if (!files.length) { return; }
    if (pluginFolderId) {
      var pluginFolder = pluginFolderById(pluginFolderId);
      if (!pluginFolder) { showNotice("插件文件夹不存在。", true, 4000); return; }
      assignPathsToPluginFolder(pluginFolder.id, files.map(function (asset) { return asset.path; }));
      state.selectedIds = {}; state.selectedId = null;
      showNotice("素材已添加到插件文件夹。", false, 3500);
      applyFilters();
      return;
    }
    if (!assetOps) { return; }
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
    card.classList.toggle("is-pinned", !!local.pinned);
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
    stopSelectedVideoPreview();
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
        updateViewerSubtitle(); updateViewerTimeline(); syncPreviewDock();
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
    return loadLutSampleImage().then(function (image) {
      var scale;
      var sourceWidth;
      var sourceHeight;
      var sourceX;
      var sourceY;
      if (!image) {
        drawDefaultLutSample(context, width, height);
      } else {
        scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
        sourceWidth = width / scale;
        sourceHeight = height / scale;
        sourceX = Math.max(0, (image.naturalWidth - sourceWidth) / 2);
        sourceY = Math.max(0, (image.naturalHeight - sourceHeight) / 2);
        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
      }
      return { canvas: canvas, data: context.getImageData(0, 0, width, height) };
    });
  }

  function loadLutSampleImage() {
    if (lutSampleImagePromise) { return lutSampleImagePromise; }
    lutSampleImagePromise = new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { resolve(null); };
      image.src = LUT_SAMPLE_SOURCE;
    });
    return lutSampleImagePromise;
  }

  function renderLutThumbnail(asset, thumb, generation) {
    var promise = lutTools ? lutTools.parseFile(asset.path) : Promise.resolve(null);
    return defaultLutSample(256, 144).then(function (sample) {
      var context = sample.canvas.getContext("2d");
      return promise.then(function (lut) {
        var processed = lut ? FnOSLutTools.applyToImageData(sample.data, lut, { opacity: 1 }) : sample.data;
        context.putImageData(processed, 0, 0);
        if (generation === renderGeneration && document.documentElement.contains(thumb)) { installImage(thumb, sample.canvas.toDataURL("image/jpeg", .86), asset.name, "poster-image", asset); }
      }).catch(function () {
        context.putImageData(sample.data, 0, 0);
        if (generation === renderGeneration && document.documentElement.contains(thumb)) { installImage(thumb, sample.canvas.toDataURL("image/jpeg", .82), asset.name, "poster-image", asset); }
      });
    });
  }

  function openLutViewer(asset) {
    var context;
    var samplePromise;
    var token;
    closeViewer();
    closeLutViewer();
    token = ++lutState.loadToken;
    lutState.asset = asset; lutState.lut = null;
    lutState.compareMode = "toggle";
    lutState.toggleLut = true;
    elements.lutViewerTitle.textContent = asset.name;
    elements.lutViewerSubtitle.textContent = "正在解析 .CUBE · 参考风景灰片";
    elements.lutSplitRange.value = "50"; elements.lutOpacityRange.value = "100";
    elements.installLutButton.disabled = state.hostId !== "PPRO";
    elements.lutApplyStatus.textContent = state.hostId === "PPRO" ? "正在检查时间线选择…" : "仅支持 Premiere Pro";
    elements.lutViewer.hidden = false;
    context = elements.lutCanvas.getContext("2d");
    context.fillStyle = "#4b514d"; context.fillRect(0, 0, elements.lutCanvas.width, elements.lutCanvas.height);
    samplePromise = defaultLutSample(elements.lutCanvas.width, elements.lutCanvas.height).then(function (sample) {
      if (token !== lutState.loadToken || lutState.asset !== asset) { return null; }
      context.putImageData(sample.data, 0, 0);
      lutState.original = sample.data; lutState.processed = sample.data;
      return sample;
    });
    if (!lutTools || !nodeAvailable) {
      samplePromise.then(function () {
        if (token !== lutState.loadToken || lutState.asset !== asset) { return; }
        elements.lutViewerSubtitle.textContent = "界面预览 · 实拍风景灰片";
        elements.lutApplyStatus.textContent = "浏览器预览模式";
      });
      return;
    }
    refreshLutSelectionState();
    Promise.all([samplePromise, lutTools.parseFile(asset.path)]).then(function (results) {
      var lut = results[1];
      if (!results[0] || token !== lutState.loadToken || lutState.asset !== asset) { return; }
      lutState.lut = lut;
      lutState.processed = FnOSLutTools.applyToImageData(lutState.original, lut, { opacity: 1 });
      elements.lutViewerSubtitle.textContent = (lut.title ? lut.title + " · " : "") + lut.size + (lut.type === "3d" ? "³ 3D LUT" : " 点 1D LUT") + " · sRGB 8-bit 近似预览";
      elements.installLutButton.disabled = state.hostId !== "PPRO";
      elements.lutApplyStatus.textContent = state.hostId === "PPRO" ? "选择时间线视频后应用" : "仅支持 Premiere Pro";
      renderCurrentLutPreview();
    }).catch(function (error) { if (token === lutState.loadToken && lutState.asset === asset) { elements.lutViewerSubtitle.textContent = "无法解析 LUT：" + friendlyError(error); } });
  }

  function refreshLutSelectionState() {
    if (state.hostId !== "PPRO" || !csInterface) { return; }
    csInterface.evalScript("SeekBridge.getSelectedVideoCount()", function (raw) {
      var result;
      try { result = JSON.parse(raw); } catch (error) { result = { ok: false, count: 0 }; }
      if (!lutState.asset) { return; }
      elements.installLutButton.disabled = !result.ok || Number(result.count) < 1;
      elements.lutApplyStatus.textContent = result.ok && Number(result.count) ? "已选中 " + result.count + " 个视频" : "当前时间线未选中";
    });
  }

  function renderCurrentLutPreview() {
    if (!lutState.original || !lutState.processed) { return; }
    if (lutState.compareMode === "toggle") {
      elements.lutCanvas.getContext("2d").putImageData(lutState.toggleLut ? lutState.processed : lutState.original, 0, 0);
    } else {
      FnOSLutTools.renderSplit(elements.lutCanvas.getContext("2d"), lutState.original, lutState.processed, Number(elements.lutSplitRange.value) / 100, Number(elements.lutOpacityRange.value) / 100);
    }
    elements.lutDivider.style.left = Math.max(0, Math.min(100, Number(elements.lutSplitRange.value) || 50)) + "%";
    elements.lutDivider.hidden = lutState.compareMode === "toggle";
  }

  function setLutCompareMode(mode) {
    if (mode === "toggle" && lutState.compareMode === "toggle") { lutState.toggleLut = !lutState.toggleLut; }
    lutState.compareMode = mode;
    [elements.lutCompareToggle, elements.lutSplitMode, elements.lutSliderMode].forEach(function (button) { button.classList.toggle("is-active", button.id === (mode === "toggle" ? "lutCompareToggle" : mode === "split" ? "lutSplitMode" : "lutSliderMode")); });
    renderCurrentLutPreview();
  }

  function updateLutDividerFromPointer(event) {
    var rect = elements.lutCanvas.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    elements.lutSplitRange.value = String(Math.round(ratio * 100));
    scheduleLutRender();
  }

  function beginLutDividerDrag(event) {
    if (lutState.compareMode === "toggle") { return; }
    lutState.dividerDragging = true;
    elements.lutCanvas.setPointerCapture(event.pointerId);
    updateLutDividerFromPointer(event);
    function move(moveEvent) { if (lutState.dividerDragging) { updateLutDividerFromPointer(moveEvent); } }
    function end() { lutState.dividerDragging = false; elements.lutCanvas.removeEventListener("pointermove", move); elements.lutCanvas.removeEventListener("pointerup", end); }
    elements.lutCanvas.addEventListener("pointermove", move);
    elements.lutCanvas.addEventListener("pointerup", end);
  }

  function scheduleLutRender() {
    if (lutState.renderFrame) { return; }
    lutState.renderFrame = requestAnimationFrame(function () { lutState.renderFrame = 0; renderCurrentLutPreview(); });
  }

  function closeLutViewer() {
    lutState.loadToken += 1;
    if (lutState.renderFrame) { cancelAnimationFrame(lutState.renderFrame); lutState.renderFrame = 0; }
    elements.lutViewer.hidden = true;
    lutState.asset = null; lutState.lut = null; lutState.original = null; lutState.processed = null;
  }

  function installCurrentLut() {
    var asset = lutState.asset;
    if (!asset || state.hostId !== "PPRO" || !csInterface) { return; }
    elements.installLutButton.disabled = true;
    elements.lutApplyStatus.textContent = "正在应用 LUT…";
    csInterface.evalScript("SeekBridge.applyLutToActiveVideo(" + JSON.stringify(JSON.stringify({ path: asset.path })) + ")", function (raw) {
      var result;
      try { result = JSON.parse(raw); } catch (error) { result = { ok: false, message: raw || "Premiere 没有返回结果。" }; }
      elements.installLutButton.disabled = false;
      elements.lutApplyStatus.textContent = result.ok ? "已应用到当前选中视频" : (result.message || "当前时间线未选中");
      if (result.ok) { showNotice("LUT 已应用到当前时间线视频。", false, 4500); }
      else { showNotice(result.message || "当前时间线未选中视频。", true, 5500); }
    });
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
    var pluginFolder = asset.type === "plugin-folder";
    state.dialogAction = { type: pluginFolder ? "rename-plugin-folder" : asset.type === "folder" ? "rename-folder" : "rename", assetId: asset.domId };
    elements.dialogTitle.textContent = pluginFolder ? "重命名插件文件夹" : asset.type === "folder" ? "重命名文件夹" : "重命名源文件";
    elements.dialogMessage.textContent = pluginFolder ? "只修改插件内的归类名称，不会改动本地文件。" : asset.type === "folder" ? "这会修改当前素材位置中的真实文件夹名称。" : "这会修改当前素材位置上的真实文件名；若素材已导入 Adobe 工程，工程可能显示离线。不可在这里更改扩展名。";
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

  function openCreatePluginFolderDialog() {
    state.dialogAction = { type: "create-plugin-folder" };
    elements.dialogTitle.textContent = "新建插件文件夹";
    elements.dialogMessage.textContent = "插件文件夹只管理素材归类，不会移动或修改本地文件。";
    elements.renameField.hidden = false; elements.renameInput.value = "新建文件夹";
    elements.dialogConfirmButton.textContent = "创建"; elements.dialogConfirmButton.className = "button button-primary";
    elements.fileActionDialog.hidden = false; elements.renameInput.focus(); elements.renameInput.select();
  }

  function openTrashDialog(input) {
    var assets = Array.isArray(input) ? input : [input];
    assets = assets.filter(Boolean);
    if (!assets.length) { return; }
    if (assets.length === 1 && assets[0].type === "plugin-folder") {
      state.dialogAction = { type: "delete-plugin-folder", pluginFolderId: assets[0].pluginFolderId };
      elements.dialogTitle.textContent = "删除插件文件夹？";
      elements.dialogMessage.textContent = "只删除插件内的归类，不会删除任何本地文件。";
    } else {
      state.dialogAction = { type: "trash", assetIds: assets.map(function (asset) { return asset.domId; }) };
      elements.dialogTitle.textContent = assets.length > 1 ? "删除这 " + assets.length + " 项？" : "删除“" + assets[0].name + "”？";
      elements.dialogMessage.textContent = "删除该文件会删除本地文件。系统会先尝试移入 macOS 废纸篓；若 SMB 共享不支持可恢复删除，操作会失败并保留原文件，不会执行永久删除。已导入 Adobe 的引用可能离线。";
    }
    elements.renameField.hidden = true; elements.dialogConfirmButton.textContent = "移到废纸篓"; elements.dialogConfirmButton.className = "button button-danger";
    elements.fileActionDialog.hidden = false;
  }

  function closeDialog() { elements.fileActionDialog.hidden = true; state.dialogAction = null; }

  function confirmDialogAction() {
    var action = state.dialogAction;
    var asset = action && assetForId(action.assetId);
    elements.dialogConfirmButton.disabled = true;
    if (action && action.type === "create-plugin-folder") {
      var folderName = String(elements.renameInput.value || "").trim();
      if (!folderName || folderName === "." || folderName === "..") { elements.dialogConfirmButton.disabled = false; showNotice("请输入有效的文件夹名称。", true, 4000); return; }
      state.pluginFolders.push({ id: "pf-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7), name: folderName, parentId: state.folderScope && state.folderScope.pluginFolderId ? state.folderScope.pluginFolderId : "", assetKeys: [] });
      var createdPluginFolder = state.pluginFolders[state.pluginFolders.length - 1];
      persistPluginFolders(); rebuildAssetMap(); closeDialog(); elements.dialogConfirmButton.disabled = false; state.selectedIds = {}; state.selectedId = "plugin-folder:" + createdPluginFolder.id; state.selectedIds[state.selectedId] = true; showNotice("插件文件夹已创建。", false, 3500); applyFilters(); setTimeout(function () { var card = findCard(state.selectedId); if (card) { card.scrollIntoView({ block: "nearest", inline: "nearest" }); } }, 0); return;
    }
    if (action && action.type === "delete-plugin-folder") {
      var removeFolderIds = {};
      var deletedFolder = pluginFolderById(action.pluginFolderId);
      var deletedParentId = pluginFolderParentId(deletedFolder);
      var currentPluginScopeId = state.folderScope && state.folderScope.pluginFolderId ? state.folderScope.pluginFolderId : "";
      (function collectFolderIds(folderId) {
        removeFolderIds[folderId] = true;
        pluginFolderChildren(folderId).forEach(function (child) { if (!removeFolderIds[child.id]) { collectFolderIds(child.id); } });
      }(action.pluginFolderId));
      state.pluginFolders = state.pluginFolders.filter(function (folder) { return !removeFolderIds[folder.id]; });
      persistPluginFolders(); rebuildAssetMap(); closeDialog(); elements.dialogConfirmButton.disabled = false;
      if (currentPluginScopeId && removeFolderIds[currentPluginScopeId]) {
        state.folderScope = deletedParentId && !removeFolderIds[deletedParentId] ? { pluginFolderId: deletedParentId } : null;
      }
      state.selectedIds = {}; state.selectedId = null; state.selectionAnchorId = null;
      renderLocations(); renderFolderScopeBar(); showNotice("插件文件夹已删除。", false, 3500); applyFilters(); return;
    }
    if (action && action.type === "create-folder") {
      assetOps.createFolder({ roots: state.roots, rootId: action.destination.rootId, parentPath: action.destination.path, name: elements.renameInput.value, onProgress: showOperationProgress }).then(function (created) {
        closeDialog(); elements.dialogConfirmButton.disabled = false; showNotice("文件夹已创建。", false, 3500); scanAssets([created.path]);
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
    if (action.type === "rename-plugin-folder") {
      var pluginFolder = pluginFolderById(asset.pluginFolderId);
      if (!pluginFolder) { elements.dialogConfirmButton.disabled = false; closeDialog(); return; }
      pluginFolder.name = String(elements.renameInput.value || "").trim() || pluginFolder.name;
      persistPluginFolders(); rebuildAssetMap(); closeDialog(); elements.dialogConfirmButton.disabled = false; renderFolderScopeBar(); showNotice("插件文件夹已重命名。", false, 3500); applyFilters();
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
      forgetAssetReferences(assets);
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
      return promise.then(function () { return runHostActionForPath(asset.path, placeAtCurrentTime, asset.name, position, { colorLabel: localMetaFor(asset).label }).then(function () { completed += 1; }); });
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
    payload = JSON.stringify({ path: filePath, position: position || "current", directImport: !!(options && options.directImport), colorLabel: options && options.colorLabel || "none" }); script = "SeekBridge." + method + "(" + JSON.stringify(payload) + ")";
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
    elements.sortDirectionButton.innerHTML = '<span class="ui-icon" data-icon="arrow-up-down" aria-hidden="true"></span><span>' + (asc ? "升序" : "降序") + '</span>';
    elements.sortDirectionButton.title = asc ? "升序" : "降序";
  }
  function syncSortFieldLabel() {
    var labels = { modified: "时间", name: "名称", size: "大小", type: "类型", duration: "时长" };
    var label = document.querySelector(".sort-current-label");
    if (label) { label.textContent = labels[state.preferences.sortBy] || "时间"; }
  }
  function syncGridZoom() {
    var size = Math.max(150, Math.min(260, Number(state.preferences.zoom) || 190));
    var available = elements.assetGrid && elements.assetGrid.clientWidth ? Math.max(150, elements.assetGrid.clientWidth - 4) : size;
    var effectiveSize = Math.min(size, available);
    var ratio = (size - 150) / 110;
    elements.assetGrid.classList.remove("grid-small", "grid-medium", "grid-large");
    elements.assetGrid.style.setProperty("--card-min", effectiveSize + "px");
    elements.assetGrid.style.setProperty("--badge-font", (6 + ratio * 2).toFixed(2) + "px");
    elements.assetGrid.style.setProperty("--badge-line", (9 + ratio * 2).toFixed(2) + "px");
    elements.assetGrid.style.setProperty("--favorite-size", (19 + ratio * 7).toFixed(2) + "px");
    elements.assetGrid.style.setProperty("--favorite-font", (12 + ratio * 5).toFixed(2) + "px");
    elements.assetGrid.style.setProperty("--label-size", (6 + ratio * 2).toFixed(2) + "px");
    var zoomThumbSize = (6 + ratio * 9).toFixed(2) + "px";
    elements.assetGrid.style.setProperty("--zoom-thumb-size", zoomThumbSize);
    if (elements.zoomRange) { elements.zoomRange.style.setProperty("--zoom-thumb-size", zoomThumbSize); }
    elements.assetGrid.classList.toggle("is-mini-card", state.preferences.viewMode !== "list" && size <= 140);
    if (elements.zoomRange) {
      elements.zoomRange.style.setProperty("--zoom-thumb-size", zoomThumbSize);
    }
  }
  function toggleViewMode() {
    setViewMode(state.preferences.viewMode === "list" ? "card" : "list");
  }
  function setViewMode(mode) {
    state.preferences.viewMode = mode === "list" ? "list" : "card";
    persistPreferences(); syncViewMode(); syncGridZoom(); renderAssets();
  }
  function syncViewMode() {
    var list = state.preferences.viewMode === "list";
    elements.assetGrid.classList.toggle("is-list-view", list);
    elements.zoomRange.disabled = list;
    elements.zoomRange.closest(".zoom-control").classList.toggle("is-disabled", list);
    elements.zoomRange.setAttribute("aria-disabled", list ? "true" : "false");
    elements.viewModeButton.classList.toggle("is-active", !list);
    elements.viewModeButton.setAttribute("aria-pressed", list ? "false" : "true");
    elements.viewModeButton.setAttribute("aria-label", "卡片视图");
    if (elements.listModeButton) {
      elements.listModeButton.classList.toggle("is-active", list);
      elements.listModeButton.setAttribute("aria-pressed", list ? "true" : "false");
    }
    syncCardStyle();
  }
  function toggleCardStyle() {
    if (state.preferences.viewMode === "list") { return; }
    state.preferences.cardStyle = state.preferences.cardStyle === "clean" ? "info" : "clean";
    persistPreferences();
    syncCardStyle();
    renderAssets();
  }
  function syncCardStyle() {
    var list = state.preferences.viewMode === "list";
    var clean = !list && state.preferences.cardStyle === "clean";
    elements.assetGrid.classList.toggle("is-clean-card", clean);
    elements.assetGrid.setAttribute("data-card-style", clean ? "clean" : "info");
    if (elements.cardStyleButton) {
      elements.cardStyleButton.hidden = false;
      elements.cardStyleButton.classList.remove("is-active");
      elements.cardStyleButton.disabled = list;
      elements.cardStyleButton.setAttribute("aria-disabled", list ? "true" : "false");
      elements.cardStyleButton.setAttribute("aria-pressed", clean ? "true" : "false");
      elements.cardStyleButton.setAttribute("aria-label", list ? "列表模式不支持纯净卡" : clean ? "切换到信息卡模式" : "切换到纯净卡模式");
      elements.cardStyleButton.title = list ? "列表模式始终显示文件信息" : clean ? "切换到信息卡模式" : "切换到纯净卡模式";
    }
  }
  function showEmpty(title, message) { elements.emptyTitle.textContent = title; elements.emptyMessage.textContent = message; elements.emptyState.hidden = false; }
  function showNotice(message, isError, duration) { clearTimeout(noticeTimer); elements.notice.hidden = false; elements.notice.textContent = message; elements.notice.classList.toggle("is-error", !!isError); if (duration !== 0) { noticeTimer = setTimeout(function () { elements.notice.hidden = true; }, duration || 4000); } }
  function friendlyError(error) { if (!error) { return "未知错误"; } if (error.code === "EACCES" || error.code === "EPERM") { return "没有操作权限"; } if (error.code === "ENOENT" || error.message === "FILE_NOT_FOUND") { return "路径不存在或共享位置已离线"; } if (error.message === "SOURCE_TIMEOUT") { return "共享位置响应超时"; } if (error.code === "JOB_CANCELLED") { return "任务已取消"; } return error.message || String(error); }

  function init() {
    cacheElements(); renderLabelFilterChoices(); ensureContextMenuExtensions(); initializeRoots(); detectHost(); bindEvents();
    renderLocations(); syncSortFieldLabel(); syncSortDirection(); syncGridZoom(); syncViewMode(); syncCardStyle(); syncSelectAllButton(); syncFilterBadge();
    if (state.preferences.searchOpen && elements.searchToggleButton) { toggleSearchPopover(); }
    else { state.preferences.searchOpen = false; }
    scanAssets();
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); } else { init(); }
}());
