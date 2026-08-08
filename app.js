/* Albiondle game logic */
const norm=s=>s.toLowerCase().replace(/\s+/g,' ').trim();
const $=id=>document.getElementById(id);
const setEq=(a,b)=>{const A=new Set(a),B=new Set(b);return A.size===B.size&&[...A].every(x=>B.has(x));};
const checkSvg='<svg width="18" height="18" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" fill="none" stroke="var(--portal)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let MAPS=[], ABILITIES=[], MAP_SRC=[], AB_SRC=[], LINES=[], LINE_LOW=[], AB_POOL=[];
const ICON=id=>`https://render.albiononline.com/v1/spell/${id}.png?size=217`;
function initData(maps,abilities){
  MAPS=maps; ABILITIES=abilities;
  MAP_SRC=MAPS.map((m,i)=>({i,n:m.n,low:m.n.toLowerCase(),tag:`T${m.t}·Q${m.q}·${m.b}`}));
  AB_SRC=ABILITIES.map((a,i)=>({i,n:a.n,low:a.n.toLowerCase(),line:a.t==='w'?a.l:null,piece:a.t==='a'?a.p:null,tag:a.t==='w'?a.l:a.p}));
  LINES=[...new Set(ABILITIES.filter(a=>a.t==='w').map(a=>a.l))].sort();
  LINE_LOW=LINES.map(l=>l.toLowerCase());
  AB_POOL=ABILITIES.map((a,i)=>i).filter(i=>ABILITIES[i].tags&&ABILITIES[i].tags.length>0);
}

const TAGS=['Damage','Crowd Control','Mobility','Debuff','Buff','Heal','Cleanse','Purge'];
const DMG=['Physical','Magical'];
const BUFF=['Resistances','Movement Speed','Ability Damage','Autoattack Damage','Damage vs Players/All','Attack Speed','Cast Rate','Cooldown Rate','Shield','HoT','Healing Cast','Healing Received','Max Health','CC Duration','Energy','CC Resistance','Attack Range','Resilience Penetration','Immunity'];
const DEBUFF=['Resistances','Ability Damage','Autoattack Damage','Damage vs Players/All','Attack Speed','Cast Rate','Cooldown Rate','DoT','Healing Cast','Healing Received','Max Health','CC Duration','Energy','CC Resistance','Attack Range','Resilience Penetration'];
const IMM=['Immune to Damage','Immune to Stun','Immune to Root','Immune to Slow','Immune to Silence','Immune to Forced Movement','Immune to Purge','Immune to Debuffs'];
const CC=['Stun','Root','Slow','Silence','Interrupt','Sleep','Forced Movement'];
const CLEANSE=['Stun','Root','Slow','Silence','Debuffs'];
const PURGE=['Buffs','Movement Speed','HoTs','Shields','Invisibility'];
const CT=['Instant','Cast time','Channeled','Toggle'];
const CR=['Self','Targeted','Free aim'];

let score={streak:0,best:0};
try{const s=JSON.parse(localStorage.getItem('albiondle_score')); if(s)score=s;}catch(e){}
function saveScore(){try{localStorage.setItem('albiondle_score',JSON.stringify(score));}catch(e){}
  $('sStreak').textContent=score.streak; $('sBest').textContent=score.best;}
saveScore();

