const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '../tizenbrew-app/TizenBrew');
const service = 'service-nextgen/service/';
function load(file, mocks = {}, globals = {}) {
    const context = { module: { exports: {} }, console: { log() {}, error() {} }, setTimeout, clearTimeout,
        require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; return require(path.resolve(root, path.dirname(file), name)); }, ...globals };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    return context.module.exports;
}
const plain = x => JSON.parse(JSON.stringify(x));
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const comm = require(path.join(root, service, 'utils/wsCommunication.js'));

test('legacy string autostart config is migrated; damaged JSON is backed up; writes are atomic', () => {
    let contents = JSON.stringify({ modules: ['npm/example'], autoLaunchServiceList: 'npm/example' });
    const writes = [], renames = [];
    const config = load(service+'utils/configuration.js', { fs: {
        existsSync: () => true, readFileSync: () => contents,
        writeFileSync: (...args) => writes.push(args), renameSync: (...args) => renames.push(args)
    }});
    assert.deepEqual(plain(config.readConfig().autoLaunchServiceList), ['npm/example']);
    contents = '{damaged';
    assert.deepEqual(plain(config.readConfig().autoLaunchServiceList), []);
    assert.equal(writes[0][1], contents);
    assert.match(writes[0][0], /\.corrupt-/);
    config.writeConfig({ modules: [], autoLaunchServiceList: '' });
    assert.match(renames[0][0], /\.tmp$/);
    assert.deepEqual(JSON.parse(writes[1][1]).modules, []);
});

test('downloads reject HTTP errors and set a legacy-compatible timeout', async () => {
    let options, destroyed = false;
    const download = load(service+'utils/download.js', {'node-fetch': (url, opts) => {
        options = opts;
        return Promise.resolve({ok:false,status:404,body:{destroy(){destroyed=true;}}});
    }});
    await assert.rejects(download('https://example.com'), /HTTP 404/);
    assert.equal(options.timeout,15000);
    assert.equal(destroyed,true);
});

test('bad metadata and failed downloads do not discard healthy modules', async () => {
    const loader = load(service+'utils/moduleLoader.js', {
        './configuration.js': {readConfig:()=>({modules:['npm/good','npm/bad','npm/offline']})},
        './download.js': url => url.includes('offline') ? Promise.reject(Error('timeout')) : Promise.resolve({json:()=>Promise.resolve({packageType:'app',appName:'Example',appPath:'index.html',keys:url.includes('bad')?'Enter':[]})})
    });
    const modules = await loader();
    assert.match(modules[0].appPath,/index.html$/);
    assert.equal(modules[1].appPath,'');
    assert.equal(modules[2].appPath,'');
});

function debuggerHarness(CDP, connection, extra = {}) {
    return load(service+'utils/debugger.js', {
        'chrome-remote-interface': CDP, './download.js':()=>Promise.resolve({text:()=>Promise.resolve('test script')}),
        './configuration.js':{readConfig:()=>({})}, './wsCommunication.js':comm
    }, extra);
}
test('exhausted debugger retries report an error through the stored connection', () => {
    const sent=[], state={};
    const connection={connection:{readyState:1},isReady:true,send:data=>sent.push(data)};
    const start=debuggerHarness(()=>{throw Error('offline');},connection);
    start(1,[],new Map([['wsConn',connection]]),'localhost',{},state,{},false,15);
    assert.equal(sent[0].type,comm.Events.Error);
    assert.equal(state.tizenDebug,false);
});

test('document-start launch uses full identifier and waits for a ready socket', async () => {
    let contextCreated; const sent=[], timers=[];
    const connection={connection:{readyState:0},isReady:true,send:data=>sent.push(data)};
    const start=debuggerHarness((opts,cb)=>{
        cb({Runtime:{enable(){}},Debugger:{enable(){}},Page:{addScriptToEvaluateOnNewDocument(){}},on(name,fn){if(name==='Runtime.executionContextCreated')contextCreated=fn;}});
        return {on(){}};
    },connection,{setTimeout:fn=>timers.push(fn)});
    start(1,[],new Map([['wsConn',connection]]),'localhost',{name:'example',fullName:'npm/example',mainFile:'main.js',evaluateScriptOnDocumentStart:true},{},{},true);
    contextCreated({context:{id:1}});
    await flush();
    assert.equal(sent.length,0);
    connection.connection.readyState=1;
    timers.shift()();
    assert.equal(sent[0].payload,'npm/example');
});

