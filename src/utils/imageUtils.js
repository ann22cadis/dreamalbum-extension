/**
 * Cover images for style sets are stored inline in SillyTavern's settings.json as
 * base64. A raw phone photo is several megabytes there, and settings.json is
 * rewritten (and backed up) on every save — so covers must be shrunk to thumbnails
 * before they are ever persisted.
 */

/** Longest edge, in pixels, of a stored style cover. */
export const COVER_MAX_EDGE = 384;

/** Encoder quality for stored covers. */
export const COVER_QUALITY = 0.82;

/** Anything larger than this is considered un-optimized and gets re-encoded. */
export const COVER_MAX_BYTES = 192 * 1024;

/**
 * Rough byte size of a data URL's payload.
 * @param {string} dataUrl
 * @returns {number}
 */
export function dataUrlBytes(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return 0;
    const comma = dataUrl.indexOf(',');
    if (comma === -1) return dataUrl.length;
    return Math.floor((dataUrl.length - comma - 1) * 3 / 4);
}

/**
 * Picks the smallest output format the browser actually supports.
 * @returns {string}
 */
function pickMimeType() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    if (canvas.toDataURL('image/webp').startsWith('data:image/webp')) return 'image/webp';
    return 'image/jpeg';
}

let cachedMime = null;

/**
 * Downscales an image to a thumbnail suitable for inline storage.
 * Returns the original string unchanged if it cannot be decoded.
 * @param {string} dataUrl Source image as a data URL (or any loadable URL).
 * @param {number} [maxEdge]
 * @param {number} [quality]
 * @returns {Promise<string>}
 */
export function downscaleImage(dataUrl, maxEdge = COVER_MAX_EDGE, quality = COVER_QUALITY) {
    return new Promise((resolve) => {
        if (!dataUrl || typeof dataUrl !== 'string') return resolve(dataUrl);

        const img = new Image();
        img.onload = () => {
            try {
                const { width, height } = img;
                if (!width || !height) return resolve(dataUrl);

                const scale = Math.min(1, maxEdge / Math.max(width, height));
                const targetW = Math.max(1, Math.round(width * scale));
                const targetH = Math.max(1, Math.round(height * scale));

                const canvas = document.createElement('canvas');
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                // Flatten onto black so transparent PNGs do not turn into white boxes
                // once re-encoded into a format without an alpha channel.
                ctx.drawImage(img, 0, 0, targetW, targetH);

                if (cachedMime === null) cachedMime = pickMimeType();
                const out = canvas.toDataURL(cachedMime, quality);

                // Keep whichever is actually smaller.
                resolve(out.length < dataUrl.length ? out : dataUrl);
            } catch (e) {
                console.warn('[DreamAlbum] Could not downscale image:', e);
                resolve(dataUrl);
            }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

/**
 * Reads a File into a thumbnail data URL, never keeping the full-size original.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function fileToThumbnail(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => resolve(await downscaleImage(e.target.result));
        reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
        reader.readAsDataURL(file);
    });
}
