const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const WHEEL_STEP = 1.15;
const SWIPE_DISTANCE = 50;
const PAN_THRESHOLD = 3;
/** Clicks this soon after a pan or swipe are the tail of that gesture, not a tap. */
const GESTURE_GRACE_MS = 300;

let instanceSeq = 0;

/**
 * Pinch/wheel/drag zoom for one image inside a clipping box. Shared by the album's
 * "Просмотр" panel and the fullscreen viewer, so both behave the same.
 *
 * The zoom level survives image switches (the caller swaps `img.src`); only
 * `reset()` clears it. Rotation is kept until `resetRotation()`.
 *
 * @param {Object} options
 * @param {HTMLImageElement} options.img The image to transform.
 * @param {HTMLElement} options.clip Element that clips the zoomed image; its size
 *   bounds panning and, when rotated, the fitted image.
 * @param {HTMLElement} [options.surface] Element that receives the gestures. Defaults
 *   to `clip`.
 * @param {(direction: 1|-1) => void} [options.onSwipe] Horizontal swipe at native
 *   scale; omit to disable swiping.
 * @param {() => void} [options.onTap] Single tap/click on the image at native scale,
 *   held back until a double tap is ruled out.
 * @param {(scale: number) => void} [options.onChange] Called whenever the scale changes.
 */
