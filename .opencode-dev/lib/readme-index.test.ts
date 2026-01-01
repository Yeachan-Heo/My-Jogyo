import { describe, it, expect } from "bun:test";
import {
  parseReadmeWithSentinels,
  hasSentinelBlock,
  updateSentinelBlock,
  generateRootReadme,
  generateWorkspaceReadme,
  toDisplayName,
  parseTags,
  WorkspaceEntry,
  ResearchEntry,
} from "./readme-index";

// =============================================================================
// parseReadmeWithSentinels
// =============================================================================

describe("parseReadmeWithSentinels", () => {
  it("returns empty map for content without sentinel blocks", () => {
    const content = "# My README\n\nSome content here.";
    const blocks = parseReadmeWithSentinels(content);
    expect(blocks.size).toBe(0);
  });

  it("extracts single sentinel block", () => {
    const content = `# README
<!-- GYOSHU:INDEX:BEGIN -->
| Name | Count |
|------|-------|
| Test | 5 |
<!-- GYOSHU:INDEX:END -->
`;
    const blocks = parseReadmeWithSentinels(content);
    expect(blocks.size).toBe(1);
    expect(blocks.has("INDEX")).toBe(true);
    expect(blocks.get("INDEX")).toContain("| Name | Count |");
  });

  it("extracts multiple sentinel blocks", () => {
    const content = `# README
<!-- GYOSHU:INDEX:BEGIN -->
Index content
<!-- GYOSHU:INDEX:END -->

## Other Section

<!-- GYOSHU:RECENT:BEGIN -->
Recent content
<!-- GYOSHU:RECENT:END -->

<!-- GYOSHU:TAGS:BEGIN -->
\`tag1\` \`tag2\`
<!-- GYOSHU:TAGS:END -->
`;
    const blocks = parseReadmeWithSentinels(content);
    expect(blocks.size).toBe(3);
    expect(blocks.has("INDEX")).toBe(true);
    expect(blocks.has("RECENT")).toBe(true);
    expect(blocks.has("TAGS")).toBe(true);
    expect(blocks.get("TAGS")).toContain("`tag1`");
  });

  it("handles empty sentinel blocks", () => {
    const content = `<!-- GYOSHU:EMPTY:BEGIN -->
<!-- GYOSHU:EMPTY:END -->`;
    const blocks = parseReadmeWithSentinels(content);
    expect(blocks.size).toBe(1);
    expect(blocks.get("EMPTY")).toBe("\n");
  });

  it("handles whitespace in sentinel markers", () => {
    const content = `<!--  GYOSHU:INDEX:BEGIN  -->
content
<!--  GYOSHU:INDEX:END  -->`;
    const blocks = parseReadmeWithSentinels(content);
    expect(blocks.size).toBe(1);
    expect(blocks.get("INDEX")).toContain("content");
  });

  it("handles underscore in block names", () => {
    const content = `<!-- GYOSHU:MY_BLOCK:BEGIN -->
content
<!-- GYOSHU:MY_BLOCK:END -->`;
    const blocks = parseReadmeWithSentinels(content);
    expect(blocks.has("MY_BLOCK")).toBe(true);
  });
});

// =============================================================================
// hasSentinelBlock
// =============================================================================

describe("hasSentinelBlock", () => {
  it("returns true if block exists", () => {
    const content = `<!-- GYOSHU:INDEX:BEGIN -->
content
<!-- GYOSHU:INDEX:END -->`;
    expect(hasSentinelBlock(content, "INDEX")).toBe(true);
  });

  it("returns false if block does not exist", () => {
    const content = `# Just a README`;
    expect(hasSentinelBlock(content, "INDEX")).toBe(false);
  });

  it("returns false if only BEGIN marker exists", () => {
    const content = `<!-- GYOSHU:INDEX:BEGIN -->`;
    expect(hasSentinelBlock(content, "INDEX")).toBe(false);
  });

  it("returns false for different block name", () => {
    const content = `<!-- GYOSHU:INDEX:BEGIN -->
content
<!-- GYOSHU:INDEX:END -->`;
    expect(hasSentinelBlock(content, "RECENT")).toBe(false);
  });
});

// =============================================================================
// updateSentinelBlock
// =============================================================================

