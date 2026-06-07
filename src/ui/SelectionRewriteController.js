import { closeMessageEditor } from '../../../../../../script.js';
import { templates_path, ElementTemplate, BlockType } from '../core/constants.js';
import { BlockService } from '../services/BlockService.js';
import { PluginRegistry } from '../core/PluginRegistry.js';

const { renderExtensionTemplateAsync, chat } = SillyTavern.getContext();

export const SelectionRewriteController = {
    isActive: false,
    activeMessageId: null,
    selectedText: '',
    popup: null,
    selectionTimeout: null,
    selectionRange: null,
    selectionStart: 0,
    selectionEnd: 0,

    async init() {
        const popupHtml = await renderExtensionTemplateAsync(templates_path, ElementTemplate.SELECTION_POPUP);
        $('body').append(popupHtml);
        this.popup = $('#dreamalbum-selection-popup');

        this.bindEvents();
    },

    bindEvents() {
        this.makeDraggable();

        $(document).on('click', '.DreamAlbum-selection-rewrite', (e) => {
            const btn = $(e.currentTarget);
            const mesElement = btn.closest('.mes');
            const messageId = parseInt(mesElement.attr('mesid'));

            if (this.isActive && this.activeMessageId === messageId) {
                this.deactivate();
            } else {
                this.activate(messageId, btn);
            }
        });

        $(document).on('mouseup', '.mes', (e) => {
            if (!this.isActive) return;
            
            const mesElement = $(e.currentTarget);
            const messageId = parseInt(mesElement.attr('mesid'));
            if (messageId !== this.activeMessageId) return;

            if (!$(e.target).closest('#curEditTextarea').length && e.target.id !== 'curEditTextarea') {
                return;
            }

            clearTimeout(this.selectionTimeout);
            this.selectionTimeout = setTimeout(() => {
                this.handleSelection(e);
            }, 500);
        });

        this.popup.find('#dreamalbum-selection-popup-close').on('click', () => {
            this.hidePopup();
        });

        this.popup.find('#dreamalbum-selection-rewrite-btn').on('click', () => {
            this.triggerRewrite();
        });

        $(document).on('mousedown', (e) => {
            if (this.popup.is(':visible') && !this.popup.is(e.target) && this.popup.has(e.target).length === 0) {
                if (!$(e.target).closest('.mes').length) {
                    this.hidePopup();
                }
            }
        });
    },

    activate(messageId, btn) {
        this.deactivate();
        this.isActive = true;
        this.activeMessageId = messageId;
        $('.DreamAlbum-selection-rewrite').removeClass('active');
        btn.addClass('active');
        toastr.info('Selection Rewrite Mode active. Select text in the editor.');
    },

    deactivate() {
        this.isActive = false;
        this.activeMessageId = null;
        this.selectedText = '';
        $('.DreamAlbum-selection-rewrite').removeClass('active');
        this.hidePopup();
    },

    handleSelection(event) {
        const textarea = document.getElementById('curEditTextarea');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value.substring(start, end).trim();

        if (text && text.length > 0) {
            this.selectedText = text;
            this.selectionStart = start;
            this.selectionEnd = end;
            this.showPopup(event.pageX, event.pageY);
        } else {
            this.hidePopup();
        }
    },

    makeDraggable() {
        let isDragging = false;
        let offset = { x: 0, y: 0 };

        $(document).on('mousedown', '.dreamalbum-selection-popup-header', (e) => {
            isDragging = true;
            const popupPos = this.popup.offset();
            offset.x = e.pageX - popupPos.left;
            offset.y = e.pageY - popupPos.top;
        });

        $(document).on('mousemove', (e) => {
            if (!isDragging) return;
            this.popup.css({
                top: e.pageY - offset.y,
                left: e.pageX - offset.x
            });
        });

        $(document).on('mouseup', () => {
            isDragging = false;
        });
    },

    showPopup(x, y) {
        const rewriteBlocks = BlockService.getBlocksByType([BlockType.REWRITE], true);
        const select = this.popup.find('#dreamalbum-selection-block-select');
        select.empty();

        if (rewriteBlocks.length === 0) {
            select.append('<option value="">No rewrite blocks found</option>');
            this.popup.find('#dreamalbum-selection-rewrite-btn').prop('disabled', true);
        } else {
            rewriteBlocks.forEach(block => {
                select.append(`<option value="${block.name}">${block.name}</option>`);
            });
            this.popup.find('#dreamalbum-selection-rewrite-btn').prop('disabled', false);
        }

        this.popup.find('#dreamalbum-selection-text-preview').text(this.selectedText);

        this.popup.css({
            display: 'block',
            visibility: 'hidden'
        });

        const popupHeight = this.popup.outerHeight();
        const popupWidth = this.popup.outerWidth();
        
        let top = y + 10;
        if (top + popupHeight > window.innerHeight) {
            top = y - popupHeight - 10;
        }

        let left = x;
        if (left + popupWidth > window.innerWidth) {
            left = window.innerWidth - popupWidth - 10;
        }

        this.popup.css({
            top: Math.max(0, top),
            left: Math.max(0, left),
            visibility: 'visible'
        });
    },

    hidePopup() {
        this.popup.hide();
        this.popup.find('#dreamalbum-selection-additional-prompt').val('');
    },

    async triggerRewrite() {
        const blockName = this.popup.find('#dreamalbum-selection-block-select').val();
        const additionalPrompt = this.popup.find('#dreamalbum-selection-additional-prompt').val();

        if (!blockName) return;

        const rewritePlugin = PluginRegistry.get(BlockType.REWRITE);
        const allBlocks = BlockService.getAllEnabledBlocks();
        const block = allBlocks.find(b => b.name === blockName);

        if (rewritePlugin && block) {
            this.hidePopup();
            
            await rewritePlugin.execute([block], {
                messageId: this.activeMessageId,
                allBlocks: allBlocks,
                additionalMacro: {
                    textToRewrite: this.selectedText,
                    additionalPrompt: additionalPrompt
                }
            });

            closeMessageEditor();
            this.deactivate();
        }
    }
};