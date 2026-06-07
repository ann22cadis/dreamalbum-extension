/**
 * Converts a string to a RegExp object, supporting slash-delimited patterns with flags.
 * @param {string} str 
 * @returns {RegExp|null}
 */
export function stringToRegex(str) {
    try {
        if (str.startsWith('/')) {
            const lastSlash = str.lastIndexOf('/');
            if (lastSlash > 0) {
                const pattern = str.substring(1, lastSlash);
                const flags = str.substring(lastSlash + 1);
                const validFlags = 'gimyus';
                for (const char of flags) {
                    if (!validFlags.includes(char)) {
                        return new RegExp(pattern);
                    }
                }
                return new RegExp(pattern, flags);
            }
        }
        return new RegExp(str);
    } catch (error) {
        console.error("Error converting string to RegExp:", error);
        return null;
    }
}

/**
 * Removes everything after the first occurrence of a substring.
 * @param {string} str 
 * @param {string} substring 
 * @returns {string}
 */
export function removeAfterSubstring(str, substring) {
    const index = str.indexOf(substring);
    if (index === -1) {
        return str;
    }
    return str.slice(0, index);
}

/**
 * Removes everything after the first match of a regex.
 * @param {string} str 
 * @param {RegExp} regex 
 * @returns {string}
 */
export function removeAfterRegexMatch(str, regex) {
    const match = regex.exec(str);
    if (match) {
        return str.slice(0, match.index + match[0].length);
    }
    return str;
}

/**
 * Removes everything after the last newline and trims the end.
 * @param {string} str 
 * @returns {string}
 */
export function removeAfterLastNewline(str) {
    const lastNewlineIndex = str.lastIndexOf('\n');
    let stringToTrim;

    if (lastNewlineIndex !== -1) {
        stringToTrim = str.slice(0, lastNewlineIndex + 1);
    } else {
        stringToTrim = str;
    }

    return stringToTrim.trimEnd();
}