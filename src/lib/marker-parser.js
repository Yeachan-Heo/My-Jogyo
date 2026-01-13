"use strict";
/**
 * Marker Parser for Gyoshu structured output.
 *
 * Parses structured markers from agent output text to enable:
 * - Reproducibility tracking of research steps
 * - Structured extraction of data, calculations, and insights
 * - Validation of marker usage against taxonomy
 *
 * Marker Format:
 * - Basic: [MARKER_TYPE] content
 * - With subtype: [MARKER_TYPE:subtype] content
 * - With attributes: [MARKER_TYPE:key=value:key2=value2] content
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MARKER_TAXONOMY = void 0;
exports.parseMarkers = parseMarkers;
exports.validateMarker = validateMarker;
exports.getMarkerDefinition = getMarkerDefinition;
exports.getMarkersByCategory = getMarkersByCategory;
exports.getMarkersByType = getMarkersByType;
exports.getAllMarkerTypes = getAllMarkerTypes;
exports.getMarkerTypesByCategory = getMarkerTypesByCategory;
/**
 * Complete marker taxonomy for Gyoshu research workflows.
 *
 * Categories:
 * - RESEARCH_PROCESS: Core scientific method steps
 * - DATA: Data loading, inspection, and characteristics
 * - CALCULATIONS: Computed values and statistics
 * - ARTIFACTS: Generated files, plots, tables
 * - INSIGHTS: Discoveries and interpretations
 * - WORKFLOW: Process tracking and status
 * - SCIENTIFIC: Research metadata and decisions
 */
