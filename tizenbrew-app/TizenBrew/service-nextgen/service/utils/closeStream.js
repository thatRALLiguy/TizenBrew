"use strict";

// Node 4 PassThrough does not implement destroy(). Match node-fetch's
// pre-8 fallback; mark first because close handlers may call us again.
module.exports = function closeStream(stream) {
    if (!stream || stream._tizenbrewClosed) return;
    stream._tizenbrewClosed = true;
    if (typeof stream.destroy === 'function') stream.destroy();
    else {
        if (typeof stream.unpipe === 'function') stream.unpipe();
        if (typeof stream.resume === 'function') stream.resume();
        if (typeof stream.emit === 'function') stream.emit('close');
    }
};
