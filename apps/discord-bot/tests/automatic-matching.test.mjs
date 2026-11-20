import test from "node:test";
import assert from "node:assert/strict";
import { recognizeIndependentRoster } from "../src/recognition.mjs";
const recognize = (text, names, extra = {}) => recognizeIndependentRoster([
  {text, confidence:96, engine:"gpt", kind:"raid-cell", slotKey:"one", unbiased:true, ...extra}
], names.map((nickname,i)=>({id:String(i),nickname})));
test("clear isolated similar names and long unique prefixes auto-match without losing image text",()=>{
  for(const [raw,nickname,extra] of [["Potatoo","Potatooo",{}],["Cartell","Cartelll",{}],["Сертрал…","Сертралин",{clipped:true}]]) {
    const r=recognize(raw,[nickname],extra);
    assert.equal(r.members[0]?.nickname,nickname);
    assert.equal(r.unresolved.length,0);
    assert.equal(r.readings[0].visible,raw.normalize("NFKC"));
    assert.equal(r.readings[0].origin,"automatic-similar");
    assert.equal(r.readings[0].status,"автосопоставлено");
  }
});
test("ambiguous candidates, poor readings and short prefixes stay unresolved",()=>{
  for(const [raw,names,extra] of [
    ["Cartel",["Cartell","Cartelll"],{}],
    ["Сертрол_",["Сертрал","Сертралин"],{uncertain:true}],
    ["Cartell",["Cartelll"],{confidence:60}],
    ["Cartell",["Cartelll"],{uncertain:true}],
    ["Cartell",["Cartelll"],{unbiased:false}],
    ["Cart…",["Cartelll"],{clipped:true}],
    ["Cartell",["Cartelll"],{engine:"tesseract"}],
  ]) { const r=recognize(raw,names,extra);assert.equal(r.members.length,0);assert.equal(r.unresolved.length,1); }
});
