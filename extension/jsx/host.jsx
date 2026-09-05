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

    function toJson(object) {
        var parts = [];
        var key;
        var value;
        var type;

        for (key in object) {
            if (!object.hasOwnProperty || object.hasOwnProperty(key)) {
                value = object[key];
                type = typeof value;
                if (type === "string") {
                    parts.push(quoteJson(key) + ":" + quoteJson(value));
                } else if (type === "number") {
                    parts.push(quoteJson(key) + ":" + (isFinite(value) ? String(value) : "null"));
                } else if (type === "boolean") {
                    parts.push(quoteJson(key) + ":" + (value ? "true" : "false"));
                } else if (value === null) {
                    parts.push(quoteJson(key) + ":null");
                }
            }
        }
        return "{" + parts.join(",") + "}";
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

    function parsePayload(payloadJson) {
        var payload;
        var match;
        if (typeof payloadJson !== "string" || payloadJson.length > 32768) {
            throw new Error("Payload must be a JSON string.");
        }
        if (typeof JSON !== "undefined" && JSON && typeof JSON.parse === "function") {
            payload = JSON.parse(payloadJson);
        } else {
            match = payloadJson.match(/^\s*\{\s*"path"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}\s*$/);
            if (!match) {
                throw new Error("Payload must contain a path string.");
            }
            payload = { path: decodeJsonString(match[1]) };
        }
        if (!payload || typeof payload.path !== "string" || !payload.path.length) {
            throw new Error("A media path is required.");
        }
        return payload;
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

    function pproEnsureImported(project, mediaFile) {
        var item = pproFindByPath(project.rootItem, mediaFile.fsName);
        var bin;
        var importResult;
        if (item) {
            return { item: item, imported: false };
        }
        bin = pproEnsureBin(project);
        importResult = project.importFiles([mediaFile.fsName], 1, bin, 0);
        item = pproFindByPath(bin, mediaFile.fsName) || pproFindByPath(project.rootItem, mediaFile.fsName);
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
        imported = pproEnsureImported(project, mediaFile);

        if (placeAtPlayhead) {
            if (sequence.videoTracks.numTracks < 1) {
                insertResult = sequence.audioTracks[0].insertClip(imported.item, sequence.getPlayerPosition().ticks);
            } else if (sequence.audioTracks.numTracks < 1) {
                insertResult = sequence.videoTracks[0].insertClip(imported.item, sequence.getPlayerPosition().ticks);
            } else {
                insertResult = sequence.insertClip(imported.item, sequence.getPlayerPosition(), videoTrackIndex, audioTrackIndex);
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

    ns.version = "0.4.0";
    ns.importMedia = function (payloadJson) {
        return invoke(payloadJson, "import");
    };
    ns.importMediaToSequence = function (payloadJson) {
        return invoke(payloadJson, "place");
    };
    ns.importMediaToComp = function (payloadJson) {
        return invoke(payloadJson, "place");
    };
}($.global.SeekBridge));
