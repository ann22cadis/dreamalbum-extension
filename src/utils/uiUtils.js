import { getSortableDelay } from '../../../../../utils.js';

const { saveSettingsDebounced } = SillyTavern.getContext();

/**
 * Initializes interactive sorting for provided data selectors.
 * @param {Object[]} sortableDatas 
 * @param {string} sortableDatas[].selector - jQuery selector for the container.
 * @param {function} sortableDatas[].setter - Function to save the new order.
 * @param {function} sortableDatas[].getter - Function to get the current data.
 * @param {function} [loadBlocksCallback] - Optional callback to reload blocks after sorting.
 */
export async function interactiveSortData(sortableDatas, loadBlocksCallback) {
    for (const { selector, setter, getter } of sortableDatas) {
        const $sortable = $(selector);

        $sortable.sortable({
            delay: getSortableDelay(),
            handle: '.drag-handle',
            axis: 'y',
            stop: async function () {
                const oldData = getter();
                const newData = [];
                $sortable.children().each(function () {
                    const id = $(this).attr('id');
                    const existingData = oldData.find((e) => e.id === id);
                    if (existingData) {
                        newData.push(existingData);
                    }
                });
                await setter(newData);
                saveSettingsDebounced();
                if (loadBlocksCallback) {
                    await loadBlocksCallback();
                }
            },
        });
    }
}