describe("updateSentinelBlock", () => {
  it("replaces existing block content", () => {
    const content = `# README
<!-- GYOSHU:INDEX:BEGIN -->
old content
<!-- GYOSHU:INDEX:END -->
`;
    const updated = updateSentinelBlock(content, "INDEX", "new content");
    expect(updated).toContain("new content");
    expect(updated).not.toContain("old content");
    expect(updated).toContain("<!-- GYOSHU:INDEX:BEGIN -->");
    expect(updated).toContain("<!-- GYOSHU:INDEX:END -->");
  });

  it("preserves content outside sentinel block", () => {
    const content = `# My Custom Header

Some user content here.

<!-- GYOSHU:INDEX:BEGIN -->
old
<!-- GYOSHU:INDEX:END -->

More user content.
`;
    const updated = updateSentinelBlock(content, "INDEX", "new");
    expect(updated).toContain("# My Custom Header");
    expect(updated).toContain("Some user content here.");
    expect(updated).toContain("More user content.");
    expect(updated).toContain("new");
  });

  it("appends block at end if not exists", () => {
    const content = `# README

Some content.`;
    const updated = updateSentinelBlock(content, "INDEX", "new content");
    expect(updated).toContain("# README");
    expect(updated).toContain("Some content.");
    expect(updated).toContain("<!-- GYOSHU:INDEX:BEGIN -->");
    expect(updated).toContain("new content");
    expect(updated).toContain("<!-- GYOSHU:INDEX:END -->");
  });

  it("updates correct block when multiple exist", () => {
    const content = `<!-- GYOSHU:INDEX:BEGIN -->
index
<!-- GYOSHU:INDEX:END -->

<!-- GYOSHU:TAGS:BEGIN -->
old-tags-content
<!-- GYOSHU:TAGS:END -->
`;
    const updated = updateSentinelBlock(content, "TAGS", "new-tags-content");
    expect(updated).toContain("index");
    expect(updated).not.toContain("old-tags-content");
    expect(updated).toContain("new-tags-content");
  });

  it("handles multiline new content", () => {
    const content = `<!-- GYOSHU:INDEX:BEGIN -->
old
<!-- GYOSHU:INDEX:END -->`;
    const newContent = `| Col1 | Col2 |
|------|------|
| A    | B    |`;
    const updated = updateSentinelBlock(content, "INDEX", newContent);
    expect(updated).toContain("| Col1 | Col2 |");
    expect(updated).toContain("| A    | B    |");
  });
});

// =============================================================================
// toDisplayName
// =============================================================================

describe("toDisplayName", () => {
  it("converts hyphenated names", () => {
    expect(toDisplayName("customer-analytics")).toBe("Customer Analytics");
  });

  it("converts underscored names", () => {
    expect(toDisplayName("customer_analytics")).toBe("Customer Analytics");
  });

  it("handles single word", () => {
    expect(toDisplayName("experiments")).toBe("Experiments");
  });

  it("removes leading underscore from _quick", () => {
    expect(toDisplayName("_quick")).toBe("Quick");
  });

  it("handles mixed case input", () => {
    expect(toDisplayName("ML-Experiments")).toBe("Ml Experiments");
  });

  it("handles multiple segments", () => {
    expect(toDisplayName("data-science-experiments")).toBe("Data Science Experiments");
  });
});

// =============================================================================
// parseTags
// =============================================================================

describe("parseTags", () => {
  it("parses backtick-formatted tags", () => {
    const line = "`ml` `classification` `test`";
    expect(parseTags(line)).toEqual(["ml", "classification", "test"]);
  });

  it("returns empty array for no tags", () => {
    expect(parseTags("No tags here")).toEqual([]);
  });

  it("handles single tag", () => {
    expect(parseTags("`single`")).toEqual(["single"]);
  });

  it("handles tags with hyphens", () => {
    expect(parseTags("`machine-learning` `deep-learning`")).toEqual([
      "machine-learning",
      "deep-learning",
    ]);
  });

  it("handles empty string", () => {
    expect(parseTags("")).toEqual([]);
  });
});

// =============================================================================
// generateRootReadme
// =============================================================================

