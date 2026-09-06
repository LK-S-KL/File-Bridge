const test = require('node:test');
const assert = require('node:assert/strict');
const grid = require('../extension/js/virtual-grid');

test('10,000 results remain addressable while DOM rows stay bounded by viewport', () => {
  const assets = Array.from({length:10000}, (_, i) => ({domId:String(i)}));
  const layout = grid.build([{key:'files',assets}], {columns:4,cardHeight:160,gap:16,padding:16});
  const first = grid.windowRows(layout,0,700,250);
  const last = grid.windowRows(layout,layout.height-700,700,250);
  assert.ok(first.flatMap(x=>x.assets).length < 40);
  assert.ok(last.flatMap(x=>x.assets).some(x=>x.domId==='9999'));
  assert.equal(layout.positions['9999'], layout.rows.at(-1).top);
});

test('folder and file collapse keeps headings and independent section positions', () => {
  const groups = [{key:'folders',assets:[{domId:'folder'}],collapsed:true},{key:'files',assets:[{domId:'file'}]}];
  const layout=grid.build(groups,{columns:2,cardHeight:120,gap:10,padding:10});
  assert.equal(layout.rows.filter(x=>x.heading).length,2);
  assert.equal(layout.positions.folder,undefined);
  assert.equal(layout.positions.file,86);
  assert.equal(grid.windowRows(layout,10000,500,100).length,0);
});
