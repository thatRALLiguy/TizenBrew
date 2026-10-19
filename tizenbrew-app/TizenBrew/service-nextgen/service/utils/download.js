"use strict";
const fetch = require('node-fetch');
// node-fetch v2 also bounds response-body reads on legacy Node.
module.exports = function download(url) {
    return fetch(url, { timeout: 15000 }).then(response => {
        if (!response.ok) {
            if (response.body) response.body.destroy();
            throw new Error('Download failed: HTTP ' + response.status);
        }
        return response;
    });
};
