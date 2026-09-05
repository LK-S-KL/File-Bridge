(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.FnOSInteractionTools = api;
}(this, function () {
  "use strict";

  function writeAdobeDragData(dataTransfer, paths, fileUrl) {
    var files = Array.isArray(paths) ? paths.filter(Boolean) : [];
    if (!dataTransfer || typeof dataTransfer.setData !== "function" || !files.length) { throw new Error("INVALID_DRAG_PAYLOAD"); }
    dataTransfer.effectAllowed = "copyMove";
    files.forEach(function (filePath, index) { dataTransfer.setData("com.adobe.cep.dnd.file." + index, filePath); });
    dataTransfer.setData("text/plain", files.join("\n"));
    dataTransfer.setData("text/uri-list", files.map(fileUrl).join("\n"));
    return files.length;
  }

  function viewerDragPath(asset, altKey, audioProxyPath) {
    if (!asset || !asset.path || asset.type === "folder" || asset.type === "lut") { return { ok: false, reason: "UNSUPPORTED_ASSET" }; }
    if (altKey && asset.type === "video") {
      return audioProxyPath ? { ok: true, path: audioProxyPath, audioOnly: true } : { ok: false, reason: "AUDIO_PROXY_PENDING" };
    }
    return { ok: true, path: asset.path, audioOnly: asset.type === "audio" };
  }

  return { writeAdobeDragData: writeAdobeDragData, viewerDragPath: viewerDragPath };
}));
