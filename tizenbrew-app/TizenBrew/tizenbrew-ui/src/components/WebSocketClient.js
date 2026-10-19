const Events = {
    Ready: -1,
    AppControlData: 0,
    GetDebugStatus: 1,
    CanLaunchInDebug: 2,
    ReLaunchInDebug: 3,
    GetModules: 4,
    LaunchModule: 5,
    StartService: 6,
    GetServiceStatuses: 7,
    Error: 8,
    CanLaunchModules: 9,
    ModuleAction: 10
};

class Client {
    constructor(context) {
        this.context = context;
        this.retries = 0;
        this.pendingEvents = [];
        this.modulesLoaded = false;
        this.modules = [];
        this.connect();
    }

    reportError(message) {
        this.context.dispatch({ type: 'SET_ERROR', payload: { message, disappear: false } });
    }

    connect() {
        const socket = new WebSocket('ws://localhost:8081');
        this.socket = socket;
        let failed = false;
        const timeout = setTimeout(() => retry(), 10000);
        const retry = () => {
            if (failed) return;
            failed = true;
            clearTimeout(timeout);
            socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
            socket.close();
            this.modulesLoaded = false;
            this.pendingEvents = [];
            if (this.retries >= 5) {
                this.reportError('Cannot connect to TizenBrew service. Relaunch TizenBrew to retry.');
                return;
            }
            this.reportError('Connection lost. Reconnecting to TizenBrew service…');
            setTimeout(() => this.connect(), Math.min(500 * Math.pow(2, this.retries++), 5000));
        };
        socket.onopen = () => {
            clearTimeout(timeout);
            this.context.dispatch({ type: 'SET_ERROR', payload: { message: null, disappear: false } });
            this.onOpen();
        };
        socket.onmessage = this.onMessage.bind(this);
        socket.onerror = socket.onclose = retry;
    }

    onOpen() {
        const data = tizen.application.getCurrentApplication().getRequestedAppControl().appControl.data;
        if (data.length > 0 && data[0].value.length > 0) {
            // TizenBrew allows other apps to launch a specific module outside of the TizenBrew app.
            try {
                const parsedData = JSON.parse(data[0].value[0]);
                const moduleName = parsedData.moduleName;
                const moduleType = parsedData.moduleType;
                const args = parsedData.args;

                if (!moduleName || !moduleType) {
                    return this.send({
                        type: Events.GetDebugStatus
                    });
                }

                this.send({
                    type: Events.AppControlData,
                    payload: {
                        package: `${moduleType}/${moduleName}`,
                        args
                    }
                });
            } catch (e) {
                this.send({
                    type: Events.GetDebugStatus
                });
            }
        } else {
            this.send({
                type: Events.GetDebugStatus
            });
        }
    }

    onMessage(event) {
        let data;
        try { data = JSON.parse(event.data); }
        catch (error) { this.reportError('Invalid response from TizenBrew service.'); return; }
        if (!data || typeof data !== 'object') return;
        const { type, payload } = data;

        switch (type) {
            case Events.Error: {
                this.reportError(typeof payload === 'string' ? payload : 'TizenBrew service error.');
                break;
            }
            case Events.AppControlData: {
                this.send({
                    type: Events.GetDebugStatus
                });
                break;
            }

            case Events.GetDebugStatus: {
                const state = this.context.state;
                state.sharedData.debugStatus = payload;
                this.context.dispatch({
                    type: 'SET_SHARED_DATA',
                    payload: state.sharedData
                });

                if (!payload.rwiDebug && !payload.appDebug && !payload.tizenDebug) {
                    this.send({
                        type: Events.CanLaunchInDebug
                    });
                } else {
                    this.send({
                        type: Events.GetModules
                    });
                }

                break;
            }

            case Events.CanLaunchInDebug: {
                if (payload) {
                    const tvIP = webapis.network.getIp();
                    this.send({
                        type: Events.ReLaunchInDebug,
                        payload: {
                            tvIP
                        }
                    });

                    tizen.application.getCurrentApplication().exit();
                } else if (payload === null) {
                    this.send({
                        type: Events.CanLaunchInDebug
                    });
                }
                else {
                    this.context.dispatch({
                        type: 'SET_ERROR',
                        payload: {
                            message: 'errors.debuggingNotEnabled',
                            disappear: false
                        }
                    });
                }

                break;
            }

            case Events.GetModules: {
                if (payload === null) {
                    return setTimeout(() => this.send({ type: Events.GetModules }), 500);
                }

                this.context.dispatch({
                    type: 'SET_MODULES',
                    payload
                });

                this.retries = 0;
                this.modules = payload;
                this.modulesLoaded = true;

                this.send({
                    type: Events.Ready
                });

                this.processPendingEvents();

                break;
            }

            case Events.CanLaunchModules: {
                this.context.dispatch({
                    type: 'SET_STATE',
                    payload: 'service.connected'
                });

                if (!this.modulesLoaded) {
                    this.pendingEvents.push({ type, payload });
                } else {
                    this.handleCanLaunchModules(payload);
                }

                break;
            }

            case Events.LaunchModule: {
                const module = this.modules.find(mdl => mdl.fullName === payload);

                if (module) {
                    for (const key of module.keys) {
                        tizen.tvinputdevice.registerKey(key);
                    }

                    location.href = module.appPath;
                }

                break;
            }
        }
    }

    handleCanLaunchModules(payload) {
        const debugStatus = this.context.state.sharedData.debugStatus;
        debugStatus.webDebug = true;
        this.context.dispatch({
            type: 'SET_DEBUG_STATUS',
            payload: debugStatus
        });

        if (payload) {
            if (payload.type === 'autolaunch' && !window.shouldDisableAutoLaunch) {
                const module = this.modules.find(mdl => mdl.fullName === payload.module);
                if (!module) {
                    this.context.dispatch({
                        type: 'SET_ERROR',
                        payload: {
                            message: 'errors.moduleNotFound',
                            args: {
                                moduleName: payload.module
                            },
                            disappear: true
                        }
                    });
                    return;
                }
                for (const key of module.keys) {
                    tizen.tvinputdevice.registerKey(key);
                }

                if (!this.send({
                    type: Events.LaunchModule,
                    payload: module
                })) return;

                if (!module.evaluateScriptOnDocumentStart) {
                    location.href = module.appPath;
                }
            }
            else if (payload.type === 'appControl') {
                const module = payload.module;
                for (const key of module.keys) {
                    tizen.tvinputdevice.registerKey(key);
                }

                if (!this.send({
                    type: Events.LaunchModule,
                    payload: module
                })) return;

                module.appPath.includes('?') ? location.href = `${module.appPath}&${payload.args}` : location.href = `${module.appPath}?${payload.args}`;
            }
        }
    }

    processPendingEvents() {
        while (this.pendingEvents.length > 0) {
            const event = this.pendingEvents.shift();
            if (event.type === Events.CanLaunchModules) {
                this.handleCanLaunchModules(event.payload);
            }
        }
    }

    send(data) {
        if (data.type === Events.LaunchModule && (!data.payload || !data.payload.appPath)) {
            this.reportError('This module could not be loaded. Refresh the module list and try again.');
            return false;
        }
        if (this.socket.readyState !== WebSocket.OPEN) {
            this.reportError('Service disconnected. Wait for reconnection and try again.');
            return false;
        }
        this.socket.send(JSON.stringify(data));
        return true;
    }
}

export { Events };
export default Client;