exports.MARKER_TAXONOMY = {
    // Research Process - Core scientific method markers
    OBJECTIVE: {
        name: 'OBJECTIVE',
        category: 'RESEARCH_PROCESS',
        description: 'Research goal or question being investigated',
    },
    HYPOTHESIS: {
        name: 'HYPOTHESIS',
        category: 'RESEARCH_PROCESS',
        description: 'Proposed explanation or prediction to test',
    },
    EXPERIMENT: {
        name: 'EXPERIMENT',
        category: 'RESEARCH_PROCESS',
        description: 'Experimental procedure or methodology',
    },
    OBSERVATION: {
        name: 'OBSERVATION',
        category: 'RESEARCH_PROCESS',
        description: 'Raw observations from data or experiments',
    },
    ANALYSIS: {
        name: 'ANALYSIS',
        category: 'RESEARCH_PROCESS',
        description: 'Interpretation and analysis of observations',
    },
    CONCLUSION: {
        name: 'CONCLUSION',
        category: 'RESEARCH_PROCESS',
        description: 'Final conclusions from the research',
    },
    // Data - Data loading, inspection, and characteristics
    DATA: {
        name: 'DATA',
        category: 'DATA',
        description: 'Data loading or general data description',
    },
    SHAPE: {
        name: 'SHAPE',
        category: 'DATA',
        description: 'Data dimensions (rows, columns, etc.)',
    },
    DTYPE: {
        name: 'DTYPE',
        category: 'DATA',
        description: 'Data types of columns or variables',
    },
    RANGE: {
        name: 'RANGE',
        category: 'DATA',
        description: 'Value ranges (min, max, quartiles)',
    },
    MISSING: {
        name: 'MISSING',
        category: 'DATA',
        description: 'Missing or null data information',
    },
    MEMORY: {
        name: 'MEMORY',
        category: 'DATA',
        description: 'Memory usage of data structures',
    },
    // Calculations - Computed values and statistics
    CALC: {
        name: 'CALC',
        category: 'CALCULATIONS',
        description: 'Computed values or transformations',
    },
    METRIC: {
        name: 'METRIC',
        category: 'CALCULATIONS',
        description: 'Named metrics (accuracy, precision, etc.)',
    },
    STAT: {
        name: 'STAT',
        category: 'CALCULATIONS',
        description: 'Statistical measures. Subtypes: ci (confidence interval), effect_size, p_value, estimate',
    },
    CORR: {
        name: 'CORR',
        category: 'CALCULATIONS',
        description: 'Correlations between variables',
    },
    // Artifacts - Generated outputs
    PLOT: {
        name: 'PLOT',
        category: 'ARTIFACTS',
        description: 'Visualizations and charts',
    },
    ARTIFACT: {
        name: 'ARTIFACT',
        category: 'ARTIFACTS',
        description: 'Saved files (models, data exports, etc.)',
    },
    TABLE: {
        name: 'TABLE',
        category: 'ARTIFACTS',
        description: 'Tabular output or formatted data',
    },
    FIGURE: {
        name: 'FIGURE',
        category: 'ARTIFACTS',
        description: 'Saved figure or image file',
    },
    // Insights - Discoveries and interpretations
    FINDING: {
        name: 'FINDING',
        category: 'INSIGHTS',
        description: 'Key discoveries from the analysis',
    },
    INSIGHT: {
        name: 'INSIGHT',
        category: 'INSIGHTS',
        description: 'Interpretations and understanding gained',
    },
    PATTERN: {
        name: 'PATTERN',
        category: 'INSIGHTS',
        description: 'Identified patterns in the data',
    },
    // Workflow - Process tracking
    STEP: {
        name: 'STEP',
        category: 'WORKFLOW',
        description: 'Process steps in the workflow',
    },
    STAGE: {
        name: 'STAGE',
        category: 'WORKFLOW',
        description: 'Bounded execution stage (begin, end, progress). Format: [STAGE:begin|end|progress:id=S01_load_data]',
    },
    CHECKPOINT: {
        name: 'CHECKPOINT',
        category: 'WORKFLOW',
        description: 'Durable checkpoint for resume capability. Format: [CHECKPOINT:saved|begin|end|emergency:id=ckpt-001:stage=S02]',
    },
    CHECK: {
        name: 'CHECK',
        category: 'WORKFLOW',
        description: 'Assumption verification checks. Subtypes: normality, homogeneity, independence',
    },
    INFO: {
        name: 'INFO',
        category: 'WORKFLOW',
        description: 'Informational messages',
    },
    WARNING: {
        name: 'WARNING',
        category: 'WORKFLOW',
        description: 'Warning messages about potential issues',
    },
    ERROR: {
        name: 'ERROR',
        category: 'WORKFLOW',
        description: 'Error messages for failures',
    },
    DEBUG: {
        name: 'DEBUG',
        category: 'WORKFLOW',
        description: 'Debug messages for development',
    },
    REHYDRATED: {
        name: 'REHYDRATED',
        category: 'WORKFLOW',
        description: 'Marker indicating session was restored from checkpoint. Format: [REHYDRATED:from=ckpt-xxx]',
    },
    // Scientific - Research metadata
    CITATION: {
        name: 'CITATION',
        category: 'SCIENTIFIC',
        description: 'Literature citations. Format: [CITATION:identifier] where identifier is a DOI (e.g., 10.1145/2939672.2939785) or arXiv ID (e.g., 2301.12345)',
    },
    LIMITATION: {
        name: 'LIMITATION',
        category: 'SCIENTIFIC',
        description: 'Known limitations of the analysis',
    },
    NEXT_STEP: {
        name: 'NEXT_STEP',
        category: 'SCIENTIFIC',
        description: 'Recommended follow-up actions',
    },
    DECISION: {
        name: 'DECISION',
        category: 'SCIENTIFIC',
        description: 'Research decisions with rationale, including test selection justification',
    },
    SO_WHAT: {
        name: 'SO_WHAT',
        category: 'SCIENTIFIC',
        description: 'Practical significance explanation - translates statistical findings to real-world impact',
    },
    INDEPENDENT_CHECK: {
        name: 'INDEPENDENT_CHECK',
        category: 'SCIENTIFIC',
        description: 'Robustness verification using alternative method or sensitivity analysis',
    },
    CHALLENGE_RESPONSE: {
        name: 'CHALLENGE_RESPONSE',
        category: 'SCIENTIFIC',
        description: 'Response to adversarial challenge from Baksa. Format: [CHALLENGE_RESPONSE:N] response text',
    },
    VERIFICATION_CODE: {
        name: 'VERIFICATION_CODE',
        category: 'SCIENTIFIC',
        description: 'Reproducible verification code that proves a claim',
    },
};
/**
 * Regex pattern to match markers in text.
 *
 * Format: [MARKER_TYPE] content
 *     or: [MARKER_TYPE:subtype] content
 *     or: [MARKER_TYPE:key=value:key2=value2] content
 *
 * Leading whitespace is allowed to match Python bridge behavior.
 * Examples: "  [FINDING] text" and "[FINDING] text" both match.
 *
 * Captures:
 * 1. Marker type (uppercase letters, underscores, and hyphens)
 * 2. Optional attributes string (everything between : and ])
 * 3. Content after the marker
 *
 * Note: Hyphens in marker types are normalized to underscores for taxonomy lookup.
 * This allows both [CHALLENGE-RESPONSE:1] and [CHALLENGE_RESPONSE:1] to work.
 */
