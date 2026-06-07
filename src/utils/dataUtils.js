/**
 * Updates an existing item in a JSON array if it has the same name, or inserts it if not found.
 * @param {Object[]} jsonArray 
 * @param {Object} newJson 
 * @returns {number} The index of the updated or inserted item.
 */
export function updateOrInsert(jsonArray, newJson) {
    let index = -1;

    for (let i = 0; i < jsonArray.length; i++) {
        if (jsonArray[i].name === newJson.name) {
            jsonArray[i] = newJson;
            index = i;
            return index;
        }
    }

    if (index === -1) {
        jsonArray.push(newJson);
        index = jsonArray.length - 1;
    }

    return index;
}

/**
 * Groups blocks by their context.
 * @param {Object[]} blocks 
 * @returns {Object} An object where keys are context strings and values are arrays of blocks.
 */
export function groupBlocksByContext(blocks) {
    const contextToString = (context) => context.map(item => item.name).join('_');

    const groupedBlocks = {};

    blocks.forEach(block => {
        const contextStr = contextToString(block.context);
        if (!groupedBlocks[contextStr]) {
            groupedBlocks[contextStr] = [];
        }
        groupedBlocks[contextStr].push(block);
    });

    return groupedBlocks;
}

/**
 * Combines global and scoped blocks, with scoped blocks taking priority.
 * @param {Object[]} globalBlocks 
 * @param {Object[]} scopedBlocks 
 * @returns {Object[]}
 */
export function priorityCombineBlocks(globalBlocks, scopedBlocks) {
    const combined = {};
    scopedBlocks.forEach(obj => {
        combined[obj.name] = obj;
    });

    globalBlocks.forEach(obj => {
        if (!combined[obj.name]) {
            combined[obj.name] = obj;
        }
    });
    return Object.values(combined);
}

/**
 * Resolves a dot-notation path in an object.
 * @param {Object} doc The document to traverse.
 * @param {string} path The dot-notation path (e.g., "a.b.0.c").
 * @param {boolean} createMissing Whether to create missing intermediate objects/arrays.
 * @returns {{parent: Object|Array, lastKey: string}|null} The parent object and the last key in the path, or null if path cannot be resolved.
 */
function resolvePath(doc, path, createMissing = false) {
    if (!path || typeof path !== 'string') return null;
    if (!path.includes('.')) {
        return { parent: doc, lastKey: path };
    }

    const parts = path.split('.');
    let current = doc;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const nextPart = parts[i + 1];

        if (current[part] === undefined || current[part] === null) {
            if (createMissing) {
                // If the next part is a numeric string, create an array, otherwise an object
                current[part] = /^\d+$/.test(nextPart) ? [] : {};
            } else {
                return null;
            }
        }
        current = current[part];

        // If we hit a non-object/non-array while traversing, we can't continue
        if (typeof current !== 'object' || current === null) {
            return null;
        }
    }

    return { parent: current, lastKey: parts[parts.length - 1] };
}

/**
 * Applies MongoDB-style update operators to a document.
 * Supported operators: $set, $inc, $push, $pull, $unset.
 * @param {Object} doc The document to update.
 * @param {Object} update The update object containing operators.
 * @returns {Object} The updated document.
 */
export function applyMongoUpdate(doc, update) {
    if (!update || typeof update !== 'object') return doc;

    const operators = {
        $set: (d, k, v) => {
            const resolved = resolvePath(d, k, true);
            if (resolved) resolved.parent[resolved.lastKey] = v;
        },
        $unset: (d, k) => {
            const resolved = resolvePath(d, k, false);
            if (resolved) delete resolved.parent[resolved.lastKey];
        },
        $inc: (d, k, v) => {
            const resolved = resolvePath(d, k, true);
            if (resolved) {
                const current = resolved.parent[resolved.lastKey] || 0;
                resolved.parent[resolved.lastKey] = current + v;
            }
        },
        $push: (d, k, v) => {
            const resolved = resolvePath(d, k, true);
            if (resolved) {
                if (!Array.isArray(resolved.parent[resolved.lastKey])) {
                    resolved.parent[resolved.lastKey] = [];
                }
                if (Array.isArray(v)) {
                    resolved.parent[resolved.lastKey].push(...v);
                } else {
                    resolved.parent[resolved.lastKey].push(v);
                }
            }
        },
        $pull: (d, k, v) => {
            const resolved = resolvePath(d, k, false);
            if (resolved && Array.isArray(resolved.parent[resolved.lastKey])) {
                const arr = resolved.parent[resolved.lastKey];
                const index = arr.indexOf(v);
                if (index !== -1) {
                    arr.splice(index, 1);
                }
            }
        }
    };

    for (const op in update) {
        if (operators[op]) {
            for (const key in update[op]) {
                operators[op](doc, key, update[op][key]);
            }
        } else if (!op.startsWith('$')) {
            // Default to $set behavior for top-level keys if no operator is provided
            const resolved = resolvePath(doc, op, true);
            if (resolved) resolved.parent[resolved.lastKey] = update[op];
        }
    }

    return doc;
}