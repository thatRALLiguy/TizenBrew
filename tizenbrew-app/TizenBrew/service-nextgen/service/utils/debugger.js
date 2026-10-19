"use strict";

const CDP = require('chrome-remote-interface');
const fetch = require('./download.js');
const { Events } = require('./wsCommunication.js');
const { readConfig } = require('./configuration.js');
const event = (type, payload) => ({ type, payload });

const modulesCache = new Map();

function startDebugging(port, queuedEvents, clientConn, ip, mdl, inDebug, appControlData, isAnotherApp, attempts) {
    if (!attempts) attempts = 1;
    if (!isAnotherApp) inDebug.tizenDebug = true;
    try {
        CDP({ port, host: ip, local: true }, (client) => {
            client.Runtime.enable();
            client.Debugger.enable();

            client.on('Runtime.executionContextCreated', (msg) => {
                if (!mdl.evaluateScriptOnDocumentStart && mdl.name !== '') {
                    const cache = modulesCache.get(mdl.fullName);
                    if (cache) {
                        client.Runtime.evaluate({ expression: cache, contextId: msg.context.id });
                    } else {
                        fetch(`https://cdn.jsdelivr.net/${mdl.fullName}/${mdl.mainFile}`).then(res => res.text()).then(modFile => {
                            modulesCache.set(mdl.fullName, modFile);
                            client.Runtime.evaluate({ expression: modFile, contextId: msg.context.id });
                        }).catch(e => {
                            client.Runtime.evaluate({ expression: `alert("Failed to load module: '${mdl.fullName}'. Please relaunch TizenBrew to try again.")`, contextId: msg.context.id });
                        });
                    }
                } else if (mdl.name !== '' && mdl.evaluateScriptOnDocumentStart) {
                    const cache = modulesCache.get(mdl.fullName);
                    if (cache) {
                        Promise.resolve(client.Page.addScriptToEvaluateOnNewDocument({ expression: cache }))
                            .then(() => sendClientInformation(clientConn, event(Events.LaunchModule, mdl.fullName)))
                            .catch(error => sendClientInformation(clientConn, event(Events.Error, error.message)));
                    } else {
                        fetch(`https://cdn.jsdelivr.net/${mdl.fullName}/${mdl.mainFile}`).then(res => res.text()).then(modFile => {
                            modulesCache.set(mdl.fullName, modFile);
                            return Promise.resolve(client.Page.addScriptToEvaluateOnNewDocument({ expression: modFile }))
                                .then(() => sendClientInformation(clientConn, event(Events.LaunchModule, mdl.fullName)));
                        }).catch(e => {
                            sendClientInformation(clientConn, event(Events.Error, 'Failed to load module: ' + mdl.fullName + '. Please try again.'));
                        });
                    }
                }
            });

            client.on('disconnect', () => {
                if (isAnotherApp) return;

                inDebug.tizenDebug = false;
                inDebug.webDebug = false;
                inDebug.rwiDebug = false;

                mdl.fullName = '';
                mdl.name = '';
                mdl.appPath = '';
                mdl.moduleType = '';
                mdl.packageType = '';
                mdl.serviceFile = '';
                mdl.mainFile = '';
            });

            if (!isAnotherApp) {
                if (appControlData && appControlData.module) {
                    const data = event(Events.CanLaunchModules, {
                        type: 'appControl',
                        module: appControlData.module,
                        args: appControlData.args
                    });
                    sendClientInformation(clientConn, data);
                } else {
                    const config = readConfig();
                    if (config.autoLaunchModule) {
                        const data = event(Events.CanLaunchModules, {
                            type: 'autolaunch',
                            module: config.autoLaunchModule
                        });

                        sendClientInformation(clientConn, data);

                    } else {
                        const data = event(Events.CanLaunchModules, null);
                        sendClientInformation(clientConn, data);
                    }
                }
            }
            if (!isAnotherApp) inDebug.webDebug = true;
            appControlData = null;
        }).on('error', (err) => {
            if (attempts >= 15) {
                if (!isAnotherApp) {
                    sendClientInformation(clientConn, event(Events.Error, 'Failed to connect to the debugger. Relaunch TizenBrew to retry.'));
                    inDebug.tizenDebug = false;
                    return;
                } else return;
            }
            attempts++;
            setTimeout(() => startDebugging(port, queuedEvents, clientConn, ip, mdl, inDebug, appControlData, isAnotherApp, attempts), 750)
        });
    } catch (e) {
        if (attempts >= 15) {
            if (!isAnotherApp) {
                sendClientInformation(clientConn, event(Events.Error, 'Failed to connect to the debugger. Relaunch TizenBrew to retry.'));
                inDebug.tizenDebug = false;
                return;
            } else return;
        }
        attempts++;
        setTimeout(() => startDebugging(port, queuedEvents, clientConn, ip, mdl, inDebug, appControlData, isAnotherApp, attempts), 750)
        return;
    }
}

function sendClientInformation(clientConn, data, attempts) {
    attempts = attempts || 0;
    const clientConnection = clientConn.get('wsConn');
    if (!clientConnection || clientConnection.connection.readyState !== 1 || (!clientConnection.isReady && data.type !== Events.Error)) {
        // Allow the bounded module downloads and UI reconnection to finish.
        if (attempts < 600) setTimeout(() => sendClientInformation(clientConn, data, attempts + 1), 100);
        return;
    }
    clientConnection.send(data);
}

module.exports = startDebugging;