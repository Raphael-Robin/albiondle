/* Albiondle game logic */
const OPP={NE:'SW',SW:'NE',NW:'SE',SE:'NW'};
const norm=s=>s.toLowerCase().replace(/\s+/g,' ').trim();
const $=id=>document.getElementById(id);
const setEq=(a,b)=>{const A=new Set(a),B=new Set(b);return A.size===B.size&&[...A].every(x=>B.has(x));};
const checkSvg='<svg width="18" height="18" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" fill="none" stroke="var(--portal)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const MAP_SRC=MAPS.map((m,i)=>({i,n:m.n,low:m.n.toLowerCase(),tag:`T${m.t}·Q${m.q}·${m.b}`}));
const AB_SRC=ABILITIES.map((a,i)=>({i,n:a.n,low:a.n.toLowerCase(),line:a.t==='w'?a.l:null,tag:a.t==='w'?a.l:'Armor'}));
const LINES=[...new Set(ABILITIES.filter(a=>a.t==='w').map(a=>a.l))].sort();
const LINE_LOW=LINES.map(l=>l.toLowerCase());
const AB_POOL=ABILITIES.map((a,i)=>i).filter(i=>ABILITIES[i].tags&&ABILITIES[i].tags.length>0);
const ICON=id=>`https://render.albiononline.com/v1/spell/${id}.png?size=217`;

const TAGS=['Damage','Crowd Control','Mobility','Debuff','Buff','Heal'];
const DMG=['Physical','Magical'];
const BD=['Resistances','Movement Speed','Ability Damage','Attack Speed','Shield','DoT','HoT','Other'];
const CC=['Stun','Root','Slow','Silence','Interrupt','Sleep','Forced Movement'];
const CT=['Instant','Cast time','Channeled'];
const CR=['Self','Single-target','Area'];

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
    const starts=[],contains=[],lineSpells=[],seen=new Set();
    for(const it of AB_SRC){const p=it.low.indexOf(q); if(p===0){starts.push(it);seen.add(it.i);} else if(p>0){contains.push(it);seen.add(it.i);}}
    if(linesMatch.length){for(const it of AB_SRC){if(seen.has(it.i))continue; if(it.line&&linesMatch.includes(it.line)){lineSpells.push(it);seen.add(it.i);}}}
    items=[...starts,...contains,...lineSpells].slice(0,30); sel=-1;
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
  $('rail0').classList.add('done'); $('rail1').classList.add('active'); unlockRound2();
  setTimeout(()=>$('round2').scrollIntoView({behavior:'smooth',block:'start'}),650);
}

/* ===== ROUND 2 ===== */
function genNav(start){
  for(let t=0;t<5000;t++){
    const len=3+Math.floor(Math.random()*3); let cur=start,prev=null,gates=[],ok=true;
    for(let s=0;s<len;s++){const opts=Object.keys(MAPS[cur].d).filter(d=>d!==prev); if(!opts.length){ok=false;break;}
      const d=opts[Math.floor(Math.random()*opts.length)]; cur=MAPS[cur].d[d]; prev=OPP[d]; gates.push(d);}
    if(ok&&cur!==start)return {gates,answer:cur};
  } return null;
}
function unlockRound2(){
  const nav=genNav(secret); navGates=nav.gates; navAns=nav.answer; wrong2=0;
  $('round2').classList.remove('locked'); $('navStart').textContent=MAPS[secret].n;
  const g=$('gates'); g.innerHTML='';
  navGates.forEach((d,i)=>{ if(i>0){const s=document.createElement('span');s.className='gsep';s.textContent='›';g.appendChild(s);}
    const el=document.createElement('div');el.className='gate';el.innerHTML=`<span>${d}</span>`;g.appendChild(el);});
  const gates=[...g.querySelectorAll('.gate')];
  if(!matchMedia('(prefers-reduced-motion:reduce)').matches){
    let i=0;(function st(){gates.forEach(x=>x.classList.remove('lit'));['NW','NE','SE','SW'].forEach(d=>$('sp-'+d).classList.remove('lit'));
      if(i<gates.length){gates[i].classList.add('lit');$('sp-'+navGates[i]).classList.add('lit');i++;setTimeout(st,560);}})();
  }
  ac2=autocomplete($('g2'),$('ac2'),MAP_SRC,submit2);
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
  $('rail1').classList.add('done'); $('rail2').classList.add('active'); unlockRound3();
  setTimeout(()=>$('round3').scrollIntoView({behavior:'smooth',block:'start'}),650);
}

