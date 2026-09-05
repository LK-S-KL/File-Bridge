(function () {
  "use strict";

  var DEFAULT_ROOT = "/Volumes/团队文件-剪辑共享/0813-MIniMax";
  var MAX_SCAN_FILES = 2500;
  var MAX_RENDERED_ASSETS = 480;
  var LABELS = ["none", "red", "orange", "yellow", "green", "blue", "purple"];

  var nodeAvailable = typeof require === "function";
  var fs = nodeAvailable ? require("fs") : null;
  var path = nodeAvailable ? require("path") : null;
  var os = nodeAvailable ? require("os") : null;
  var crypto = nodeAvailable ? require("crypto") : null;
  var childProcess = nodeAvailable ? require("child_process") : null;
  var csInterface = typeof CSInterface === "function" ? new CSInterface() : null;
  var mediaTools = nodeAvailable ? FnOSMediaTools.create({ fs: fs, path: path, os: os, crypto: crypto, childProcess: childProcess }) : null;
  var stateStore = nodeAvailable ? FnOSStateStore.create({ fs: fs, path: path, os: os }) : null;
  var fileOps = nodeAvailable ? FnOSFileOps.create({ fs: fs, path: path, childProcess: childProcess }) : null;
  var persisted = stateStore ? stateStore.load() : FnOSStateStore.defaults();

  var state = {
    hostId: "BROWSER",
    roots: persisted.roots,
    assetMeta: persisted.assetMeta,
    preferences: persisted.preferences,
    assets: [],
    visibleAssets: [],
    assetById: {},
    selectedId: null,
    contextId: null,
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
    dialogAction: null
  };

  var elements = {};
  var filterTimer = null;
  var noticeTimer = null;

  function byId(id) { return document.getElementById(id); }

  function cacheElements() {
    [
      "appShell", "hostLabel", "refreshButton", "locationsButton", "addFolderButton", "mountStatus", "rootLabel",
      "searchInput", "clearSearchButton", "favoriteOnlyButton", "sortSelect", "sortDirectionButton", "filterButton",
      "filterBadge", "zoomRange", "resultCount", "notice", "assetGrid", "emptyState", "emptyTitle", "emptyMessage",
      "inspector", "inspectorPreview", "selectedName", "selectedMeta", "selectedPath", "importButton", "placeButton",
      "revealButton", "statusText", "locationsPopover", "locationsList", "addFolderFromPopover", "filterPopover",
      "resetFiltersButton", "sizeFilter", "extensionFilter", "labelFilter", "rootFilter", "metadataOnlyFilter",
      "contextMenu", "contextLabelChoices", "metadataPanel", "metadataTitle", "metadataPreview", "metadataLoading",
      "metadataList", "closeMetadataButton", "viewer", "viewerTitle", "viewerSubtitle", "viewerInfoButton",
      "closeViewerButton", "viewerStage", "fileActionDialog", "dialogTitle", "dialogMessage", "renameField",
      "renameInput", "dialogCancelButton", "dialogConfirmButton"
    ].forEach(function (id) { elements[id] = byId(id); });
    elements.searchField = document.querySelector(".search-field");
    elements.filterButtons = document.querySelectorAll(".filter-button");
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
    if (state.roots.length) { return; }
    legacy = localStorage.getItem("seekBridge.rootPath");
    state.roots = [{
      id: stableRootId(legacy || DEFAULT_ROOT),
      path: legacy || DEFAULT_ROOT,
      label: displayNameForPath(legacy || DEFAULT_ROOT),
      enabled: true
    }];
    persistRoots();
  }

  function persistRoots() {
    if (!stateStore) { return; }
    stateStore.mutate(function (latest) { latest.roots = state.roots; });
  }

  function persistPreferences() {
    if (!stateStore) { return; }
    stateStore.mutate(function (latest) { latest.preferences = state.preferences; });
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
    if (state.hostId === "PPRO") {
      elements.hostLabel.textContent = "Premiere Pro 素材面板";
      elements.placeButton.textContent = "放到播放头";
    } else if (state.hostId === "AEFT") {
      elements.hostLabel.textContent = "After Effects 素材面板";
      elements.placeButton.textContent = "加入当前合成";
    } else {
      elements.hostLabel.textContent = "界面预览";
      elements.importButton.disabled = true;
      elements.placeButton.disabled = true;
    }
  }

  function bindEvents() {
    elements.refreshButton.addEventListener("click", scanAssets);
    elements.locationsButton.addEventListener("click", function (event) {
      event.stopPropagation();
      togglePopover(elements.locationsPopover, elements.locationsButton);
    });
    elements.addFolderButton.addEventListener("click", chooseFolder);
    elements.addFolderFromPopover.addEventListener("click", chooseFolder);
    elements.locationsList.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-root-remove]");
      if (button) { removeRoot(button.getAttribute("data-root-remove")); }
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
      elements.favoriteOnlyButton.innerHTML = state.favoriteOnly ? "&#9733;" : "&#9734;";
      applyFilters();
    });
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
    elements.resetFiltersButton.addEventListener("click", resetAdvancedFilters);
    elements.zoomRange.value = String(state.preferences.zoom);
    elements.zoomRange.addEventListener("input", function () {
      state.preferences.zoom = Number(elements.zoomRange.value);
      syncGridZoom();
      persistPreferences();
    });

    elements.assetGrid.addEventListener("click", function (event) {
      var card = closestCard(event.target);
      if (card) { selectAsset(card.getAttribute("data-asset-id")); }
    });
    elements.assetGrid.addEventListener("dblclick", function (event) {
      var card = closestCard(event.target);
      if (card) {
        selectAsset(card.getAttribute("data-asset-id"));
        openViewer(assetForId(card.getAttribute("data-asset-id")));
      }
    });
    elements.assetGrid.addEventListener("keydown", function (event) {
      var card = closestCard(event.target);
      if (!card) { return; }
      if (event.key === "Enter") {
        selectAsset(card.getAttribute("data-asset-id"));
        openViewer(assetForId(card.getAttribute("data-asset-id")));
      } else if (event.key === " ") {
        event.preventDefault();
        selectAsset(card.getAttribute("data-asset-id"));
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

    elements.importButton.addEventListener("click", function () { runHostAction(false); });
    elements.placeButton.addEventListener("click", function () { runHostAction(true); });
    elements.revealButton.addEventListener("click", revealSelected);
    elements.contextMenu.addEventListener("click", handleContextCommand);
    elements.contextLabelChoices.addEventListener("click", function (event) {
      var choice = event.target.closest("button[data-label]");
      var asset = assetForId(state.contextId);
      if (choice && asset) {
        setColorLabel(asset, choice.getAttribute("data-label"));
        closeContextMenu();
      }
    });

    elements.closeMetadataButton.addEventListener("click", closeMetadata);
    elements.closeViewerButton.addEventListener("click", closeViewer);
    elements.viewerInfoButton.addEventListener("click", function () {
      var asset = assetForId(state.selectedId);
      if (asset) { closeViewer(); openMetadata(asset); }
    });
    elements.dialogCancelButton.addEventListener("click", closeDialog);
    elements.dialogConfirmButton.addEventListener("click", confirmDialogAction);
    elements.renameInput.addEventListener("keydown", function (event) { if (event.key === "Enter") { confirmDialogAction(); } });

    document.addEventListener("click", function (event) {
      if (!elements.locationsPopover.contains(event.target) && event.target !== elements.locationsButton) { hidePopover(elements.locationsPopover, elements.locationsButton); }
      if (!elements.filterPopover.contains(event.target) && event.target !== elements.filterButton) { hidePopover(elements.filterPopover, elements.filterButton); }
      if (!elements.contextMenu.contains(event.target)) { closeContextMenu(); }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") { return; }
      if (!elements.fileActionDialog.hidden) { closeDialog(); }
      else if (!elements.viewer.hidden) { closeViewer(); }
      else if (!elements.metadataPanel.hidden) { closeMetadata(); }
      else { closeContextMenu(); hidePopover(elements.locationsPopover, elements.locationsButton); hidePopover(elements.filterPopover, elements.filterButton); }
    });
  }

  function closestCard(target) {
    while (target && target !== elements.assetGrid) {
      if (target.classList && target.classList.contains("asset-card")) { return target; }
      target = target.parentNode;
    }
    return null;
  }

  function togglePopover(popover, trigger) {
    var show = popover.hidden;
    hidePopover(elements.locationsPopover, elements.locationsButton);
    hidePopover(elements.filterPopover, elements.filterButton);
    popover.hidden = !show;
    trigger.setAttribute("aria-expanded", show ? "true" : "false");
  }

  function hidePopover(popover, trigger) {
    popover.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
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

  function canonicalPath(value) {
    try { return fs.realpathSync(value); } catch (error) { return path.resolve(value); }
  }

  function isNestedPath(candidate, existing) {
    var relative = path.relative(existing, candidate);
    return relative === "" || (relative && relative.indexOf("..") !== 0 && !path.isAbsolute(relative));
  }

  function addRoot(rootPath) {
    var canonical;
    var conflict;
    if (!nodeAvailable || !fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
      showNotice("所选素材位置当前不可读取。", true, 5000);
      return;
    }
    canonical = canonicalPath(rootPath);
    conflict = state.roots.some(function (root) {
      var existing = canonicalPath(root.path);
      return isNestedPath(canonical, existing) || isNestedPath(existing, canonical);
    });
    if (conflict) {
      showNotice("这个位置已经添加，或与现有位置互相包含。", true, 5000);
      return;
    }
    state.roots.push({ id: stableRootId(canonical), path: canonical, label: displayNameForPath(canonical), enabled: true });
    persistRoots();
    renderLocations();
    scanAssets();
  }

  function removeRoot(rootId) {
    if (state.roots.length <= 1) {
      showNotice("至少保留一个素材位置。", true, 4000);
      return;
    }
    state.roots = state.roots.filter(function (root) { return root.id !== rootId; });
    if (state.filters.rootId === rootId) { state.filters.rootId = "all"; }
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
      var dot = document.createElement("span");
      var copy = document.createElement("div");
      var name = document.createElement("strong");
      var pathText = document.createElement("span");
      var remove = document.createElement("button");
      var option = document.createElement("option");
      var online = !nodeAvailable || fs.existsSync(root.path);
      if (online) { onlineCount += 1; }
      row.className = "location-item";
      dot.className = "status-dot " + (online ? "is-online" : "is-offline");
      copy.className = "location-copy";
      name.textContent = root.label || displayNameForPath(root.path);
      pathText.textContent = root.path;
      pathText.title = root.path;
      copy.appendChild(name); copy.appendChild(pathText);
      remove.type = "button"; remove.textContent = "×"; remove.title = "移除此素材位置"; remove.setAttribute("data-root-remove", root.id);
      row.appendChild(dot); row.appendChild(copy); row.appendChild(remove);
      elements.locationsList.appendChild(row);
      option.value = root.id; option.textContent = root.label || displayNameForPath(root.path); elements.rootFilter.appendChild(option);
    });
    if (!state.roots.some(function (root) { return root.id === state.filters.rootId; })) { state.filters.rootId = "all"; }
    elements.rootFilter.value = state.filters.rootId;
    elements.rootLabel.textContent = state.roots.length === 1 ? state.roots[0].path : state.roots.length + " 个素材位置";
    elements.rootLabel.title = state.roots.map(function (root) { return root.path; }).join("\n");
    elements.mountStatus.className = "status-dot " + (onlineCount === state.roots.length ? "is-online" : onlineCount ? "is-partial" : "is-offline");
  }

  function scanAssets() {
    var combined = [];
    var seen = {};
    var warnings = 0;
    var offline = 0;
    if (state.scanning) { return; }
    if (!nodeAvailable) { loadPreviewAssets(); return; }
    state.scanning = true;
    elements.refreshButton.disabled = true;
    elements.statusText.textContent = "正在读取多个素材位置...";
    setTimeout(function () {
      try {
        state.roots.forEach(function (root) {
          var result = SeekLibrary.scanLibrary(root.path, { fs: fs, path: path }, { maxFiles: MAX_SCAN_FILES, maxDepth: 10 });
          if (result.offline) { offline += 1; return; }
          warnings += result.warnings.length;
          result.assets.forEach(function (asset) {
            var canonical;
            try { canonical = fs.realpathSync(asset.path); } catch (error) { canonical = asset.path; }
            if (seen[canonical]) { return; }
            seen[canonical] = true;
            asset.rootId = root.id;
            asset.rootPath = root.path;
            asset.rootLabel = root.label || displayNameForPath(root.path);
            asset.id = root.id + ":" + asset.relativePath;
            asset.domId = crypto.createHash("sha1").update(asset.id).digest("hex").slice(0, 16);
            combined.push(asset);
          });
        });
        state.assets = combined;
        rebuildAssetMap();
        renderLocations();
        elements.statusText.textContent = "已读取 " + combined.length + " 项素材";
        if (offline) { showNotice(offline + " 个素材位置离线，其余位置仍可使用。", false, 5500); }
        else if (warnings) { showNotice("有 " + warnings + " 个位置暂时无法读取。", false, 5500); }
        applyFilters();
      } catch (error) {
        showNotice("读取素材失败：" + friendlyError(error), true, 0);
      } finally {
        state.scanning = false;
        elements.refreshButton.disabled = false;
      }
    }, 20);
  }

  function loadPreviewAssets() {
    var examples = [
      ["EVO4-Pro_产品特写.mov", "video", 238412800], ["fnOS_界面录屏.mp4", "video", 98304000],
      ["Seek_封面主视觉.png", "image", 6021120], ["发布会_环境声.wav", "audio", 48128000],
      ["NAS_工作流示意图.jpg", "image", 3184128], ["用户采访_A机位.mp4", "video", 438412800]
    ];
    state.roots = [{ id: "preview", path: "/Volumes/团队文件-剪辑共享/预览", label: "团队素材预览", enabled: true }];
    state.assets = examples.map(function (example, index) {
      return { id: "preview:" + index, domId: "preview-" + index, name: example[0], path: state.roots[0].path + "/" + example[0], relativePath: example[0], folder: "团队素材预览", extension: example[0].split(".").pop().toLowerCase(), type: example[1], size: example[2], modifiedMs: Date.now() - index * 3600000, rootId: "preview", rootPath: state.roots[0].path, rootLabel: state.roots[0].label };
    });
    state.assets[0].mediaMetadata = {
      format: "QuickTime / MOV", duration: 18.542, totalBitrate: 84200000,
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
    if (!SeekLibrary.matches(asset, state.query, state.filter)) { return false; }
    if (state.favoriteOnly && !local.favorite) { return false; }
    if (state.filters.size === "small" && asset.size >= 100 * megabyte) { return false; }
    if (state.filters.size === "medium" && (asset.size < 100 * megabyte || asset.size > 1024 * megabyte)) { return false; }
    if (state.filters.size === "large" && asset.size <= 1024 * megabyte) { return false; }
    if (state.filters.extensions.length && state.filters.extensions.indexOf(asset.extension) === -1) { return false; }
    if (state.filters.label === "none" && local.label && local.label !== "none") { return false; }
    if (state.filters.label !== "all" && state.filters.label !== "none" && local.label !== state.filters.label) { return false; }
    if (state.filters.rootId !== "all" && asset.rootId !== state.filters.rootId) { return false; }
    if (state.filters.metadataOnly && !local.metadataCached) { return false; }
    return true;
  }

  function compareAssets(left, right) {
    var by = state.preferences.sortBy;
    var direction = state.preferences.sortDirection === "asc" ? 1 : -1;
    var leftValue;
    var rightValue;
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
    var renderList = state.visibleAssets.slice(0, MAX_RENDERED_ASSETS);
    var selectedVisible = false;
    elements.assetGrid.innerHTML = "";
    elements.resultCount.textContent = state.visibleAssets.length + " 项";
    renderList.forEach(function (asset) {
      var local = localMetaFor(asset);
      var card = document.createElement("article");
      var thumb = document.createElement("div");
      var sprite = document.createElement("div");
      var progress = document.createElement("div");
      var type = document.createElement("span");
      var copy = document.createElement("div");
      var name = document.createElement("span");
      var folder = document.createElement("span");
      card.className = "asset-card";
      card.setAttribute("data-asset-id", asset.domId);
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", asset.name + "，双击预览，右键更多操作");
      card.draggable = state.hostId === "PPRO";
      card.title = state.hostId === "PPRO" ? "拖到 Premiere 素材箱、源监视器或时间线" : state.hostId === "AEFT" ? "AE 暂不支持从扩展直接拖入，请使用下方按钮" : "";
      if (asset.domId === state.selectedId) { card.classList.add("is-selected"); selectedVisible = true; }
      thumb.className = "asset-thumb";
      sprite.className = "sprite-preview";
      progress.className = "scrub-progress";
      type.className = "asset-type"; type.textContent = asset.extension || asset.type;
      thumb.appendChild(createPlaceholder(asset)); thumb.appendChild(sprite); thumb.appendChild(progress); thumb.appendChild(type);
      if (local.favorite) { var favorite = document.createElement("span"); favorite.className = "favorite-mark"; favorite.textContent = "★"; thumb.appendChild(favorite); }
      if (local.label && local.label !== "none") { var label = document.createElement("span"); label.className = "color-label"; label.setAttribute("data-label", local.label); thumb.appendChild(label); }
      copy.className = "asset-copy";
      name.className = "asset-name"; name.textContent = asset.name; name.title = asset.name;
      folder.className = "asset-folder"; folder.textContent = asset.folder === "根目录" || asset.folder === asset.rootLabel ? asset.rootLabel : asset.rootLabel + " / " + asset.folder; folder.title = asset.path;
      copy.appendChild(name); copy.appendChild(folder); card.appendChild(thumb); card.appendChild(copy); fragment.appendChild(card);
      requestVisual(asset, thumb);
    });
    elements.assetGrid.appendChild(fragment);
    if (!selectedVisible && state.selectedId) { state.selectedId = null; renderInspector(); }
    if (!state.visibleAssets.length) {
      elements.assetGrid.hidden = true;
      showEmpty(state.assets.length ? "没有匹配的素材" : "没有可用素材", state.assets.length ? "调整搜索、收藏或筛选条件。" : "添加一个包含视频、图片或音频的素材位置。");
    } else {
      elements.assetGrid.hidden = false; elements.emptyState.hidden = true;
      if (state.visibleAssets.length > MAX_RENDERED_ASSETS) { showNotice("结果较多，当前显示前 " + MAX_RENDERED_ASSETS + " 项。", false, 4000); }
    }
  }

  function createPlaceholder(asset) {
    var placeholder = document.createElement("div");
    placeholder.className = "generic-thumb";
    placeholder.textContent = asset.type === "video" ? "VID" : asset.type === "image" ? "IMG" : "AUD";
    return placeholder;
  }

  function requestVisual(asset, thumb) {
    var directImages = ["jpg", "jpeg", "jpe", "png", "webp", "gif", "bmp", "svg"];
    if (asset.type === "image" && directImages.indexOf(asset.extension) !== -1) {
      installImage(thumb, SeekLibrary.fileUrl(asset.path), asset.name, "poster-image");
    } else if (mediaTools && asset.type === "video") {
      mediaTools.posterFor(asset.path).then(function (filePath) { if (document.documentElement.contains(thumb)) { installImage(thumb, SeekLibrary.fileUrl(filePath), asset.name, "poster-image"); } }).catch(function () {});
    } else if (mediaTools && asset.type === "audio") {
      mediaTools.waveformFor(asset.path).then(function (filePath) { if (document.documentElement.contains(thumb)) { installImage(thumb, SeekLibrary.fileUrl(filePath), asset.name, "waveform-image"); } }).catch(function () {});
    }
  }

  function installImage(container, source, label, className) {
    var image = document.createElement("img");
    image.alt = label; image.draggable = false; image.className = className || "";
    image.onload = function () { var placeholder = container.querySelector(".generic-thumb"); if (placeholder) { placeholder.remove(); } };
    image.onerror = function () { image.remove(); };
    image.src = source;
    container.insertBefore(image, container.firstChild);
  }

  function beginSpritePreview(event) {
    var card = closestCard(event.target);
    var asset;
    var thumb;
    var sprite;
    if (!card || (event.relatedTarget && card.contains(event.relatedTarget))) { return; }
    asset = assetForId(card.getAttribute("data-asset-id"));
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
  }

  function selectAsset(id) {
    var asset = assetForId(id);
    if (!asset) { return; }
    state.selectedId = id;
    Array.prototype.forEach.call(elements.assetGrid.querySelectorAll(".asset-card"), function (card) { card.classList.toggle("is-selected", card.getAttribute("data-asset-id") === id); });
    renderInspector();
  }

  function renderInspector() {
    var asset = selectedAsset();
    var sourceImage;
    var image;
    if (!asset) { elements.inspector.hidden = true; return; }
    elements.inspector.hidden = false;
    elements.selectedName.textContent = asset.name; elements.selectedName.title = asset.name;
    elements.selectedMeta.textContent = typeLabel(asset.type) + " · " + SeekLibrary.formatBytes(asset.size);
    elements.selectedPath.textContent = asset.rootLabel + " / " + asset.folder; elements.selectedPath.title = asset.path;
    elements.inspectorPreview.innerHTML = "";
    sourceImage = findCard(asset.domId) && findCard(asset.domId).querySelector(".asset-thumb img");
    if (sourceImage) { image = document.createElement("img"); image.src = sourceImage.src; image.alt = ""; elements.inspectorPreview.appendChild(image); }
    else { elements.inspectorPreview.appendChild(createPlaceholder(asset)); }
  }

  function findCard(id) {
    var cards = elements.assetGrid.querySelectorAll(".asset-card");
    var i;
    for (i = 0; i < cards.length; i += 1) { if (cards[i].getAttribute("data-asset-id") === id) { return cards[i]; } }
    return null;
  }

  function typeLabel(type) { return type === "video" ? "视频" : type === "image" ? "图片" : "音频"; }

  function startAssetDrag(event) {
    var card = closestCard(event.target);
    var asset = card && assetForId(card.getAttribute("data-asset-id"));
    if (state.hostId !== "PPRO" || !asset || !nodeAvailable || !fs.existsSync(asset.path)) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("com.adobe.cep.dnd.file.0", asset.path);
    event.dataTransfer.setData("text/plain", asset.path);
    event.dataTransfer.setData("text/uri-list", SeekLibrary.fileUrl(asset.path));
    card.classList.add("is-dragging");
    elements.statusText.textContent = "拖到 Premiere 素材箱、源监视器或时间线";
  }

  function openContextMenu(event) {
    var card = closestCard(event.target);
    var asset;
    var left;
    var top;
    var favoriteButton;
    if (!card) { return; }
    event.preventDefault(); event.stopPropagation();
    state.contextId = card.getAttribute("data-asset-id"); selectAsset(state.contextId); asset = assetForId(state.contextId);
    favoriteButton = elements.contextMenu.querySelector('[data-command="favorite"]');
    favoriteButton.textContent = localMetaFor(asset).favorite ? "取消本机收藏" : "添加到本机收藏";
    renderLabelChoices(asset);
    elements.contextMenu.hidden = false;
    left = Math.min(event.clientX, window.innerWidth - elements.contextMenu.offsetWidth - 6);
    top = Math.min(event.clientY, window.innerHeight - elements.contextMenu.offsetHeight - 6);
    elements.contextMenu.style.left = Math.max(4, left) + "px"; elements.contextMenu.style.top = Math.max(4, top) + "px";
  }

  function renderLabelChoices(asset) {
    var current = localMetaFor(asset).label || "none";
    elements.contextLabelChoices.innerHTML = "";
    LABELS.forEach(function (label) {
      var button = document.createElement("button");
      button.type = "button"; button.className = "label-choice" + (current === label ? " is-selected" : ""); button.setAttribute("data-label", label); button.title = label === "none" ? "移除标签" : label;
      elements.contextLabelChoices.appendChild(button);
    });
  }

  function closeContextMenu() { elements.contextMenu.hidden = true; state.contextId = null; }

  function handleContextCommand(event) {
    var button = event.target.closest("button[data-command]");
    var asset = assetForId(state.contextId);
    var command;
    if (!button || !asset) { return; }
    command = button.getAttribute("data-command");
    if (command === "play") { openViewer(asset); }
    else if (command === "info") { openMetadata(asset); }
    else if (command === "favorite") { toggleFavorite(asset); }
    else if (command === "reveal") { revealAsset(asset); }
    else if (command === "rename") { openRenameDialog(asset); }
    else if (command === "trash") { openTrashDialog(asset); }
    closeContextMenu();
  }

  function toggleFavorite(asset) {
    updateLocalMeta(asset, { favorite: !localMetaFor(asset).favorite });
    renderAssets(); renderInspector();
  }

  function setColorLabel(asset, label) {
    updateLocalMeta(asset, { label: LABELS.indexOf(label) !== -1 ? label : "none" });
    renderAssets(); renderInspector();
  }

  function openViewer(asset) {
    var source = SeekLibrary.fileUrl(asset.path);
    var media;
    state.selectedId = asset.domId;
    elements.viewerTitle.textContent = asset.name;
    elements.viewerSubtitle.textContent = asset.rootLabel + " / " + asset.folder;
    elements.viewerStage.innerHTML = "";
    if (asset.type === "video") {
      media = document.createElement("video"); media.src = source; media.controls = true; media.autoplay = true; media.preload = "metadata"; elements.viewerStage.appendChild(media);
    } else if (asset.type === "audio") {
      var audioViewer = document.createElement("div"); audioViewer.className = "audio-viewer";
      var waveform = document.createElement("div"); waveform.className = "generic-thumb"; waveform.textContent = "正在生成波形..."; audioViewer.appendChild(waveform);
      media = document.createElement("audio"); media.src = source; media.controls = true; media.autoplay = true; audioViewer.appendChild(media); elements.viewerStage.appendChild(audioViewer);
      if (mediaTools) { mediaTools.waveformFor(asset.path).then(function (filePath) { var image = document.createElement("img"); image.src = SeekLibrary.fileUrl(filePath); image.alt = asset.name + " 波形"; waveform.replaceWith(image); }).catch(function () { waveform.textContent = "无法生成波形"; }); }
    } else {
      media = document.createElement("img"); media.src = source; media.alt = asset.name; elements.viewerStage.appendChild(media);
    }
    elements.viewer.hidden = false;
  }

  function closeViewer() {
    Array.prototype.forEach.call(elements.viewerStage.querySelectorAll("video,audio"), function (media) { media.pause(); media.removeAttribute("src"); media.load(); });
    elements.viewerStage.innerHTML = ""; elements.viewer.hidden = true;
  }

  function metadataRows(asset, metadata) {
    return [
      ["文件名", asset.name], ["文件格式", metadata.format], ["时长", FnOSMediaTools.formatDuration(metadata.duration)],
      ["文件大小", SeekLibrary.formatBytes(asset.size)], ["总码率", FnOSMediaTools.formatBitrate(metadata.totalBitrate)],
      ["视频编码", metadata.videoCodec], ["视频 Profile", metadata.videoProfile], ["视频码率", FnOSMediaTools.formatBitrate(metadata.videoBitrate)],
      ["音频编码", metadata.audioCodec], ["音频 Profile", metadata.audioProfile], ["音频码率", FnOSMediaTools.formatBitrate(metadata.audioBitrate)], ["分辨率", metadata.resolution],
      ["帧率", metadata.frameRate ? metadata.frameRate.toFixed(3).replace(/\.000$/, "") + " fps" : "不适用"],
      ["色彩空间", metadata.colorSpace], ["色域 / Primaries", metadata.colorPrimaries], ["传递函数", metadata.colorTransfer],
      ["矩阵系数", metadata.colorMatrix], ["色彩范围", metadata.colorRange],
      ["动态范围", metadata.dynamicRange + "（推断置信度：" + metadata.dynamicRangeConfidence + "）"],
      ["Alpha 通道", metadata.alpha + "（推断置信度：" + metadata.alphaConfidence + "）"],
      ["像素格式", metadata.pixelFormat], ["位深", metadata.bitDepth], ["扫描方式", metadata.fieldOrder],
      ["像素宽高比", metadata.sampleAspectRatio], ["显示宽高比", metadata.displayAspectRatio],
      ["音频采样率", metadata.audioSampleRate ? metadata.audioSampleRate + " Hz" : "不适用"], ["音频声道", metadata.audioChannels],
      ["时间码", metadata.timecode], ["媒体流数量", String(metadata.streamCount)], ["媒体创建时间", metadata.creationTime],
      ["修改日期", new Date(asset.modifiedMs).toLocaleString("zh-CN")], ["素材位置", asset.rootLabel], ["完整路径", asset.path]
    ];
  }

  function openMetadata(asset) {
    state.selectedId = asset.domId;
    elements.metadataTitle.textContent = asset.name; elements.metadataPreview.innerHTML = ""; elements.metadataList.innerHTML = ""; elements.metadataLoading.hidden = false; elements.metadataPanel.hidden = false;
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
      asset.mediaMetadata = metadata; updateLocalMeta(asset, { metadataCached: true });
      elements.metadataLoading.hidden = true;
      metadataRows(asset, metadata).forEach(function (row) { var dt = document.createElement("dt"); var dd = document.createElement("dd"); dt.textContent = row[0]; dd.textContent = row[1]; elements.metadataList.appendChild(dt); elements.metadataList.appendChild(dd); });
      if (state.preferences.sortBy === "duration") { applyFilters(); }
    }).catch(function (error) { elements.metadataLoading.textContent = "无法读取元数据：" + friendlyError(error); });
  }

  function closeMetadata() { elements.metadataPanel.hidden = true; }

  function openRenameDialog(asset) {
    var extensionLength = asset.extension ? asset.extension.length + 1 : 0;
    state.dialogAction = { type: "rename", assetId: asset.domId };
    elements.dialogTitle.textContent = "重命名源文件";
    elements.dialogMessage.textContent = "这会修改 NAS 上的真实文件名；若素材已导入 Adobe 工程，工程可能显示离线。MVP 暂不允许更改扩展名。";
    elements.renameField.hidden = false; elements.renameInput.value = asset.name;
    elements.dialogConfirmButton.textContent = "重命名"; elements.dialogConfirmButton.className = "button button-primary";
    elements.fileActionDialog.hidden = false; elements.renameInput.focus(); elements.renameInput.setSelectionRange(0, asset.name.length - extensionLength);
  }

  function openTrashDialog(asset) {
    state.dialogAction = { type: "trash", assetId: asset.domId };
    elements.dialogTitle.textContent = "移到废纸篓？";
    elements.dialogMessage.textContent = "将移动 NAS 上的“" + asset.name + "”。若共享盘不支持废纸篓，操作会失败并保留原文件；绝不会改为永久删除。已导入 Adobe 的引用可能离线。";
    elements.renameField.hidden = true; elements.dialogConfirmButton.textContent = "移到废纸篓"; elements.dialogConfirmButton.className = "button button-danger";
    elements.fileActionDialog.hidden = false;
  }

  function closeDialog() { elements.fileActionDialog.hidden = true; state.dialogAction = null; }

  function confirmDialogAction() {
    var action = state.dialogAction;
    var asset = action && assetForId(action.assetId);
    if (!asset || !fileOps) { closeDialog(); return; }
    elements.dialogConfirmButton.disabled = true;
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

  function performTrash(asset) {
    fileOps.moveToTrash(asset, state.roots).then(function () {
      elements.dialogConfirmButton.disabled = false;
      closeDialog(); showNotice("文件已移到废纸篓。", false, 4500); scanAssets();
    }).catch(function (error) {
      elements.dialogConfirmButton.disabled = false;
      showNotice("无法移到废纸篓，原文件已保留：" + friendlyError(error), true, 7000);
    });
  }

  function runHostAction(placeAtCurrentTime) {
    var asset = selectedAsset();
    var method;
    var payload;
    var script;
    if (!asset || !csInterface || state.hostId === "BROWSER") { return; }
    if (nodeAvailable && !fs.existsSync(asset.path)) { showNotice("素材当前不可用，请检查 fnOS 连接。", true, 5000); return; }
    method = placeAtCurrentTime ? (state.hostId === "AEFT" ? "importMediaToComp" : "importMediaToSequence") : "importMedia";
    payload = JSON.stringify({ path: asset.path }); script = "SeekBridge." + method + "(" + JSON.stringify(payload) + ")";
    setActionBusy(true, placeAtCurrentTime ? "正在放置素材..." : "正在导入素材...");
    csInterface.evalScript(script, function (rawResult) {
      var result; setActionBusy(false);
      try { result = JSON.parse(rawResult); } catch (error) { result = { ok: false, code: "INVALID_RESPONSE", message: rawResult || "Adobe 没有返回结果。" }; }
      if (result.ok) { elements.statusText.textContent = placeAtCurrentTime ? "已放置：" + asset.name : "已导入：" + asset.name; showNotice(placeAtCurrentTime ? (state.hostId === "AEFT" ? "素材已加入当前合成。" : "素材已放到当前播放头。") : "素材已导入项目。", false, 3200); }
      else { elements.statusText.textContent = "操作未完成"; showNotice(hostErrorMessage(result), true, 6500); }
    });
  }

  function hostErrorMessage(result) {
    var messages = { NO_PROJECT: "请先新建或打开一个 Adobe 工程。", NO_ACTIVE_SEQUENCE: "请先打开一条 Premiere 时间线。", NO_ACTIVE_COMP: "请先打开一个 After Effects 合成。", FILE_NOT_FOUND: "素材文件暂时不可用，请检查 fnOS 连接。", IMPORT_FAILED: "Adobe 无法导入这个文件，可能是不支持该格式。", INSERT_FAILED: "素材已导入，但没能放到当前时间。请检查时间线轨道。", ADD_TO_COMP_FAILED: "素材已导入，但没能加入当前合成。" };
    return messages[result.code] || result.message || "Adobe 操作失败，请重试。";
  }

  function setActionBusy(busy, message) {
    elements.importButton.disabled = busy || state.hostId === "BROWSER"; elements.placeButton.disabled = busy || state.hostId === "BROWSER"; elements.revealButton.disabled = busy;
    if (busy && message) { elements.statusText.textContent = message; }
  }

  function revealAsset(asset) {
    var process;
    if (!asset || !nodeAvailable) { return; }
    process = childProcess.spawn("/usr/bin/open", ["-R", asset.path], { detached: true });
    process.on("error", function () { showNotice("无法在 Finder 中显示这个文件。", true, 4000); }); process.unref();
  }
  function revealSelected() { revealAsset(selectedAsset()); }

  function syncSortDirection() {
    var asc = state.preferences.sortDirection === "asc";
    elements.sortDirectionButton.innerHTML = asc ? "&#8593;" : "&#8595;"; elements.sortDirectionButton.title = asc ? "升序" : "降序";
  }
  function syncGridZoom() {
    elements.assetGrid.classList.remove("grid-small", "grid-medium", "grid-large");
    elements.assetGrid.classList.add(state.preferences.zoom === 0 ? "grid-small" : state.preferences.zoom === 2 ? "grid-large" : "grid-medium");
  }
  function showEmpty(title, message) { elements.emptyTitle.textContent = title; elements.emptyMessage.textContent = message; elements.emptyState.hidden = false; }
  function showNotice(message, isError, duration) { clearTimeout(noticeTimer); elements.notice.hidden = false; elements.notice.textContent = message; elements.notice.classList.toggle("is-error", !!isError); if (duration !== 0) { noticeTimer = setTimeout(function () { elements.notice.hidden = true; }, duration || 4000); } }
  function friendlyError(error) { if (!error) { return "未知错误"; } if (error.code === "EACCES" || error.code === "EPERM") { return "没有操作权限"; } if (error.code === "ENOENT" || error.message === "FILE_NOT_FOUND") { return "路径不存在或共享盘已离线"; } return error.message || String(error); }

  function init() {
    cacheElements(); initializeRoots(); detectHost(); bindEvents(); renderLocations(); syncSortDirection(); syncGridZoom(); syncFilterBadge(); scanAssets();
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); } else { init(); }
}());