/* ---------- autocomplete (maps) ---------- */
function autocomplete(input, box, source, onEnter){
  let items=[], sel=-1;
  function open(){
    const q=norm(input.value); if(!q){close();return;}
    const a=[],b=[]; for(const it of source){const p=it.low.indexOf(q); if(p===0)a.push(it); else if(p>0)b.push(it);}
    items=[...a,...b].slice(0,8); sel=-1;
    if(!items.length){close();return;}
    box.innerHTML=items.map(it=>`<div>${it.n}<span class="tag">${it.tag}</span></div>`).join('');
    box.classList.add('open');
    [...box.children].forEach((ch,k)=>ch.addEventListener('mousedown',e=>{e.preventDefault();choose(k);}));
  }
  function close(){box.classList.remove('open');items=[];sel=-1;}
  function choose(k){input.value=items[k].n;close();input.focus();}
  function move(d){if(!items.length)return;sel=(sel+d+items.length)%items.length;[...box.children].forEach((c,i)=>c.classList.toggle('sel',i===sel));}
  input.addEventListener('input',open);
  input.addEventListener('keydown',e=>{
    if(box.classList.contains('open')){
      if(e.key==='ArrowDown'){e.preventDefault();move(1);return;}
      if(e.key==='ArrowUp'){e.preventDefault();move(-1);return;}
      if(e.key==='Escape'){close();return;}
      if(e.key==='Tab'&&items.length){e.preventDefault();choose(sel>=0?sel:0);return;}
      if(e.key==='Enter'&&sel>=0){e.preventDefault();choose(sel);return;}
    }
    if(e.key==='Enter'){e.preventDefault();onEnter();}
  });
  input.addEventListener('blur',()=>setTimeout(close,120));
  return {close};
}
/* ---------- autocomplete (abilities, line-aware) ---------- */
function abilityAC(input, box, onEnter){
  let items=[], sel=-1;
  function open(){
    const q=norm(input.value); if(!q){close();return;}
    const linesMatch=LINES.filter((l,k)=>LINE_LOW[k].includes(q));
    let pieceMatch=null;   // typing helmet / armor / boots lists that armor slot's spells
    for(const [kw,lab] of [['helmet','Helmet'],['armor','Armor'],['boots','Boots']]){if(q.length>=3&&kw.startsWith(q)){pieceMatch=lab;break;}}
    const starts=[],contains=[],lineSpells=[],seen=new Set();
    for(const it of AB_SRC){const p=it.low.indexOf(q); if(p===0){starts.push(it);seen.add(it.i);} else if(p>0){contains.push(it);seen.add(it.i);}}
    if(linesMatch.length||pieceMatch){for(const it of AB_SRC){if(seen.has(it.i))continue;
      if((it.line&&linesMatch.includes(it.line))||(pieceMatch&&it.piece===pieceMatch)){lineSpells.push(it);seen.add(it.i);}}}
    items=[...starts,...contains,...lineSpells].sort((x,y)=>x.n.localeCompare(y.n)).slice(0,100); sel=-1;
    if(!items.length){close();return;}
    box.innerHTML=items.map(it=>`<div>${it.n}<span class="tag">${it.tag}</span></div>`).join('');
    box.classList.add('open');
    [...box.children].forEach((ch,k)=>ch.addEventListener('mousedown',e=>{e.preventDefault();choose(k);}));
  }
  function close(){box.classList.remove('open');items=[];sel=-1;}
  function choose(k){input.value=items[k].n;close();input.focus();}
  function move(d){if(!items.length)return;sel=(sel+d+items.length)%items.length;[...box.children].forEach((c,i)=>c.classList.toggle('sel',i===sel));}
  input.addEventListener('input',open);
  input.addEventListener('keydown',e=>{
    if(box.classList.contains('open')){
      if(e.key==='ArrowDown'){e.preventDefault();move(1);return;}
      if(e.key==='ArrowUp'){e.preventDefault();move(-1);return;}
      if(e.key==='Escape'){close();return;}
      if(e.key==='Tab'&&items.length){e.preventDefault();choose(sel>=0?sel:0);return;}
      if(e.key==='Enter'&&sel>=0){e.preventDefault();choose(sel);return;}
    }
    if(e.key==='Enter'){e.preventDefault();onEnter();}
  });
  input.addEventListener('blur',()=>setTimeout(close,120));
  return {close};
}
const resolve=(input,source)=>{const q=norm(input.value); if(!q)return -1; const h=source.find(x=>x.low===q); return h?h.i:-1;};

/* ---------- state ---------- */
let secret, navAns, navGates, r1done, r2done, r3done, wrong2, secretAb, r3stage;
let ac1,ac2,ac3;

