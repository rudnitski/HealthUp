# PRD v4.7: Segment Control for Plot/Table View Toggle

**Status**: Ready for Implementation
**Created**: 2026-01-03

---

## Breaking Changes (Implementation Required)

The following existing code patterns MUST be modified:

1. **`handlePlotResult()` and `handleTableResult()`**: Remove `replace_previous` conditionals. Both methods must ALWAYS call `destroyAllCharts()` THEN clear `resultsContainer` unconditionally. This prevents Chart.js memory leaks when a table result replaces a plot result.

2. **`renderParameterTable()` → `renderTableInView()`**: The existing method is REPLACED (not supplemented). The new method uses a scoped selector: `plotSection.querySelector('.chat-scrollable-table-container')` instead of `this.resultsContainer.querySelector('.chat-parameter-table-container')`.

3. **No `hidden` attribute**: The new view panels use CSS visibility + `aria-hidden`. Do NOT use `element.hidden = true/false` on view containers.

---

## Overview

Replace the sequential plot + table layout in chat results with a segment control that toggles between Plot and Table views. Both views share a fixed-height container with fade transitions. The table scrolls internally when rows exceed the container height.

## Problem Statement

Currently, plot and table are displayed sequentially (plot above, table below), which:
- Consumes significant vertical space
- Splits user attention between two representations
- Requires scrolling to see the table after viewing the plot

## Goals

**Primary:**
- Consolidate plot and table into a single fixed-height area
- Provide intuitive toggle control with smooth transitions
- Maintain full functionality of both views

**Secondary:**
- Improve visual polish with animated segment control
- Ensure accessibility for keyboard and screen reader users

## Non-Goals

- Displaying plot and table simultaneously (side-by-side)
- Multiple concurrent visualizations (each new result replaces the previous)
- Persistence of view preference across sessions
- Custom view preferences per parameter

---

## Architectural Clarification: Thumbnails vs Plot/Table

**Important distinction** between two UI elements:

| Element | Location | Behavior |
|---------|----------|----------|
| **Thumbnails** | Chat message bubbles (`.thumbnail-stack`) | Accumulate in conversation history. Each assistant message can have multiple thumbnails that persist across turns. |
| **Plot/Table visualization** | Results container (`#sqlResults`) | Always replaced. Only ONE visualization exists at a time. Each new result clears the previous. |

**Why this matters:**
- The `replace_previous` parameter in backend tool definitions is **ignored** for plot/table results
- Frontend always clears `resultsContainer` before rendering new plot/table
- Thumbnails are NOT affected by this - they remain in chat history as part of the message thread
- Backend retains `replace_previous` for backward compatibility but frontend enforces single-visualization mode

---

## Design Specification

### Visual Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Results (h3)                         ┌────────────────────┐   │
│                                       │ 📊 Plot │ 📋 Table │   │
│                                       └────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────────────────────────────┐    │
│  │   Select     │  │                                      │    │
│  │  Parameter   │  │                                      │    │
│  │              │  │          PLOT or TABLE               │    │
│  │  ○ HDL      │  │        (500px fixed height)          │    │
│  │  ○ LDL      │  │                                      │    │
│  │  ● Total    │  │         Table scrolls internally      │    │
│  │              │  │                                      │    │
│  └──────────────┘  └──────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Segment Control Design

- **Position**: Above plot area, right-aligned
- **Style**: Pill-shaped container with icons + text labels
- **Active state**: Sliding white indicator behind active button
- **Labels**: "Plot" (chart icon) / "Table" (grid icon)
- **Icons**: Use inline SVG in the template (consistent with existing patterns in the codebase); no sprite sheet required
- **Default**: Plot view

### View Behavior

| Aspect | Specification |
|--------|---------------|
| Default view | Plot |
| Transition | Fade in/out, 250ms ease |
| Container height | Fixed 500px (matches plot area) |
| Table scroll | Internal scroll with sticky header |
| Sidebar visibility | Always visible in both views |
| Parameter change | Reset view to Plot (sequence: update tab state → update panel visibility → resize chart in rAF) |
| Few data rows | Fixed height maintained, empty space below |
| Zero data rows | Render table with single row: "No data available" placeholder message |
| Out-of-range | Red border highlighting preserved in table |

---

## Technical Architecture

### Files to Modify

| File | Changes |
|------|---------|
| `public/js/chat.js` | HTML template in `displayPlotResults()`, segment control handlers, view switching |
| `public/css/chat.css` | Segment control styles, view container, transitions, scrollable table |

### HTML Structure

**Architectural Constraint**: This design enforces **single-visualization mode** - only one plot/table result exists at a time. Each new result unconditionally clears the previous visualization before rendering. The `replace_previous` flag is not used; replacement is always performed.

