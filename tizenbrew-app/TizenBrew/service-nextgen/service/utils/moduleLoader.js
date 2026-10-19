const { readConfig } = require('./configuration.js');
const fetch = require('./download.js');

function loadModules() {
    const config = readConfig();
    const modules = config.modules;

    const modulePromises = modules.map(module => {
        return fetch(`https://cdn.jsdelivr.net/${module}/package.json`)
            .then(res => res.json())
            .then(moduleJson => {
                if (!moduleJson || typeof moduleJson.appName !== 'string' ||
                    (moduleJson.keys && (!Array.isArray(moduleJson.keys) || moduleJson.keys.some(key => typeof key !== 'string'))) ||
                    (moduleJson.serviceFile && typeof moduleJson.serviceFile !== 'string') ||
                    (moduleJson.packageType === 'app' && (typeof moduleJson.appPath !== 'string' || !moduleJson.appPath)) ||
                    (moduleJson.packageType === 'mods' && (typeof moduleJson.websiteURL !== 'string' || !/^https?:\/\//.test(moduleJson.websiteURL) || typeof moduleJson.main !== 'string' || !moduleJson.main))) {
                    throw new Error('Invalid module metadata');
                }
                let moduleData;
                const splitData = [
                    module.substring(0, module.indexOf('/')),
                    module.substring(module.indexOf('/') + 1)
                ];
                const moduleMetadata = {
                    name: splitData[1],
                    type: splitData[0]
                }
                if (moduleJson.packageType === 'app') {
                    moduleData = {
                        fullName: module,
                        appName: moduleJson.appName,
                        version: moduleJson.version,
                        name: moduleMetadata.name,
                        appPath: `http://127.0.0.1:8081/module/${encodeURIComponent(module)}/${moduleJson.appPath}`,
                        keys: moduleJson.keys ? moduleJson.keys : [],
                        moduleType: moduleMetadata.type,
                        packageType: moduleJson.packageType,
                        description: moduleJson.description,
                        serviceFile: moduleJson.serviceFile
                    }
                } else if (moduleJson.packageType === 'mods') {
                    moduleData = {
                        fullName: module,
                        appName: moduleJson.appName,
                        version: moduleJson.version,
                        name: moduleMetadata.name,
                        appPath: moduleJson.websiteURL,
                        keys: moduleJson.keys ? moduleJson.keys : [],
                        moduleType: moduleMetadata.type,
                        packageType: moduleJson.packageType,
                        description: moduleJson.description,
                        serviceFile: moduleJson.serviceFile,
                        tizenAppId: moduleJson.tizenAppId,
                        mainFile: moduleJson.main,
                        evaluateScriptOnDocumentStart: moduleJson.evaluateScriptOnDocumentStart
                    }
                } else return {
                    appName: 'Unknown Module',
                    name: moduleMetadata.name,
                    fullName: module,
                    appPath: '',
                    keys: [],
                    moduleType: moduleMetadata.type,
                    packageType: 'app',
                    description: `Unknown module ${module}. Please check the module name and try again.`
                }

                return moduleData;
            })
            .catch(e => {
                console.error(e);

                const splitData = [
                    module.substring(0, module.indexOf('/')),
                    module.substring(module.indexOf('/') + 1)
                ];

                const moduleMetadata = {
                    name: splitData[1],
                    type: splitData[0]
                }

                return {
                    appName: 'Unknown Module',
                    name: moduleMetadata.name,
                    fullName: module,
                    appPath: '',
                    keys: [],
                    moduleType: moduleMetadata.type,
                    packageType: 'app',
                    description: `Unknown module ${module}. Please check the module name and try again.`
                }
            });
    });

    return Promise.all(modulePromises)
        .then(modules => {
            return modules;
        });
}

module.exports = loadModules;