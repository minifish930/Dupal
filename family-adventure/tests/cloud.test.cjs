const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const appSource = fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const cloudSource = fs.readFileSync(path.join(__dirname,'../cloud.js'),'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i=0;i<20;i++) await new Promise(resolve=>setImmediate(resolve)); };

function createDevice(server, existingStorage = {}) {
  const storage = {...existingStorage}, elements = {}, listeners = {};
  let callback;
  const el = selector => elements[selector] ||= {innerHTML:'',textContent:'',style:{},open:false,
    showModal(){this.open=true},close(){this.open=false},addEventListener(){},click(){}};
  const sdk = {auth:{
    getSession:async()=>({data:{session:null}}),
    onAuthStateChange:fn=>{callback=fn},
    signInWithPassword:async()=>({data:{session:{user:{id:'owner-1',email:'family@example.test'}}}}),
    signOut:async()=>({error:null})
  },from:()=>({select:()=>({maybeSingle:async()=>({data:clone(server.row),error:null})})}),
    rpc:async(_name,args)=>{
      if (server.failure) throw Error('fetch failed');
      server.calls++;
      const row = server.row;
      if (row?.lastId===args.request_id) return {data:{ok:true,version:row.version,payload:clone(row.payload)}};
      if (row && row.version!==args.expected_version) return {data:{ok:false,conflict:true,version:row.version,payload:clone(row.payload)}};
      server.row={payload:clone(args.new_payload),version:(row?.version||0)+1,lastId:args.request_id};
      return {data:{ok:true,version:server.row.version,payload:clone(server.row.payload)}};
    }};
  const window = {FAMILY_CLOUD_CONFIG:{url:'https://example.supabase.co',publishableKey:'public-test-key',redirectUrl:'https://example.test/'},addEventListener:(name,fn)=>listeners[name]=fn};
  const ctx={window,document:{querySelector:el,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn,hidden:false},
    localStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v},location:{hash:''},navigator:{onLine:true},crypto:{randomUUID},
    setInterval(){},setTimeout:fn=>{fn();return 1},console,Date,FormData:class{constructor(f){this.f=f}get(k){return this.f[k]}},Blob,URL,sdk};
  vm.createContext(ctx);vm.runInContext(appSource,ctx);
  vm.runInContext(cloudSource.replace("import('https://esm.sh/@supabase/supabase-js@2.118.0')","Promise.resolve({createClient:()=>sdk})"),ctx);
  ctx.FamilyCloud=ctx.window.FamilyCloud;
  return {ctx,storage,elements,listeners,run:code=>vm.runInContext(code,ctx),
    login:async()=>{await settle();await ctx.FamilyCloud.authenticate({preventDefault(){},target:{email:'family@example.test',password:'not-a-real-password'}},'login');await settle()},
    pull:async()=>{listeners.focus();await settle()}};
}

(async()=>{
  const server={row:null,calls:0};
  const laptop=createDevice(server);await settle();
  laptop.run("state.people[0].name='家庭成员';save()");
  const guestBackup=laptop.storage['family-island-v1'];
  await laptop.login();
  assert.equal(server.row,null,'Login must not upload local data without choosing import');
  assert(laptop.elements['#dialog'].innerHTML.includes('导入此设备数据'));
  await laptop.ctx.FamilyCloud.createSpace(true);await settle();
  assert.equal(server.row.payload.people[0].name,'家庭成员');
  assert(!('member' in server.row.payload),'Active role is device-local');
  const phone=createDevice(server);await phone.login();
  assert.equal(phone.run('state.people[0].name'),'家庭成员','Second device loads cloud members');
  laptop.run('complete(2)');await settle();await phone.pull();
  assert.equal(phone.run('state.tasks.find(t=>t.id===2).done'),true,'Task completion reaches second device');
  assert.equal(phone.run('state.people[0].xp'),200);
  phone.run('complete(2)');await settle();assert.equal(server.row.payload.people[0].xp,200,'No repeated completion reward');
  laptop.run('state.member=1;save()');await settle();assert.equal(phone.run('state.member'),0,'Role choice must not switch the other device');
  // Leave the phone stale, then edit the same family from both devices.
  laptop.run("state.people[0].role='电脑新角色';save()");await settle();
  phone.run("state.people[0].role='手机旧版本改动';save()");await settle();
  assert.equal(server.row.payload.people[0].role,'电脑新角色','Stale snapshot must not overwrite cloud');
  assert(phone.elements['#dialog'].innerHTML.includes('另一台设备'));
  assert.equal(phone.ctx.FamilyCloud.canTick(),false,'Conflicted timers cannot keep granting rewards');
  phone.ctx.FamilyCloud.acceptRemote();await settle();
  assert.equal(phone.run('state.people[0].role'),'电脑新角色');
  assert(phone.storage['family-island-account-owner-1-conflict-backup'].includes('手机旧版本改动'));
  // A disconnected operation persists and can be sent after connectivity returns.
  phone.ctx.navigator.onLine=false;phone.run("state.people[0].name='离线修改';save()");await settle();
  assert.equal(server.row.payload.people[0].name,'家庭成员');
  assert(JSON.parse(phone.storage['family-island-account-owner-1']).pending);
  phone.ctx.navigator.onLine=true;phone.listeners.online();await settle();
  assert.equal(server.row.payload.people[0].name,'离线修改');
  await laptop.ctx.FamilyCloud.signOut();await settle();
  assert.equal(laptop.storage['family-island-v1'],guestBackup,'Cloud data never overwrites guest data');
  assert.equal(laptop.run('state.people[0].name'),'家庭成员');
  assert.equal(laptop.ctx.FamilyCloud.isCloud(),false);
  console.log('PASS: explicit import, second-device load, completion sync, duplicate prevention, local role, conflict backup, offline retry, sign-out isolation');
})().catch(error=>{console.error(error);process.exitCode=1});
