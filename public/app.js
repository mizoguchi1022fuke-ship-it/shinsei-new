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
      ? [['pending','承認待ち'],['submit','申請する'],['mine','申請履歴'],['summary','集計']]
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
    else if(tab==='summary') renderSummary();
  }
  if(user) enterApp();

  /* ---------- 申請（区分切替） ---------- */
  var days=[];
  function renderSubmit(){
    var c=$('content'); c.innerHTML='';
    var appno=genNo();

    var segCard=el('div','card');
    segCard.innerHTML='<span class="lab">申請区分 <span class="req">*</span></span>'+
      '<div class="seg" id="kubun-seg" style="margin-top:6px">'+
      '<button type="button" data-v="休日出勤" aria-pressed="true">休日出勤</button>'+
      '<button type="button" data-v="休日申請" aria-pressed="false">休日申請</button></div>'+
      '<p class="hint">※残業申請は雇用契約見直しのため、現在一時停止しています。</p>';
    c.appendChild(segCard);

    var basic=el('div','card');
    basic.innerHTML =
      '<label class="lab">申請日 <span class="req">*</span></label><input type="date" id="f-date">'+
      '<div class="row2" style="margin-top:12px"><div><label class="lab">車番</label><input type="text" id="f-sha" placeholder="例）28"></div>'+
      '<div><label class="lab">氏名</label><input type="text" id="f-name" disabled></div></div>';
    c.appendChild(basic);

    var holder=el('div',null); holder.id='kubun-body'; c.appendChild(holder);
    $('f-date').value=todayStr(); $('f-name').value=user.name;

    var kubun='休日出勤';
    function setKubun(v){
      kubun=v;
      [].forEach.call($('kubun-seg').children,function(b){ var on=b.getAttribute('data-v')===v; b.setAttribute('aria-pressed', on?'true':'false'); b.style.background=on?'var(--navy)':'transparent'; b.style.color=on?'#fff':'var(--muted)'; });
      $('app-title').textContent = (v==='休日申請') ? v : v+'申請';
      if(v==='残業') buildZangyo(holder);
      else if(v==='休日出勤') buildKyujitsu(holder);
      else buildKyukyu(holder);
    }
    [].forEach.call($('kubun-seg').children,function(b){ b.addEventListener('click',function(){ setKubun(b.getAttribute('data-v')); }); });

    var bar=$('bar'); bar.classList.remove('hide');
    $('bar-btn').textContent='申請する'; $('bar-btn').className='btn primary';
    $('bar-btn').onclick=function(){
      if(kubun==='残業') submitZangyo(appno);
      else if(kubun==='休日出勤') submitKyujitsu(appno);
      else submitKyukyu(appno);
    };

    setKubun('休日出勤');
  }

  /* ---------- 残業ブロック ---------- */
  function buildZangyo(holder){
    holder.innerHTML='';
    var dcard=el('div','card');
    dcard.innerHTML='<span class="lab">勤務日（最大7日） <span class="req">*</span></span>'+
      '<p class="hint" style="margin:2px 2px 10px">始業・終業・休憩・分割休息から、実働8時間を超えた分が残業として自動計算されます。</p>'+
      '<div id="day-list"></div><button type="button" class="addbtn" id="add-day">＋ 日を追加</button><div class="total" id="zan-total"></div>';
    holder.appendChild(dcard);
    var rcard=el('div','card');
    rcard.innerHTML='<label class="lab">業務内容・理由 <span class="req">*</span></label><textarea id="f-reason" placeholder="例）配送遅延の積み直し対応"></textarea>';
    holder.appendChild(rcard);
    days=[]; $('day-list').innerHTML=''; addDay(todayStr());
    $('add-day').addEventListener('click',function(){ addDay(''); });
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
    if(!$('day-list')) return;
    var totOT=0,cnt=0;
    rowsData().forEach(function(r){ var c=(r.start&&r.end)?rowOT(r):null; r.el.querySelector('.rowcalc').textContent=c?('実働 '+durText(c.work)+' ／ 残業 '+durText(c.ot)):''; if(r.date&&r.start&&r.end){ totOT+=(c?c.ot:0); cnt++; } });
    $('zan-total').textContent=cnt?('残業 合計 '+durText(totOT)+'（'+cnt+'日）'):'';
  }
  function submitZangyo(appno){
    var rows=rowsData().filter(function(r){ return r.date&&r.start&&r.end; });
    var miss=[];
    if(!$('f-date').value) miss.push('申請日');
    if(rows.length===0) miss.push('勤務日');
    if(!$('f-reason').value.trim()) miss.push('理由');
    if(miss.length){ toast('未入力：'+miss.join('・')); return; }
    var dlist=rows.map(function(r){ var c=rowOT(r); return { date:r.date, start:r.start, end:r.end, kyukei:parseInt(r.kyukei,10)||0, bunkatsu:parseInt(r.bunkatsu,10)||0, work:c.work, ot:c.ot }; });
    var totOT=dlist.reduce(function(a,d){ return a+d.ot; },0);
    var detail={ days:dlist, total_ot:totOT, reason:$('f-reason').value.trim() };
    send(appno, '残業', detail);
  }

  /* ---------- 休日出勤ブロック（終日のみ） ---------- */
  function buildKyujitsu(holder){
    holder.innerHTML='';
    var card1=el('div','card');
    card1.innerHTML='<label class="lab">対象日（出勤する日） <span class="req">*</span></label><input type="date" id="k-date">'+
      '<p class="hint">終日の出勤として申請されます。</p>'+
      '<label class="lab" style="margin-top:14px">振替休日 予定日 <span class="req">*</span></label><input type="date" id="k-furikae">'+
      '<p class="hint">休日出勤の振替として取得する休日の予定日を入力してください。</p>';
    holder.appendChild(card1);
    var rcard=el('div','card');
    rcard.innerHTML='<label class="lab">業務内容・理由 <span class="req">*</span></label><textarea id="k-reason" placeholder="例）ABC商会 ○○〜××の運行"></textarea>'+
      '<p class="hint">運賃が分かる場合は、あわせてご記入ください（不明な場合は未記入で構いません）。</p>';
    holder.appendChild(rcard);
    $('k-date').value=todayStr();
  }
  function submitKyujitsu(appno){
    var date=$('k-date').value, fu=$('k-furikae').value, reason=$('k-reason').value.trim();
    var miss=[];
    if(!$('f-date').value) miss.push('申請日');
    if(!date) miss.push('対象日');
    if(!fu) miss.push('振替休日 予定日');
    if(!reason) miss.push('理由');
    if(miss.length){ toast('未入力：'+miss.join('・')); return; }
    var detail={ date:date, furikae:fu, reason:reason };
    send(appno, '休日出勤', detail);
  }

  /* ---------- 休日申請ブロック（終日・出勤なし） ---------- */
  function buildKyukyu(holder){
    holder.innerHTML='';
    var card1=el('div','card');
    card1.innerHTML='<label class="lab">対象日（休む日） <span class="req">*</span></label><input type="date" id="q-date">'+
      '<p class="hint">終日の休みとして申請されます。出勤はしません。</p>';
    holder.appendChild(card1);
    var rcard=el('div','card');
    rcard.innerHTML='<label class="lab">理由 <span class="req">*</span></label><textarea id="q-reason" placeholder="例）私用のため"></textarea>';
    holder.appendChild(rcard);
    $('q-date').value=todayStr();
  }
  function submitKyukyu(appno){
    var date=$('q-date').value, reason=$('q-reason').value.trim();
    var miss=[];
    if(!$('f-date').value) miss.push('申請日');
    if(!date) miss.push('対象日');
    if(!reason) miss.push('理由');
    if(miss.length){ toast('未入力：'+miss.join('・')); return; }
    var detail={ date:date, reason:reason };
    send(appno, '休日申請', detail);
  }

  function send(appno, type, detail){
    $('bar-btn').disabled=true;
    api('/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      app_no:appno, type:type, applicant_id:user.id, applicant_name:user.name,
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
    var typeLabel=(a.type||'残業'); typeLabel = typeLabel.indexOf('申請')>=0 ? typeLabel : typeLabel+'申請';
    var head='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<div><b>'+typeLabel+'</b> <span class="muted">No.'+a.app_no+'</span></div>'+statusPill(a.status)+'</div>';
    var who='<div class="muted" style="margin-bottom:8px">'+(a.applicant_name||'')+(a.sha?(' ／ 車番 '+a.sha):'')+' ／ 申請日 '+fmtDate(a.apply_date)+'</div>';
    var body;
    if(a.type==='休日出勤'){
      body='<div style="font-size:14px;line-height:1.8">'+
        '対象日：'+fmtDate(d.date)+'（終日）<br>'+
        '振替休日：'+fmtDate(d.furikae)+'</div>'+
        (d.reason?('<div class="muted" style="margin-top:6px">理由：'+escapeHtml(d.reason)+'</div>'):'');
    } else if(a.type==='休日申請'){
      body='<div style="font-size:14px;line-height:1.8">対象日：'+fmtDate(d.date)+'（終日）</div>'+
        (d.reason?('<div class="muted" style="margin-top:6px">理由：'+escapeHtml(d.reason)+'</div>'):'');
    } else {
      var lines=(d.days||[]).map(function(day,i){
        var extra=(day.bunkatsu>0?(' 分割休息'+day.bunkatsu+'分'):'');
        return (i+1)+'. '+fmtMD(day.date)+' '+day.start+'〜'+day.end+' 休憩'+(day.kyukei||0)+'分'+extra+' → 残業'+durText(day.ot);
      }).join('<br>');
      body='<div style="font-size:14px;margin-bottom:6px">'+lines+'</div>'+
        '<div class="total" style="font-size:14px">合計 残業 '+durText(d.total_ot||0)+'</div>'+
        (d.reason?('<div class="muted" style="margin-top:6px">理由：'+escapeHtml(d.reason)+'</div>'):'');
    }
    card.innerHTML=head+who+body;

    if(a.result){
      if((a.type==='休日出勤'||a.type==='休日申請') && a.result.overall){
        card.appendChild(el('div','muted','回答：'+a.result.overall+(a.approver?('（'+a.approver+'）'):'')+(a.comment?('　'+escapeHtml(a.comment)):'')));
      } else if(a.result.days){
        var rl=a.result.days.map(function(r,i){ return (i+1)+'. '+r.result; }).join('　');
        card.appendChild(el('div','muted','回答：'+rl+(a.approver?('（'+a.approver+'）'):'')+(a.comment?('　'+escapeHtml(a.comment)):'')));
      }
    }

    // 残業の60時間アラート（承認待ち一覧でのみ付与される）
    if(a.type==='残業' && typeof a.month_approved_ot==='number'){
      var refYm=a.month_label||'';
      var thisOt=(d.days||[]).filter(function(day){return String(day.date).slice(0,7)===refYm;}).reduce(function(s,day){return s+(day.ot||0);},0);
      var combined=a.month_approved_ot+thisOt;
      var ymLabel= refYm ? (refYm.split('-')[0]+'年'+(+refYm.split('-')[1])+'月') : '当月';
      var bg='#eef4ec', col='#1f8a4c', tag='';
      if(combined>=3600){ bg='#fbe3e3'; col='#c0392b'; tag='⚠ 月60時間に達しています'; }
      else if(combined>=2700){ bg='#fff3da'; col='#9a6b00'; tag='月45時間を超えています'; }
      var box=el('div',null,
        '<div style="font-size:12.5px;color:#6b7785;margin-bottom:2px">'+ymLabel+'の残業（承認済み）合計 '+durText(a.month_approved_ot)+'</div>'+
        '<div style="font-size:14px;font-weight:800;color:'+col+'">この申請を含めると '+durText(combined)+'</div>'+
        (tag?('<div style="font-size:12px;font-weight:700;color:'+col+';margin-top:2px">'+tag+'</div>'):''));
      box.style.cssText='background:'+bg+';border-radius:10px;padding:10px 12px;margin-top:10px';
      card.appendChild(box);
    }

    if(approvable && a.status==='承認待ち'){
      card.appendChild(buildApproveUI(a));
    }
    return card;
  }
  function buildApproveUI(a){
    var wrap=el('div',null); wrap.style.marginTop='12px'; wrap.style.borderTop='1px solid var(--line)'; wrap.style.paddingTop='12px';

    if(a.type==='休日出勤' || a.type==='休日申請'){
      var decision={v:'承認'};
      wrap.appendChild(el('div','muted','<div style="margin-bottom:6px">承認／却下</div>'));
      var seg=el('div','seg yn');
      ['承認','却下'].forEach(function(v){ var b=el('button',null,v); b.setAttribute('data-v',v); b.setAttribute('aria-pressed', v==='承認'?'true':'false');
        b.addEventListener('click',function(){ decision.v=v; [].forEach.call(seg.children,function(x){ x.setAttribute('aria-pressed', x.getAttribute('data-v')===v?'true':'false'); }); });
        seg.appendChild(b);
      });
      wrap.appendChild(seg);
      var cm=el('input'); cm.type='text'; cm.placeholder='コメント（任意）'; cm.style.margin='10px 0'; wrap.appendChild(cm);
      var btn=el('button','btn primary','回答を確定');
      btn.addEventListener('click',function(){
        var status= decision.v==='承認' ? '承認済' : '却下';
        sendDecide(a,{ id:a.id, status:status, result:{overall:decision.v}, approver:user.name, comment:cm.value||'' });
      });
      wrap.appendChild(btn);
      return wrap;
    }

    var dlist=(a.detail&&a.detail.days)||[];
    var decisions=dlist.map(function(){ return '承認'; });
    wrap.appendChild(el('div','muted','<div style="margin-bottom:6px">日ごとに承認／却下</div>'));
    dlist.forEach(function(day,i){
      var r=el('div',null); r.style.marginBottom='8px';
      r.innerHTML='<div style="font-size:13px;margin-bottom:4px">'+(i+1)+'. '+fmtMD(day.date)+' '+day.start+'〜'+day.end+'（残業'+durText(day.ot)+'）</div>';
      var seg=el('div','seg yn');
      ['承認','却下'].forEach(function(v){ var b=el('button',null,v); b.setAttribute('data-v',v); b.setAttribute('aria-pressed', v==='承認'?'true':'false');
        b.addEventListener('click',function(){ decisions[i]=v; [].forEach.call(seg.children,function(x){ x.setAttribute('aria-pressed', x.getAttribute('data-v')===v?'true':'false'); }); });
        seg.appendChild(b);
      });
      r.appendChild(seg); wrap.appendChild(r);
    });
    var cm2=el('input'); cm2.type='text'; cm2.placeholder='コメント（任意）'; cm2.style.marginBottom='10px'; wrap.appendChild(cm2);
    var btns=el('div','row2');
    var ok=el('button','btn ok','承認を確定'); var no=el('button','btn no','却下');
    btns.appendChild(ok); btns.appendChild(no); wrap.appendChild(btns);
    ok.addEventListener('click',function(){ decideZangyo(a, decisions, cm2.value); });
    no.addEventListener('click',function(){ decideZangyo(a, dlist.map(function(){return '却下';}), cm2.value); });
    return wrap;
  }
  function decideZangyo(a, decisions, comment){
    var dlist=(a.detail&&a.detail.days)||[];
    var resultDays=dlist.map(function(day,i){ return { date:day.date, result:decisions[i]||'承認' }; });
    var anyOk=decisions.indexOf('承認')>=0, anyNo=decisions.indexOf('却下')>=0;
    var status = anyOk&&anyNo ? '一部承認' : (anyOk ? '承認済' : '却下');
    sendDecide(a,{ id:a.id, status:status, result:{days:resultDays}, approver:user.name, comment:comment||'' });
  }
  function sendDecide(a, payload){
    api('/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(){ toast('回答を送信しました'); selectTab('pending'); })
      .catch(function(e){ toast(e.message); });
  }

  /* ---------- 集計 ---------- */
  function renderSummary(){
    $('app-title').textContent='集計';
    var c=$('content'); c.innerHTML='';
    var now=new Date(); var defYm=now.getFullYear()+'-'+('0'+(now.getMonth()+1)).slice(-2);

    var head=el('div','card');
    head.innerHTML='<label class="lab">対象月</label>'+
      '<div class="row2"><input type="month" id="sum-ym" value="'+defYm+'"><button class="btn primary" id="sum-go" style="white-space:nowrap">表示</button></div>'+
      '<button class="btn" id="sum-xlsx" style="margin-top:10px">xlsxで書き出す</button>';
    c.appendChild(head);
    var area=el('div',null); area.id='sum-area'; c.appendChild(area);

    var lastRows=[], lastYm=defYm;
    function load(){
      var ym=$('sum-ym').value||defYm; lastYm=ym;
      area.innerHTML='<div class="empty">読み込み中…</div>';
      api('/summary?ym='+encodeURIComponent(ym)).then(function(j){
        lastRows=j.rows||[]; drawSummary(area, lastRows, ym);
      }).catch(function(e){ area.innerHTML=''; area.appendChild(el('div','empty',e.message)); });
    }
    $('sum-go').addEventListener('click',load);
    $('sum-xlsx').addEventListener('click',function(){ exportXlsx(lastRows, lastYm); });
    load();
  }

  function drawSummary(area, rows, ym){
    area.innerHTML='';
    var ymLabel=ym.split('-')[0]+'年'+(+ym.split('-')[1])+'月';
    if(rows.length===0){ area.appendChild(el('div','empty', ymLabel+'の承認済みデータはありません')); return; }

    // 個人別サマリー
    var per={}; // name -> {ot:分, kyu:休日出勤日数, yasumi:休日申請日数}
    rows.forEach(function(r){
      per[r.name]=per[r.name]||{ot:0,kyu:0,yasumi:0};
      if(r.type==='残業') per[r.name].ot+=(r.ot||0);
      else if(r.type==='休日出勤') per[r.name].kyu+=1;
      else per[r.name].yasumi+=1;
    });
    var sumCard=el('div','card');
    var html='<span class="lab">個人別（'+ymLabel+'）</span><div style="margin-top:8px">';
    Object.keys(per).sort().forEach(function(name){
      var p=per[name];
      var col= p.ot>=3600?'#c0392b':(p.ot>=2700?'#9a6b00':'#1b2733');
      var warn= p.ot>=3600?' ⚠60h':(p.ot>=2700?' 45h超':'');
      html+='<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line)">'+
        '<span style="font-weight:700">'+escapeHtml(name)+'</span>'+
        '<span style="font-size:13.5px">残業 <b style="color:'+col+'">'+durText(p.ot)+'</b>'+(warn?'<span style="color:'+col+';font-weight:700">'+warn+'</span>':'')+' ／ 休日出勤 '+p.kyu+'日 ／ 休日申請 '+p.yasumi+'日</span></div>';
    });
    html+='</div>';
    sumCard.innerHTML=html;
    area.appendChild(sumCard);

    // 明細
    var detCard=el('div','card');
    var dh='<span class="lab">明細（'+rows.length+'件）</span><div style="margin-top:8px;font-size:13px">';
    rows.forEach(function(r){
      var line;
      if(r.type==='残業') line=fmtMD(r.date)+' '+escapeHtml(r.name)+' 残業'+durText(r.ot);
      else if(r.type==='休日出勤') line=fmtMD(r.date)+' '+escapeHtml(r.name)+' 休日出勤'+(r.furikae?('／振替'+fmtMD(r.furikae)):'');
      else line=fmtMD(r.date)+' '+escapeHtml(r.name)+' 休日申請';
      dh+='<div style="padding:6px 0;border-bottom:1px solid var(--line)">'+line+(r.status==='一部承認'?' <span class="muted">(一部承認)</span>':'')+'</div>';
    });
    dh+='</div>';
    detCard.innerHTML=dh;
    area.appendChild(detCard);
  }

  function exportXlsx(rows, ym){
    if(!rows || rows.length===0){ toast('書き出すデータがありません'); return; }
    if(typeof XLSX==='undefined'){ toast('Excel機能を読み込み中です。少し待って再度お試しください'); return; }

    // シート1：個人別サマリー
    var per={}; // name -> {ot:分, kyu:休日出勤日数, yasumi:休日申請日数}
    rows.forEach(function(r){
      per[r.name]=per[r.name]||{ot:0,kyu:0,yasumi:0};
      if(r.type==='残業') per[r.name].ot+=(r.ot||0);
      else if(r.type==='休日出勤') per[r.name].kyu+=1;
      else per[r.name].yasumi+=1;
    });
    var sumAoa=[['氏名','残業時間','60h警告','休日出勤(日)','休日申請(日)']];
    Object.keys(per).sort().forEach(function(name){
      var p=per[name];
      var warn = p.ot>=3600 ? '⚠60h超' : (p.ot>=2700 ? '45h超' : '');
      sumAoa.push([name, durText(p.ot), warn, p.kyu, p.yasumi]);
    });
    var ws1=XLSX.utils.aoa_to_sheet(sumAoa);
    ws1['!cols']=[{wch:14},{wch:10},{wch:10},{wch:13},{wch:13}];

    // シート2：明細
    var detAoa=[['日付','氏名','車番','区分','残業時間','開始','終了','振替休日','理由','状態','承認者']];
    rows.forEach(function(r){
      var ot = r.type==='残業' ? durText(r.ot) : '';
      detAoa.push([r.date, r.name, r.sha||'', r.type, ot, r.start||'', r.end||'', r.furikae||'', r.reason||'', r.status, r.approver||'']);
    });
    var ws2=XLSX.utils.aoa_to_sheet(detAoa);
    ws2['!cols']=[{wch:11},{wch:10},{wch:7},{wch:10},{wch:9},{wch:7},{wch:7},{wch:11},{wch:32},{wch:9},{wch:10}];

    var wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, '個人別サマリー');
    XLSX.utils.book_append_sheet(wb, ws2, '明細');
    XLSX.writeFile(wb, '集計_'+ym+'.xlsx');
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
})();