export function createZoomController({ img, clip, surface = clip, onSwipe = null, onTap = null, onChange = null }) {
    const ns = `.dazoom${++instanceSeq}`;
    const $img = $(img);

    let rotation = 0;
    let scale = 1;
    let panX = 0;
    let panY = 0;

    // Size the image occupies at scale 1 with the current rotation. Cached because
    // measuring forces a reflow, and it only changes on rotate, resize or image switch.
    let fitW = 0;
    let fitH = 0;

    const isRotated = () => (rotation / 90) % 2 !== 0;

    /** Area actually available to the image, inside the clip's own padding. */
    const contentBox = () => {
        const cs = window.getComputedStyle(clip);
        return {
            w: clip.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
            h: clip.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
        };
    };

    // Wheel, drag and pinch rewrite the transform every frame, and measuring commits
    // a probe transform — both need the CSS easing off. Reference-counted so a nested
    // measurement cannot switch it back on for the outer caller.
    let instantDepth = 0;
    const beginInstant = () => {
        if (instantDepth++ === 0) $img.addClass('DA-zoom-instant');
    };
    const endInstant = () => {
        if (--instantDepth > 0) return;
        instantDepth = 0;
        // Flush the pending style so restoring the transition cannot animate it.
        void img.offsetHeight;
        $img.removeClass('DA-zoom-instant');
    };
    const instant = (fn) => {
        beginInstant();
        try {
            fn();
        } finally {
            endInstant();
        }
    };

    const measureFit = () => {
        const prevTransform = img.style.transform;
        // getBoundingClientRect flushes styles, so the probe transform really is
        // committed — suppress the easing so it cannot animate.
        beginInstant();
        img.style.transform = `rotate(${rotation}deg)`;
        const rect = img.getBoundingClientRect();
        fitW = rect.width;
        fitH = rect.height;
        img.style.transform = prevTransform;
        endInstant();
    };

    /** Keeps the image edges from being dragged inside the visible area. */
    const clampPan = () => {
        if (scale <= MIN_SCALE) {
            panX = 0;
            panY = 0;
            return;
        }
        // The clip's padding box is what actually clips the image.
        const viewW = clip.clientWidth || window.innerWidth;
        const viewH = clip.clientHeight || window.innerHeight;
        const maxX = Math.max(0, (fitW * scale - viewW) / 2);
        const maxY = Math.max(0, (fitH * scale - viewH) / 2);
        panX = Math.min(maxX, Math.max(-maxX, panX));
        panY = Math.min(maxY, Math.max(-maxY, panY));
    };

    /**
     * Sets the size caps. Only rotation and the clip's size affect these, so it is
     * kept out of applyTransform, which runs on every drag and wheel frame.
     */
    const applySizing = () => {
        if (isRotated()) {
            // Swap the caps so a quarter-turned image still fits the real content area.
            const box = contentBox();
            $img.css({ 'max-width': `${Math.max(0, box.h)}px`, 'max-height': `${Math.max(0, box.w)}px` });
        } else {
            $img.css({ 'max-width': '100%', 'max-height': '100%' });
        }
        measureFit();
    };

    let lastReportedScale = scale;
    const applyTransform = () => {
        $img.css('transform', `translate(${panX}px, ${panY}px) scale(${scale}) rotate(${rotation}deg) translateZ(0)`);
        $img.toggleClass('DA-zoom-zoomed', scale > MIN_SCALE);
        if (onChange && scale !== lastReportedScale) {
            lastReportedScale = scale;
            onChange(scale);
        }
    };

    const refit = () => {
        applySizing();
        clampPan();
        applyTransform();
    };

    /**
     * Zooms so the point under (clientX, clientY) stays put.
     * The transformed bounding box is centred on origin + pan, which is what lets us
     * recover the untransformed origin without measuring again.
     */
    const zoomAt = (clientX, clientY, nextScale) => {
        const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
        if (Math.abs(target - scale) < 0.0001) return;

        const rect = img.getBoundingClientRect();
        const originX = rect.left + rect.width / 2 - panX;
        const originY = rect.top + rect.height / 2 - panY;
        const ratio = target / scale;

        panX = (clientX - originX) - (clientX - originX - panX) * ratio;
        panY = (clientY - originY) - (clientY - originY - panY) * ratio;
        scale = target;

        clampPan();
        applyTransform();
    };

    /** Zooms about the middle of the clip, for buttons and keys. */
    const zoomBy = (factor) => {
        const rect = clip.getBoundingClientRect();
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, scale * factor);
    };

    const reset = () => {
        scale = 1;
        panX = 0;
        panY = 0;
        applyTransform();
    };

    const rotate = (degrees) => {
        rotation += degrees;
        // The fitted size changes, so the pan is re-clamped — the zoom stays put.
        refit();
    };

    const resetRotation = () => {
        rotation = 0;
        instant(refit);
    };

    // A new image or a resize changes the fitted size, so the current pan has to be
    // re-clamped against it — the zoom level itself stays.
    $img.on(`load${ns}`, refit);
    $(window).on(`resize${ns}`, refit);

    // --- Single tap, held back until a double tap is ruled out ------------------
    let tapTimer = null;
    let lastGestureEnd = 0;
    const cancelPendingTap = () => {
        clearTimeout(tapTimer);
        tapTimer = null;
    };
    if (onTap) {
        $img.on(`click${ns}`, () => {
            if (scale > MIN_SCALE || Date.now() - lastGestureEnd < GESTURE_GRACE_MS) return;
            cancelPendingTap();
            tapTimer = setTimeout(() => {
                tapTimer = null;
                if (scale <= MIN_SCALE) onTap();
            }, DOUBLE_TAP_MS);
        });
    }

    // --- Wheel ------------------------------------------------------------------
    // Registered natively: jQuery cannot mark the listener non-passive, and without
    // preventDefault the page behind scrolls.
    const onWheel = (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
        instant(() => zoomAt(e.clientX, e.clientY, scale * factor));
    };

    // --- Mouse drag to pan ------------------------------------------------------
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panStartX = 0;
    let panStartY = 0;
    let didPan = false;

    $img.on(`mousedown${ns}`, (e) => {
        if (e.button !== 0 || scale <= MIN_SCALE) return;
        e.preventDefault();
        dragging = true;
        didPan = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        panStartX = panX;
        panStartY = panY;
        beginInstant();
        $img.addClass('DA-zoom-dragging');
    });

    $(document).on(`mousemove${ns}`, (e) => {
        if (!dragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.abs(dx) > PAN_THRESHOLD || Math.abs(dy) > PAN_THRESHOLD) didPan = true;
        panX = panStartX + dx;
        panY = panStartY + dy;
        clampPan();
        applyTransform();
    });

    $(document).on(`mouseup${ns}`, () => {
        if (!dragging) return;
        dragging = false;
        if (didPan) lastGestureEnd = Date.now();
        endInstant();
        $img.removeClass('DA-zoom-dragging');
    });

    // --- Double click toggles zoom ----------------------------------------------
    $img.on(`dblclick${ns}`, (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelPendingTap();
        if (scale > MIN_SCALE) reset();
        else zoomAt(e.clientX, e.clientY, DOUBLE_TAP_SCALE);
    });

    // --- Touch: pinch zooms, one finger pans when zoomed, swipes navigate -------
    let touchStartX = 0;
    let touchStartY = 0;
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let touchPanning = false;
    let lastTapTime = 0;

    const touchDistance = (touches) => Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
    );

    const onTouchStart = (e) => {
        const touches = e.touches;
        if (touches.length === 2) {
            e.preventDefault();
            cancelPendingTap();
            // Guard against a repeated two-finger touchstart double-counting.
            if (pinchStartDist === 0) beginInstant();
            if (touchPanning) {
                touchPanning = false;
                endInstant();
            }
            pinchStartDist = touchDistance(touches);
            pinchStartScale = scale;
            return;
        }
        if (touches.length !== 1) return;

        touchStartX = touches[0].clientX;
        touchStartY = touches[0].clientY;

        // Double tap toggles zoom, mirroring the desktop double click.
        const now = Date.now();
        if (now - lastTapTime < DOUBLE_TAP_MS && e.target === img) {
            e.preventDefault();
            cancelPendingTap();
            if (scale > MIN_SCALE) reset();
            else zoomAt(touches[0].clientX, touches[0].clientY, DOUBLE_TAP_SCALE);
            lastTapTime = 0;
            return;
        }
        lastTapTime = now;

        if (scale > MIN_SCALE && !touchPanning) {
            touchPanning = true;
            didPan = false;
            dragStartX = touches[0].clientX;
            dragStartY = touches[0].clientY;
            panStartX = panX;
            panStartY = panY;
            beginInstant();
        }
    };

    const onTouchMove = (e) => {
        if (e.touches.length === 2 && pinchStartDist > 0) {
            e.preventDefault();
            const dist = touchDistance(e.touches);
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            zoomAt(midX, midY, pinchStartScale * (dist / pinchStartDist));
            return;
        }
        if (touchPanning && e.touches.length === 1) {
            e.preventDefault();
            const dx = e.touches[0].clientX - dragStartX;
            const dy = e.touches[0].clientY - dragStartY;
            if (Math.abs(dx) > PAN_THRESHOLD || Math.abs(dy) > PAN_THRESHOLD) didPan = true;
            panX = panStartX + dx;
            panY = panStartY + dy;
            clampPan();
            applyTransform();
        }
    };

    const onTouchEnd = (e) => {
        if (pinchStartDist > 0 && e.touches.length < 2) {
            pinchStartDist = 0;
            lastGestureEnd = Date.now();
            endInstant();
            return;
        }
        if (touchPanning) {
            touchPanning = false;
            if (didPan) lastGestureEnd = Date.now();
            endInstant();
            return;
        }
        // Only navigate at native scale, so panning a zoomed image never swipes it away.
        if (!onSwipe || scale > MIN_SCALE) return;
        const dx = touchStartX - e.changedTouches[0].clientX;
        const dy = touchStartY - e.changedTouches[0].clientY;
        if (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
            lastGestureEnd = Date.now();
            cancelPendingTap();
            onSwipe(dx > 0 ? 1 : -1);
        }
    };

    surface.addEventListener('wheel', onWheel, { passive: false });
    surface.addEventListener('touchstart', onTouchStart, { passive: false });
    surface.addEventListener('touchmove', onTouchMove, { passive: false });
    surface.addEventListener('touchend', onTouchEnd, { passive: false });

    const destroy = () => {
        cancelPendingTap();
        $img.off(ns);
        $(document).off(ns);
        $(window).off(ns);
        surface.removeEventListener('wheel', onWheel);
        surface.removeEventListener('touchstart', onTouchStart);
        surface.removeEventListener('touchmove', onTouchMove);
        surface.removeEventListener('touchend', onTouchEnd);
    };

    if (img.complete && img.naturalWidth) refit();
    else applyTransform();

    return {
        get scale() {
            return scale;
        },
        isZoomed: () => scale > MIN_SCALE,
        /** True right after a pan, pinch or swipe — its trailing click is not a tap. */
        recentlyGestured: () => Date.now() - lastGestureEnd < GESTURE_GRACE_MS,
        refit,
        zoomBy,
        reset,
        rotate,
        resetRotation,
        destroy
    };
}