describe("generateRootReadme", () => {
  it("generates empty state with no workspaces", () => {
    const readme = generateRootReadme([]);
    expect(readme).toContain("# Research Index");
    expect(readme).toContain("GYOSHU:INDEX:BEGIN");
    expect(readme).toContain("GYOSHU:INDEX:END");
    expect(readme).toContain("_No workspaces yet");
    expect(readme).toContain("GYOSHU:RECENT:BEGIN");
    expect(readme).toContain("GYOSHU:TAGS:BEGIN");
  });

  it("generates table with workspaces", () => {
    const workspaces: WorkspaceEntry[] = [
      {
        name: "customer-analytics",
        displayName: "Customer Analytics",
        researchCount: 3,
        activeCount: 2,
        lastUpdated: "2026-01-01",
      },
      {
        name: "experiments",
        displayName: "Experiments",
        researchCount: 5,
        activeCount: 0,
        lastUpdated: "2025-12-28",
      },
    ];
    const readme = generateRootReadme(workspaces);
    expect(readme).toContain("| Workspace | Research | Status | Last Updated |");
    expect(readme).toContain("[Customer Analytics](./customer-analytics/)");
    expect(readme).toContain("3 projects");
    expect(readme).toContain("2 active");
    expect(readme).toContain("[Experiments](./experiments/)");
    expect(readme).toContain("5 projects");
    expect(readme).toContain("-");
  });

  it("includes recent activity section", () => {
    const workspaces: WorkspaceEntry[] = [
      {
        name: "test",
        displayName: "Test",
        researchCount: 1,
        activeCount: 1,
        lastUpdated: "2026-01-01",
      },
    ];
    const readme = generateRootReadme(workspaces);
    expect(readme).toContain("## Recent Activity");
    expect(readme).toContain("GYOSHU:RECENT:BEGIN");
    expect(readme).toContain("**[Test](./test/)**");
  });

  it("includes tags section", () => {
    const workspaces: WorkspaceEntry[] = [];
    const readme = generateRootReadme(workspaces, ["ml", "classification", "clustering"]);
    expect(readme).toContain("## All Tags");
    expect(readme).toContain("GYOSHU:TAGS:BEGIN");
    expect(readme).toContain("`classification`");
    expect(readme).toContain("`clustering`");
    expect(readme).toContain("`ml`");
  });

  it("sorts tags alphabetically", () => {
    const readme = generateRootReadme([], ["zebra", "apple", "mango"]);
    const tagsSection = readme.split("GYOSHU:TAGS:BEGIN")[1].split("GYOSHU:TAGS:END")[0];
    expect(tagsSection).toContain("`apple` `mango` `zebra`");
  });

  it("handles singular project count", () => {
    const workspaces: WorkspaceEntry[] = [
      {
        name: "test",
        displayName: "Test",
        researchCount: 1,
        activeCount: 1,
        lastUpdated: "2026-01-01",
      },
    ];
    const readme = generateRootReadme(workspaces);
    expect(readme).toContain("1 project");
    expect(readme).not.toContain("1 projects");
  });

  it("includes auto-generated notice", () => {
    const readme = generateRootReadme([]);
    expect(readme).toContain("Auto-generated by Gyoshu");
  });
});

// =============================================================================
// generateWorkspaceReadme
// =============================================================================