```html
<div class="chat-plot-visualization">
  <!-- Header with title and segment control -->
  <div class="chat-plot-header">
    <h3>{title}</h3>
    <div class="view-segment-control" role="tablist" aria-label="View options" data-active="plot">
      <div class="segment-indicator"></div>
      <button class="segment-button segment-button--active" id="tab-plot" data-view="plot" role="tab" aria-selected="true" aria-controls="panel-plot">
        <svg class="segment-icon"><!-- line chart --></svg>
        <span>Plot</span>
      </button>
      <button class="segment-button" id="tab-table" data-view="table" role="tab" aria-selected="false" aria-controls="panel-table" tabindex="-1">
        <svg class="segment-icon"><!-- table grid --></svg>
        <span>Table</span>
      </button>
    </div>
  </div>

  <!-- Main content area: sidebar + view container -->
  <div class="chat-plot-content">
    <!-- Parameter selector (OUTSIDE view container - always visible) -->
    <div class="chat-parameter-selector-panel">
      <h4 class="chat-parameter-selector-title">Select Parameter</h4>
      <div class="chat-parameter-list">...</div>
    </div>

    <!-- View container with fixed height -->
    <div class="chat-view-container">
      <!-- Plot view (default active) -->
      <div class="chat-view chat-view--plot chat-view--active" id="panel-plot" role="tabpanel" aria-labelledby="tab-plot" aria-hidden="false">
        <div class="chat-plot-canvas-wrapper">
          <div class="chat-plot-toolbar">
            <span class="chat-plot-toolbar-hint">Pan and zoom to explore the data.</span>
          </div>
          <canvas id="{canvasId}"></canvas>
        </div>
      </div>

      <!-- Table view (inactive - uses CSS visibility + aria-hidden for screen readers) -->
      <div class="chat-view chat-view--table" id="panel-table" role="tabpanel" aria-labelledby="tab-table" aria-hidden="true">
        <div class="chat-scrollable-table-container">
          <table class="parameters-table">...</table>
        </div>
      </div>
    </div>
  </div>
</div>
```

### CSS Architecture

**Migration Note**: The new `.chat-view-container` with fixed 500px height replaces the existing height constraints on `.chat-plot-canvas-wrapper`. Remove or override these existing rules to prevent conflicts:
- `min-height: 400px` (desktop, line ~621)
- `max-height: 500px` (desktop, line ~622)
- `max-height: 420px !important` on canvas (desktop, line ~639)
- `min-height: 400px` (mobile `@media` variant, line ~680)

The canvas `width="800" height="400"` attributes can remain as Chart.js uses them as defaults but respects container sizing via `maintainAspectRatio`.

```css
/* Main content area: sidebar + view container (grid layout) */
.chat-plot-content {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 0;
}

/* Parameter selector panel with internal scroll */
.chat-parameter-selector-panel {
  max-height: 500px; /* Match right panel height */
  overflow-y: auto;
}

.chat-parameter-selector-title {
  position: sticky;
  top: 0;
  background: var(--color-white);
  z-index: 1;
  padding-bottom: 0.5rem;
}

/* View container with fixed height */
.chat-view-container {
  position: relative;
  height: 500px;
  overflow: hidden;
}

/* Individual views with fade transition (uses visibility, NOT hidden attribute) */
.chat-view {
  position: absolute;
  inset: 0;
  opacity: 0;
  visibility: hidden;
  transition: opacity 250ms ease, visibility 250ms ease;
}

.chat-view--active {
  opacity: 1;
  visibility: visible;
}

/* Scrollable table with sticky header */
.chat-scrollable-table-container {
  height: 100%;
  overflow-y: auto;
}

/* Sticky header: apply to th for cross-browser support (thead sticky is unreliable) */
.chat-scrollable-table-container th {
  position: sticky;
  top: 0;
  background: var(--color-slate-50);
  z-index: 1; /* Ensure header stays above scrolling content */
}

/* Sliding indicator animation */
.segment-indicator {
  transition: transform 250ms ease;
}

.view-segment-control[data-active="table"] .segment-indicator {
  transform: translateX(calc(100% + 2px));
}

/* Reduced motion: disable all segment control and view transitions */
@media (prefers-reduced-motion: reduce) {
  .segment-indicator,
  .chat-view {
    transition: none;
  }
}
```

### JavaScript Methods

**New methods in `ConversationalSQLChat` class:**

1. `initViewSegmentControl(plotSection, canvasId)`
   - Attach click handlers to segment buttons
   - Handle keyboard navigation (Arrow Left/Right for tabs, roving tabindex)
   - Update `data-active` attribute for indicator animation
   - Update `aria-selected` and `tabindex` on tab buttons
   - Move focus to newly selected tab

