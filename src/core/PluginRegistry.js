/**
 * @typedef {Object} IBlockPlugin
 * @property {string} type - The BlockType this plugin handles.
 * @property {function} [execute] - Main execution logic for the block.
 */

export const PluginRegistry = {
    /** @type {Map<string, IBlockPlugin>} */
    plugins: new Map(),

    /**
     * Registers a plugin for a specific block type.
     * @param {IBlockPlugin} plugin 
     */
    register(plugin) {
        if (!plugin.type) {
            throw new Error('[DreamAlbum] Plugin must have a type.');
        }
        this.plugins.set(plugin.type, plugin);
        console.debug(`[DreamAlbum] Registered plugin for type: ${plugin.type}`);
    },

    /**
     * Gets a plugin by block type.
     * @param {string} type 
     * @returns {IBlockPlugin|undefined}
     */
    get(type) {
        return this.plugins.get(type);
    },

    /**
     * Returns all registered plugins.
     * @returns {IBlockPlugin[]}
     */
    getAll() {
        return Array.from(this.plugins.values());
    }
};