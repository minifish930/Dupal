/* Account-private cloud sync. Shared snapshots use server-side version checks;
 * a stale device is never allowed to silently overwrite another device. */
(() => {
  const config = window.FAMILY_CLOUD_CONFIG || {};
  const configured = /^https:\/\/[^/]+\.supabase\.co$/.test(config.url || '') && Boolean(config.publishableKey);
  const guestKey = 'family-island-v1';
  let client, owner = null, version = 0, pending = null, conflict = null;
  let loading = false, syncing = false, authBusy = false, startup = configured, loadError = false, recovering = false;
  let status = configured ? '正在连接云端' : '本机保存';
  let lastSync = null;
  const copy = value => JSON.parse(JSON.stringify(value));
  const shared = value => { const result = copy(value); delete result.member; return result; };
  const key = () => `family-island-account-${owner}`;
  const read = name => { try { return JSON.parse(localStorage.getItem(name)); } catch { return null; } };
  function setStatus(text) { status = text; decorate(); }
  function cache() {
    if (owner) localStorage.setItem(key(), JSON.stringify({state,version,pending,conflict}));
  }
  function decorate() {
    const button = document.querySelector('#account');
    if (button) {
      button.textContent = owner ? `☁ ${status}` : '☁ 登录同步';
      button.title = owner ? `我的账号 · ${status}` : '登录后在电脑和手机间同步';
    }
    for (const element of document.querySelectorAll('[data-sync-status]')) element.textContent = `● ${status}`;
  }
  function valid(data) {
    return data && Array.isArray(data.people) && data.people.some(p => !p.archived)
      && ['tasks','history','records','goal'].every(k => Array.isArray(data[k]));
  }
  function apply(payload) {
    if (!valid(payload)) throw new Error('云端数据格式不正确，请勿覆盖本机数据');
    const member = state.member;
    state = copy(payload);
    state.member = state.people[member] && !state.people[member].archived ? member : state.people.findIndex(p => !p.archived);
    selected = null;
    rollDay();
    cache();
    render();
  }
  function errorText(error) {
    const message = error?.message || '';
    if (/Invalid login credentials/i.test(message)) return '邮箱或密码不正确';
    if (/Email not confirmed/i.test(message)) return '请先点击邮箱里的确认链接，再登录';
    if (/rate limit|too many/i.test(message)) return '操作较频繁，请稍后再试';
    if (/security purposes|email address.*invalid|email.*not authorized/i.test(message)) return '邮件发送受限，请检查项目的邮件服务设置';
    if (/fetch|network|timeout/i.test(message)) return '暂时无法连接云端，请检查网络后重试';
    return message || '操作未完成，请稍后重试';
  }
  function persist(value) {
    if (!owner) { localStorage.setItem(guestKey, JSON.stringify(value)); return; }
    if (loading || conflict) return;
    const payload = shared(value);
    // Switching the visible family member is a device preference, not a cloud edit.
    const previous = read(key());
    if (previous && JSON.stringify(shared(previous.state)) === JSON.stringify(payload)) { cache(); return; }
    pending = {payload, requestId:crypto.randomUUID()};
    cache(); setStatus(navigator.onLine ? '正在同步…' : '离线 · 等待同步');
    void flush();
  }
  async function flush() {
    if (!owner || !client || !pending || loading || syncing || conflict || !navigator.onLine) return;
    syncing = true;
    const account = owner;
    try {
      while (pending && account === owner && !conflict) {
        const sending = pending;
        const {data,error} = await client.rpc('sync_family_space', {
          expected_version:version, new_payload:sending.payload, request_id:sending.requestId
        });
        if (error) throw error;
        if (owner !== account) return;
        if (!data?.ok) {
          if (!data?.conflict || !valid(data.payload)) throw new Error('同步返回异常，已保留本机数据');
          conflict = {payload:data.payload,version:data.version,local:copy(state)};
          cache(); setStatus('有更新待处理');
          toast('另一台设备也更新了数据，本机改动已保留，请处理同步冲突');
          showConflict();
          return;
        }
        version = data.version;
        if (pending?.requestId === sending.requestId) pending = null;
        lastSync = new Date(); cache();
      }
      setStatus('已同步');
    } catch (error) {
      setStatus('同步失败 · 本机已保留');
      console.warn('Family sync:', errorText(error));
    } finally { syncing = false; }
  }
  async function pull() {
    if (!owner || !client || loading || syncing || conflict) return;
    if (pending) { await flush(); return; }
    const account = owner;
    try {
      const {data,error} = await client.from('family_spaces').select('payload,version').maybeSingle();
      if (error) throw error;
      if (account !== owner || pending || syncing || conflict || !data) return;
      if (data.version > version) {
        if (document.querySelector('#dialog')?.open) {
          closeDialog(); toast('其他设备有新的进展，页面已更新，请重新操作');
        }
        version = data.version; apply(data.payload);
      }
      lastSync = new Date(); if (!pending) setStatus('已同步');
    } catch { setStatus('连接中断 · 本机可用'); }
  }
  function showConflict() {
    if (!conflict) return;
    openDialog(`<h2>另一台设备也有新的进展</h2><p>为了避免覆盖任务或重复领取奖励，已暂停同步。本机尚未同步的改动仍保存在这台设备上。</p><p class="note">请先下载本机备份，再载入云端版本。需要保留的任务可对照备份重新添加，奖励不会自动重复合并。</p><div class="form-actions"><button class="outline" onclick="FamilyCloud.downloadBackup()">下载本机备份</button><button class="primary" onclick="FamilyCloud.acceptRemote()">载入云端版本</button></div><button class="focus-action" onclick="closeDialog()">稍后处理</button>`);
  }
  function downloadBackup() {
    const backup = conflict?.local || state;
    const blob = new Blob([JSON.stringify(backup,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `家庭冒险岛备份-${today()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function acceptRemote() {
    if (!conflict) return;
    localStorage.setItem(`${key()}-conflict-backup`,JSON.stringify(conflict.local));
    const remote = conflict; conflict = null; pending = null; version = remote.version;
    apply(remote.payload); cache(); closeDialog(); if (!pending) setStatus('已同步');
    toast('已载入云端进展，本机旧版本另有备份');
  }
  function accountDialog(mode = 'login') {
    if (conflict) { showConflict(); return; }
    if (!configured) {
      openDialog('<h2>云端同步正在准备中</h2><p>当前数据仍安全保存在本机。项目配置完成后即可使用邮箱登录，在手机和电脑间同步。</p><div class="form-actions"><button class="primary" onclick="closeDialog()">知道了</button></div>'); return;
    }
    if (loading && loadError) {
      openDialog('<h2>云端家庭暂时无法载入</h2><p>当前设备的数据未被覆盖。可以检查网络后重试，或退出账号继续使用本机模式。</p><div class="form-actions"><button class="outline" onclick="FamilyCloud.signOut()">退出账号</button><button class="primary" onclick="FamilyCloud.syncNow()">重新载入</button></div>'); return;
    }
    if (loading && owner && status === '等待设置云端家庭') { migrationDialog(); return; }
    if (startup || loading) { toast('正在连接账号，请稍候'); return; }
    if (!client) {
      openDialog('<h2>登录服务暂时无法连接</h2><p>本机数据仍保留。请检查网络后重试。</p><div class="form-actions"><button class="outline" onclick="closeDialog()">取消</button><button class="primary" onclick="FamilyCloud.reconnect()">重新连接</button></div>'); return;
    }
    if (owner) {
      openDialog(`<h2>我的家庭账号</h2><p>${esc(clientUserEmail || '')}</p><p class="note">${esc(status)}${lastSync ? ` · ${lastSync.toLocaleTimeString('zh-CN')}` : ''}<br>电脑和手机使用同一账号，即可同步同一个家庭。角色切换只影响当前设备。</p><div class="form-actions"><button class="outline" onclick="FamilyCloud.downloadBackup()">下载备份</button><button class="outline" onclick="FamilyCloud.syncNow()">立即同步</button><button class="primary" onclick="FamilyCloud.signOut()">退出账号</button></div><button class="focus-action" onclick="closeDialog()">关闭</button>`); return;
    }
    const recovery = mode === 'recover', register = mode === 'register';
    openDialog(`<h2>${recovery?'找回登录密码':register?'创建家庭账号':'登录，让进展随身同行'}</h2><p class="sub">一个账号连接全家的每一次小进步。</p><form onsubmit="FamilyCloud.authenticate(event,'${mode}')"><label for="authEmail">邮箱</label><input id="authEmail" name="email" type="email" autocomplete="email" required maxlength="254">${recovery?'':`<label for="authPassword">密码</label><input id="authPassword" name="password" type="password" autocomplete="${register?'new-password':'current-password'}" minlength="8" required>`}<p id="authMessage" class="auth-message" role="status"></p><div class="form-actions"><button type="button" class="outline" onclick="closeDialog()">取消</button><button class="primary" id="authSubmit">${recovery?'发送重置邮件':register?'注册家庭账号':'登录'}</button></div></form><div class="auth-links"><button onclick="FamilyCloud.accountDialog('${register||recovery?'login':'register'}')">${register||recovery?'已有账号，去登录':'首次使用？注册账号'}</button>${recovery?'':'<button onclick="FamilyCloud.accountDialog(\'recover\')">忘记密码</button>'}</div><p class="note">首次登录可选择导入此设备的数据。不同账号的数据独立保存。</p>`);
  }
  let clientUserEmail = '';
  function authMessage(text) { const el = document.querySelector('#authMessage'); if (el) el.textContent = text; }
  async function authenticate(event,mode) {
    event.preventDefault(); if (authBusy || !client) return;
    authBusy = true;
    const button = document.querySelector('#authSubmit'); if (button) button.disabled = true;
    const data = new FormData(event.target), email = String(data.get('email')||'').trim(), password = String(data.get('password')||'');
    authMessage('正在处理…');
    try {
      if (mode === 'recover') {
        const {error} = await client.auth.resetPasswordForEmail(email,{redirectTo:config.redirectUrl});
        if (error) throw error;
        authMessage('若该邮箱已注册，将收到密码重置邮件。请检查收件箱和垃圾邮件。');
      } else {
        const result = mode === 'register'
          ? await client.auth.signUp({email,password,options:{emailRedirectTo:config.redirectUrl}})
          : await client.auth.signInWithPassword({email,password});
        if (result.error) throw result.error;
        if (!result.data.session) authMessage('请前往邮箱确认注册，然后返回登录。');
        else { closeDialog(); await activate(result.data.session.user); }
      }
    } catch (error) { authMessage(errorText(error)); }
    finally { authBusy = false; if (button?.isConnected) button.disabled = false; }
  }
  function newFamily() {
    return {day:today(),people:[{name:'我',avatar:'🌻',role:'新晋冒险家',energy:0,xp:0,minutes:0,duration:25}],tasks:[],history:[],records:[],goal:[],timer:null};
  }
  function migrationDialog() {
    openDialog(`<h2>开启全家的云端冒险</h2><p>这个账号还没有云端数据。你可以导入此设备的 ${state.people.filter(p=>!p.archived).length} 位成员及现有任务，也可以从空白家庭开始。</p><p class="note">导入会将成员昵称、任务、积分和记录保存到此账号的私有云端空间。其他终端登录同一账号即可查看。</p><div class="form-actions"><button class="outline" onclick="FamilyCloud.createSpace(false)">新建空白家庭</button><button class="primary" onclick="FamilyCloud.createSpace(true)">导入此设备数据</button></div><button class="focus-action" onclick="FamilyCloud.signOut()">暂不设置，退出账号</button>`);
  }
  async function createSpace(importLocal) {
    if (!owner || syncing || !loading || status !== '等待设置云端家庭') return;
    loading = false;
    const data = importLocal ? copy(state) : {...newFamily(),member:0};
    state = data; pending = {payload:shared(data),requestId:crypto.randomUUID()}; version = 0;
    cache(); closeDialog(); render(); setStatus('正在创建家庭…'); await flush();
  }
  async function activate(user) {
    if (!user || owner === user.id) return;
    if (owner && owner !== user.id) { state = read(guestKey) || copy(initial); selected = null; }
    owner = user.id; clientUserEmail = user.email; loading = true; loadError = false; conflict = null; pending = null;
    setStatus('正在载入家庭…');
    const account = owner, cached = read(key());
    try {
      const {data,error} = await client.from('family_spaces').select('payload,version').maybeSingle();
      if (error) throw error;
      if (owner !== account) return;
      if (!data) {
        version = 0;
        if (cached?.pending && valid(cached.state)) {
          state = cached.state; pending = cached.pending; loading = false;
          render(); await flush();
        } else { setStatus('等待设置云端家庭'); if (!recovering) migrationDialog(); }
        return;
      }
      if (cached?.pending && valid(cached.state)) {
        state = cached.state; version = cached.version; pending = cached.pending; conflict = cached.conflict || null;
        loading = false; render();
        if (conflict) { setStatus('有更新待处理'); showConflict(); } else await flush();
      } else {
        version = data.version; loading = false; apply(data.payload); lastSync = new Date(); if (!pending) setStatus('已同步');
      }
    } catch (error) {
      if (owner !== account) return;
      if (cached && valid(cached.state)) {
        state = cached.state; version = cached.version; pending = cached.pending; conflict = cached.conflict || null;
        loading = false; render(); setStatus('离线 · 本机缓存');
      } else { loadError = true; setStatus('云端暂不可用'); toast(errorText(error)); }
    }
  }
  async function signOut() {
    if (pending) { await flush(); if (pending) { toast('仍有未同步的数据，请恢复网络或处理冲突后再退出'); return; } }
    const {error} = await client.auth.signOut();
    if (error) { toast(errorText(error)); return; }
    leaveAccount(); closeDialog(); toast('已退出账号');
  }
  function leaveAccount() {
    if (!owner) return;
    owner = null; version = 0; pending = null; conflict = null; loading = false;
    state = read(guestKey) || copy(initial); selected = null; render(); setStatus('本机保存');
  }
  function passwordDialog() {
    openDialog('<h2>设置新的登录密码</h2><form onsubmit="FamilyCloud.resetPassword(event)"><label for="newPassword">新密码（至少 8 位）</label><input id="newPassword" name="password" type="password" autocomplete="new-password" minlength="8" required><p id="authMessage" class="auth-message" role="status"></p><div class="form-actions"><button class="primary" id="authSubmit">保存新密码</button></div></form>');
  }
  async function resetPassword(event) {
    event.preventDefault(); if (authBusy) return; authBusy = true;
    try {
      const {error} = await client.auth.updateUser({password:new FormData(event.target).get('password')});
      if (error) throw error;
      recovering = false; closeDialog(); toast('密码已更新');
      if (loading && version === 0 && !loadError) migrationDialog();
    } catch (error) { authMessage(errorText(error)); }
    finally { authBusy = false; }
  }
  async function syncNow() { if (owner && loading) { const previous = owner; owner = null; await activate({id:previous,email:clientUserEmail}); } else { await flush(); await pull(); } if (owner && !loading) accountDialog(); }
  window.FamilyCloud = {persist,decorate,accountDialog,authenticate,createSpace,signOut,downloadBackup,acceptRemote,syncNow,resetPassword,
    reconnect:() => { closeDialog(); startup = true; setStatus('正在连接云端'); void init(); },
    canTick:() => !startup && !loading && !conflict,
    isCloud:() => Boolean(owner)};
  // A loading/conflicted account must not mutate a guest snapshot or award a timer twice.
  function protect(event) {
    if (!startup && !loading && !conflict) return;
    if (!event.target.closest('#main,#member')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (conflict) showConflict();
    else if (owner && loading && status === '等待设置云端家庭') migrationDialog();
    else if (loadError) accountDialog();
    else toast('请等待云端载入完成，或点击账号重试');
  }
  document.addEventListener('click',protect,true); document.addEventListener('submit',protect,true);
  window.addEventListener('online',() => { void flush(); void pull(); });
  window.addEventListener('focus',() => { void pull(); });
  document.addEventListener('visibilitychange',() => { if (!document.hidden) void pull(); });
  window.addEventListener('beforeunload',event => { if (pending) { event.preventDefault(); event.returnValue = ''; } });
  document.querySelector('#account').onclick = () => accountDialog();
  decorate();
  async function init() {
    if (!configured) { startup = false; return; }
    try {
      const module = await Promise.race([
        import('https://esm.sh/@supabase/supabase-js@2.118.0'),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('加载登录服务超时，请检查网络')),15000))
      ]);
      client = module.createClient(config.url,config.publishableKey, {auth:{storageKey:'family-island-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      client.auth.onAuthStateChange((event,session) => {
        setTimeout(() => {
          if (event === 'PASSWORD_RECOVERY') {
            recovering = true;
            void (async () => { if (session?.user) await activate(session.user); passwordDialog(); })();
            return;
          }
          if (session?.user) void activate(session.user);
          else if (event === 'SIGNED_OUT') leaveAccount();
        },0);
      });
      const {data,error} = await client.auth.getSession(); if (error) throw error;
      startup = false;
      if (data.session?.user) await activate(data.session.user); else setStatus('本机保存 · 未登录');
      setInterval(() => { if (!document.hidden) void pull(); },5000);
    } catch (error) { startup = false; setStatus('登录服务暂不可用'); console.warn(errorText(error)); }
  }
  void init();
})();
