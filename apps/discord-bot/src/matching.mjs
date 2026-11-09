export const norm=value=>String(value).normalize('NFKC').toLowerCase().replaceAll('ё','е').replace(/[^\p{L}\p{N}]/gu,'');
function index(rows){const map=new Map();for(const r of rows){const k=norm(r.name??r.nickname);map.set(k,[...(map.get(k)??[]),r]);}return map;}
function distance(a,b){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old;}}return row[b.length];}
export function suggestion(value,rows){const key=norm(value);if(key.length<4)return null;const matches=rows.map(r=>({r,d:distance(key,norm(r.name??r.nickname))})).filter(x=>x.d<=2&&x.d/key.length<=.25).sort((a,b)=>a.d-b.d);return matches[0]&&(!matches[1]||matches[0].d<matches[1].d)?matches[0].r:null;}
export function rosterText(text,members){const by=index(members),selected=new Map(),guests=[],unresolved=[];for(const line of text.split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean)){
 if(line.startsWith('?')){unresolved.push(line.replace(/^\?\s*/,''));continue;}
 if(/^гость\s*:/i.test(line)){const name=line.replace(/^гость\s*:/i,'').trim();if(name.length&&name.length<=80)guests.push(name);else unresolved.push(line);continue;}
 const exact=by.get(norm(line));if(exact?.length===1)selected.set(exact[0].id,exact[0]);else unresolved.push(line);
 }return {members:[...selected.values()],guests:[...new Set(guests)],unresolved};}
export function recognizeRoster(words,members){const by=index(members),selected=new Map(),uncertain=new Set(),ignored=new Set(['рейд','группа','уровень','лидер','помощник','здоровье','мана','маг','хил','танк','лучник','милик','командир','рейда','состав','опции','настройки','закрыть']);
 for(const word of words){const raw=word.text.trim();if(!/^[\p{L}\p{N}_-]{2,32}$/u.test(raw)||!/[\p{L}]/u.test(raw)||ignored.has(norm(raw))||word.confidence<35)continue;const exact=by.get(norm(raw));if(exact?.length===1&&word.confidence>=65)selected.set(exact[0].id,exact[0]);else uncertain.add(raw);}
 // OCR words can split a nickname containing spaces; only exact unique whole-line matches qualify.
 const lines=new Map();for(const w of words){const key=w.line;lines.set(key,[...(lines.get(key)??[]),w]);}for(const line of lines.values()){const text=line.map(w=>w.text).join(' '),exact=by.get(norm(text));if(exact?.length===1&&line.every(w=>w.confidence>=65)){selected.set(exact[0].id,exact[0]);for(const w of line)uncertain.delete(w.text.trim());}}
 for(const m of selected.values())for(const u of uncertain)if(norm(u)===norm(m.nickname))uncertain.delete(u);
 return {members:[...selected.values()],guests:[],unresolved:[...uncertain].slice(0,150)};
}
export function lootText(text,drops){const by=index(drops),selected=new Map(),unresolved=[];for(let raw of text.split('\n').map(s=>s.trim()).filter(Boolean)){
 if(raw.startsWith('?')){unresolved.push(raw.replace(/^\?\s*/,''));continue;}
 if(/^(нет|без дропа|дроп|список дропа|монеты?|золото)[:.!]?$/i.test(raw))continue;
 raw=raw.replace(/^[•*-]\s*/,'').replace(/^получено\s*:\s*/i,'').replace(/^\[(.*?)\](?=\s*[xх×]|$)/u,'$1');let name=raw,quantity=1;let exact=by.get(norm(raw));
 if(exact?.length!==1){const tail=raw.match(/^(.*?)\s*[xх×]\s*(\d+)\s*$/iu),head=raw.match(/^(\d+)\s*[xх×]\s*(.+)$/iu),tab=raw.match(/^(.*?)\t+(\d+)$/u);if(tail){name=tail[1].trim().replace(/^\[(.*)\]$/u,'$1');quantity=Number(tail[2]);}else if(head){quantity=Number(head[1]);name=head[2];}else if(tab){name=tab[1];quantity=Number(tab[2]);}exact=by.get(norm(name));}
 if(exact?.length!==1||!Number.isSafeInteger(quantity)||quantity<1||quantity>1_000_000){unresolved.push(raw);continue;}const item=exact[0],old=selected.get(item.id);const total=(old?.quantity??0)+quantity;if(total>1_000_000){unresolved.push(raw);continue;}selected.set(item.id,{...item,quantity:total});
 }return {items:[...selected.values()],unresolved};}
export function reviewReady(draft){return Boolean(draft.activity&&draft.mode&&draft.source&&draft.analyzed&&draft.roster.members.length&&!draft.roster.unresolved.length&&!draft.loot.unresolved.length);}
