"use strict";

module.exports.onStart = function () {
    console.log('Service started');
    const adbhost = require('adbhost');
    const express = require('express');
    const fetch = require('./utils/download.js');
    const closeStream = require('./utils/closeStream.js');
    const path = require('path');
    const { readConfig, writeConfig } = require('./utils/configuration.js');
    const loadModules = require('./utils/moduleLoader.js');
    const startDebugging = require('./utils/debugger.js');
    const startService = require('./utils/serviceLauncher.js');
    const { Connection, Events } = require('./utils/wsCommunication.js');
    let WebSocket;
    if (process.version === 'v4.4.3') {
        WebSocket = require('ws-old');
    } else {
        WebSocket = require('ws-new');
    }


    const app = express();
    let deviceIP;
    const isTizen3 = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');

    // HTTP Proxy for modules 
    app.all('*', (req, res) => {
        if (req.url.startsWith('/module/')) {
            const splittedUrl = req.url.split('/');
            const encodedModuleName = splittedUrl[2];
            const moduleName = decodeURIComponent(encodedModuleName);
            fetch(`https://cdn.jsdelivr.net/${moduleName}/${req.url.replace(`/module/${encodedModuleName}/`, '')}`)
                .then(fetchRes => {
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.type(path.basename(req.url.split('?')[0]));
                    fetchRes.body.on('error', () => res.destroy());
                    res.on('close', () => closeStream(fetchRes.body));
                    res.setTimeout(15000, () => { closeStream(fetchRes.body); res.destroy(); });
                    fetchRes.body.pipe(res);
                }).catch(error => {
                    if (!res.headersSent) res.status(502).send(error.message);
                    else res.destroy();
                });
        } else {
            res.send(deviceIP);
        }
    });

    const wsServer = new WebSocket.Server({ server: app.listen(8081, "127.0.0.1") });

    let adbClient;
    let canLaunchInDebug = null;
    fetch('http://127.0.0.1:8001/api/v2/').then(res => res.json())
        .then(json => {
            canLaunchInDebug = (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') && json.device.developerMode === '1';
        }).catch(error => console.error('Developer mode check failed:', error.message));
    const inDebug = {
        tizenDebug: false,
        webDebug: false,
        rwiDebug: false
    };

    const services = new Map();
    const queuedEvents = [];
    let modulesCache = null;

    const currentModule = {
        name: '',
        appPath: '',
        moduleType: '',
        packageType: '',
        serviceFile: ''
    };

    const appControlData = {
        module: null,
        args: null
    };

    const modulesReady = loadModules().then(modules => {
        modulesCache = modules;
        const serviceModuleList = readConfig().autoLaunchServiceList;
        if (serviceModuleList.length > 0) {
            serviceModuleList.forEach(module => {
                const service = modules.find(m => (m.fullName === module || m.name === module) && m.serviceFile);
                if (service) startService(service, services);
            });
        }
        return modules;
    });
    modulesReady.catch(error => console.error('Module startup failed:', error.message));


    function createAdbConnection(ip, mdl) {
        deviceIP = ip;
        if (adbClient) {
            if (adbClient._stream) {
                adbClient._stream.removeAllListeners('connect');
                adbClient._stream.removeAllListeners('error');
                adbClient._stream.removeAllListeners('close');
            }
        }

        adbClient = adbhost.createConnection({ host: '127.0.0.1', port: 26101 });

        adbClient._stream.on('connect', () => {
            console.log('ADB connection established');
            //Launch app
            const tbPackageId = tizen.application.getAppInfo().packageId;
            const shellCmd = adbClient.createStream(`shell:0 debug ${tbPackageId}.TizenBrewStandalone${isTizen3 ? ' 0' : ''}`);
            shellCmd.on('data', function dataIncoming(data) {
                const dataString = data.toString();
                if (dataString.includes('debug')) {
                    const port = Number(dataString.substr(dataString.indexOf(':') + 1, 6).replace(' ', ''));
                    startDebugging(port, queuedEvents, services, ip, mdl, inDebug, appControlData, false);
                    setTimeout(() => adbClient._stream.end(), 1000);
                }
            });
        });

        adbClient._stream.on('error', (e) => {
            console.log('ADB connection error. ' + e);
        });
        adbClient._stream.on('close', () => {
            console.log('ADB connection closed.');
        });
    }


    wsServer.on('connection', (ws) => {
        const wsConn = new Connection(ws);
        while (queuedEvents.length) wsConn.send(queuedEvents.shift());
        services.set('wsConn', wsConn);
        ws.on('message', (message) => {
            let msg;
            try {
                msg = JSON.parse(message)
            } catch (e) {
                return wsConn.send(wsConn.Event(Events.Error, `Invalid JSON: ${message}`));
            }

            try {
                if (!msg || typeof msg !== 'object') throw new Error('Invalid event');
                const { type, payload } = msg;

                switch (type) {
                    case Events.AppControlData: {
                        if (!payload || typeof payload.package !== 'string') throw new Error('Invalid App Control module');
                        modulesReady.then(() => {
                            const module = (modulesCache || []).find(m => m.fullName === payload.package);
                            if (!module) throw new Error('App Control module not found.');
                            appControlData.module = module;
                            appControlData.args = payload.args;
                            wsConn.send(wsConn.Event(Events.AppControlData, null));
                        }).catch(error => wsConn.send(wsConn.Event(Events.Error, error.message)));
                        break;
                    }
                    case Events.GetDebugStatus: {
                        wsConn.send(wsConn.Event(Events.GetDebugStatus, inDebug));
                        break;
                    }
                    case Events.CanLaunchInDebug: {
                        const queryDeveloperMode = (attempt) => {
                            fetch('http://127.0.0.1:8001/api/v2/').then(res => res.json())
                                .then(json => {
                                    canLaunchInDebug = (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') && json.device.developerMode === '1';
                                    wsConn.send(wsConn.Event(Events.CanLaunchInDebug, canLaunchInDebug));
                                }).catch(error => {
                                    if (attempt < 3) {
                                        setTimeout(() => queryDeveloperMode(attempt + 1), 1000 * (attempt + 1));
                                    } else wsConn.send(wsConn.Event(Events.Error, 'TV status unavailable after retries. Relaunch TizenBrew to retry. ' + error.message));
                                });
                        };
                        queryDeveloperMode(0);
                        break;
                    }
                    case Events.ReLaunchInDebug: {
                        setTimeout(() => {
                            createAdbConnection(payload.tvIP, currentModule);
                        }, 1000);
                        break;
                    }
                    case Events.GetModules: {
                        wsConn.isReady = true;
                        services.set('wsConn', wsConn);

                        if (payload) {
                            loadModules().then(modules => {
                                modulesCache = modules;
                                wsConn.send(wsConn.Event(Events.GetModules, modules));
                            }).catch(error => wsConn.send(wsConn.Event(Events.Error, error.message)));
                        } else wsConn.send(wsConn.Event(Events.GetModules, modulesCache));
                        break;
                    }
                    case Events.LaunchModule: {
                        const mdl = payload;
                        currentModule.fullName = mdl.fullName;
                        currentModule.name = mdl.name;
                        currentModule.appPath = mdl.appPath;
                        currentModule.moduleType = mdl.moduleType;
                        currentModule.packageType = mdl.packageType;
                        currentModule.serviceFile = mdl.serviceFile;

                        if (mdl.packageType === 'app') {
                            inDebug.webDebug = false;
                            inDebug.tizenDebug = false;
                        } else {
                            currentModule.mainFile = mdl.mainFile;
                            currentModule.tizenAppId = mdl.tizenAppId;
                            currentModule.evaluateScriptOnDocumentStart = mdl.evaluateScriptOnDocumentStart;
                        }

                        if (mdl.serviceFile) {
                            if (services.has(mdl.fullName)) {
                                if (services.get(mdl.fullName).hasCrashed) {
                                    services.delete(mdl.fullName);
                                    startService(mdl, services);
                                }
                            } else startService(mdl, services);
                        }
                        break;
                    }
                    case Events.StartService: {
                        const mdl = payload;
                        if (payload.serviceFile && services.has(mdl.fullName)) {
                            if (services.get(mdl.fullName).hasCrashed) {
                                services.delete(mdl.fullName);
                                startService(mdl, services);
                            }
                        } else startService(mdl, services);
                        break;
                    }
                    case Events.GetServiceStatuses: {
                        const serviceList = [];
                        for (const map of services) {
                            serviceList.push({
                                name: map[0],
                                hasCrashed: map[1].hasCrashed,
                                error: map[1].error
                            });
                        }
                        wsConn.send(wsConn.Event(Events.GetServiceStatuses, serviceList));
                        break;
                    }
                    case Events.ModuleAction: {
                        const { action, module } = payload;
                        if (typeof module !== 'string') throw new Error('Invalid module identifier');

                        const config = readConfig();
                        switch (action) {
                            case 'add': {
                                const index = config.modules.findIndex(m => m === module);
                                if (index === -1) {
                                    config.modules.push(module);
                                    writeConfig(config);
                                }
                                break;
                            }
                            case 'remove': {
                                const index = config.modules.findIndex(m => m === module);
                                if (index !== -1) {
                                    config.modules.splice(index, 1);
                                    writeConfig(config);
                                }
                                break;
                            }
                            case 'autolaunch': {
                                config.autoLaunchModule = module;
                                writeConfig(config);
                                break;
                            }
                            case 'autolaunchService': {
                                config.autoLaunchServiceList = module ? [module] : [];
                                writeConfig(config);
                                break;
                            }
                        }
                        break;
                    }
                    case Events.Ready: {
                        wsConn.isReady = true;
                        services.set('wsConn', wsConn);
                        break;
                    }
                    default: {
                        wsConn.send(wsConn.Event(Events.Error, 'Invalid event type.'));
                        break;
                    }
                }
            } catch (error) {
                wsConn.send(wsConn.Event(Events.Error, error.message));
            }
        });
    });
}
