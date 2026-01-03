import { describe, expect, test } from 'bun:test';
import {
  parseMarkers,
  getMarkerDefinition,
  getMarkersByType,
  getMarkersByCategory,
  MARKER_TAXONOMY,
} from './marker-parser';

describe('marker-parser', () => {
  describe('MARKER_TAXONOMY', () => {
    test('includes STAGE marker', () => {
      expect(MARKER_TAXONOMY.STAGE).toBeDefined();
      expect(MARKER_TAXONOMY.STAGE.category).toBe('WORKFLOW');
    });

    test('includes CHECKPOINT marker', () => {
      expect(MARKER_TAXONOMY.CHECKPOINT).toBeDefined();
      expect(MARKER_TAXONOMY.CHECKPOINT.category).toBe('WORKFLOW');
    });

    test('includes REHYDRATED marker', () => {
      expect(MARKER_TAXONOMY.REHYDRATED).toBeDefined();
      expect(MARKER_TAXONOMY.REHYDRATED.category).toBe('WORKFLOW');
    });
  });

  describe('parseMarkers', () => {
    test('parses basic markers', () => {
      const text = `[OBJECTIVE] Analyze customer churn`;
      const result = parseMarkers(text);
      
      expect(result.markers.length).toBe(1);
      expect(result.markers[0].type).toBe('OBJECTIVE');
      expect(result.markers[0].content).toBe('Analyze customer churn');
      expect(result.markers[0].valid).toBe(true);
    });

    test('parses STAGE marker with subtype and attributes', () => {
      const text = `[STAGE:begin:id=S01_load_data] Loading dataset`;
      const result = parseMarkers(text);
      
      expect(result.markers.length).toBe(1);
      expect(result.markers[0].type).toBe('STAGE');
      expect(result.markers[0].subtype).toBe('begin');
      expect(result.markers[0].attributes.id).toBe('S01_load_data');
      expect(result.markers[0].content).toBe('Loading dataset');
      expect(result.markers[0].valid).toBe(true);
    });

    test('parses STAGE:end marker', () => {
      const text = `[STAGE:end:id=S01_load_data:duration=45s] Data loaded successfully`;
      const result = parseMarkers(text);
      
      expect(result.markers.length).toBe(1);
      expect(result.markers[0].type).toBe('STAGE');
      expect(result.markers[0].subtype).toBe('end');
      expect(result.markers[0].attributes.id).toBe('S01_load_data');
      expect(result.markers[0].attributes.duration).toBe('45s');
    });

    test('parses CHECKPOINT:saved marker with all attributes', () => {
      const text = `[CHECKPOINT:saved:id=ckpt-001:stage=S02_eda:runId=run-001] Checkpoint saved`;
      const result = parseMarkers(text);
      
      expect(result.markers.length).toBe(1);
      expect(result.markers[0].type).toBe('CHECKPOINT');
      expect(result.markers[0].subtype).toBe('saved');
      expect(result.markers[0].attributes.id).toBe('ckpt-001');
      expect(result.markers[0].attributes.stage).toBe('S02_eda');
      expect(result.markers[0].attributes.runId).toBe('run-001');
      expect(result.markers[0].valid).toBe(true);
    });

    test('parses CHECKPOINT:emergency marker', () => {
      const text = `[CHECKPOINT:emergency:id=ckpt-002:reason=watchdog_timeout] Emergency save`;
      const result = parseMarkers(text);
      
      expect(result.markers.length).toBe(1);
      expect(result.markers[0].type).toBe('CHECKPOINT');
      expect(result.markers[0].subtype).toBe('emergency');
      expect(result.markers[0].attributes.reason).toBe('watchdog_timeout');
    });

    test('parses REHYDRATED marker', () => {
      const text = `[REHYDRATED:from=ckpt-001] Session restored from checkpoint`;
      const result = parseMarkers(text);
      
      expect(result.markers.length).toBe(1);
      expect(result.markers[0].type).toBe('REHYDRATED');
      expect(result.markers[0].attributes.from).toBe('ckpt-001');
    });

    test('parses multiple stage markers in workflow', () => {
      const text = `
[STAGE:begin:id=S01_load_data] Loading dataset
[DATA] Loaded customers.csv
[SHAPE] 10000 rows, 15 columns
[STAGE:end:id=S01_load_data:duration=30s] Complete
[CHECKPOINT:saved:id=ckpt-001:stage=S01_load_data] Checkpoint saved
[STAGE:begin:id=S02_eda] Starting exploratory analysis
`;
      const result = parseMarkers(text);
      
      expect(result.markers.length).toBe(6);
      expect(result.validCount).toBe(6);
      
      const stageMarkers = getMarkersByType(result.markers, 'STAGE');
      expect(stageMarkers.length).toBe(3);
      
      const checkpointMarkers = getMarkersByType(result.markers, 'CHECKPOINT');
      expect(checkpointMarkers.length).toBe(1);
    });

    test('tracks unknown markers', () => {
      const text = `[UNKNOWN_MARKER] Some content`;
      const result = parseMarkers(text);
      
      expect(result.markers.length).toBe(1);
      expect(result.markers[0].valid).toBe(false);
      expect(result.unknownCount).toBe(1);
      expect(result.unknownTypes).toContain('UNKNOWN_MARKER');
    });
  });

  describe('getMarkerDefinition', () => {
    test('returns definition for STAGE', () => {
      const def = getMarkerDefinition('STAGE');
      expect(def).toBeDefined();
      expect(def?.category).toBe('WORKFLOW');
    });

    test('returns definition for CHECKPOINT', () => {
      const def = getMarkerDefinition('CHECKPOINT');
      expect(def).toBeDefined();
      expect(def?.category).toBe('WORKFLOW');
    });

    test('returns undefined for unknown marker', () => {
      const def = getMarkerDefinition('UNKNOWN');
      expect(def).toBeUndefined();
    });
  });

  describe('getMarkersByCategory', () => {
    test('returns WORKFLOW markers including STAGE and CHECKPOINT', () => {
      const text = `
[STAGE:begin:id=S01] Start
[CHECKPOINT:saved:id=ckpt-001] Saved
[INFO] Some info
[OBJECTIVE] Goal
`;
      const result = parseMarkers(text);
      const workflowMarkers = getMarkersByCategory(result.markers, 'WORKFLOW');
      
      expect(workflowMarkers.length).toBe(3);
      expect(workflowMarkers.map(m => m.type)).toContain('STAGE');
      expect(workflowMarkers.map(m => m.type)).toContain('CHECKPOINT');
      expect(workflowMarkers.map(m => m.type)).toContain('INFO');
    });
  });
});