/* ===== ROUND 1 ===== */
function tile(cls,main,sub){return `<div class="cell ${cls}">${main}${sub?`<span class="sub">${sub}</span>`:''}</div>`;}
function numCell(gv,sv){ if(gv===sv)return tile('g',gv,''); return `<div class="cell r">${gv}<span class="arrow">${sv>gv?'▲':'▼'}</span></div>`; }
function featCell(gf,sf){
  const ss=new Set(sf); const inter=gf.filter(x=>ss.has(x)).length;
  const same=gf.length===sf.length&&inter===gf.length; const cls=same?'g':(inter>0?'y':'r');
  const label=gf.length?gf.map(f=>f.replace("Smuggler's Den","Smuggler")).join(', '):'None';
  return tile(cls,label,'');
}
function submit1(){
  if(r1done)return; const gi=resolve($('g1'),MAP_SRC); if(gi<0)return;
  const g=MAPS[gi], s=MAPS[secret]; $('grid1').style.display='block';
  const win=gi===secret; const row=document.createElement('div'); row.className='growrow';
  row.innerHTML=tile('name'+(win?' g':''),g.n,'')+numCell(g.q,s.q)+numCell(g.t,s.t)+
    tile(g.b===s.b?'g':'r',g.b,'')+featCell(g.f,s.f)+
    tile(g.c===s.c?'g':'r',g.c.replace(' Portal','').replace("'s Rest","'s"),g.c.includes('Rest')?'rest':'portal');
  $('rows1').prepend(row); $('g1').value=''; if(win)finishRound1();
}
function finishRound1(){
  r1done=true; $('g1').disabled=true; $('b1').disabled=true; ac1.close();
  $('solved1').innerHTML=`<div class="solved">${checkSvg} Found it — <b style="color:var(--brass-lite);margin-left:4px">${MAPS[secret].n}</b>. On to the gates.</div>`;
  $('rail0').classList.add('done'); $('rail1').classList.add('active'); revealRound2();
  setTimeout(()=>$('round2').scrollIntoView({behavior:'smooth',block:'start'}),650);
}

/* ===== ROUND 2 ===== */
function genNav(start){
  for(let t=0;t<5000;t++){
    const len=3+Math.floor(Math.random()*3); let cur=start,prevMap=-1,gates=[],ok=true;
    for(let s=0;s<len;s++){
      const opts=Object.keys(MAPS[cur].d).filter(d=>MAPS[cur].d[d]!==prevMap);
      if(!opts.length){ok=false;break;}
      const d=opts[Math.floor(Math.random()*opts.length)];
      prevMap=cur; cur=MAPS[cur].d[d]; gates.push(d);
    }
    if(ok&&cur!==start)return {gates,answer:cur};
  } return null;
}
function setupRound2(){
  const nav=genNav(secret); navGates=nav.gates; navAns=nav.answer; wrong2=0;
  $('navStart').textContent=MAPS[secret].n;
  const g=$('gates'); g.innerHTML='';
  navGates.forEach((d,i)=>{ if(i>0){const s=document.createElement('span');s.className='gsep';s.textContent='›';g.appendChild(s);}
    const el=document.createElement('div');el.className='gate';el.innerHTML=`<span>${d}</span>`;g.appendChild(el);});
}
function revealRound2(){
  $('round2').classList.remove('locked');
  const gates=[...$('gates').querySelectorAll('.gate')];
  if(!matchMedia('(prefers-reduced-motion:reduce)').matches){
    let i=0;(function st(){gates.forEach(x=>x.classList.remove('lit'));['NW','NE','SE','SW'].forEach(d=>$('sp-'+d).classList.remove('lit'));
      if(i<gates.length){gates[i].classList.add('lit');$('sp-'+navGates[i]).classList.add('lit');i++;setTimeout(st,560);}})();
  }
}
function submit2(){
  if(r2done)return; const gi=resolve($('g2'),MAP_SRC); if(gi<0)return;
  const win=gi===navAns; const row=document.createElement('div'); row.className='grow'+(win?' correct':'');
  row.innerHTML=`${MAPS[gi].n}<span class="x">${win?'✓ arrived':'✕'}</span>`; $('guesses2').appendChild(row); $('g2').value='';
  if(win){finishRound2();return;}
  wrong2++; const a=MAPS[navAns]; let h='';
  if(wrong2===4)h=`Biome of the destination: <b>${a.b}</b>`;
  else if(wrong2===8)h=`Map tier of the destination: <b>T${a.t}</b>`;
  else if(wrong2===12)h=`Features: <b>${a.f.length?a.f.join(', '):'none'}</b>`;
  else if(wrong2===16){const fw=a.n.split(' ')[0]; h=a.n.includes(' ')?`The name begins with <b>${fw}</b>`:`Single-word name — begins with <b>${a.n[0]}</b>`;}
  if(h){const el=document.createElement('div');el.className='hint';el.innerHTML=h;$('hints2').appendChild(el);
    setTimeout(()=>el.scrollIntoView({behavior:'smooth',block:'nearest'}),50);}
}
function finishRound2(){
  r2done=true; $('g2').disabled=true; $('b2').disabled=true; ac2.close();
  ['NW','NE','SE','SW'].forEach(d=>$('sp-'+d).classList.remove('lit'));
  $('solved2').innerHTML=`<div class="solved">${checkSvg} Arrived at <b style="color:var(--brass-lite);margin-left:4px">${MAPS[navAns].n}</b>.</div>`;
  $('rail1').classList.add('done'); $('rail2').classList.add('active'); revealRound3();
  setTimeout(()=>$('round3').scrollIntoView({behavior:'smooth',block:'start'}),650);
}

