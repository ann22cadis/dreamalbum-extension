/**
 * Checks if a block name contains attributes (indicated by '=') and returns upper and bottom names.
 * @param {string} block_name 
 * @returns {{upper_block_name: string, bottom_block_name: string}}
 */
export function checkAttributesInBlockName(block_name) {
    if (block_name.includes('=')) {
        const indexOfFirstEqual = block_name.indexOf('=');
        const bottom_block_name = block_name.substring(0, indexOfFirstEqual).trim().split(/\s+/).slice(0, -1).join(' ');
        return {
            upper_block_name: block_name,
            bottom_block_name: bottom_block_name
        }
    } else {
        return {
            upper_block_name: block_name,
            bottom_block_name: block_name
        }
    }
}

export function getRegexForBlock(block_name) {
    const { upper_block_name, bottom_block_name } = checkAttributesInBlockName(block_name);
    const escapedUpper = upper_block_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedBottom = bottom_block_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Matches: 
    // 1. <Tag>...</Tag>
    // 2. <Tag /> (self-closing)
    // 3. <Tag> (unclosed, matches until next tag or end of string)
    return `(\\n*<${escapedUpper}(\\s+[^>]+)?>([\\s\\S]*?<\\/${escapedBottom}>|))`;
}

/**
 * Extracts block content (including tags) from a message by block name.
 * Returns the first matching block.
 * @param {string} message
 * @param {string} block_name
 * @returns {string}
 */
export function getBlockFromMessage(message, block_name) {
    if (!message) return '';
    const { upper_block_name, bottom_block_name } = checkAttributesInBlockName(block_name);
    const startTagIndicator = `<${upper_block_name.toLowerCase()}`;
    const closingTag = `</${bottom_block_name.toLowerCase()}>`;
    const lowerMessage = message.toLowerCase();
    
    let startIndex = lowerMessage.indexOf(startTagIndicator);
    
    while (startIndex !== -1) {
        const nextChar = lowerMessage[startIndex + startTagIndicator.length];
        if (!nextChar || nextChar === '>' || nextChar === ' ' || nextChar === '\t' || nextChar === '\n' || nextChar === '\r') {
             const tagEndIndex = lowerMessage.indexOf('>', startIndex);
             if (tagEndIndex === -1) {
                 startIndex = lowerMessage.indexOf(startTagIndicator, startIndex + 1);
                 continue;
             }

             const endIndex = lowerMessage.indexOf(closingTag, tagEndIndex);
             if (endIndex === -1) {
                 startIndex = lowerMessage.indexOf(startTagIndicator, startIndex + 1);
                 continue;
             }

             return message.substring(startIndex, endIndex + closingTag.length);
        }
        startIndex = lowerMessage.indexOf(startTagIndicator, startIndex + 1);
    }
    
    return '';
}

/**
 * Extracts and concatenates inner content from multiple blocks of the same name.
 * @param {string} message
 * @param {string} block_name
 * @returns {string}
 */
export function getMultiBlockContentFromMessage(message, block_name) {
    if (!message) return '';
    const { upper_block_name, bottom_block_name } = checkAttributesInBlockName(block_name);
    const startTagIndicator = `<${upper_block_name.toLowerCase()}`;
    const closingTag = `</${bottom_block_name.toLowerCase()}>`;
    const lowerMessage = message.toLowerCase();
    
    let contents = [];
    let searchIndex = 0;

    while (true) {
        let startIndex = lowerMessage.indexOf(startTagIndicator, searchIndex);
        if (startIndex === -1) break;

        const nextChar = lowerMessage[startIndex + startTagIndicator.length];
        if (!nextChar || nextChar === '>' || nextChar === ' ' || nextChar === '\t' || nextChar === '\n' || nextChar === '\r') {
            const tagEndIndex = lowerMessage.indexOf('>', startIndex);
            if (tagEndIndex === -1) {
                searchIndex = startIndex + 1;
                continue;
            }

            const endIndex = lowerMessage.indexOf(closingTag, tagEndIndex);
            if (endIndex === -1) {
                searchIndex = startIndex + 1;
                continue;
            }

            // Extract inner content from original message using indexes from lowercase message
            const innerContent = message.substring(tagEndIndex + 1, endIndex);
            contents.push(innerContent.trim());
            searchIndex = endIndex + closingTag.length;
        } else {
            searchIndex = startIndex + 1;
        }
    }

    return contents.join('\n').trim();
}

/**
 * Wraps block content in an identifiable HTML container for the UI.
 * If the content contains a <style> tag, marks the container for Shadow DOM
 * rendering so AI-authored CSS does not bleed into SillyTavern's global styles.
 * @param {string} tagName
 * @param {string} content
 * @returns {string}
 */
export function wrapInDAContainer(tagName, content) {
    const hasStyle = /<style[\s>]/i.test(content);
    const shadowAttr = hasStyle ? ' data-da-shadow="true"' : '';
    return `<div class="da-block-container" data-da-name="${tagName}"${shadowAttr} style="display: block !important;">${content}</div>`;
}