const MARKER_REGEX = /^\s*\[([A-Z][A-Z0-9_-]*)(?::([^\]]+))?\]\s*(.*)$/;
/**
 * Parse markers from text output.
 *
 * Scans each line for markers matching the pattern [MARKER_TYPE] or
 * [MARKER_TYPE:attributes]. Unknown markers generate a console warning
 * but are still included in the result with valid=false.
 *
 * @param text - Multi-line text to parse
 * @returns ParseResult with all found markers and statistics
 *
 * @example
 * ```typescript
 * const text = `
 * [OBJECTIVE] Analyze customer churn patterns
 * [DATA:loading] Loading customers.csv
 * [SHAPE] 10000 rows, 15 columns
 * [STAT:mean] avg_tenure = 24.5 months
 * [FINDING] High churn in first 3 months
 * `;
 *
 * const result = parseMarkers(text);
 * console.log(result.markers.length); // 5
 * console.log(result.validCount);     // 5
 * ```
 */
function parseMarkers(text) {
    const lines = text.split('\n');
    const markers = [];
    const unknownTypes = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(MARKER_REGEX);
        if (match) {
            const [, rawType, attributeStr, content] = match;
            // Normalize hyphens to underscores for taxonomy lookup
            const type = rawType.replace(/-/g, '_');
            const attributes = {};
            let subtype;
            // Parse attributes if present
            if (attributeStr) {
                // CITATION identifiers (DOIs, arXiv) may contain colons - don't split
                if (type === 'CITATION') {
                    subtype = attributeStr;
                }
                else {
                    const parts = attributeStr.split(':');
                    for (const part of parts) {
                        if (part.includes('=')) {
                            const eqIndex = part.indexOf('=');
                            const key = part.slice(0, eqIndex);
                            const value = part.slice(eqIndex + 1);
                            attributes[key] = value;
                        }
                        else if (subtype === undefined) {
                            subtype = part.replace(/-/g, '_');
                        }
                        else {
                            attributes[part] = '';
                        }
                    }
                }
            }
            // Validate against taxonomy (silently track unknown markers)
            const valid = type in exports.MARKER_TAXONOMY;
            if (!valid && !unknownTypes.includes(type)) {
                unknownTypes.push(type);
            }
            markers.push({
                type,
                subtype,
                attributes,
                content: content.trim(),
                lineNumber: i + 1,
                valid,
            });
        }
    }
    return {
        markers,
        validCount: markers.filter((m) => m.valid).length,
        unknownCount: markers.filter((m) => !m.valid).length,
        unknownTypes,
    };
}
/**
 * Validate a marker against the taxonomy.
 *
 * @param marker - Parsed marker to validate
 * @returns true if marker type is in the taxonomy
 */
function validateMarker(marker) {
    return marker.type in exports.MARKER_TAXONOMY;
}
/**
 * Get the definition for a marker type.
 *
 * @param type - Marker type to look up
 * @returns MarkerDefinition if found, undefined otherwise
 */
function getMarkerDefinition(type) {
    return exports.MARKER_TAXONOMY[type];
}
/**
 * Get all markers of a specific category.
 *
 * @param markers - Array of parsed markers
 * @param category - Category to filter by
 * @returns Markers belonging to the specified category
 */
function getMarkersByCategory(markers, category) {
    return markers.filter((m) => {
        const def = exports.MARKER_TAXONOMY[m.type];
        return def && def.category === category;
    });
}
/**
 * Get all markers of a specific type.
 *
 * @param markers - Array of parsed markers
 * @param type - Marker type to filter by
 * @returns Markers of the specified type
 */
function getMarkersByType(markers, type) {
    return markers.filter((m) => m.type === type);
}
/**
 * List all marker types in the taxonomy.
 *
 * @returns Array of all marker type names
 */
function getAllMarkerTypes() {
    return Object.keys(exports.MARKER_TAXONOMY);
}
/**
 * List all marker types in a specific category.
 *
 * @param category - Category to filter by
 * @returns Array of marker type names in the category
 */
function getMarkerTypesByCategory(category) {
    return Object.entries(exports.MARKER_TAXONOMY)
        .filter(([, def]) => def.category === category)
        .map(([type]) => type);
}
