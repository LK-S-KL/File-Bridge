/* LK‘s File Bridge host adapter. ES3-compatible for Premiere Pro and After Effects. */

$.global.SeekBridge = $.global.SeekBridge || {};

(function (ns) {
    var FOLDER_NAME = "LK‘s File Bridge";
    var LEGACY_FOLDER_NAMES = { "Rove": true, "Seek Bridge": true, "Seek Bridge MVP": true, "fnOS Bridge": true };

    function quoteJson(value) {
        var input = String(value);
        var output = "\"";
        var character;
        var code;
        var hex;
        var i;

        for (i = 0; i < input.length; i += 1) {
            character = input.charAt(i);
            code = input.charCodeAt(i);
            if (character === "\"") {
                output += "\\\"";
            } else if (character === "\\") {
                output += "\\\\";
            } else if (character === "\b") {
                output += "\\b";
            } else if (character === "\f") {
                output += "\\f";
            } else if (character === "\n") {
                output += "\\n";
            } else if (character === "\r") {
                output += "\\r";
            } else if (character === "\t") {
                output += "\\t";
            } else if (code < 32 || code === 0x2028 || code === 0x2029) {
                hex = code.toString(16);
                while (hex.length < 4) {
                    hex = "0" + hex;
                }
                output += "\\u" + hex;
            } else {
                output += character;
            }
        }
        return output + "\"";
    }

    function isArrayValue(value) {
        return value && typeof value === "object" && Object.prototype.toString.call(value) === "[object Array]";
    }

    function toJsonValue(value) {
        var parts = [];
        var key;
        var type;
        var i;

        if (value === null || typeof value === "undefined") {
            return "null";
        }
        type = typeof value;
        if (type === "string") {
            return quoteJson(value);
        }
        if (type === "number") {
            return isFinite(value) ? String(value) : "null";
        }
        if (type === "boolean") {
            return value ? "true" : "false";
        }
        if (isArrayValue(value)) {
            for (i = 0; i < value.length; i += 1) {
                parts.push(toJsonValue(value[i]));
            }
            return "[" + parts.join(",") + "]";
        }
        if (type === "object") {
            for (key in value) {
                if (!value.hasOwnProperty || value.hasOwnProperty(key)) {
                    if (typeof value[key] !== "function" && typeof value[key] !== "undefined") {
                        parts.push(quoteJson(key) + ":" + toJsonValue(value[key]));
                    }
                }
            }
            return "{" + parts.join(",") + "}";
        }
        return "null";
    }

    function toJson(object) {
        return toJsonValue(object);
    }

    function decodeJsonString(input) {
        var output = "";
        var index = 0;
        var character;
        var escapeCode;
        var hex;

        while (index < input.length) {
            character = input.charAt(index);
            if (character !== "\\") {
                output += character;
                index += 1;
                continue;
            }
            if (index + 1 >= input.length) {
                throw new Error("Invalid JSON escape.");
            }
            escapeCode = input.charAt(index + 1);
            if (escapeCode === "\"" || escapeCode === "\\" || escapeCode === "/") {
                output += escapeCode;
                index += 2;
            } else if (escapeCode === "b") {
                output += "\b";
                index += 2;
            } else if (escapeCode === "f") {
                output += "\f";
                index += 2;
            } else if (escapeCode === "n") {
                output += "\n";
                index += 2;
            } else if (escapeCode === "r") {
                output += "\r";
                index += 2;
            } else if (escapeCode === "t") {
                output += "\t";
                index += 2;
            } else if (escapeCode === "u") {
                hex = input.substr(index + 2, 4);
                if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                    throw new Error("Invalid JSON Unicode escape.");
                }
                output += String.fromCharCode(parseInt(hex, 16));
                index += 6;
            } else {
                throw new Error("Unsupported JSON escape.");
            }
        }
        return output;
    }

    function parseJsonText(input) {
        var index = 0;
        var depth = 0;

        if (typeof JSON !== "undefined" && JSON && typeof JSON.parse === "function") {
            return JSON.parse(input);
        }

        function fail() {
            throw new Error("Invalid JSON payload.");
        }

        function skipWhitespace() {
            while (index < input.length && /\s/.test(input.charAt(index))) {
                index += 1;
            }
        }

        function parseString() {
            var start;
            var escaped = false;
            var character;
            if (input.charAt(index) !== "\"") {
                fail();
            }
            index += 1;
            start = index;
            while (index < input.length) {
                character = input.charAt(index);
                if (character === "\"" && !escaped) {
                    character = input.substring(start, index);
                    index += 1;
                    return decodeJsonString(character);
                }
                if (character === "\\" && !escaped) {
                    escaped = true;
                } else {
                    escaped = false;
                }
                index += 1;
            }
            fail();
        }

        function parseNumber() {
            var remainder = input.substring(index);
            var match = remainder.match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
            var number;
            if (!match) {
                fail();
            }
            index += match[0].length;
            number = Number(match[0]);
            if (!isFinite(number)) {
                fail();
            }
            return number;
        }

        function parseValue() {
            var result;
            var key;
            var character;
            skipWhitespace();
            if (depth > 20) {
                fail();
            }
            character = input.charAt(index);
            if (character === "\"") {
                return parseString();
            }
            if (character === "[") {
                result = [];
                index += 1;
                depth += 1;
                skipWhitespace();
                if (input.charAt(index) === "]") {
                    index += 1;
                    depth -= 1;
                    return result;
                }
                while (index < input.length) {
                    result.push(parseValue());
                    skipWhitespace();
                    if (input.charAt(index) === "]") {
                        index += 1;
                        depth -= 1;
                        return result;
                    }
                    if (input.charAt(index) !== ",") {
                        fail();
                    }
                    index += 1;
                }
                fail();
            }
            if (character === "{") {
                result = {};
                index += 1;
                depth += 1;
                skipWhitespace();
                if (input.charAt(index) === "}") {
                    index += 1;
                    depth -= 1;
                    return result;
                }
                while (index < input.length) {
                    skipWhitespace();
                    key = parseString();
                    skipWhitespace();
                    if (input.charAt(index) !== ":") {
                        fail();
                    }
                    index += 1;
                    result[key] = parseValue();
                    skipWhitespace();
                    if (input.charAt(index) === "}") {
                        index += 1;
                        depth -= 1;
                        return result;
                    }
                    if (input.charAt(index) !== ",") {
                        fail();
                    }
                    index += 1;
                }
                fail();
            }
            if (input.substring(index, index + 4) === "true") {
                index += 4;
                return true;
            }
            if (input.substring(index, index + 5) === "false") {
                index += 5;
                return false;
            }
            if (input.substring(index, index + 4) === "null") {
                index += 4;
                return null;
            }
            return parseNumber();
        }

        var parsed = parseValue();
        skipWhitespace();
        if (index !== input.length) {
            fail();
        }
        return parsed;
    }

    function parsePayload(payloadJson) {
        var payload;
        if (typeof payloadJson !== "string" || payloadJson.length > 32768) {
            throw new Error("Payload must be a JSON string.");
        }
        payload = parseJsonText(payloadJson);
        if (!payload || typeof payload.path !== "string" || !payload.path.length) {
            throw new Error("A media path is required.");
        }
        return payload;
    }

    function normalizePathForComparison(value) {
        var normalized = String(value || "").replace(/\\/g, "/");
        while (normalized.length > 1 && normalized.charAt(normalized.length - 1) === "/" && !/^[A-Za-z]:\/$/.test(normalized)) {
            normalized = normalized.substring(0, normalized.length - 1);
        }
        if (Folder.fs === "Windows") {
            normalized = normalized.toLowerCase();
        }
        return normalized;
    }

    function pathIsInsideRoot(mediaPath, rootPath) {
        var candidate = normalizePathForComparison(mediaPath);
        var root = normalizePathForComparison(rootPath);
        if (!candidate || !root || candidate === root) {
            return false;
        }
        if (root === "/") {
            return candidate.charAt(0) === "/";
        }
        return candidate.indexOf(root + "/") === 0;
    }

    function parseRootsPayload(payloadJson) {
        var payload;
        var normalized = [];
        var seen = {};
        var root;
        var captureRoot;
        var captureRoots;
        var key;
        var i;
        if (typeof payloadJson !== "string" || payloadJson.length > 262144) {
            throw makeError("INVALID_PAYLOAD", "Project packaging payload is too large or invalid.");
        }
        payload = parseJsonText(payloadJson);
        if (!payload || !isArrayValue(payload.roots) || payload.roots.length > 128) {
            throw makeError("INVALID_ROOTS", "Configured media roots are required.");
        }
        for (i = 0; i < payload.roots.length; i += 1) {
            root = payload.roots[i];
            if (!root || typeof root.path !== "string" || !isAbsolutePath(root.path) || root.path.indexOf(String.fromCharCode(0)) !== -1) {
                continue;
            }
            key = normalizePathForComparison(root.path);
            if (!seen["$" + key]) {
                seen["$" + key] = true;
                normalized.push({
                    id: typeof root.id === "string" && root.id ? root.id : "root-" + (i + 1),
                    path: root.path,
                    label: typeof root.label === "string" ? root.label : ""
                });
            }
        }
        /* Screenshots generated by the panel live outside the media roots.
           The panel must opt them in explicitly; we never scan this folder. */
        captureRoots = isArrayValue(payload.captureRoots) ? payload.captureRoots : [];
        if (captureRoots.length > 16) {
            throw makeError("INVALID_ROOTS", "Too many plugin capture roots were supplied.");
        }
        for (i = 0; i < captureRoots.length; i += 1) {
            captureRoot = captureRoots[i];
            if (typeof captureRoot === "string") {
                captureRoot = { path: captureRoot };
            }
            if (!captureRoot || typeof captureRoot.path !== "string" || !isAbsolutePath(captureRoot.path) || captureRoot.path.indexOf(String.fromCharCode(0)) !== -1) {
                continue;
            }
            key = normalizePathForComparison(captureRoot.path);
            if (!seen["$" + key]) {
                seen["$" + key] = true;
                normalized.push({
                    id: typeof captureRoot.id === "string" && captureRoot.id ? captureRoot.id : "plugin-capture-" + (i + 1),
                    path: captureRoot.path,
                    label: typeof captureRoot.label === "string" && captureRoot.label ? captureRoot.label : "Plugin screenshots",
                    pluginGenerated: true
                });
            }
        }
        if (!normalized.length) {
            throw makeError("INVALID_ROOTS", "At least one valid absolute media root is required.");
        }
        return { roots: normalized };
    }

    function isAbsolutePath(value) {
        return value.charAt(0) === "/" || /^[A-Za-z]:[\\\/]/.test(value) || /^(\\\\|\/\/)[^\\\/]+[\\\/][^\\\/]+/.test(value);
    }

    function requireMediaFile(pathValue) {
        var file;
        if (!isAbsolutePath(pathValue) || pathValue.indexOf(String.fromCharCode(0)) !== -1) {
            throw makeError("INVALID_PATH", "An absolute media path is required.");
        }
        file = new File(pathValue);
        if (!file.exists) {
            throw makeError("FILE_NOT_FOUND", "The media file is unavailable.");
        }
        return file;
    }

    function makeError(code, message) {
        var error = new Error(message);
        error.seekCode = code;
        return error;
    }

    function hostName() {
        var name = "";
        try {
            name = String(BridgeTalk.appName).toLowerCase();
        } catch (ignoreBridgeTalkError) {}
        if (name.indexOf("premiere") !== -1) {
            return "PPRO";
        }
        if (name.indexOf("aftereffects") !== -1 || name.indexOf("after effects") !== -1) {
            return "AEFT";
        }
        try {
            name = String(app.name).toLowerCase();
        } catch (ignoreAppNameError) {}
        return name.indexOf("premiere") !== -1 ? "PPRO" : "AEFT";
    }

    function samePath(first, second) {
        var firstPath = String(first || "").replace(/\\/g, "/");
        var secondPath = String(second || "").replace(/\\/g, "/");
        if (Folder.fs === "Windows") {
            firstPath = firstPath.toLowerCase();
            secondPath = secondPath.toLowerCase();
        }
        if (firstPath === secondPath) {
            return true;
        }
        try {
            return new File(first).absoluteURI === new File(second).absoluteURI;
        } catch (ignoreUriError) {
            return false;
        }
    }

    function pproIsBin(item) {
        if (!item) {
            return false;
        }
        try {
            if (typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN) {
                return true;
            }
        } catch (ignoreEnumError) {}
        try {
            return item.type === 2 || String(item.type).toUpperCase() === "BIN";
        } catch (ignoreTypeError) {
            return false;
        }
    }

    function pproFindRootBin(project) {
        var children = project.rootItem.children;
        var count = children ? children.numItems : 0;
        var item;
        var i;
        for (i = 0; i < count; i += 1) {
            item = children[i];
            if (pproIsBin(item) && (item.name === FOLDER_NAME || LEGACY_FOLDER_NAMES[item.name])) {
                if (item.name !== FOLDER_NAME) {
                    try { item.name = FOLDER_NAME; } catch (ignoreLegacyRenameError) {}
                }
                return item;
            }
        }
        return null;
    }

    function pproEnsureBin(project) {
        var bin = pproFindRootBin(project);
        if (!bin) {
            project.rootItem.createBin(FOLDER_NAME);
            bin = pproFindRootBin(project);
        }
        if (!bin) {
            throw makeError("BIN_CREATE_FAILED", "Premiere could not create the LK‘s File Bridge bin.");
        }
        return bin;
    }

    function pproFindByPath(rootItem, mediaPath) {
        var stack = [rootItem];
        var current;
        var children;
        var count;
        var child;
        var candidatePath;
        var i;

        try {
            var fastMatches = rootItem.findItemsMatchingMediaPath(mediaPath, 1);
            if (fastMatches && fastMatches.numItems > 0) {
                return fastMatches[0];
            }
        } catch (ignoreFastFindError) {}

        while (stack.length) {
            current = stack.pop();
            children = current.children;
            count = children ? children.numItems : 0;
            for (i = 0; i < count; i += 1) {
                child = children[i];
                if (pproIsBin(child)) {
                    stack.push(child);
                } else if (child) {
                    try {
                        candidatePath = child.getMediaPath();
                        if (candidatePath && samePath(candidatePath, mediaPath)) {
                            return child;
                        }
                    } catch (ignoreMediaPathError) {}
                }
            }
        }
        return null;
    }

    function pproEnsureImported(project, mediaFile, directToProject) {
        var item = pproFindByPath(project.rootItem, mediaFile.fsName);
        var bin;
        var destination;
        var importResult;
        if (item) {
            return { item: item, imported: false };
        }
        destination = directToProject ? project.rootItem : pproEnsureBin(project);
        importResult = project.importFiles([mediaFile.fsName], 1, destination, 0);
        item = pproFindByPath(destination, mediaFile.fsName) || pproFindByPath(project.rootItem, mediaFile.fsName);
        if (importResult === false || !item) {
            throw makeError("IMPORT_FAILED", "Premiere could not import this file.");
        }
        return { item: item, imported: true };
    }

    function pproImport(payload, placeAtPlayhead) {
        var project = app.project;
        var sequence;
        var mediaFile;
        var imported;
        var insertResult;
        var insertTime;
        var videoTrackIndex = 0;
        var audioTrackIndex = 0;

        if (!project || !project.rootItem) {
            throw makeError("NO_PROJECT", "Open or create a Premiere project first.");
        }
        if (placeAtPlayhead) {
            sequence = project.activeSequence;
            if (!sequence) {
                throw makeError("NO_ACTIVE_SEQUENCE", "Open a Premiere sequence first.");
            }
            if (sequence.videoTracks.numTracks < 1 && sequence.audioTracks.numTracks < 1) {
                throw makeError("NO_TRACKS", "The active sequence has no usable tracks.");
            }
        }
        mediaFile = requireMediaFile(payload.path);
        /* Screenshots are ordinary PNG files and should appear directly in
           the project root rather than inside the bridge bin. The explicit
           flag is preferred; the filename check keeps older panel builds
           compatible with the new capture naming convention. */
        imported = pproEnsureImported(project, mediaFile, payload.directImport === true || /_Screenshot_\d{8}-\d{4}(?:-\d+)?\.png$/i.test(String(mediaFile.name || "")));

        if (placeAtPlayhead) {
            insertTime = sequence.getPlayerPosition();
            if (payload.position === "start") {
                insertTime = new Time();
                insertTime.ticks = "0";
            } else if (payload.position === "end") {
                insertTime = new Time();
                insertTime.ticks = String(sequence.end || "0");
            }
            if (sequence.videoTracks.numTracks < 1) {
                insertResult = sequence.audioTracks[0].insertClip(imported.item, insertTime.ticks);
            } else if (sequence.audioTracks.numTracks < 1) {
                insertResult = sequence.videoTracks[0].insertClip(imported.item, insertTime.ticks);
            } else {
                insertResult = sequence.insertClip(imported.item, insertTime, videoTrackIndex, audioTrackIndex);
            }
            if (insertResult === false || insertResult === 0) {
                throw makeError("INSERT_FAILED", "Premiere could not insert the media at the playhead.");
            }
        }

        return {
            ok: true,
            code: "OK",
            itemName: String(imported.item.name || mediaFile.name),
            imported: imported.imported,
            placed: placeAtPlayhead,
            path: mediaFile.fsName
        };
    }

    function pproCollectionCount(collection, preferredProperty) {
        var count = 0;
        if (!collection) {
            return 0;
        }
        try {
            count = Number(collection[preferredProperty]);
            if (isFinite(count) && count >= 0) {
                return Math.floor(count);
            }
        } catch (ignorePreferredCountError) {}
        try {
            count = Number(collection.length);
            if (isFinite(count) && count >= 0) {
                return Math.floor(count);
            }
        } catch (ignoreLengthError) {}
        return 0;
    }

    function pproCollectionItem(collection, index) {
        var item = null;
        try {
            item = collection[index];
        } catch (ignoreIndexError) {}
        if (!item) {
            try {
                if (typeof collection.getItemAt === "function") {
                    item = collection.getItemAt(index);
                }
            } catch (ignoreGetItemError) {}
        }
        return item;
    }

    function pproRootForMediaPath(mediaPath, roots) {
        var match = null;
        var matchLength = -1;
        var length;
        var i;
        for (i = 0; i < roots.length; i += 1) {
            if (pathIsInsideRoot(mediaPath, roots[i].path)) {
                length = normalizePathForComparison(roots[i].path).length;
                if (length > matchLength) {
                    match = roots[i];
                    matchLength = length;
                }
            }
        }
        return match;
    }

    function pproProjectItemOffline(projectItem) {
        try {
            if (typeof projectItem.isOffline === "function") {
                return projectItem.isOffline() === true;
            }
            return projectItem.isOffline === true;
        } catch (ignoreOfflineError) {
            return false;
        }
    }

    function appendUnique(values, value) {
        var i;
        for (i = 0; i < values.length; i += 1) {
            if (values[i] === value) {
                return;
            }
        }
        values.push(value);
    }

    function pproRecordTrackItems(sequence, sequenceName, tracks, mediaByPath, media, roots, kind, counters) {
        var trackCount = pproCollectionCount(tracks, "numTracks");
        var clipCount;
        var track;
        var clip;
        var projectItem;
        var mediaPath;
        var normalizedPath;
        var key;
        var root;
        var entry;
        var offline;
        var trackIndex;
        var clipIndex;

        for (trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
            track = pproCollectionItem(tracks, trackIndex);
            if (!track || !track.clips) {
                continue;
            }
            clipCount = pproCollectionCount(track.clips, "numItems");
            for (clipIndex = 0; clipIndex < clipCount; clipIndex += 1) {
                clip = pproCollectionItem(track.clips, clipIndex);
                counters.trackItems += 1;
                projectItem = null;
                try {
                    projectItem = clip.projectItem;
                } catch (ignoreProjectItemError) {}
                if (!projectItem) {
                    counters.withoutMediaPath += 1;
                    continue;
                }
                mediaPath = "";
                try {
                    if (typeof projectItem.getMediaPath === "function") {
                        mediaPath = String(projectItem.getMediaPath() || "");
                    }
                } catch (ignoreMediaPathError) {}
                if (!mediaPath || !isAbsolutePath(mediaPath)) {
                    counters.withoutMediaPath += 1;
                    continue;
                }
                try {
                    mediaPath = new File(mediaPath).fsName || mediaPath;
                } catch (ignorePathNormalizeError) {}
                root = pproRootForMediaPath(mediaPath, roots);
                if (!root) {
                    counters.outOfScope += 1;
                    continue;
                }
                normalizedPath = normalizePathForComparison(mediaPath);
                key = "$" + normalizedPath;
                offline = pproProjectItemOffline(projectItem);
                entry = mediaByPath[key];
                if (!entry) {
                    entry = {
                        path: mediaPath,
                        offline: offline,
                        rootId: root.id,
                        rootPath: root.path,
                        rootLabel: root.label,
                        pluginGenerated: root.pluginGenerated === true,
                        sourceKind: root.pluginGenerated === true ? "screenshot" : "media",
                        clipCount: 0,
                        videoUses: 0,
                        audioUses: 0,
                        sequences: []
                    };
                    mediaByPath[key] = entry;
                    media.push(entry);
                } else {
                    entry.offline = entry.offline && offline;
                }
                entry.clipCount += 1;
                if (kind === "video") {
                    entry.videoUses += 1;
                } else {
                    entry.audioUses += 1;
                }
                appendUnique(entry.sequences, sequenceName);
            }
        }
    }

    function pproListUsedMedia(roots) {
        var project = app.project;
        var sequences;
        var sequenceCount;
        var sequence;
        var sequenceName;
        var mediaByPath = {};
        var media = [];
        var counters = { trackItems: 0, withoutMediaPath: 0, outOfScope: 0 };
        var offlineCount = 0;
        var i;

        if (!project || !project.rootItem) {
            throw makeError("NO_PROJECT", "Open or create a Premiere project first.");
        }
        sequences = project.sequences;
        sequenceCount = pproCollectionCount(sequences, "numSequences");
        for (i = 0; i < sequenceCount; i += 1) {
            sequence = pproCollectionItem(sequences, i);
            if (!sequence) {
                continue;
            }
            try {
                sequenceName = String(sequence.name || "Sequence " + (i + 1));
            } catch (ignoreSequenceNameError) {
                sequenceName = "Sequence " + (i + 1);
            }
            pproRecordTrackItems(sequence, sequenceName, sequence.videoTracks, mediaByPath, media, roots, "video", counters);
            pproRecordTrackItems(sequence, sequenceName, sequence.audioTracks, mediaByPath, media, roots, "audio", counters);
        }
        media.sort(function (first, second) {
            var firstPath = normalizePathForComparison(first.path);
            var secondPath = normalizePathForComparison(second.path);
            return firstPath < secondPath ? -1 : (firstPath > secondPath ? 1 : 0);
        });
        for (i = 0; i < media.length; i += 1) {
            if (media[i].offline) {
                offlineCount += 1;
            }
        }
        return {
            ok: true,
            code: "OK",
            projectName: String(project.name || "Premiere Project"),
            sequencesScanned: sequenceCount,
            trackItemsScanned: counters.trackItems,
            mediaCount: media.length,
            offlineCount: offlineCount,
            outOfScopeClipCount: counters.outOfScope,
            noMediaPathClipCount: counters.withoutMediaPath,
            media: media
        };
    }

    function aeFindFolder(project) {
        var item;
        var i;
        for (i = 1; i <= project.rootFolder.numItems; i += 1) {
            item = project.rootFolder.item(i);
            if (item instanceof FolderItem && (item.name === FOLDER_NAME || LEGACY_FOLDER_NAMES[item.name])) {
                if (item.name !== FOLDER_NAME) {
                    try { item.name = FOLDER_NAME; } catch (ignoreLegacyRenameError) {}
                }
                return item;
            }
        }
        return null;
    }

    function aeEnsureFolder(project) {
        return aeFindFolder(project) || project.items.addFolder(FOLDER_NAME);
    }

    function aeFindByPath(project, mediaFile) {
        var item;
        var candidateFile;
        var i;
        for (i = 1; i <= project.numItems; i += 1) {
            item = project.item(i);
            if (item instanceof FootageItem) {
                candidateFile = null;
                try {
                    candidateFile = item.file;
                } catch (ignoreFileError) {}
                if (candidateFile && samePath(candidateFile.fsName, mediaFile.fsName)) {
                    return item;
                }
            }
        }
        return null;
    }

    function aeImport(payload, addToComp) {
        var project = app.project;
        var comp;
        var mediaFile;
        var footage;
        var imported = false;
        var layer;
        var undoOpen = false;

        if (!project) {
            throw makeError("NO_PROJECT", "Open or create an After Effects project first.");
        }
        if (addToComp) {
            comp = project.activeItem;
            if (!(comp instanceof CompItem)) {
                throw makeError("NO_ACTIVE_COMP", "Open an After Effects composition first.");
            }
        }
        mediaFile = requireMediaFile(payload.path);
        footage = aeFindByPath(project, mediaFile);

        try {
            app.beginUndoGroup(addToComp ? "LK‘s File Bridge: Add to Composition" : "LK‘s File Bridge: Import Media");
            undoOpen = true;
            if (!footage) {
                footage = project.importFile(new ImportOptions(mediaFile));
                footage.parentFolder = aeEnsureFolder(project);
                imported = true;
            }
            if (addToComp) {
                layer = comp.layers.add(footage);
                layer.startTime = comp.time;
            }
        } catch (operationError) {
            throw makeError(addToComp ? "ADD_TO_COMP_FAILED" : "IMPORT_FAILED", operationError.message || String(operationError));
        } finally {
            if (undoOpen) {
                app.endUndoGroup();
            }
        }

        return {
            ok: true,
            code: "OK",
            itemName: footage.name,
            imported: imported,
            placed: addToComp,
            path: mediaFile.fsName
        };
    }

    function invoke(payloadJson, action) {
        var payload;
        var result;
        try {
            payload = parsePayload(payloadJson);
            if (hostName() === "PPRO") {
                result = pproImport(payload, action === "place");
            } else {
                result = aeImport(payload, action === "place");
            }
            return toJson(result);
        } catch (error) {
            return toJson({
                ok: false,
                code: error.seekCode || "INTERNAL_ERROR",
                message: error.message || String(error)
            });
        }
    }

    ns.version = "0.6.1";
    ns.importMedia = function (payloadJson) {
        return invoke(payloadJson, "import");
    };
    ns.importMediaToSequence = function (payloadJson) {
        return invoke(payloadJson, "place");
    };
    ns.importMediaToComp = function (payloadJson) {
        return invoke(payloadJson, "place");
    };
    ns.listUsedPremiereMedia = function (payloadJson) {
        var payload;
        try {
            if (hostName() !== "PPRO") {
                throw makeError("UNSUPPORTED_HOST", "Project media packaging is available in Premiere Pro only.");
            }
            payload = parseRootsPayload(payloadJson);
            return toJson(pproListUsedMedia(payload.roots));
        } catch (error) {
            return toJson({
                ok: false,
                code: error.seekCode || "INTERNAL_ERROR",
                message: error.message || String(error)
            });
        }
    };
}($.global.SeekBridge));
