# PRD v3.3: Multi-Modal Conversational Health Data Analyst

**Status:** Draft
**Author:** System Architecture
**Created:** 2025-11-16
**Target Release:** v3.3
**Estimated Effort:** 2-3 days (Middle SE)

---

## Table of Contents
1. [Overview](#overview)
2. [Motivation](#motivation)
3. [Current State Analysis](#current-state-analysis)
4. [Goals & Non-Goals](#goals--non-goals)
5. [User Experience](#user-experience)
6. [Technical Design](#technical-design)
7. [Implementation Plan](#implementation-plan)
8. [Testing Strategy](#testing-strategy)
9. [Rollout Plan](#rollout-plan)
10. [Success Metrics](#success-metrics)
11. [Future Considerations](#future-considerations)

---

## Overview

Transform the conversational SQL assistant (v3.2) from a **single-shot SQL generator** into a **multi-modal health data analyst** that can:
- Display plots and tables on demand (multiple times per conversation)
- Provide text-based interpretations and insights
- Maintain continuous conversation flow with full data context
- Support iterative refinement of visualizations

**Key Change:** Remove the "conversation ends after SQL execution" constraint. Enable LLM to use display tools (`show_plot`, `show_table`) as part of an ongoing dialogue, with full access to displayed data for accurate health analysis.

---

## Motivation

### Problem Statement

**Current System (v3.2):**
```
User: "show my cholesterol trend"
LLM: [generates SQL → shows plot] → CONVERSATION ENDS

User: "what does this mean?"
LLM: [NEW conversation, no context about previous plot]
```

**Issues:**
1. **Poor UX:** Users must restart conversation for follow-up questions
2. **Lost Context:** LLM has no memory of what data was displayed
3. **Inflexible Output:** Every conversation must end with SQL (can't just answer with text)
4. **No Iterative Refinement:** Can't filter/modify visualizations in same conversation

### Why Now?

1. **User Feedback:** Users expect ChatGPT-style continuous conversations
2. **Healthcare Use Case:** Medical questions require back-and-forth dialogue
3. **Infrastructure Ready:** v3.2 SSE streaming + session management already built
4. **Accuracy Requirements:** Health data demands precise answers → need full data in context

### Business Impact

- **Increased Engagement:** Users stay in conversation longer (more valuable insights)
- **Better Health Outcomes:** LLM can provide nuanced interpretations of trends
- **Competitive Advantage:** Most health apps only show raw data, not conversational analysis
- **Reduced Support:** Users get answers without contacting healthcare provider for every question

---

## Current State Analysis

### What We Have (v3.2)

✅ **Strong Foundation:**
- Server-Sent Events (SSE) for real-time streaming
- Session management (1-hour TTL, atomic locking)
- Tool-calling framework (fuzzy search, exploratory SQL)
- Multi-turn dialogue support
- Plot rendering (Chart.js with zoom/pan)
- Table rendering with out-of-range highlighting

❌ **Critical Limitations:**
- `generate_final_query` tool **ends conversation** (`server/routes/chatStream.js:534-536`)
- Frontend expects single `final_result` event, then conversation stops
- System prompt is SQL-generation-only (317 lines, zero text analysis guidance)
- No way to update/replace visualizations in same conversation
- No text-only response capability

### Architecture Diagram (Current)

```
┌─────────────┐
│    User     │
└──────┬──────┘
       │ "show my vitamin D"
       ▼
┌─────────────────────────────────┐
│  Conversational SQL Assistant   │
│  (SSE Stream + Session)         │
└──────┬──────────────────────────┘
       │ Multi-turn dialogue
       ▼
┌─────────────────────────────────┐
│   Tool: generate_final_query    │◄─── ENDS CONVERSATION
└──────┬──────────────────────────┘
       │ SQL + metadata
       ▼
┌─────────────────────────────────┐
│   Execute Query → Show Plot     │
└──────┬──────────────────────────┘
       │ type: 'final_result'
       │ type: 'done' ◄─── Stream closes
       ▼
┌─────────────┐
│  Frontend   │ (conversation over)
└─────────────┘
```

---

## Goals & Non-Goals

### Goals

**Primary:**
1. ✅ Enable LLM to call `show_plot` and `show_table` **without ending conversation**
2. ✅ Provide LLM with **full data access** in tool results for accurate health analysis
3. ✅ Support **text-only responses** streamed directly to chat
4. ✅ Allow **iterative refinement** (filter plots, change visualizations)
5. ✅ Maintain **existing UI layout** (plot area, table area, chat area)

**Secondary:**
1. ✅ Optimize token usage (compact JSON format for data)
2. ✅ Add conversation pruning to prevent context overflow
3. ✅ Support multi-modal responses (plot + text in single turn)

### Non-Goals

❌ **Out of Scope for v3.3:**
- Persist conversation history across browser sessions (still in-memory only)
- Add new visualization types (heatmaps, correlation matrices)
- Multi-patient comparison in single plot
- Export conversation transcripts
- Voice input/output

❌ **Explicitly NOT Changing:**
- Session management architecture (keep 1-hour TTL, in-memory)
- Frontend plot/table rendering logic (Chart.js, existing styles)
- SQL validation rules (keep strict security checks)
- Database schema

---

## User Experience

### Use Case 1: Exploratory Analysis

```
User: "show my vitamin D trend"
LLM: [calls show_plot tool]
     [plot appears in results area]
     "Your Vitamin D levels are shown in the plot above. I can see you have
     12 measurements from January 2023 to November 2024."

User: "what does this trend tell you?"
LLM: [analyzes data from previous tool result - has full 156 rows in context]
     "Your Vitamin D shows excellent improvement:
     - Started at 25.3 ng/mL (deficient, below 30 ng/mL minimum)
     - Current level: 45.2 ng/mL (healthy range)
     - That's a 78% increase over 22 months
     - You had 8 out-of-range readings initially, but last 4 tests are all normal

     This suggests your supplementation or lifestyle changes are working well."

User: "show just the last 6 months"
LLM: [calls show_plot with filtered date range, replace_previous=true]
     [plot redraws with filtered data]
     "Here's your recent trend. Your levels have been stable in the healthy
     range (42-46 ng/mL) for the past 6 months."

User: "is that good?"
LLM: "Yes, that's excellent. Vitamin D between 30-100 ng/mL is optimal. Your
     stable levels at 45 ng/mL suggest you've found the right maintenance dose."
```

### Use Case 2: Multi-Parameter Comparison

```
User: "show my lipid panel results"
LLM: [calls show_plot with Total Cholesterol, HDL, LDL, Triglycerides]
     [plot appears with all 4 parameters]
     "I've plotted your complete lipid panel. You have measurements from
     5 tests over the past 2 years."

User: "show this as a table with the latest values"
LLM: [calls show_table with latest results, replace_previous=true]
     [table replaces plot, showing latest test]
     "Here are your most recent lipid panel results from November 2024."

User: "compare this to my first test"
LLM: [calls show_table with first AND latest, replace_previous=true]
     "Here's the comparison:

     Total Cholesterol: 240 → 195 mg/dL (↓ 19%)
     LDL ('bad'): 160 → 120 mg/dL (↓ 25%, now optimal <130)
     HDL ('good'): 52 → 55 mg/dL (↑ 6%, stable and healthy)
     Triglycerides: 140 → 100 mg/dL (↓ 29%, now optimal <150)

     All parameters improved significantly. Your cardiovascular risk markers
     are much better now."
```

### Use Case 3: Text-Only Questions

```
User: "what does LDL mean?"
LLM: [no tools needed, just text]
     "LDL stands for Low-Density Lipoprotein, often called 'bad cholesterol'.
     It carries cholesterol from your liver to cells. High LDL can lead to
     plaque buildup in arteries, increasing heart disease risk.

     Target levels:
     - Optimal: <100 mg/dL
     - Near optimal: 100-129 mg/dL
     - Borderline high: 130-159 mg/dL
     - High: ≥160 mg/dL"

User: "show my LDL history"
LLM: [calls show_plot for LDL only]
     [plot appears]
     "Your LDL started at 160 mg/dL (high) and is now 120 mg/dL (near optimal)."
```

### Use Case 4: Error Recovery

```
User: "show my blood pressure"
LLM: [calls fuzzy_search_analyte_names("blood pressure")]
     [no results found]
     "I don't see any blood pressure measurements in your lab results.
     Blood pressure is typically measured during doctor visits, not
     laboratory tests.

     I can show you lab markers related to cardiovascular health like
     cholesterol, if you'd like?"

User: "yes, show cholesterol"
LLM: [calls show_plot]
     [conversation continues normally]
```

---

## Technical Design

### Architecture Changes

#### Overview Diagram (New)

```
┌─────────────┐
│    User     │
└──────┬──────┘
       │ Multiple messages
       ▼
┌─────────────────────────────────┐
│  Conversational Data Analyst    │
│  (SSE Stream + Session)         │
│  ┌───────────────────────────┐  │
│  │  Conversation Loop:       │  │
│  │  1. User message          │  │
│  │  2. LLM reasoning         │  │
│  │  3. Tool calls (if any)   │  │
│  │  4. Text streaming        │  │
│  │  5. Back to step 1 ◄─────┼──┼─── NO FORCED END
│  └───────────────────────────┘  │
└──────┬──────────────────────────┘
       │
       ├──► show_plot
       │    ├─► Validate SQL
       │    ├─► Execute query (max 200 rows)
       │    ├─► Send to frontend: type: 'plot_result'
       │    └─► Add compact data to session.messages
       │
       ├──► show_table
       │    ├─► Validate SQL
       │    ├─► Execute query (max 50 rows)
       │    ├─► Send to frontend: type: 'table_result'
       │    └─► Add compact data to session.messages
       │
       └──► fuzzy_search / exploratory_sql
            └─► Add results to session.messages

       ▼ Conversation continues...
┌─────────────┐
│  Frontend   │
│  ├─ Chat messages (text)        │
│  ├─ Plot area (redraws on new)  │
│  └─ Table area (redraws on new) │
└─────────────────────────────────┘
```

### Component Changes

#### 1. Tool Definitions (`server/services/agenticTools.js`)

**Remove:**
- ❌ `generate_final_query` tool (this ended conversations)

**Add:**
- ✅ `show_plot` - Display time-series visualization
- ✅ `show_table` - Display tabular data

**Keep:**
- ✅ `fuzzy_search_analyte_names`
- ✅ `fuzzy_search_parameter_names`
- ✅ `execute_exploratory_sql`

#### 2. Route Handlers (`server/routes/chatStream.js`)

**Remove:**
- ❌ `handleFinalQuery()` - this sent `type: 'done'` to end stream

**Add:**
- ✅ `handleShowPlot()` - execute plot query, send result, DON'T end conversation
- ✅ `handleShowTable()` - execute table query, send result, DON'T end conversation

**Modify:**
- 🔄 `executeToolCalls()` - handle new tools without ending conversation
- 🔄 `streamLLMResponse()` - add conversation pruning before each LLM call

#### 3. Frontend (`public/js/chat.js`)

**Remove:**
- ❌ `handleFinalResult()` - assumed single result then done

**Add:**
- ✅ `handlePlotResult()` - append/replace plot in results area
- ✅ `handleTableResult()` - append/replace table in results area

**Modify:**
- 🔄 `handleSSEEvent()` - handle new event types
- 🔄 Display logic to support replace vs append

#### 4. System Prompt (`prompts/agentic_sql_generator_system_prompt.txt`)

**Add:**
- ✅ Display tool usage guidelines (when to use plot vs table vs text)
- ✅ Multi-modal response patterns
- ✅ Conversation continuity instructions
- ✅ Data format documentation (compact JSON keys)
- ✅ Medical disclaimer language for text analysis

**Remove:**
- ❌ References to `generate_final_query`
- ❌ "This is your final answer" language

---

## Implementation Plan

### Phase 1: Backend Tool Definitions (2-3 hours)

**File:** `server/services/agenticTools.js`

**Task 1.1:** Add `show_plot` tool definition

```javascript
{
  type: "function",
  function: {
    name: "show_plot",
    description: "Display a time-series plot of lab results in the UI. The plot will appear in the results area. You can call this multiple times - use replace_previous=true to update the current plot, or false to keep conversation context. After calling this tool, you will receive the full dataset in the tool result, allowing you to analyze and discuss the data with the user.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "SQL query returning time-series data. MUST include columns: t (bigint timestamp in ms), y (numeric value), parameter_name (text), unit (text). SHOULD include: reference_lower, reference_upper, is_out_of_range. Will be limited to 200 rows max."
        },
        plot_title: {
          type: "string",
          description: "Short title for the plot (max 30 chars). Use only the parameter name, no extra words. Examples: 'Vitamin D', 'Холестерин', 'Glucose'."
        },
        replace_previous: {
          type: "boolean",
          description: "If true, replace the current plot/table. If false, keep previous context. Use true when user says 'show as...', 'change to...', 'instead...'. Default: false.",
          default: false
        },
        reasoning: {
          type: "string",
          description: "Brief explanation of why you're showing this plot (for logging)"
        }
      },
      required: ["sql", "plot_title"]
    }
  }
}
```

**Task 1.2:** Add `show_table` tool definition

```javascript
{
  type: "function",
  function: {
    name: "show_table",
    description: "Display lab results as a table in the UI. The table will appear in the results area. Use for latest values, detailed comparison, or when user prefers tabular format. After calling this tool, you receive the full dataset for analysis and discussion.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "SQL query returning tabular data. SHOULD include columns: parameter_name, value, unit, date, reference_interval or reference_lower/upper. Will be limited to 50 rows max."
        },
        table_title: {
          type: "string",
          description: "Descriptive title for the table. Example: 'Latest Lipid Panel', 'Vitamin D History'."
        },
        replace_previous: {
          type: "boolean",
          description: "If true, replace current table/plot. If false, keep previous context. Default: false.",
          default: false
        },
        reasoning: {
          type: "string",
          description: "Brief explanation (for logging)"
        }
      },
      required: ["sql", "table_title"]
    }
  }
}
```

**Task 1.3:** Remove `generate_final_query` from TOOL_DEFINITIONS array

**Acceptance Criteria:**
- ✅ TOOL_DEFINITIONS exports array with 5 tools (2 search, 1 exploratory, 2 display)
- ✅ No references to `generate_final_query` remain
- ✅ Tool descriptions mention conversation continuity

---

### Phase 2: Backend Handlers (4-6 hours)

**File:** `server/routes/chatStream.js`

**Task 2.1:** Implement `handleShowPlot()`

```javascript
/**
 * Handle show_plot tool call
 * Executes SQL, sends plot to frontend, adds compact data to conversation
 * Does NOT end conversation
 */
async function handleShowPlot(session, params, toolCallId) {
  const { sql, plot_title, replace_previous = false, reasoning } = params;
  const startTime = Date.now();

  logger.info('[chatStream] show_plot called:', {
    session_id: session.id,
    plot_title,
    replace_previous,
    reasoning
  });

  try {
    // Step 1: Validate SQL (reuse existing validation)    const validation = await validateSQL(sql, { schemaSnapshotId: null });

    if (!validation.valid) {
      logger.warn('[chatStream] Plot validation failed');
      session.messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify({
          success: false,
          error: 'SQL validation failed',
          violations: validation.violations.map(v => v.message || v.code)
        })
      });
      return;
    }

    // Step 2: Enforce row limit
    const MAX_PLOT_ROWS = 200;
    const safeSql = ensureLimit(validation.sqlWithLimit, MAX_PLOT_ROWS);

    // Step 3: Execute query
    const queryResult = await pool.query(safeSql);

    // Step 4: Send FULL data to frontend
    if (session.sseResponse) {
      streamEvent(session.sseResponse, {
        type: 'plot_result',
        plot_title,
        rows: queryResult.rows,
        replace_previous
      });
    }

    // Step 5: Create COMPACT data for conversation history
    const compactRows = queryResult.rows.map(row => ({
      t: row.t,
      y: row.y,
      p: row.parameter_name,
      u: row.unit,
      ...(row.reference_lower != null && { rl: row.reference_lower }),
      ...(row.reference_upper != null && { ru: row.reference_upper }),
      ...(row.is_out_of_range != null && { oor: row.is_out_of_range })
    }));

    // Step 6: Clear previous display if replacing
    if (replace_previous) {
      session.messages = session.messages.filter(msg => {
        if (msg.role !== 'tool') return true;
        try {
          const content = JSON.parse(msg.content);
          return content.display_type !== 'plot' && content.display_type !== 'table';
        } catch {
          return true;
        }
      });
    }

    // Step 7: Add compact result to conversation
    session.messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify({
        success: true,
        display_type: 'plot',
        plot_title,
        rows: compactRows,
        row_count: compactRows.length
      })
    });

  } catch (error) {
    logger.error('[chatStream] show_plot error:', error.message);
    session.messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify({ success: false, error: error.message })
    });
  }
}
```

**Acceptance Criteria for Phase 2:**
- handleShowPlot() and handleShowTable() add compact data to session.messages
- Neither handler sends 'done' event
- executeToolCalls() continues conversation after display tools
- handleFinalQuery() deleted
- Conversation pruning implemented
- Full error handling and logging

---

### Phase 3: Frontend Updates (3-4 hours)

See detailed frontend implementation in the earlier sections.

**Key Changes:**
- Add plot_result and table_result event handlers
- Implement handlePlotResult() and handleTableResult()
- Support replace_previous flag
- Remove handleFinalResult()

**Acceptance Criteria:**
- Events handled correctly
- Plot/table rendering works
- Replace logic functional
- No visual regressions

---

### Phase 4: System Prompt (2-3 hours)

**Major additions:**
1. Display Tools section explaining show_plot and show_table
2. Multi-modal response patterns
3. Medical analysis guidelines
4. Conversation continuity emphasis
5. Compact data format documentation

**Deletions:**
- All generate_final_query references
- "Final answer" language

---

### Phase 5: Validation (1-2 hours)

Add validatePlotQuery() and validateTableQuery() helpers that wrap existing validateSQL().

---

## Testing Strategy

### Unit Tests
- Tool definitions correct
- Handlers add data to messages
- No 'done' events sent
- Conversation pruning works

### Integration Tests
- Conversation continues after display
- replace_previous clears old displays
- Token limits enforced
- Multi-turn conversations work

### Manual QA (7 scenarios documented above)

---

## Rollout Plan

**Day 1-2:** Development
**Day 3 AM:** Internal testing
**Day 3 PM:** Soft launch
**Day 4+:** Production rollout

**Rollback:** Revert 3 key files if critical issues

---

## Success Metrics

**Primary:**
- Messages per conversation: >5
- Follow-up rate: >60%
- Tool usage: 1-2 plots, 0-1 tables per conversation
- Validation success: >95%

**Secondary:**
- Token usage: <15k per conversation
- Execution time: <2s per display
- Zero hallucinated values

**Monitoring:**
Log conversation stats, tool usage, token counts

---

## Future Enhancements

- Advanced visualizations (correlations, heatmaps)
- Conversation persistence
- Trend prediction
- Voice I/O
- Mobile optimization

---

## Appendix

### A. Data Format Reference
Compact format examples for plot and table data

### B. Error Handling
Standard error response formats

### C. Migration Guide
Before/after comparison of tool usage

---

**End of PRD v3.3: Multi-Modal Conversational Health Data Analyst**

---

## Implementation Checklist for Middle SE

**Before You Start:**
- [ ] Read entire PRD
- [ ] Review existing code in chatStream.js, agenticTools.js, chat.js
- [ ] Set up local development environment
- [ ] Run existing tests to establish baseline

**Phase 1 - Backend Tools (2-3 hours):**
- [ ] Add show_plot tool definition to TOOL_DEFINITIONS
- [ ] Add show_table tool definition to TOOL_DEFINITIONS
- [ ] Remove generate_final_query from TOOL_DEFINITIONS
- [ ] Verify tool definitions validate correctly
- [ ] Write unit test for tool definitions
- [ ] Run: npm test

**Phase 2 - Backend Handlers (4-6 hours):**
- [ ] Implement handleShowPlot() in chatStream.js
- [ ] Implement handleShowTable() in chatStream.js
- [ ] Implement ensureLimit() helper function
- [ ] Update executeToolCalls() to handle new tools
- [ ] Delete handleFinalQuery() function
- [ ] Implement pruneConversationIfNeeded()
- [ ] Implement estimateTokenCount()
- [ ] Update streamLLMResponse() to call pruning
- [ ] Add comprehensive error handling
- [ ] Add logging at key points
- [ ] Write unit tests for handlers
- [ ] Test with mock sessions

**Phase 3 - Frontend (3-4 hours):**
- [ ] Update handleSSEEvent() switch statement
- [ ] Implement handlePlotResult()
- [ ] Implement handleTableResult()
- [ ] Update displayTableResults() to accept title
- [ ] Delete handleFinalResult()
- [ ] Test plot display with real data
- [ ] Test table display with real data
- [ ] Test replace_previous behavior
- [ ] Verify no visual regressions

**Phase 4 - System Prompt (2-3 hours):**
- [ ] Remove all generate_final_query references
- [ ] Add Display Tools section
- [ ] Add multi-modal response patterns
- [ ] Add medical analysis guidelines
- [ ] Add conversation continuity notes
- [ ] Document compact data format
- [ ] Review for clarity and completeness

**Phase 5 - Validation (1-2 hours):**
- [ ] Implement validatePlotQuery()
- [ ] Implement validateTableQuery()
- [ ] Export from agenticCore
- [ ] Test validation with valid/invalid SQL

**Testing (2-3 hours):**
- [ ] Run all unit tests
- [ ] Run integration tests
- [ ] Complete manual QA checklist (7 scenarios)
- [ ] Test with real lab data
- [ ] Verify token usage reasonable
- [ ] Test error scenarios
- [ ] Test long conversations (15+ turns)

**Final Steps:**
- [ ] Code review with senior engineer
- [ ] Update CLAUDE.md if needed
- [ ] Deploy to dev environment
- [ ] Smoke test in dev
- [ ] Create pull request
- [ ] Schedule deployment

**Estimated Total Time:** 15-20 hours (2-3 days for middle SE)

---

**Questions? Issues?**
- Refer to existing v3.2 implementation for patterns
- Check CLAUDE.md for architecture notes
- Review existing PRDs for context
- Ask senior engineer for clarification

**Good luck!**
