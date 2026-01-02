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

/**
 * Categories of markers organized by their purpose in the research workflow.
 */
export type MarkerCategory =
  | 'RESEARCH_PROCESS'
  | 'DATA'
  | 'CALCULATIONS'
  | 'ARTIFACTS'
  | 'INSIGHTS'
  | 'WORKFLOW'
  | 'SCIENTIFIC';

/**
 * Definition of a marker type within the taxonomy.
 */
export interface MarkerDefinition {
  /** Marker name (e.g., 'OBJECTIVE', 'HYPOTHESIS') */
  name: string;
  /** Category this marker belongs to */
  category: MarkerCategory;
  /** Human-readable description of the marker's purpose */
  description: string;
}

/**
 * A parsed marker extracted from text output.
 */
export interface ParsedMarker {
  /** The marker type (e.g., 'OBJECTIVE', 'DATA') */
  type: string;
  /** Optional subtype (e.g., 'loading' in [DATA:loading]) */
  subtype?: string;
  /** Key-value attributes (e.g., { format: 'csv' } from [DATA:format=csv]) */
  attributes: Record<string, string>;
  /** The content following the marker */
  content: string;
  /** Line number where the marker was found (1-indexed) */
  lineNumber: number;
  /** Whether the marker is recognized in the taxonomy */
  valid: boolean;
}

/**
 * Result of parsing text for markers.
 */
export interface ParseResult {
  /** All markers found in the text */
  markers: ParsedMarker[];
  /** Count of valid (recognized) markers */
  validCount: number;
  /** Count of unknown markers that triggered warnings */
  unknownCount: number;
  /** List of unknown marker types encountered */
  unknownTypes: string[];
}

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
export const MARKER_TAXONOMY: Record<string, MarkerDefinition> = {
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
    description: 'Statistical measures (mean, std, p-value)',
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
  CHECK: {
    name: 'CHECK',
    category: 'WORKFLOW',
    description: 'Validation checks and assertions',
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

  // Scientific - Research metadata
  CITATION: {
    name: 'CITATION',
    category: 'SCIENTIFIC',
    description: 'References to papers, datasets, or sources',
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
    description: 'Research decisions and their rationale',
  },
};

/**
 * Regex pattern to match markers in text.
 * 
 * Format: [MARKER_TYPE] content
 *     or: [MARKER_TYPE:subtype] content
 *     or: [MARKER_TYPE:key=value:key2=value2] content
 * 
 * Captures:
 * 1. Marker type (uppercase letters and underscores)
 * 2. Optional attributes string (everything between : and ])
 * 3. Content after the marker
 */
const MARKER_REGEX = /^\[([A-Z_]+)(?::([^\]]+))?\]\s*(.*)$/;

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
export function parseMarkers(text: string): ParseResult {
  const lines = text.split('\n');
  const markers: ParsedMarker[] = [];
  const unknownTypes: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(MARKER_REGEX);

    if (match) {
      const [, type, attributeStr, content] = match;
      const attributes: Record<string, string> = {};
      let subtype: string | undefined;

      // Parse attributes if present
      if (attributeStr) {
        // Split by colon to handle multiple attributes
        const parts = attributeStr.split(':');
        for (const part of parts) {
          if (part.includes('=')) {
            // Key-value attribute
            const eqIndex = part.indexOf('=');
            const key = part.slice(0, eqIndex);
            const value = part.slice(eqIndex + 1);
            attributes[key] = value;
          } else {
            // Simple subtype (first non-kv part)
            if (subtype === undefined) {
              subtype = part;
            } else {
              // Additional subtypes become attributes with empty values
              attributes[part] = '';
            }
          }
        }
      }

      // Validate against taxonomy (silently track unknown markers)
      const valid = type in MARKER_TAXONOMY;
      if (!valid && !unknownTypes.includes(type)) {
        unknownTypes.push(type);
      }

      markers.push({
        type,
        subtype,
        attributes,
        content,
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
export function validateMarker(marker: ParsedMarker): boolean {
  return marker.type in MARKER_TAXONOMY;
}

/**
 * Get the definition for a marker type.
 * 
 * @param type - Marker type to look up
 * @returns MarkerDefinition if found, undefined otherwise
 */
export function getMarkerDefinition(type: string): MarkerDefinition | undefined {
  return MARKER_TAXONOMY[type];
}

/**
 * Get all markers of a specific category.
 * 
 * @param markers - Array of parsed markers
 * @param category - Category to filter by
 * @returns Markers belonging to the specified category
 */
export function getMarkersByCategory(
  markers: ParsedMarker[],
  category: MarkerCategory
): ParsedMarker[] {
  return markers.filter((m) => {
    const def = MARKER_TAXONOMY[m.type];
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
export function getMarkersByType(markers: ParsedMarker[], type: string): ParsedMarker[] {
  return markers.filter((m) => m.type === type);
}

/**
 * List all marker types in the taxonomy.
 * 
 * @returns Array of all marker type names
 */
export function getAllMarkerTypes(): string[] {
  return Object.keys(MARKER_TAXONOMY);
}

/**
 * List all marker types in a specific category.
 * 
 * @param category - Category to filter by
 * @returns Array of marker type names in the category
 */
export function getMarkerTypesByCategory(category: MarkerCategory): string[] {
  return Object.entries(MARKER_TAXONOMY)
    .filter(([, def]) => def.category === category)
    .map(([type]) => type);
}