function serviceHarness(config, version = 'v24.0.0', fetchOverride) {
    let accept, receive, selectedSocket; const sent=[], started=[], timers=[], removed=[];
    const socketServer = name => ({Server:class {constructor(){selectedSocket=name;} on(event,fn){accept=fn;}}});
    const instance=load(service+'index.js', {
        adbhost:{createConnection:()=>({_stream:{on(){},removeAllListeners:event=>removed.push(event)}})}, express:()=>({all(){},listen(){return {};}}),
        './utils/download.js':fetchOverride || (()=>Promise.resolve({json:()=>Promise.resolve({device:{developerIP:'127.0.0.1',developerMode:'1'}})})),
        path:require('node:path'), './utils/configuration.js':{readConfig:()=>config,writeConfig:()=>{}},
        './utils/moduleLoader.js':()=>Promise.resolve([{name:'example',fullName:'npm/example',serviceFile:'service.js'}]),
        './utils/debugger.js':()=>{}, './utils/serviceLauncher.js':mdl=>started.push(mdl), './utils/wsCommunication.js':comm,
        'ws-new':socketServer('new'), 'ws-old':socketServer('old')
    },{setTimeout:fn=>timers.push(fn),process:{version},tizen:{systeminfo:{getCapability:()=> '6.0'}}});
    instance.onStart();
    accept({readyState:1,send:data=>sent.push(JSON.parse(data)),on(name,fn){receive=fn;}});
    return {sent,started,timers,removed,selectedSocket,send:msg=>receive(JSON.stringify(msg))};
}
test('service autostart saves a list, matches full names, and can be disabled', async () => {
    const config={modules:[],autoLaunchServiceList:[]};
    const h=serviceHarness(config);
    h.send({type:10,payload:{action:'autolaunchService',module:'npm/example'}});
    assert.deepEqual(plain(config.autoLaunchServiceList),['npm/example']);
    await flush();
    assert.equal(h.started[0].fullName,'npm/example');
    h.send({type:10,payload:{action:'autolaunchService',module:''}});
    assert.deepEqual(plain(config.autoLaunchServiceList),[]);
});

test('developer status is sent after lookup; malformed events report errors', async () => {
    const h=serviceHarness({modules:[],autoLaunchServiceList:[]});
    h.send({type:2});
    assert.equal(h.sent.length,0);
    await flush();
    assert.equal(h.sent[0].payload,true);
    h.send(null);
    assert.equal(h.sent[1].type,8);
});

function clientHarness() {
    const sockets=[], timers=[], actions=[];
    class Socket {
        static OPEN=1;
        constructor(){this.readyState=0;sockets.push(this);}
        close(){this.readyState=3;}
        send(){}
    }
    let code=fs.readFileSync(path.join(root,'tizenbrew-ui/src/components/WebSocketClient.js'),'utf8').replace('export { Events };','').replace('export default Client;','module.exports = Client;');
    const sandbox={module:{exports:{}},WebSocket:Socket,setTimeout:fn=>{const timer={fn,active:true};timers.push(timer);return timer;},clearTimeout:timer=>{timer.active=false;},tizen:{application:{getCurrentApplication:()=>({getRequestedAppControl:()=>({appControl:{data:[]}})})}}};
    vm.runInNewContext(code,sandbox);
    const client=new sandbox.module.exports({dispatch:action=>actions.push(action)});
    return {client,sockets,timers,actions,next(){let timer;while((timer=timers.shift())){if(timer.active){timer.fn();return;}}}};
}
test('socket errors and closes retry once per attempt, then stop without reloading', () => {
    const h=clientHarness();
    for(let i=0;i<6;i++) {
        const socket=h.sockets[i], error=socket.onerror, close=socket.onclose;
        error(); close();
        h.next();
    }
    assert.equal(h.sockets.length,6);
    assert.match(h.actions.at(-1).payload.message,/Relaunch/);
    assert.equal(h.client.send({type:10}),false);
});

test('client displays service errors and malformed responses', () => {
    const h=clientHarness();
    h.client.onMessage({data:JSON.stringify({type:8,payload:'Download failed'})});
    assert.equal(h.actions.at(-1).payload.message,'Download failed');
    h.client.onMessage({data:'broken'});
    assert.match(h.actions.at(-1).payload.message,/Invalid response/);
});

test('all registered translation files exist and contain valid JSON', () => {
    const file = path.join(root, 'tizenbrew-ui/src/components/i18nResources.js');
    for (const match of fs.readFileSync(file,'utf8').matchAll(/from '([^']+\.json)'/g)) {
        assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.resolve(path.dirname(file),match[1]),'utf8')));
    }
});

test('App Control waits for modules to load on a cold start', async () => {
    const h = serviceHarness({modules:[],autoLaunchServiceList:[]});
    h.send({type:0,payload:{package:'npm/example',args:''}});
    assert.equal(h.sent.length,0);
    await flush();
    assert.equal(h.sent[0].type,0);
});

test('client refuses to launch failed modules and times out unopened sockets', () => {
    const h=clientHarness();
    h.sockets[0].readyState=1;
    assert.equal(h.client.send({type:5,payload:{appPath:''}}),false);
    assert.match(h.actions.at(-1).payload.message,/could not be loaded/);
    h.next(); // connection deadline
    h.next(); // retry backoff
    assert.equal(h.sockets.length,2);
});

test('debugger notifications stop retrying when no UI ever connects', () => {
    const timers=[];
    const start=debuggerHarness(()=>{throw Error('offline');},null,{setTimeout:fn=>timers.push(fn)});
    start(1,[],new Map(),'localhost',{}, {},{},false,15);
    let count=0;
    while(timers.length && count<1000){timers.shift()();count++;}
    assert.equal(count,600);
    assert.equal(timers.length,0);
});

