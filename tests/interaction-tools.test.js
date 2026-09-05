const assert = require("node:assert/strict");
const test = require("node:test");
const tools = require("../extension/js/interaction-tools.js");

test("writes indexed Premiere CEP drag payloads for every selected file", () => {
  const values = {};
  const transfer = { effectAllowed: "", setData: (type, value) => { values[type] = value; } };
  const count = tools.writeAdobeDragData(transfer, ["/Volumes/A/a.mov", "/Volumes/A/b.wav"], (value) => "file://" + value);
  assert.equal(count, 2);
  assert.equal(transfer.effectAllowed, "copyMove");
  assert.equal(values["com.adobe.cep.dnd.file.0"], "/Volumes/A/a.mov");
  assert.equal(values["com.adobe.cep.dnd.file.1"], "/Volumes/A/b.wav");
  assert.match(values["text/uri-list"], /a\.mov/);
});

test("viewer drag keeps original video but Alt chooses the prepared audio proxy", () => {
  const video = { type: "video", path: "/Volumes/A/source.mov" };
  assert.deepEqual(tools.viewerDragPath(video, false, "/cache/audio.m4a"), { ok: true, path: video.path, audioOnly: false });
  assert.deepEqual(tools.viewerDragPath(video, true, "/cache/audio.m4a"), { ok: true, path: "/cache/audio.m4a", audioOnly: true });
  assert.equal(tools.viewerDragPath(video, true, "").reason, "AUDIO_PROXY_PENDING");
});
