"use strict";
const fs = require('fs');
const path = require('path');

// Optional, explicitly packaged snapshot. Never intercept other modules or
// version-pinned URLs. Ordinary releases without this directory use the CDN.
module.exports = function bundledModule(url, Response) {
    const prefix = 'https://cdn.jsdelivr.net/npm/@foxreis/tizentube/';
    if (url.indexOf(prefix) !== 0) return null;
    const asset = url.slice(prefix.length);
    if (['package.json', 'dist/userScript.js', 'dist/service.js'].indexOf(asset) < 0) return null;
    const directory = 'bundled-tizentube';
    const file = path.join(__dirname, directory, asset);
    if (!fs.existsSync(file)) return null;
    return new Response(fs.createReadStream(file));
};
