// Run with Node 4.4.3 after the service build (also works on current Node).
'use strict';
var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var Stream = require('stream');
var base = path.join(__dirname, '../tizenbrew-app/TizenBrew/service-nextgen/service');
var closeStream = require(path.join(base, 'utils/closeStream.js'));
function checkProxy(mode, done) {
    var route, deadline, closed = 0;
    var body = new Stream.PassThrough();
    if (process.version === 'v4.4.3') assert.strictEqual(typeof body.destroy, 'undefined');
    else body.destroy = undefined;
    body.on('close', function () { closed++; });
    var res = new Stream.PassThrough();
    res.setHeader = res.type = function () {};
    res.setTimeout = function (ms, cb) { deadline = cb; };
    res.destroy = function () { res.emit('close'); };
    var mocks = {
        adbhost: {}, express: function () { return {all:function (p, fn) {route=fn;},listen:function () {return {};}}; },
        './utils/download.js': function (url) { return Promise.resolve(url.indexOf('cdn.jsdelivr') >= 0 ? {body:body} : {json:function () {return Promise.resolve({device:{}});}}); },
        './utils/closeStream.js': closeStream, path:path,
        './utils/configuration.js':{readConfig:function () {return {autoLaunchServiceList:[]};}},
        './utils/moduleLoader.js':function () {return Promise.resolve([]);},
        './utils/debugger.js':function () {}, './utils/serviceLauncher.js':function () {},
        './utils/wsCommunication.js':{}, 'ws-old':{Server:function () {this.on=function () {};}}
    };
    var sandbox = {module:{exports:{}},console:console,process:{version:'v4.4.3'},
        tizen:{systeminfo:{getCapability:function () {return '3.0';}}},
        require:function (name) {assert.ok(Object.prototype.hasOwnProperty.call(mocks,name),name);return mocks[name];}};
    vm.runInNewContext(fs.readFileSync(path.join(base,'transpiled/index.js'),'utf8'),sandbox);
    sandbox.module.exports.onStart();
    route({url:'/module/npm%2Fexample/main.js'},res);
    setImmediate(function () {
        if (mode === 'close') res.emit('close'); else deadline();
        closeStream(body);
        assert.strictEqual(closed,1);
        done();
    });
}
checkProxy('close',function () {checkProxy('timeout',function () {
    var fetch = require(path.join(base,'node_modules/node-fetch'));
    var download = require(path.join(base,'utils/download.js'));
    var server = require('http').createServer(function (req,res) {res.writeHead(503);res.end('unavailable');});
    server.listen(0,'127.0.0.1',function () {
        var url='http://127.0.0.1:'+server.address().port;
        fetch(url).then(function (response) {
            if (process.version === 'v4.4.3') assert.strictEqual(typeof response.body.destroy,'undefined');
            closeStream(response.body);
            return download(url);
        }).then(function () {throw Error('Expected HTTP rejection');},function (err) {
            assert.ok(/HTTP 503/.test(err.message),err.message);
            server.close();
            console.log('PASS '+process.version+': proxy close, proxy timeout, real node-fetch HTTP rejection');
        }).catch(function (err) {console.error(err);server.close();process.exitCode=1;});
    });
});});
