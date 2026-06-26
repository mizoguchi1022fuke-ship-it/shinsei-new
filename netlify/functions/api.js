// 溝口急送 申請アプリ : サーバー処理（すべての /api/* をこの1ファイルで処理）
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  process.env.VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || ''
);

function json(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

async function pushTo(employeeIds, payload) {
  if (!employeeIds || employeeIds.length === 0) return;
  const { data: subs } = await supabase
    .from('push_subscriptions').select('id,subscription').in('employee_id', employeeIds);
  if (!subs) return;
  await Promise.all(subs.map(async (row) => {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify(payload));
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', row.id);
      }
    }
  }));
}

exports.handler = async (event) => {
  // 末尾のパスでどの処理かを判定（例 /api/login → 'login'）
  const action = (event.path || '').split('/').filter(Boolean).pop();
  let body = {};
  if (event.body) { try { body = JSON.parse(event.body); } catch { return json(400, { error: 'bad json' }); } }
  const q = event.queryStringParameters || {};

  try {
    // VAPID公開鍵を返す
    if (action === 'config') {
      return json(200, { vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '' });
    }

    // ログイン（名前＋社員番号）
    if (action === 'login') {
      const name = (body.name || '').trim();
      const emp_no = String(body.emp_no || '').trim();
      if (!name || !emp_no) return json(400, { error: '名前と社員番号を入力してください' });
      const { data, error } = await supabase
        .from('employees').select('id,name,role').eq('name', name).eq('emp_no', emp_no).maybeSingle();
      if (error) return json(500, { error: error.message });
      if (!data) return json(401, { error: '名前または社員番号が違います' });
      return json(200, { user: data });
    }

    // プッシュ購読の保存
    if (action === 'subscribe') {
      const { employee_id, subscription } = body;
      if (!employee_id || !subscription || !subscription.endpoint) return json(400, { error: 'bad request' });
      const { error } = await supabase.from('push_subscriptions')
        .upsert({ employee_id, endpoint: subscription.endpoint, subscription }, { onConflict: 'endpoint' });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    // 申請の保存＋承認者へ通知
    if (action === 'submit') {
      if (!body.applicant_id || !body.detail) return json(400, { error: '入力が不足しています' });
      const rec = {
        app_no: body.app_no || String(Math.floor(100000 + Math.random() * 900000)),
        type: body.type || '残業',
        applicant_id: body.applicant_id,
        applicant_name: body.applicant_name || '',
        sha: body.sha || '',
        apply_date: body.apply_date || null,
        detail: body.detail,
        status: '承認待ち'
      };
      const { data, error } = await supabase.from('applications').insert(rec).select().single();
      if (error) return json(500, { error: error.message });
      const { data: mgrs } = await supabase.from('employees').select('id').eq('role', 'manager');
      await pushTo((mgrs || []).map(m => m.id), {
        title: '新しい' + rec.type + '申請',
        body: `${rec.applicant_name} さんから申請（No.${rec.app_no}）`,
        url: './'
      });
      return json(200, { application: data });
    }

    // 一覧取得
    if (action === 'list') {
      let query = supabase.from('applications').select('*').order('created_at', { ascending: false }).limit(100);
      if (q.scope === 'pending') query = query.eq('status', '承認待ち');
      else if (q.scope === 'mine' && q.user_id) query = query.eq('applicant_id', q.user_id);
      const { data, error } = await query;
      if (error) return json(500, { error: error.message });

      // 承認待ち一覧には、申請者の「当月の承認済み残業」を付与（60時間アラート用）
      if (q.scope === 'pending' && data && data.length) {
        const ids = [...new Set(data.filter(a => a.type === '残業' && a.applicant_id).map(a => a.applicant_id))];
        if (ids.length) {
          const { data: approved } = await supabase.from('applications')
            .select('applicant_id,status,detail,result')
            .in('applicant_id', ids).eq('type', '残業').in('status', ['承認済', '一部承認']);
          const map = {}; // applicant_id -> { 'YYYY-MM': minutes }
          (approved || []).forEach(ap => {
            const days = (ap.detail && ap.detail.days) || [];
            let okDates = null;
            if (ap.status === '一部承認' && ap.result && ap.result.days) {
              okDates = new Set(ap.result.days.filter(r => r.result === '承認').map(r => r.date));
            }
            days.forEach(day => {
              if (okDates && !okDates.has(day.date)) return;
              const ym = String(day.date).slice(0, 7);
              map[ap.applicant_id] = map[ap.applicant_id] || {};
              map[ap.applicant_id][ym] = (map[ap.applicant_id][ym] || 0) + (day.ot || 0);
            });
          });
          data.forEach(a => {
            if (a.type !== '残業') return;
            const days = (a.detail && a.detail.days) || [];
            const refYm = (days[0] && String(days[0].date).slice(0, 7)) || (a.apply_date && String(a.apply_date).slice(0, 7)) || '';
            a.month_label = refYm;
            a.month_approved_ot = (map[a.applicant_id] && map[a.applicant_id][refYm]) || 0;
          });
        }
      }
      return json(200, { applications: data });
    }

    // 承認／却下＋申請者へ通知
    if (action === 'decide') {
      if (!body.id || !body.status) return json(400, { error: 'bad request' });
      const upd = {
        status: body.status,
        result: body.result || null,
        approver: body.approver || '',
        comment: body.comment || '',
        decided_at: new Date().toISOString()
      };
      const { data, error } = await supabase.from('applications').update(upd).eq('id', body.id).select().single();
      if (error) return json(500, { error: error.message });
      if (data.applicant_id) {
        await pushTo([data.applicant_id], {
          title: `申請が${body.status}になりました`,
          body: `No.${data.app_no}（${body.approver || '承認者'}）`,
          url: './'
        });
      }
      return json(200, { application: data });
    }

    return json(404, { error: 'unknown action: ' + action });
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
};
