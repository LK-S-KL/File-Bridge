(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.LKVirtualGrid = api;
}(this, function () {
  "use strict";
  function build(groups, options) {
    var columns = Math.max(1, options.columns || 1);
    var rows = [];
    var positions = Object.create(null);
    var top = options.padding || 0;
    var gap = options.gap || 0;
    groups.forEach(function (group) {
      var i;
      if (!group.assets.length) { return; }
      rows.push({ top: top, height: 28, heading: group.key, count: group.assets.length, assets: [] });
      top += 28 + gap;
      if (group.collapsed) { return; }
      for (i = 0; i < group.assets.length; i += columns) {
        var assets = group.assets.slice(i, i + columns);
        assets.forEach(function (asset) { positions[asset.domId] = top; });
        rows.push({ top: top, height: options.cardHeight, assets: assets, group: group.key });
        top += options.cardHeight + gap;
      }
    });
    return { rows: rows, positions: positions, height: Math.max(0, top - gap + (options.padding || 0)) };
  }
  function windowRows(layout, scrollTop, height, overscan) {
    var start = Math.max(0, scrollTop - overscan);
    var end = scrollTop + height + overscan;
    var rows = layout.rows;
    var low = 0;
    var high = rows.length;
    while (low < high) {
      var middle = Math.floor((low + high) / 2);
      if (rows[middle].top + rows[middle].height < start) { low = middle + 1; }
      else { high = middle; }
    }
    var result = [];
    for (var i = low; i < rows.length && rows[i].top <= end; i += 1) { result.push(rows[i]); }
    return result;
  }
  return { build: build, windowRows: windowRows };
}));
