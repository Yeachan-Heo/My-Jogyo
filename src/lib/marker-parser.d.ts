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
export type MarkerCategory = 'RESEARCH_PROCESS' | 'DATA' | 'CALCULATIONS' | 'ARTIFACTS' | 'INSIGHTS' | 'WORKFLOW' | 'SCIENTIFIC';
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
export declare const MARKER_TAXONOMY: Record<string, MarkerDefinition>;
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
export declare function parseMarkers(text: string): ParseResult;
/**
 * Validate a marker against the taxonomy.
 *
 * @param marker - Parsed marker to validate
 * @returns true if marker type is in the taxonomy
 */
export declare function validateMarker(marker: ParsedMarker): boolean;
/**
 * Get the definition for a marker type.
 *
 * @param type - Marker type to look up
 * @returns MarkerDefinition if found, undefined otherwise
 */
export declare function getMarkerDefinition(type: string): MarkerDefinition | undefined;
/**
 * Get all markers of a specific category.
 *
 * @param markers - Array of parsed markers
 * @param category - Category to filter by
 * @returns Markers belonging to the specified category
 */
export declare function getMarkersByCategory(markers: ParsedMarker[], category: MarkerCategory): ParsedMarker[];
/**
 * Get all markers of a specific type.
 *
 * @param markers - Array of parsed markers
 * @param type - Marker type to filter by
 * @returns Markers of the specified type
 */
export declare function getMarkersByType(markers: ParsedMarker[], type: string): ParsedMarker[];
/**
 * List all marker types in the taxonomy.
 *
 * @returns Array of all marker type names
 */
export declare function getAllMarkerTypes(): string[];
/**
 * List all marker types in a specific category.
 *
 * @param category - Category to filter by
 * @returns Array of marker type names in the category
 */
export declare function getMarkerTypesByCategory(category: MarkerCategory): string[];