test('Node 4.4.3 selects the legacy WebSocket implementation', () => {
    const h=serviceHarness({modules:[],autoLaunchServiceList:[]},'v4.4.3');
    assert.equal(h.selectedSocket,'old');
});

test('repeated debug launches clean up an existing ADB stream', () => {
    const h=serviceHarness({modules:[],autoLaunchServiceList:[]});
    h.send({type:3,payload:{tvIP:'127.0.0.1'}});
    h.timers.shift()();
    h.send({type:3,payload:{tvIP:'127.0.0.1'}});
    h.timers.shift()();
    assert.deepEqual(h.removed,['connect','error','close']);
});


test('legacy PassThrough cleanup is idempotent without destroy', () => {
    const closeStream = require(path.join(root, service, 'utils/closeStream.js'));
    const stream = new (require('node:stream').PassThrough)();
    stream.destroy = undefined; // Node 4 native Transform/PassThrough shape.
    let closed = 0;
    stream.on('close', () => { closed++; closeStream(stream); });
    closeStream(stream);
    closeStream(stream);
    assert.equal(closed, 1);
    assert.equal(stream.readableFlowing, true);
});

test('HTTP rejection keeps the status error with a legacy stream body', async () => {
    const stream = new (require('node:stream').PassThrough)();
    stream.destroy = undefined;
    const download = load(service+'utils/download.js', {'node-fetch': () =>
        Promise.resolve({ok:false, status:503, body:stream})});
    await assert.rejects(download('https://example.com'), /HTTP 503/);
});

test('proxy cancellation and timeout clean legacy response streams', async () => {
    for (const event of ['close', 'timeout']) {
        let route, timeout;
        const body = new (require('node:stream').PassThrough)();
        body.destroy = undefined;
        let closed = 0;
        body.on('close', () => closed++);
        const res = new (require('node:stream').PassThrough)();
        res.setHeader = res.type = () => {};
        res.setTimeout = (ms, cb) => { timeout = cb; };
        const instance = load(service+'index.js', {
            adbhost: {}, express: () => ({all(p, fn){route=fn;}, listen(){return {};}}),
            './utils/download.js': url => Promise.resolve(url.indexOf('cdn.jsdelivr') >= 0 ? {body} : {json:()=>Promise.resolve({device:{}})}),
            path: require('node:path'), './utils/configuration.js': {readConfig:()=>({autoLaunchServiceList:[]})},
            './utils/moduleLoader.js':()=>Promise.resolve([]), './utils/debugger.js':()=>{},
            './utils/serviceLauncher.js':()=>{}, './utils/wsCommunication.js':comm,
            'ws-old': {Server: class {on(){}}}
        }, {process:{version:'v4.4.3'}, tizen:{systeminfo:{getCapability:()=> '3.0'}}});
        instance.onStart();
        route({url:'/module/npm%2Fexample/main.js'}, res);
        await flush();
        assert.doesNotThrow(() => event === 'close' ? res.emit('close') : timeout());
        assert.equal(closed, 1);
    }
});


test('bundled TizenTube only handles the three exact unversioned assets', () => {
    const seen=[];
    const bundled=load(service+'utils/bundledModule.js', {
        fs:{existsSync:p=>p.indexOf('missing')<0,createReadStream:p=>{seen.push(p);return p;}},
        path:require('node:path')
    }, {__dirname:'/package/service/dist'});
    function Response(body){this.body=body;}
    const prefix='https://cdn.jsdelivr.net/npm/@foxreis/tizentube/';
    for(const asset of ['package.json','dist/userScript.js','dist/service.js']) {
        assert.ok(bundled(prefix+asset,Response).body.includes('bundled-tizentube'));
    }
    for(const url of [prefix+'../secret',prefix+'package.json?x',prefix.replace('tizentube/','tizentube@1.15.2/')+'package.json','https://example.com/package.json']) {
        assert.equal(bundled(url,Response),null);
    }
    assert.equal(seen.length,3);
});


test('developer status recovers after a transient TV API failure without reconnecting', async () => {
    let requests=0;
    const h=serviceHarness({modules:[],autoLaunchServiceList:[]},'v4.4.3',()=> {
        requests++;
        return requests===2 ? Promise.reject(Error('TV API starting')) : Promise.resolve({json:()=>Promise.resolve({device:{developerIP:'127.0.0.1',developerMode:'1'}})});
    });
    h.send({type:2});await flush();
    assert.equal(h.sent.length,0);assert.equal(h.timers.length,1);
    h.timers.shift()();await flush();
    assert.equal(h.sent[0].type,2);assert.equal(h.sent[0].payload,true);
    assert.equal(h.timers.length,0);
});

test('developer status retries are bounded and report a recovery action', async () => {
    const h=serviceHarness({modules:[],autoLaunchServiceList:[]},'v4.4.3',()=>Promise.reject(Error('offline')));
    h.send({type:2});await flush();
    for(let i=0;i<3;i++){assert.equal(h.timers.length,1);h.timers.shift()();await flush();}
    assert.equal(h.timers.length,0);assert.equal(h.sent.length,1);
    assert.equal(h.sent[0].type,8);assert.match(h.sent[0].payload,/Relaunch/);
});