/* ===== ROUND 3 ===== */
function chipGroup(el, values, multi){
  if(!el)return;
  el.innerHTML=values.map(v=>`<button data-v="${v}">${v}</button>`).join('');
  el.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
    if(b.disabled||r3done)return;
    if(multi){b.classList.toggle('on');}
    else{el.querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');}
    b.classList.remove('ok','no');
    if(el.id==='tagChips')updateSubs();
    if(el.id==='bfChips')updateImm();
  }));
}
const getSel=el=>el?[...el.querySelectorAll('button.on')].map(b=>b.dataset.v):[];
const getOne=el=>{const b=el&&el.querySelector('button.on');return b?b.dataset.v:null;};
function toggleBlock(id,show){const el=$(id); if(!el)return; if(!show)el.querySelectorAll('button.on').forEach(b=>b.classList.remove('on')); const blk=$(id.replace('Chips','Block')); if(blk)blk.style.display=show?'block':'none';}
function updateImm(){
  const on = getSel($('tagChips')).includes('Buff') && getSel($('bfChips')).includes('Immunity');
  toggleBlock('immChips',on);
}
function updateSubs(){
  const t=new Set(getSel($('tagChips')));
  toggleBlock('dmgChips',t.has('Damage'));
  toggleBlock('bfChips',t.has('Buff'));
  toggleBlock('dbChips',t.has('Debuff'));
  toggleBlock('ccChips',t.has('Crowd Control'));
  toggleBlock('clChips',t.has('Cleanse'));
  toggleBlock('pgChips',t.has('Purge'));
  updateImm();
}
function buildR3Chips(){
  chipGroup($('tagChips'),TAGS,true);
  chipGroup($('dmgChips'),DMG,true);
  chipGroup($('bfChips'),BUFF,true);
  chipGroup($('immChips'),IMM,true);
  chipGroup($('dbChips'),DEBUFF,true);
  chipGroup($('ccChips'),CC,true);
  chipGroup($('clChips'),CLEANSE,true);
  chipGroup($('pgChips'),PURGE,true);
  chipGroup($('ctChips'),CT,false);
  chipGroup($('crChips'),CR,false);
  $('ipBtn').addEventListener('click',()=>{
    if(r3done)return;
    $('ipBtn').classList.toggle('on'); const on=$('ipBtn').classList.contains('on');
    $('cdInput').disabled=on; if(on)$('cdInput').value='';
  });
}
function setupRound3(){
  secretAb=AB_POOL[Math.floor(Math.random()*AB_POOL.length)]; r3stage='name';
  const fr=$('abFrame'); fr.classList.remove('err');
  const img=$('abIcon'); img.onerror=()=>fr.classList.add('err'); img.src=ICON(ABILITIES[secretAb].id);
}
function revealRound3(){ $('round3').classList.remove('locked'); }
function submit3name(){
  if(r3done||r3stage!=='name')return; const gi=resolve($('g3'),AB_SRC); if(gi<0)return;
  const win=gi===secretAb; const a=ABILITIES[gi];
  const row=document.createElement('div'); row.className='grow'+(win?' correct':'');
  row.innerHTML=`<img src="${ICON(a.id)}" alt="">${a.n}<span class="x">${win?'✓':(a.t==='w'?a.l:'Armor')}</span>`;
  $('guesses3').appendChild(row); $('g3').value='';
  if(!win)return;
  ac3.close(); $('g3').disabled=true; $('b3').disabled=true;
  r3stage='attrs'; const s=ABILITIES[secretAb];
  $('atIcon').src=ICON(s.id); $('atName').textContent=s.n;
  $('attrstage').style.display='block';
  updateSubs();
  setTimeout(()=>$('attrstage').scrollIntoView({behavior:'smooth',block:'nearest'}),60);
}
function colorMulti(el,answer){
  const A=new Set(answer);
  el.querySelectorAll('button').forEach(b=>{
    const v=b.dataset.v, picked=b.classList.contains('on');
    b.classList.remove('on');
    if(A.has(v))b.classList.add('ok');            // reveal correct answers green
    else if(picked)b.classList.add('no');          // wrong picks red
    b.disabled=true;
  });
}
function colorOne(el,answer){
  el.querySelectorAll('button').forEach(b=>{
    const v=b.dataset.v, picked=b.classList.contains('on'); b.classList.remove('on');
    if(v===answer)b.classList.add('ok'); else if(picked)b.classList.add('no');
    b.disabled=true;
  });
}
function submit3confirm(){
  if(r3done||r3stage!=='attrs')return; const a=ABILITIES[secretAb];
  const gTags=getSel($('tagChips')), gDmg=getSel($('dmgChips')), gBf=getSel($('bfChips')), gImm=getSel($('immChips')), gDb=getSel($('dbChips')), gCc=getSel($('ccChips')), gCl=getSel($('clChips')), gPg=getSel($('pgChips'));
  const gCt=getOne($('ctChips')), gCr=getOne($('crChips'));
  const ipSel=$('ipBtn').classList.contains('on'); const cdRaw=$('cdInput').value.trim();
  const cdVal=cdRaw===''?null:parseFloat(cdRaw);
  const cdOk = a.ip ? ipSel : (!ipSel && cdVal!==null && Math.abs(cdVal-a.cd)<1);

  const rows=[]; let correct=0, total=0;
  function add(label,ok,guessStr,ansStr){ total++; if(ok)correct++;
    rows.push(`<div class="rvrow ${ok?'ok':'no'}"><span class="k">${label}</span><span class="v">${ok?ansStr:`<span class="miss">${guessStr||'—'}</span> → ${ansStr}`}</span><span class="mark">${ok?'✓':'✗'}</span></div>`); }

  const tagsOk=setEq(gTags,a.tags); add('Tags',tagsOk,gTags.join(', '),a.tags.join(', ')); colorMulti($('tagChips'),a.tags);
  if(a.tags.includes('Damage')){const ok=setEq(gDmg,a.dmg); add('Damage type',ok,gDmg.join(', '),a.dmg.join(', ')); }
  colorMulti($('dmgChips'),a.tags.includes('Damage')?a.dmg:[]);
  if(a.tags.includes('Buff')){const ok=setEq(gBf,a.bf); add('Buff type',ok,gBf.join(', '),a.bf.join(', ')); }
  colorMulti($('bfChips'),a.tags.includes('Buff')?a.bf:[]);
  const showImm=a.tags.includes('Buff')&&a.bf.includes('Immunity');
  if(showImm){const ok=setEq(gImm,a.imm); add('Immunity type',ok,gImm.join(', '),a.imm.join(', ')); }
  colorMulti($('immChips'),showImm?a.imm:[]);
  if(a.tags.includes('Debuff')){const ok=setEq(gDb,a.db); add('Debuff type',ok,gDb.join(', '),a.db.join(', ')); }
  colorMulti($('dbChips'),a.tags.includes('Debuff')?a.db:[]);
  if(a.tags.includes('Crowd Control')){const ok=setEq(gCc,a.cc); add('CC type',ok,gCc.join(', '),a.cc.join(', ')); }
  colorMulti($('ccChips'),a.tags.includes('Crowd Control')?a.cc:[]);
  if(a.tags.includes('Cleanse')){const ok=setEq(gCl,a.cl); add('Cleanse type',ok,gCl.join(', '),a.cl.join(', ')); }
  colorMulti($('clChips'),a.tags.includes('Cleanse')?a.cl:[]);
  if(a.tags.includes('Purge')){const ok=setEq(gPg,a.pg); add('Purge type',ok,gPg.join(', '),a.pg.join(', ')); }
  colorMulti($('pgChips'),a.tags.includes('Purge')?a.pg:[]);
  add('Cast type',gCt===a.ct,gCt,a.ct); colorOne($('ctChips'),a.ct);
  add('Targeting',gCr===a.cr,gCr,a.cr); colorOne($('crChips'),a.cr);
  const cdAns=a.ip?'Scales with IP':a.cd+'s'; const cdGuess=ipSel?'Scales with IP':(cdRaw===''?'—':cdRaw+'s');
  add('Cooldown',cdOk,cdGuess,cdAns);
  $('ipBtn').disabled=true; $('cdInput').disabled=true;
  $('b3confirm').disabled=true;

  // reveal panel with description
  $('reveal3').innerHTML=
    `<div class="reveal"><div class="rvscore">${correct} / ${total} correct — <b style="color:var(--brass-lite)">${a.n}</b></div>`+
    `<div class="rvgrid">${rows.join('')}</div>`+
    (a.desc?`<div class="rvdesc"><div class="dh">In-game description</div><div class="dn">${a.n}</div>${a.desc}</div>`:'')+
    `</div>`;
  finishRound3(correct===total);
}
function finishRound3(allCorrect){
  r3done=true; $('rail2').classList.add('done');
  if(allCorrect){ score.streak++; score.best=Math.max(score.best,score.streak); }
  else score.streak=0;
  saveScore();
  $('finishMsg').textContent=allCorrect?`Flawless — all three rounds cleared. Streak ${score.streak}.`:`Rounds complete. Round 3 wasn't perfect, so the streak resets.`;
  $('finish').classList.add('show');
  setTimeout(()=>$('reveal3').scrollIntoView({behavior:'smooth',block:'nearest'}),200);
}

