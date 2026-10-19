"use strict";
const fs = require('fs');
const configPath = '/home/owner/share/tizenbrewConfig.json';
function normalize(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
    if (!Array.isArray(config.modules)) config.modules = ['npm/@foxreis/tizentube'];
    config.modules = config.modules.filter(value => typeof value === 'string' && /^(npm|gh)\/.+/.test(value));
    if (typeof config.autoLaunchServiceList === 'string') {
        config.autoLaunchServiceList = config.autoLaunchServiceList ? [config.autoLaunchServiceList] : [];
    }
    if (!Array.isArray(config.autoLaunchServiceList)) config.autoLaunchServiceList = [];
    config.autoLaunchServiceList = config.autoLaunchServiceList.filter(value => typeof value === 'string' && value);
    if (typeof config.autoLaunchModule !== 'string') config.autoLaunchModule = '';
    return config;
}
function readConfig() {
    if (!fs.existsSync(configPath)) return normalize({});
    const contents = fs.readFileSync(configPath, 'utf8');
    try { return normalize(JSON.parse(contents)); }
    catch (error) {
        fs.writeFileSync(configPath + '.corrupt-' + Date.now(), contents);
        console.error('Invalid configuration; using defaults:', error.message);
        return normalize({});
    }
}
function writeConfig(config) {
    fs.writeFileSync(configPath + '.tmp', JSON.stringify(normalize(config), null, 4));
    fs.renameSync(configPath + '.tmp', configPath);
}
module.exports = { readConfig, writeConfig };