describe("generateWorkspaceReadme", () => {
  it("generates empty state with no research", () => {
    const readme = generateWorkspaceReadme(
      "customer-analytics",
      "Customer behavior research.",
      []
    );
    expect(readme).toContain("# Customer Analytics");
    expect(readme).toContain("Customer behavior research.");
    expect(readme).toContain("GYOSHU:INDEX:BEGIN");
    expect(readme).toContain("_No research projects yet");
    expect(readme).toContain("GYOSHU:TAGS:BEGIN");
    expect(readme).toContain("_No tags yet_");
  });

  it("generates table with research projects", () => {
    const research: ResearchEntry[] = [
      {
        reportTitle: "churn-prediction",
        title: "Churn Prediction",
        status: "active",
        updated: "2026-01-01",
        tags: ["ml", "classification"],
        description: "Predict customer churn risk",
      },
      {
        reportTitle: "ltv-modeling",
        title: "LTV Modeling",
        status: "completed",
        updated: "2025-12-28",
        tags: ["regression"],
        description: "Customer lifetime value",
      },
    ];
    const readme = generateWorkspaceReadme(
      "customer-analytics",
      "Customer behavior research.",
      research
    );
    expect(readme).toContain("| Research | Status | Updated | Tags | Description |");
    expect(readme).toContain("[Churn Prediction](./churn-prediction.ipynb)");
    expect(readme).toContain("active");
    expect(readme).toContain("ml, classification");
    expect(readme).toContain("[LTV Modeling](./ltv-modeling.ipynb)");
    expect(readme).toContain("completed");
  });

  it("includes workspace tags from research", () => {
    const research: ResearchEntry[] = [
      {
        reportTitle: "test1",
        title: "Test 1",
        status: "active",
        updated: "2026-01-01",
        tags: ["ml", "test"],
      },
      {
        reportTitle: "test2",
        title: "Test 2",
        status: "completed",
        updated: "2026-01-01",
        tags: ["test", "clustering"],
      },
    ];
    const readme = generateWorkspaceReadme("test", "", research);
    expect(readme).toContain("## Workspace Tags");
    const tagsSection = readme.split("GYOSHU:TAGS:BEGIN")[1].split("GYOSHU:TAGS:END")[0];
    expect(tagsSection).toContain("`clustering`");
    expect(tagsSection).toContain("`ml`");
    expect(tagsSection).toContain("`test`");
  });

  it("converts workspace name to display name", () => {
    const readme = generateWorkspaceReadme("my-data-science", "", []);
    expect(readme).toContain("# My Data Science");
  });

  it("handles missing description", () => {
    const readme = generateWorkspaceReadme("test", "", []);
    expect(readme).toContain("Research workspace.");
  });

  it("handles research without description", () => {
    const research: ResearchEntry[] = [
      {
        reportTitle: "test",
        title: "Test",
        status: "active",
        updated: "2026-01-01",
        tags: [],
      },
    ];
    const readme = generateWorkspaceReadme("test", "", research);
    expect(readme).toContain("| - |");
  });

  it("handles research without tags", () => {
    const research: ResearchEntry[] = [
      {
        reportTitle: "test",
        title: "Test",
        status: "active",
        updated: "2026-01-01",
        tags: [],
        description: "Description",
      },
    ];
    const readme = generateWorkspaceReadme("test", "", research);
    const tableRow = readme.split("\n").find((l) => l.includes("[Test]"));
    expect(tableRow).toContain("| - |");
  });

  it("formats ISO timestamps to date only", () => {
    const research: ResearchEntry[] = [
      {
        reportTitle: "test",
        title: "Test",
        status: "active",
        updated: "2026-01-01T15:30:00Z",
        tags: [],
      },
    ];
    const readme = generateWorkspaceReadme("test", "", research);
    expect(readme).toContain("2026-01-01");
    expect(readme).not.toContain("T15:30:00Z");
  });
});

// =============================================================================
// Integration: Round-trip parsing and updating
// =============================================================================

describe("Integration", () => {
  it("can parse and update README created by generator", () => {
    const workspaces: WorkspaceEntry[] = [
      {
        name: "test",
        displayName: "Test",
        researchCount: 2,
        activeCount: 1,
        lastUpdated: "2026-01-01",
      },
    ];
    const original = generateRootReadme(workspaces, ["ml"]);

    const blocks = parseReadmeWithSentinels(original);
    expect(blocks.size).toBe(3);
    expect(blocks.has("INDEX")).toBe(true);
    expect(blocks.has("RECENT")).toBe(true);
    expect(blocks.has("TAGS")).toBe(true);

    const updated = updateSentinelBlock(original, "INDEX", "Updated index content");
    expect(updated).toContain("# Research Index");
    expect(updated).toContain("Updated index content");
    expect(updated).toContain("`ml`");
  });

  it("preserves user content when updating sentinel blocks", () => {
    const userContent = `# My Custom Research Index

I wrote this custom intro paragraph myself.

## Workspaces

<!-- GYOSHU:INDEX:BEGIN -->
Old table here
<!-- GYOSHU:INDEX:END -->

## My Notes

These are my personal notes that should never be deleted.

<!-- GYOSHU:TAGS:BEGIN -->
\`old-tag\`
<!-- GYOSHU:TAGS:END -->
`;

    const updatedIndex = updateSentinelBlock(userContent, "INDEX", "New table");
    const updatedTags = updateSentinelBlock(updatedIndex, "TAGS", "`new-tag`");

    expect(updatedTags).toContain("I wrote this custom intro paragraph myself.");
    expect(updatedTags).toContain("These are my personal notes");
    expect(updatedTags).toContain("New table");
    expect(updatedTags).toContain("`new-tag`");
    expect(updatedTags).not.toContain("Old table here");
    expect(updatedTags).not.toContain("`old-tag`");
  });

  it("adds new sentinel block to existing README", () => {
    const existing = `# Existing README

Some content here.

<!-- GYOSHU:INDEX:BEGIN -->
Index
<!-- GYOSHU:INDEX:END -->
`;

    const updated = updateSentinelBlock(existing, "CUSTOM", "Custom content");
    expect(updated).toContain("GYOSHU:CUSTOM:BEGIN");
    expect(updated).toContain("Custom content");
    expect(updated).toContain("GYOSHU:CUSTOM:END");
    expect(updated).toContain("Index");
  });
});