2. `switchView(container, targetView, canvasId)`
   - `container` is the root `plotSection` element (`.chat-plot-visualization`); query tabs via `.view-segment-control` and panels via `.chat-view`
   - Toggle `chat-view--active` class (NO `hidden` attribute - use CSS visibility only)
   - Update `aria-hidden` on panels (`"false"` for active, `"true"` for inactive)
   - If switching to plot: retrieve chart via `this.charts.get(canvasId)` and call `chart.resize()` inside `requestAnimationFrame` to ensure DOM has been updated before resize
   - Update `aria-selected` on tabs
   - Note: Both user clicks and programmatic switches (e.g., parameter change) call this method, ensuring consistent ARIA state and CSS animations

3. `renderTableInView(plotSection, rows, parameterName)`
   - Render table HTML into `.chat-scrollable-table-container`
   - Preserve out-of-range highlighting (red border via `data-out-of-range` attribute)

**Modified methods:**

1. `displayPlotResults()` - Update HTML template, call `initViewSegmentControl()`, always clear previous visualization before rendering (remove `replace_previous` conditional)
2. `handlePlotResult()` - **CRITICAL**: Remove `replace_previous` conditional; ALWAYS call `destroyAllCharts()` and clear `resultsContainer`. The `replace_previous` SSE field is ignored - single-visualization mode is enforced unconditionally.
3. `attachParameterSelectorListener()` - On parameter change: (1) call `switchView(container, 'plot', canvasId)` to reset tab and panel state, (2) re-render chart with new parameter data, (3) chart resize handled automatically by `switchView()` via `requestAnimationFrame`

**Also modified (consistency):**

1. `handleTableResult()` - **CRITICAL**: Remove `replace_previous` conditional; ALWAYS call `destroyAllCharts()` THEN clear `resultsContainer` before rendering. This prevents Chart.js memory leaks when table result replaces a plot. Standalone table results (non-plot) continue to render without segment control. The `replace_previous` SSE field is ignored.

**Note on thumbnails**: The `thumbnail_update` SSE event handling in `renderThumbnail()` is NOT modified. Thumbnails continue to respect `replace_previous` because they accumulate in chat message history (`.thumbnail-stack`), which is semantically different from the results panel.

---

## Accessibility

- **ARIA roles**:
  - `role="tablist"` with `aria-label` on segment control container
  - `role="tab"` on each button with `aria-controls` pointing to panel ID
  - `role="tabpanel"` on each view with `aria-labelledby` pointing to tab ID
- **Hidden panel management**:
  - Active panel: `aria-hidden="false"`
  - Inactive panel: `aria-hidden="true"` (prevents screen reader traversal of hidden content)
  - Updated dynamically in `switchView()` when toggling views
- **Keyboard navigation**:
  - Arrow Left/Right: Move between tabs (roving tabindex pattern)
  - `tabindex="-1"` on inactive tabs, `tabindex="0"` on active tab
  - Focus moves to selected tab on keyboard navigation
- **Screen readers**: `aria-selected="true|false"` announces active tab
- **Reduced motion**: Respects `prefers-reduced-motion` media query (segment indicator and view transitions disabled)

## Responsive Behavior

**Note**: This implementation targets **desktop only**. Mobile optimization is not a priority.

- **Desktop (≥ 768px)**: Full segment control with icons + text labels
- **Tablet/smaller screens**: Basic responsiveness inherited from existing CSS; not optimized

---

## Testing Checklist

- [ ] Segment control renders above plot, right-aligned
- [ ] Clicking "Table" shows table with fade transition
- [ ] Clicking "Plot" shows plot with fade transition
- [ ] Chart.js canvas resizes correctly when switching to plot
- [ ] Table has sticky header when scrolling many rows
- [ ] Out-of-range values show red border in table view
- [ ] Parameter selector remains visible in both Plot and Table views
- [ ] Parameter selection resets view to Plot
- [ ] Keyboard navigation (Arrow Left/Right) switches tabs
- [ ] Screen reader announces tab selection (`aria-selected` updates)
- [ ] Inactive panel has `aria-hidden="true"` (screen reader cannot traverse)
- [ ] New query result clears previous visualization before rendering
- [ ] Reduced motion: transitions disabled when `prefers-reduced-motion: reduce`

---

## Implementation Phases

**Phase 1**: CSS and HTML structure
- Add segment control styles
- Add view container styles with transitions
- Update HTML template in `displayPlotResults()`

**Phase 2**: JavaScript logic
- Implement `initViewSegmentControl()`
- Implement `switchView()` with Chart.js resize fix
- Implement `renderTableInView()`

**Phase 3**: Integration
- Wire up parameter selector to reset view
- Pre-render table for instant switching
- Testing and polish
