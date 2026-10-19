"use strict";
const fetch = require('node-fetch');
const closeStream = require('./closeStream.js');
const bundledModule = require('./bundledModule.js');
// node-fetch v2 also bounds response-body reads on legacy Node.
module.exports = function download(url) {
    const bundled = bundledModule(url, fetch.Response);
    if (bundled) return Promise.resolve(bundled);
    return fetch(url, { timeout: 15000 }).then(response => {
        if (!response.ok) {
            closeStream(response.body);
            throw new Error('Download failed: HTTP ' + response.status);
        }
        return response;
    });
};
