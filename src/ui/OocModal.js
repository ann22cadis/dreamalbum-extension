const MAX_TEXTAREA_HEIGHT = 250;

/** Backdrop clicks this soon after opening are the tail of the press that opened it. */
const OPEN_GRACE_MS = 400;

/**
 * Asks for a one-off out-of-character instruction to attach to a single generation.
 * Shared by the floating style buttons and the album's "Создать" button.
 *
 * @param {Object} options
 * @param {string} options.styleName Style the instruction is for, shown in the title.
 * @param {string} [options.initial] Text to prefill, e.g. the previous instruction.
 * @returns {Promise<string|null>} The instruction (possibly empty), or null if dismissed.
 */
export function askOocInstruction({ styleName, initial = '' }) {
    return new Promise((resolve) => {
        const $overlay = $(`
            <div class="DA-confirm-wrapper DA-ooc-overlay" role="dialog" aria-modal="true">
                <div class="DA-confirm-box DA-ooc-box">
                    <div class="DA-ooc-title">
                        <i class="fa-solid fa-comment-dots"></i>
                        <span>ООС-пожелание</span>
                    </div>
                    <div class="DA-ooc-style">Стиль: <span class="DA-ooc-style-name"></span></div>
                    <div class="DA-ooc-hint">Одноразовая инструкция для ИИ — она учтётся только в этой генерации.</div>
                    <textarea class="DA-input DA-ooc-input" rows="3" placeholder="Например: ночь, дождь, крупный план лица..."></textarea>
                    <div class="DA-ooc-actions">
                        <button class="DA-btn-confirm DA-ooc-cancel" type="button">Отмена</button>
                        <button class="DA-btn-confirm DA-ooc-submit" type="button">Сгенерировать</button>
                    </div>
                    <div class="DA-ooc-keys">Ctrl+Enter — отправить · Esc — отмена</div>
                </div>
            </div>
        `);

        // Style names are user text: set them as text, never as markup.
        $overlay.find('.DA-ooc-style-name').text(styleName);

        const previousFocus = document.activeElement;
        const openedAt = Date.now();
        const textarea = $overlay.find('.DA-ooc-input')[0];
        // `initial` may be a previously submitted value, which was stored escaped.
        textarea.value = initial.replace(/&apos;/g, "'");

        const autosize = () => {
            textarea.style.height = '';
            textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
            textarea.style.overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
        };

        const finish = (value) => {
            document.removeEventListener('keydown', onKeydown, true);
            $overlay.remove();
            if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
            resolve(value);
        };

        const submit = () => {
            // Normalised the same way the floating buttons always did, so an apostrophe
            // cannot break the single-quoted attribute the model may copy it into.
            finish(textarea.value.trim().replace(/'/g, '&apos;'));
        };

        $overlay.find('.DA-ooc-cancel').on('click', () => finish(null));
        $overlay.find('.DA-ooc-submit').on('click', submit);
        $overlay.on('click', (e) => {
            if (e.target !== $overlay[0]) return;
            if (Date.now() - openedAt < OPEN_GRACE_MS) return;
            finish(null);
        });
        $(textarea).on('input', autosize);

        // Capture phase on purpose: SillyTavern listens for keydown on `document` and
        // maps Ctrl+Enter to "regenerate" and Alt+Enter to "continue". A bubbling
        // listener here runs after those, so submitting the dialog would also
        // regenerate the last chat message.
        function onKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finish(null);
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.stopPropagation();
                submit();
            } else if ($overlay[0].contains(e.target)) {
                // Typing here is never a chat hotkey.
                e.stopPropagation();
            }
        }
        document.addEventListener('keydown', onKeydown, true);

        $('body').append($overlay);
        autosize();
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
}
