import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDxf,makeRec,buildScene} from '../app/renderer/core/engine.js';

const rec=(type,pairs)=>makeRec(type,pairs);
function documentWithPolyline({closed=false,terminated=true,explicitOwner=true}={}) {
  const doc=parseDxf('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n');
  doc.blockRecords.set('PAPER','*Paper_Space2');
  const owner=explicitOwner?[[330,'PAPER']]:[];
  doc.entities.push(rec('POLYLINE',[[5,'PL'],...owner,[67,1],[70,closed?1:0]]));
  for(const [x,y] of [[100,200],[110,200],[110,210],[100,210]]) {
    doc.entities.push(rec('VERTEX',[[330,'PL'],[10,x],[20,y]]));
  }
  if(terminated) doc.entities.push(rec('SEQEND',[[330,'PL']]));
  doc.entities.push(rec('LINE',[...owner,[67,1],[10,120],[20,200],[11,125],[21,200]]));
  doc.entities.push(rec('LINE',[[10,0],[20,0],[11,5],[21,0]]));
  return doc;
}

test('paper POLYLINE keeps ownerless child vertices and SEQEND in the same layout',()=>{
  const scene=buildScene(documentWithPolyline({closed:true}));
  const paper=scene.spaces.find(s=>s.key==='*PAPER_SPACE2');
  const model=scene.spaces.find(s=>s.key==='*MODEL_SPACE');
  assert.ok(paper);
  assert.equal(paper.segs.length/4,5,'four closed edges plus the following line');
  assert.deepEqual(Array.from(paper.segs.slice(0,4)),[100,200,110,200]);
  assert.equal(paper.regions.length,1);
  assert.equal(model.segs.length/4,1,'paper vertices must not leak into model space');
});

test('paper POLYLINE without SEQEND stops at the following standalone entity',()=>{
  const scene=buildScene(documentWithPolyline({terminated:false}));
  const paper=scene.spaces.find(s=>s.key==='*PAPER_SPACE2');
  assert.equal(paper.segs.length/4,4,'three open edges plus the following line');
  assert.deepEqual(Array.from(paper.segs.slice(-4)),[120,200,125,200]);
});

test('R12 paper-space flag also carries the complete POLYLINE sequence',()=>{
  const scene=buildScene(documentWithPolyline({explicitOwner:false}));
  const paper=scene.spaces.find(s=>s.key==='*PAPER_SPACE');
  assert.equal(paper.segs.length/4,4);
});