/* ===== new game ===== */
function resetChips(){
  ['tagChips','dmgChips','bfChips','immChips','dbChips','ccChips','clChips','pgChips','ctChips','crChips'].forEach(id=>{
    const el=$(id); if(el)el.querySelectorAll('button').forEach(b=>{b.className='';b.disabled=false;});});
  ['dmgBlock','bfBlock','immBlock','dbBlock','ccBlock','clBlock','pgBlock'].forEach(id=>{const el=$(id); if(el)el.style.display='none';});
  const ci=$('cdInput'); if(ci){ci.value='';ci.disabled=false;} const ib=$('ipBtn'); if(ib){ib.className='ipbtn';ib.disabled=false;}
  const bc=$('b3confirm'); if(bc)bc.disabled=false; const rv=$('reveal3'); if(rv)rv.innerHTML='';
}
function newGame(){
  secret=Math.floor(Math.random()*MAPS.length);
  let guard=0; while(!genNav(secret)&&guard++<60) secret=Math.floor(Math.random()*MAPS.length);
  r1done=r2done=r3done=false;
  $('g1').disabled=false;$('b1').disabled=false;$('g1').value='';$('rows1').innerHTML='';$('grid1').style.display='none';$('solved1').innerHTML='';
  $('g2').disabled=false;$('b2').disabled=false;$('g2').value='';$('guesses2').innerHTML='';$('hints2').innerHTML='';$('solved2').innerHTML='';$('round2').classList.add('locked');
  $('g3').disabled=false;$('b3').disabled=false;$('g3').value='';$('guesses3').innerHTML='';$('round3').classList.add('locked');
  $('attrstage').style.display='none'; resetChips();
  setupRound2(); setupRound3();
  $('finish').classList.remove('show');
  ['rail0','rail1','rail2'].forEach(r=>$(r).classList.remove('done','active')); $('rail0').classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'}); $('g1').focus();
}

