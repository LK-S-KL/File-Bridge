(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.FnOSFileOps = api;
}(this, function () {
  "use strict";

  var TRASH_SCRIPT = [
    'ObjC.import("Foundation");',
    'function run(argv){',
    'var source=$.NSURL.fileURLWithPath(argv[0]);',
    'var resulting=$();var error=$();',
    'var ok=$.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError(source,resulting,error);',
    'return JSON.stringify({ok:Boolean(ok),out:resulting.isNil()?"":ObjC.unwrap(resulting.path),error:error.isNil()?"":ObjC.unwrap(error.localizedDescription)});',
    '}'
  ].join("");

  function isContained(path, child, root) {
    var relative = path.relative(root, child);
    return !!relative && relative.indexOf("..") !== 0 && !path.isAbsolute(relative);
  }

  function create(runtime) {
    var fs = runtime.fs;
    var path = runtime.path;
    var childProcess = runtime.childProcess;

    function validateSource(asset, roots) {
      var root = roots.filter(function (item) { return item.id === asset.rootId; })[0];
      var stat;
      var sourceReal;
      var rootReal;
      if (!root || !fs.existsSync(asset.path)) { throw new Error("素材已不存在或素材位置已离线。"); }
      stat = fs.lstatSync(asset.path);
      if (!stat.isFile() || stat.isSymbolicLink()) { throw new Error("只允许操作素材位置内的普通文件。"); }
      sourceReal = fs.realpathSync(asset.path);
      rootReal = fs.realpathSync(root.path);
      if (!isContained(path, sourceReal, rootReal)) { throw new Error("文件不在已授权的素材位置内。"); }
      if (stat.size !== asset.size || Math.abs(stat.mtimeMs - asset.modifiedMs) > 1) { throw new Error("文件在扫描后发生过变化，请先刷新再操作。"); }
      return { root: root, sourceReal: sourceReal, rootReal: rootReal, stat: stat };
    }

    function validateNewName(asset, value) {
      var newName = String(value || "").trim();
      var oldExtension = String(asset.extension || "").toLowerCase();
      var dot = newName.lastIndexOf(".");
      var newExtension = dot < 0 ? "" : newName.slice(dot + 1).toLowerCase();
      var stem = oldExtension ? newName.slice(0, -(oldExtension.length + 1)) : newName;
      if (!newName || newName === "." || newName === ".." || /[\x00-\x1f<>:"/\\|?*]/.test(newName) || /[ .]$/.test(newName)) { throw new Error("文件名包含 SMB 不支持的字符，或结尾为空格/句点。"); }
      if (oldExtension !== newExtension) { throw new Error("为避免格式误判，当前版本不允许更改扩展名。"); }
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) { throw new Error("这是 Windows/SMB 保留名称，请换一个名称。"); }
      return newName;
    }

    function rename(asset, roots, value) {
      var newName;
      var destination;
      var existingNames;
      var temporary;
      validateSource(asset, roots);
      newName = validateNewName(asset, value);
      destination = path.join(path.dirname(asset.path), newName);
      if (destination === asset.path) { return { changed: false, path: asset.path }; }
      existingNames = fs.readdirSync(path.dirname(asset.path));
      if (existingNames.some(function (name) { return name.toLocaleLowerCase() === newName.toLocaleLowerCase() && name !== asset.name; })) { throw new Error("同一文件夹已存在同名文件。"); }
      if (asset.name.toLocaleLowerCase() === newName.toLocaleLowerCase()) {
        temporary = path.join(path.dirname(asset.path), ".__fnosbridge__" + Date.now() + "." + asset.extension);
        fs.renameSync(asset.path, temporary);
        try { fs.renameSync(temporary, destination); }
        catch (error) { fs.renameSync(temporary, asset.path); throw error; }
      } else {
        fs.renameSync(asset.path, destination);
      }
      return { changed: true, path: destination, oldPath: asset.path, name: newName };
    }

    function moveToTrash(asset, roots) {
      validateSource(asset, roots);
      return new Promise(function (resolve, reject) {
        childProcess.execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", TRASH_SCRIPT, asset.path], { timeout: 30000 }, function (error, stdout) {
          var result;
          if (error) { reject(error); return; }
          try { result = JSON.parse(stdout); }
          catch (parseError) { reject(parseError); return; }
          if (!result.ok || fs.existsSync(asset.path)) { reject(new Error(result.error || "共享盘没有完成废纸篓操作，原文件已保留。")); return; }
          resolve(result);
        });
      });
    }

    return { validateSource: validateSource, validateNewName: validateNewName, rename: rename, moveToTrash: moveToTrash };
  }

  return { create: create, TRASH_SCRIPT: TRASH_SCRIPT };
}));
