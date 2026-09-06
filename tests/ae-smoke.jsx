/* Run only with no open AE project. An existing project is never closed. */
(function () {
    var TEST_PROJECT_MARKER = "LKFB_AE_SMOKE_" + new Date().getTime();
    var testProject = null;
    var marker = null;
    var scriptFile = new File($.fileName);
    var hostFile = new File(scriptFile.parent.parent.fsName + "/extension/jsx/host.jsx");
    var resultFile = new File(Folder.temp.fsName + "/" + TEST_PROJECT_MARKER + ".json");
    var output;
    var projectFile;
    var comp;
    try {
        if (app.project) { throw new Error("SMOKE_REFUSED: close your current AE project manually before running this isolated test."); }
        app.newProject();
        testProject = app.project;
        if (!testProject) { throw new Error("SMOKE_PROJECT_FAILED"); }
        marker = testProject.items.addFolder(TEST_PROJECT_MARKER);
        marker.comment = TEST_PROJECT_MARKER;
        $.evalFile(hostFile);
        comp = testProject.items.addComp(TEST_PROJECT_MARKER, 320, 180, 1, 1, 25);
        comp.parentFolder = marker;
        output = "{\"ok\":true,\"marker\":" + quote(TEST_PROJECT_MARKER) + ",\"hostVersion\":" + quote($.global.SeekBridge.version) + ",\"numItems\":" + testProject.numItems + "}";
    } catch (error) {
        output = "{\"ok\":false,\"harnessError\":" + quote(error.message || String(error)) + "}";
    } finally {
        /* Save even the test project before closing; identity must still match. */
        if (testProject && app.project === testProject && marker && marker.comment === TEST_PROJECT_MARKER) {
            try {
                projectFile = new File(Folder.temp.fsName + "/" + TEST_PROJECT_MARKER + ".aep");
                testProject.save(projectFile);
                if (testProject.file && testProject.file.fsName === projectFile.fsName) { testProject.close(CloseOptions.SAVE_CHANGES); }
            } catch (cleanupError) {
                output = "{\"ok\":false,\"harnessError\":" + quote(cleanupError.message || String(cleanupError)) + ",\"testProjectLeftOpen\":true}";
            }
        }
        resultFile.encoding = "UTF-8";
        if (resultFile.open("w")) { resultFile.write(output); resultFile.close(); }
    }

    function quote(value) {
        return "\"" + String(value).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n") + "\"";
    }
}());