async function boot(){
  try{
    const [maps,abilities]=await Promise.all([
      fetch('maps.json').then(r=>{if(!r.ok)throw 0;return r.json();}),
      fetch('abilities.json').then(r=>{if(!r.ok)throw 0;return r.json();})
    ]);
    initData(maps,abilities);
  }catch(e){
    document.querySelector('.lede').innerHTML='Could not load game data. If you opened this file directly from disk, serve it with a local web server (e.g. <code>python -m http.server</code>) and reload — browsers block reading JSON over file://.';
    return;
  }
  $('b1').addEventListener('click',submit1); ac1=autocomplete($('g1'),$('ac1'),MAP_SRC,submit1);
  $('b2').addEventListener('click',submit2); ac2=autocomplete($('g2'),$('ac2'),MAP_SRC,submit2);
  $('b3').addEventListener('click',submit3name); ac3=abilityAC($('g3'),$('ac3'),submit3name);
  $('b3confirm').addEventListener('click',submit3confirm);
  $('newGame').addEventListener('click',newGame); $('playAgain').addEventListener('click',newGame);
  $('showAll').addEventListener('click',()=>{
    const on=document.body.classList.toggle('reveal-all');
    $('showAll').classList.toggle('toggled',on); $('showAll').textContent=on?'Hide locked':'Show all';
  });
  document.querySelectorAll('.reportbtn').forEach(b=>b.addEventListener('click',()=>openReport(+b.dataset.round)));
  $('rpCancel').addEventListener('click',closeReport);
  $('rpSubmit').addEventListener('click',submitReport);
  $('reportModal').addEventListener('click',e=>{if(e.target===$('reportModal'))closeReport();});
  buildR3Chips();
  newGame();
}
boot();

