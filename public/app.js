/* 溝口急送 申請アプリ */
(function () {
  var API = '/api';
  var WD = ['日','月','火','水','木','金','土'], MAX = 7;
  var user = null;
  try { user = JSON.parse(localStorage.getItem('mk_user') || 'null'); } catch (e) {}

  function $(id){ return document.getElementById(id); }
  function el(tag, cls, html){ var e=document.createElement(tag); if(cls)e.className=cls; if(html!=null)e.innerHTML=html; return e; }
  function todayStr(){ return new Date().toISOString().slice(0,10); }
  function genNo(){ return String(Math.floor(100000+Math.random()*900000)); }
  function toast(t){ var e=$('toast'); e.textContent=t; e.classList.add('show'); clearTimeout(e._t); e._t=setTimeout(function(){e.classList.remove('show');},2000); }
  function api(path, opts){ return fetch(API+path, opts).then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||('エラー '+r.status)); return j; }); }); }

  function fmtDate(v){ if(!v) return ''; var p=String(v).slice(0,10).split('-'); if(p.length!==3) return v; var d=new Date(+p[0],+p[1]-1,+p[2]); return p[0]+'/'+p[1]+'/'+p[2]+'（'+WD[d.getDay()]+'）'; }
  function fmtMD(v){ if(!v) return ''; var p=String(v).slice(0,10).split('-'); if(p.length!==3) return v; var d=new Date(+p[0],+p[1]-1,+p[2]); return p[1]+'/'+p[2]+'（'+WD[d.getDay()]+'）'; }
  function diff(s,e){ if(!s||!e) return null; var a=s.split(':'),b=e.split(':'); var m=(+b[0]*60+ +b[1])-(+a[0]*60+ +a[1]); if(m<0)m+=1440; return m; }
  function durText(m){ if(m==null) return ''; var h=Math.floor(m/60),mm=m%60; return h+'時間'+(mm?mm+'分':'0分'); }
  function rowOT(r){ var span=diff(r.start,r.end); if(span==null) return null; var br=parseInt(r.kyukei,10)||0, rest=parseInt(r.bunkatsu,10)||0; var work=span-br-rest; if(work<0)work=0; var ot=work-480; if(ot<0)ot=0; return {work:work,ot:ot,br:br,rest:rest}; }

  /* ---------- ログイン ---------- */
  $('login-btn').addEventListener('click', function(){
    var name=$('in-name').value.trim(), emp=$('in-empno').value.trim();
    $('login-msg').textContent='';
    if(!name||!emp){ $('login-msg').textContent='名前と社員番号を入力してください'; return; }
    $('login-btn').disabled=true;
    api('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,emp_no:emp})})
      .then(function(j){ user=j.user; localStorage.setItem('mk_user',JSON.stringify(user)); enterApp(); setupPush(); })
      .catch(function(e){ $('login-msg').textContent=e.message; })
      .then(function(){ $('login-btn').disabled=false; });
  });
  $('logout-btn').addEventListener('click', function(){ localStorage.removeItem('mk_user'); location.reload(); });

  /* ---------- プッシュ購読 ---------- */
  function urlB64ToUint8(base64){ var pad='='.repeat((4-base64.length%4)%4); var b=(base64+pad).replace(/-/g,'+').replace(/_/g,'/'); var raw=atob(b); var arr=new Uint8Array(raw.length); for(var i=0;i<raw.length;i++)arr[i]=raw.charCodeAt(i); return arr; }
  function setupPush(){
    if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.register('sw.js').then(function(reg){
      return api('/config').then(function(c){
        if(!c.vapidPublicKey){ return; }
        if(Notification.permission==='denied') return;
        return Notification.requestPermission().then(function(p){
          if(p!=='granted') return;
          return reg.pushManager.getSubscription().then(function(sub){
            if(sub) return sub;
            return reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlB64ToUint8(c.vapidPublicKey) });
          }).then(function(sub){
            return api('/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employee_id:user.id,subscription:sub})});
          });
        });
      });
    }).catch(function(e){ console.warn('push setup failed', e); });
  }

  /* ---------- アプリ枠 ---------- */
  var currentTab = '';
  function enterApp(){
    $('login-view').classList.add('hide');
    $('app-view').classList.remove('hide');
    $('who').textContent = user.name + (user.role==='manager'?'（承認者）':'');
    var tabs = (user.role==='manager')
      ? [['pending','承認待ち'],['submit','申請する'],['mine','申請履歴']]
      : [['submit','申請する'],['mine','申請履歴']];
    var tabsEl=$('tabs'); tabsEl.innerHTML='';
    tabs.forEach(function(t){
      var b=el('button',null,t[1]); b.setAttribute('data-tab',t[0]);
      b.addEventListener('click',function(){ selectTab(t[0]); });
      tabsEl.appendChild(b);
    });
    selectTab(tabs[0][0]);
  }
  function selectTab(tab){
    currentTab=tab;
    [].forEach.call($('tabs').children,function(b){ b.setAttribute('aria-selected', b.getAttribute('data-tab')===tab ? 'true':'false'); });
    $('bar').classList.add('hide');
    if(tab==='submit') renderSubmit();
    else if(tab==='mine') renderList('mine');
    else if(tab==='pending') renderList('pending');
  }
  if(user) enterApp();

  /* ---------- 申請（残業） ---------- */
  var days=[];
  function renderSubmit(){
    $('app-title').textContent='残業申請';
    var c=$('content'); c.innerHTML='';
    var appno=genNo();
    var basic=el('div','card');
    basic.innerHTML =
      '<label class="lab">申請日 <span class="req">*</span></label><input type="date" id="f-date">'+
      '<div class="row2" style="margin-top:12px"><div><label class="lab">車番</label><input type="text" id="f-sha" placeholder="例）28"></div>'+
      '<div><label class="lab">氏名</label><input type="text" id="f-name" disabled></div></div>';
    c.appendChild(basic);

    var dcard=el('div','card');
    dcard.innerHTML='<span class="lab">勤務日（最大7日） <span class="req">*</span></span>'+
      '<p class="hint" style="margin:2px 2px 10px">始業・終業・休憩・分割休息から、実働8時間を超えた分が残業として自動計算されます。</p>'+
      '<div id="day-list"></div><button type="button" class="addbtn" id="add-day">＋ 日を追加</button><div class="total" id="zan-total"></div>';
    c.appendChild(dcard);

    var rcard=el('div','card');
    rcard.innerHTML='<label class="lab">業務内容・理由 <span class="req">*</span></label><textarea id="f-reason" placeholder="例）配送遅延の積み直し対応"></textarea>';
    c.appendChild(rcard);

    $('f-date').value=todayStr();
    $('f-name').value=user.name;
    days=[]; $('day-list').innerHTML=''; addDay(todayStr());
    $('add-day').addEventListener('click',function(){ addDay(''); });
    $('f-sha').addEventListener('input',preview); $('f-reason').addEventListener('input',preview);

    var bar=$('bar'); bar.classList.remove('hide');
    $('bar-btn').textContent='申請する';
    $('bar-btn').className='btn primary';
    $('bar-btn').onclick=function(){ submitApp(appno); };
    refreshRows();
  }
  function makeRow(dateVal){
    var row=el('div','dayrow');
    row.innerHTML='<div class="dayrow-head"><span class="n"></span><button type="button" class="del">×</button></div>'+
      '<input type="date" class="d-date">'+
      '<div class="row2" style="margin-top:8px"><div><span class="rowlab">始業</span><input type="time" class="d-start" step="300"></div><div><span class="rowlab">終業</span><input type="time" class="d-end" step="300"></div></div>'+
      '<div class="row2" style="margin-top:8px"><div><span class="rowlab">休憩（分）</span><input type="number" inputmode="numeric" class="d-break" min="0" step="5" placeholder="例）60"></div><div><span class="rowlab">分割休息（分）</span><input type="number" inputmode="numeric" class="d-rest" min="0" step="5" placeholder="0"></div></div>'+
      '<div class="rowcalc"></div>';
    row.querySelector('.d-date').value=dateVal||'';
    row.querySelector('.d-break').value='60';
    row.querySelector('.del').addEventListener('click',function(){ row.parentNode.removeChild(row); refreshRows(); });
    [].forEach.call(row.querySelectorAll('input'),function(i){ i.addEventListener('input',preview); i.addEventListener('change',preview); });
    return row;
  }
  function addDay(d){ if($('day-list').querySelectorAll('.dayrow').length>=MAX) return; $('day-list').appendChild(makeRow(d||'')); refreshRows(); }
  function refreshRows(){
    var rows=$('day-list').querySelectorAll('.dayrow');
    if(rows.length===0){ $('day-list').appendChild(makeRow(todayStr())); rows=$('day-list').querySelectorAll('.dayrow'); }
    [].forEach.call(rows,function(r,i){ r.querySelector('.n').textContent='勤務日 '+(i+1); r.querySelector('.del').style.display=rows.length>1?'':'none'; });
    $('add-day').disabled=rows.length>=MAX;
    $('add-day').textContent=rows.length>=MAX?'追加できるのは7日までです':'＋ 日を追加';
    preview();
  }
  function rowsData(){
    return [].map.call($('day-list').querySelectorAll('.dayrow'),function(r){
      return { date:r.querySelector('.d-date').value, start:r.querySelector('.d-start').value, end:r.querySelector('.d-end').value, kyukei:r.querySelector('.d-break').value, bunkatsu:r.querySelector('.d-rest').value, el:r };
    });
  }
  function preview(){
    var totOT=0,cnt=0;
    rowsData().forEach(function(r){ var c=(r.start&&r.end)?rowOT(r):null; r.el.querySelector('.rowcalc').textContent=c?('実働 '+durText(c.work)+' ／ 残業 '+durText(c.ot)):''; if(r.date&&r.start&&r.end){ totOT+=(c?c.ot:0); cnt++; } });
    $('zan-total').textContent=cnt?('残業 合計 '+durText(totOT)+'（'+cnt+'日）'):'';
  }
  function submitApp(appno){
    var rows=rowsData().filter(function(r){ return r.date&&r.start&&r.end; });
    var miss=[];
    if(!$('f-date').value) miss.push('申請日');
    if(rows.length===0) miss.push('勤務日');
    if(!$('f-reason').value.trim()) miss.push('理由');
    if(miss.length){ toast('未入力：'+miss.join('・')); return; }
    var days=rows.map(function(r){ var c=rowOT(r); return { date:r.date, start:r.start, end:r.end, kyukei:parseInt(r.kyukei,10)||0, bunkatsu:parseInt(r.bunkatsu,10)||0, work:c.work, ot:c.ot }; });
    var totOT=days.reduce(function(a,d){ return a+d.ot; },0);
    var detail={ days:days, total_ot:totOT, reason:$('f-reason').value.trim() };
    $('bar-btn').disabled=true;
    api('/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      app_no:appno, type:'残業', applicant_id:user.id, applicant_name:user.name,
      sha:$('f-sha').value.trim(), apply_date:$('f-date').value, detail:detail
    })}).then(function(){ toast('申請を送信しました'); selectTab('mine'); })
      .catch(function(e){ toast(e.message); })
      .then(function(){ $('bar-btn').disabled=false; });
  }

  /* ---------- 一覧 / 承認 ---------- */
  function statusPill(s){
    var m={'承認待ち':'wait','承認済':'ok','却下':'no','一部承認':'part'};
    return '<span class="pill '+(m[s]||'wait')+'">'+s+'</span>';
  }
  function renderList(scope){
    $('app-title').textContent = scope==='pending' ? '承認待ち' : '申請履歴';
    var c=$('content'); c.innerHTML='<div class="empty">読み込み中…</div>';
    var q = scope==='pending' ? '?scope=pending' : ('?scope=mine&user_id='+encodeURIComponent(user.id));
    api('/list'+q).then(function(j){
      c.innerHTML='';
      var list=j.applications||[];
      if(list.length===0){ c.appendChild(el('div','empty', scope==='pending'?'承認待ちの申請はありません':'申請はまだありません')); return; }
      list.forEach(function(a){ c.appendChild(appCard(a, scope==='pending')); });
    }).catch(function(e){ c.innerHTML=''; c.appendChild(el('div','empty',e.message)); });
  }
  function appCard(a, approvable){
    var d=a.detail||{}; var card=el('div','card');
    var head='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<div><b>'+(a.type||'残業')+'申請</b> <span class="muted">No.'+a.app_no+'</span></div>'+statusPill(a.status)+'</div>';
    var who='<div class="muted" style="margin-bottom:8px">'+(a.applicant_name||'')+(a.sha?(' ／ 車番 '+a.sha):'')+' ／ 申請日 '+fmtDate(a.apply_date)+'</div>';
    var lines=(d.days||[]).map(function(day,i){
      var extra=(day.bunkatsu>0?(' 分割休息'+day.bunkatsu+'分'):'');
      return (i+1)+'. '+fmtMD(day.date)+' '+day.start+'〜'+day.end+' 休憩'+(day.kyukei||0)+'分'+extra+' → 残業'+durText(day.ot);
    }).join('<br>');
    var body='<div style="font-size:14px;margin-bottom:6px">'+lines+'</div>'+
      '<div class="total" style="font-size:14px">合計 残業 '+durText(d.total_ot||0)+'</div>'+
      (d.reason?('<div class="muted" style="margin-top:6px">理由：'+escapeHtml(d.reason)+'</div>'):'');
    card.innerHTML=head+who+body;

    if(a.result && a.result.days){
      var rl=a.result.days.map(function(r,i){ return (i+1)+'. '+r.result; }).join('　');
      card.appendChild(el('div','muted','回答：'+rl+(a.approver?('（'+a.approver+'）'):'')+(a.comment?('　'+escapeHtml(a.comment)):'')));
    }

    if(approvable && a.status==='承認待ち'){
      card.appendChild(buildApproveUI(a));
    }
    return card;
  }
  function buildApproveUI(a){
    var wrap=el('div',null); wrap.style.marginTop='12px'; wrap.style.borderTop='1px solid var(--line)'; wrap.style.paddingTop='12px';
    var days=(a.detail&&a.detail.days)||[];
    var decisions=days.map(function(){ return '承認'; });
    var quick=el('div',null,'<div class="muted" style="margin-bottom:6px">日ごとに承認／却下</div>');
    wrap.appendChild(quick);
    days.forEach(function(day,i){
      var r=el('div',null); r.style.marginBottom='8px';
      r.innerHTML='<div style="font-size:13px;margin-bottom:4px">'+(i+1)+'. '+fmtMD(day.date)+' '+day.start+'〜'+day.end+'（残業'+durText(day.ot)+'）</div>';
      var seg=el('div','seg yn');
      ['承認','却下'].forEach(function(v){ var b=el('button',null,v); b.setAttribute('data-v',v); b.setAttribute('aria-pressed', v==='承認'?'true':'false');
        b.addEventListener('click',function(){ decisions[i]=v; [].forEach.call(seg.children,function(x){ x.setAttribute('aria-pressed', x.getAttribute('data-v')===v?'true':'false'); }); });
        seg.appendChild(b);
      });
      r.appendChild(seg); wrap.appendChild(r);
    });
    var cm=el('input'); cm.type='text'; cm.placeholder='コメント（任意）'; cm.style.marginBottom='10px'; wrap.appendChild(cm);
    var btns=el('div','row2');
    var ok=el('button','btn ok','承認を確定'); var no=el('button','btn no','却下');
    btns.appendChild(ok); btns.appendChild(no); wrap.appendChild(btns);
    ok.addEventListener('click',function(){ decide(a, decisions, cm.value); });
    no.addEventListener('click',function(){ decide(a, days.map(function(){return '却下';}), cm.value); });
    return wrap;
  }
  function decide(a, decisions, comment){
    var days=(a.detail&&a.detail.days)||[];
    var resultDays=days.map(function(day,i){ return { date:day.date, result:decisions[i]||'承認' }; });
    var anyOk=decisions.indexOf('承認')>=0, anyNo=decisions.indexOf('却下')>=0;
    var status = anyOk&&anyNo ? '一部承認' : (anyOk ? '承認済' : '却下');
    api('/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      id:a.id, status:status, result:{days:resultDays}, approver:user.name, comment:comment||''
    })}).then(function(){ toast('回答を送信しました'); selectTab('pending'); })
      .catch(function(e){ toast(e.message); });
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
})();