/* ===== ROUND 3 ===== */
function chipGroup(el, values, multi){
  el.innerHTML=values.map(v=>`<button data-v="${v}">${v}</button>`).join('');
  el.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
    if(b.disabled||r3done)return;
    if(multi){b.classList.toggle('on');}
    else{el.querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');}
    b.classList.remove('ok','no');
    if(el.id==='tagChips')updateSubs();
  }));
}
const getSel=el=>[...el.querySelectorAll('button.on')].map(b=>b.dataset.v);
const getOne=el=>{const b=el.querySelector('button.on');return b?b.dataset.v:null;};
function toggleBlock(id,show){const el=$(id); if(!show)el.querySelectorAll('button.on').forEach(b=>b.classList.remove('on')); $(id.replace('Chips','Block')).style.display=show?'block':'none';}
function updateSubs(){
  const t=new Set(getSel($('tagChips')));
  toggleBlock('dmgChips',t.has('Damage'));
  toggleBlock('bdChips',t.has('Buff')||t.has('Debuff'));
  toggleBlock('ccChips',t.has('Crowd Control'));
}
function buildR3Chips(){
  chipGroup($('tagChips'),TAGS,true);
  chipGroup($('dmgChips'),DMG,true);
  chipGroup($('bdChips'),BD,true);
  chipGroup($('ccChips'),CC,true);
  chipGroup($('ctChips'),CT,false);
  chipGroup($('crChips'),CR,false);
  $('ipBtn').addEventListener('click',()=>{
    if(r3done)return;
    $('ipBtn').classList.toggle('on'); const on=$('ipBtn').classList.contains('on');
    $('cdInput').disabled=on; if(on)$('cdInput').value='';
  });
}
function unlockRound3(){
  secretAb=AB_POOL[Math.floor(Math.random()*AB_POOL.length)]; r3stage='name';
  $('round3').classList.remove('locked');
  const fr=$('abFrame'); fr.classList.remove('err');
  const img=$('abIcon'); img.onerror=()=>fr.classList.add('err'); img.src=ICON(ABILITIES[secretAb].id);
  ac3=abilityAC($('g3'),$('ac3'),submit3name);
}
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
  const gTags=getSel($('tagChips')), gDmg=getSel($('dmgChips')), gBd=getSel($('bdChips')), gCc=getSel($('ccChips'));
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
  if(a.tags.includes('Buff')||a.tags.includes('Debuff')){const ok=setEq(gBd,a.bd); add('Buff/debuff type',ok,gBd.join(', '),a.bd.join(', ')); }
  colorMulti($('bdChips'),(a.tags.includes('Buff')||a.tags.includes('Debuff'))?a.bd:[]);
  if(a.tags.includes('Crowd Control')){const ok=setEq(gCc,a.cc); add('CC type',ok,gCc.join(', '),a.cc.join(', ')); }
  colorMulti($('ccChips'),a.tags.includes('Crowd Control')?a.cc:[]);
  add('Cast type',gCt===a.ct,gCt,a.ct); colorOne($('ctChips'),a.ct);
  add('Cast range',gCr===a.cr,gCr,a.cr); colorOne($('crChips'),a.cr);
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
  ['tagChips','dmgChips','bdChips','ccChips','ctChips','crChips'].forEach(id=>
    $(id).querySelectorAll('button').forEach(b=>{b.className='';b.disabled=false;}));
  $('dmgBlock').style.display='none'; $('bdBlock').style.display='none'; $('ccBlock').style.display='none';
  $('cdInput').value=''; $('cdInput').disabled=false; $('ipBtn').className='ipbtn'; $('ipBtn').disabled=false;
  $('b3confirm').disabled=false; $('reveal3').innerHTML='';
}
function newGame(){
  secret=Math.floor(Math.random()*MAPS.length);
  let guard=0; while(!genNav(secret)&&guard++<60) secret=Math.floor(Math.random()*MAPS.length);
  r1done=r2done=r3done=false;
  $('g1').disabled=false;$('b1').disabled=false;$('g1').value='';$('rows1').innerHTML='';$('grid1').style.display='none';$('solved1').innerHTML='';
  $('g2').disabled=false;$('b2').disabled=false;$('g2').value='';$('guesses2').innerHTML='';$('hints2').innerHTML='';$('solved2').innerHTML='';$('round2').classList.add('locked');
  $('g3').disabled=false;$('b3').disabled=false;$('g3').value='';$('guesses3').innerHTML='';$('round3').classList.add('locked');
  $('attrstage').style.display='none'; resetChips();
  $('finish').classList.remove('show');
  ['rail0','rail1','rail2'].forEach(r=>$(r).classList.remove('done','active')); $('rail0').classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'}); $('g1').focus();
  unlockRound3();
}

$('b1').addEventListener('click',submit1); ac1=autocomplete($('g1'),$('ac1'),MAP_SRC,submit1);
$('b2').addEventListener('click',submit2); $('b3').addEventListener('click',submit3name);
$('b3confirm').addEventListener('click',submit3confirm);
$('newGame').addEventListener('click',newGame); $('playAgain').addEventListener('click',newGame);
buildR3Chips();
newGame();