/* ===== report wrong data ===== */
const REPORT_ENDPOINT='';   // optional: set to a Formspree / Google Apps Script URL to collect reports
let reportRound=1;
function openReport(round){
  reportRound=round;
  let entity='',ctx='';
  if(round===1){entity=(MAPS[secret]||{}).n||''; ctx='Round 1 — map data: biome, tier, quality, features, or nearest hub.';}
  else if(round===2){entity=(MAPS[secret]||{}).n||''; ctx='Round 2 — a gate direction (NW/NE/SE/SW) or where a gate leads.';}
  else{entity=(secretAb!=null?(ABILITIES[secretAb]||{}).n:'')||''; ctx='Round 3 — ability data: tags, damage type, buff/debuff, CC, cast type/range, cooldown, or immunity.';}
  $('reportContext').textContent=ctx;
  $('rpEntity').value=entity; $('rpField').value=''; $('rpCorrect').value=''; $('rpNotes').value='';
  $('rpStatus').textContent='';
  $('reportModal').classList.add('open'); $('rpField').focus();
}
function closeReport(){ $('reportModal').classList.remove('open'); }
async function submitReport(){
  const rep={ts:new Date().toISOString(), round:reportRound,
    entity:$('rpEntity').value.trim(), issue:$('rpField').value.trim(),
    correct:$('rpCorrect').value.trim(), notes:$('rpNotes').value.trim()};
  if(!rep.entity || (!rep.issue && !rep.notes)){
    $('rpStatus').style.color='#e6b6a6'; $('rpStatus').textContent='Please name the entry and what looks wrong.'; return;
  }
  try{const arr=JSON.parse(localStorage.getItem('albiondle_reports')||'[]'); arr.push(rep);
    localStorage.setItem('albiondle_reports',JSON.stringify(arr));}catch(e){}
  console.log('[Albiondle report]',rep);
  if(REPORT_ENDPOINT){try{await fetch(REPORT_ENDPOINT,{method:'POST',mode:'no-cors',keepalive:true,headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(rep)});}catch(e){console.warn('[Albiondle] report POST failed',e);}}
  $('rpStatus').style.color='var(--portal)'; $('rpStatus').textContent='Thanks — report saved.';
  setTimeout(closeReport,900);
}
/* dev helpers: albiondleReports() to view, albiondleReportsCSV() to export */
window.albiondleReports=()=>{try{return JSON.parse(localStorage.getItem('albiondle_reports')||'[]')}catch(e){return[]}};
window.albiondleReportsCSV=()=>{const r=window.albiondleReports();
  const cols=['ts','round','entity','issue','correct','notes'];
  return [cols.join(',')].concat(r.map(o=>cols.map(c=>JSON.stringify(o[c]||'')).join(','))).join('\n');};