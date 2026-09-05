(function () {
    var resultFile = new File("/tmp/rove-ae-smoke.json");
    var hostFile = new File("/Users/lk/Codex/Seek Bridge MVP/extension/jsx/host.jsx");
    var mediaPath = "/Volumes/团队文件-剪辑共享/0813-MIniMax/MiniMax-H3.MP4";
    var payload;
    var importResult;
    var placeResult;
    var comp;
    var output;

    try {
        $.evalFile(hostFile);
        payload = "{\"path\":" + SeekBridgeTestQuote(mediaPath) + "}";
        importResult = SeekBridge.importMedia(payload);
        comp = app.project.items.addComp("Rove Smoke Test", 1920, 1080, 1, 10, 25);
        comp.openInViewer();
        comp.time = 2;
        placeResult = SeekBridge.importMediaToComp(payload);
        output = "{\"importResult\":" + importResult + ",\"placeResult\":" + placeResult + ",\"numItems\":" + app.project.numItems + ",\"numLayers\":" + comp.numLayers + "}";
    } catch (error) {
        output = "{\"harnessError\":" + SeekBridgeTestQuote(error.message || String(error)) + "}";
    }

    if (resultFile.open("w")) {
        resultFile.encoding = "UTF-8";
        resultFile.write(output);
        resultFile.close();
    }

    if (app.project) {
        app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    }
    app.quit();

    function SeekBridgeTestQuote(value) {
        return "\"" + String(value).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n") + "\"";
    }
}());
