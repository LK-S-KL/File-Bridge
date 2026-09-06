const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const hostSource = fs.readFileSync(path.join(root, "extension/jsx/host.jsx"), "utf8");
const smokeSource = fs.readFileSync(path.join(__dirname, "ae-smoke.jsx"), "utf8");

test("LUT capability is read-only and unsupported application never modifies selected effects", () => {
  let mutations = 0;
  function File(value) { this.fsName = value; this.exists = true; }
  function Folder() {}
  Folder.fs = "Macintosh";
  const clips = [0, 1].map(() => ({
    isSelected: () => true,
    components: { numItems: 1, 0: { displayName: "Lumetri Color", properties: { numItems: 1, 0: { displayName: "Input LUT", setValue: () => { mutations++; throw new Error("unsupported"); } } } } }
  }));
  clips.numItems = clips.length;
  const qeClip = { addVideoEffect: () => mutations++ };
  const context = {
    $: { global: {} }, File, Folder,
    app: { name: "Adobe Premiere Pro", project: { rootItem: {}, activeSequence: { videoTracks: { numTracks: 1, 0: { clips } } } }, enableQE: () => mutations++ },
    qe: { project: { getActiveSequence: () => ({ getVideoTrackAt: () => ({ getItemAt: () => qeClip }) }), getVideoEffectByName: () => ({}) } },
    BridgeTalk: { appName: "premierepro" }
  };
  vm.createContext(context);
  vm.runInContext(hostSource, context);
  const host = context.$.global.SeekBridge;
  assert.equal(JSON.parse(host.getCapabilities()).lutApplication, false);
  assert.equal(JSON.parse(host.getSelectedVideoCount()).count, 2);
  const result = JSON.parse(host.applyLutToActiveVideo('{"path":"/tmp/look.cube"}'));
  assert.equal(result.ok, false);
  assert.equal(result.code, "LUT_UNSUPPORTED");
  assert.equal(mutations, 0);
});

function runSmoke(existingProject, options = {}) {
  const writes = [];
  const calls = [];
  let testProject;
  function File(value) {
    this.fsName = value;
    this.parent = { parent: { fsName: root } };
    this.open = () => true;
    this.write = value => writes.push(JSON.parse(value));
    this.close = () => {};
  }
  const app = {
    project: existingProject,
    quit: () => { throw new Error("must never quit"); },
    newProject: () => {
      calls.push("create");
      testProject = {
        items: { addFolder: () => ({}), addComp: () => ({}) }, numItems: 2,
        save: file => { calls.push("save"); if (options.saveFails) throw new Error("disk full"); testProject.file = file; },
        close: mode => { calls.push(["close", mode]); app.project = null; }
      };
      app.project = testProject;
    }
  };
  const context = {
    app, File, Folder: { temp: { fsName: "/tmp" } }, CloseOptions: { SAVE_CHANGES: "save" },
    $: { fileName: path.join(__dirname, "ae-smoke.jsx"), global: { SeekBridge: { version: "test" } }, evalFile: () => { if (options.switchProject) app.project = options.switchProject; } }
  };
  vm.runInNewContext(smokeSource, context);
  return { calls, writes, app, testProject };
}

test("AE smoke refuses every existing project without closing or quitting", () => {
  const userProject = { dirty: true, close: () => { throw new Error("user project closed"); } };
  const result = runSmoke(userProject);
  assert.deepEqual(result.calls, []);
  assert.equal(result.app.project, userProject);
  assert.match(result.writes[0].harnessError, /SMOKE_REFUSED/);
});

test("AE smoke saves and closes only its explicitly marked isolated project", () => {
  const result = runSmoke(null);
  assert.deepEqual(result.calls, ["create", "save", ["close", "save"]]);
  assert.equal(result.writes[0].ok, true);
  assert.match(result.writes[0].marker, /^LKFB_AE_SMOKE_/);
});

test("AE smoke leaves a project open on save failure and never closes a replacement project", () => {
  const failed = runSmoke(null, { saveFails: true });
  assert.deepEqual(failed.calls, ["create", "save"]);
  assert.equal(failed.app.project, failed.testProject);
  assert.equal(failed.writes[0].testProjectLeftOpen, true);
  const userProject = {};
  const switched = runSmoke(null, { switchProject: userProject });
  assert.deepEqual(switched.calls, ["create"]);
  assert.equal(switched.app.project, userProject);
});
