# PRD v4.1: Chat-Centric UI Redesign

**Status**: Draft
**Created**: 2025-12-14
**Author**: System (Claude Code)

## Overview

Redesign the HealthUp main interface to center the user experience around the chat interaction. Implement a 3-state UI system: (1) fresh start with centered input, (2) active conversation, (3) split view for results with data visualization. Refactor the existing 260px sidebar to a minimal ~56px icon sidebar.

## Problem Statement

**Current limitations:**
- Chat input field is not prominently visible on initial load
- Results display replaces the chat context, losing conversation flow
- Current 260px sidebar with full labels takes significant screen space
- No visual hierarchy guiding user toward primary action (asking questions)

**User impact:**
- New users don't immediately know what to do
- Viewing results disconnects from the conversation that produced them
- Context switching between features feels disjointed

## Goals

**Primary:**
- Make chat input the central, unmissable element on fresh page load
- Preserve conversation context when viewing results (70/30 split view)
- Shrink existing sidebar to icon-only (~56px) for minimal navigation footprint
- Create smooth, polished transitions between states (400ms animations)

**Non-Goals:**
- Mobile-optimized responsive design (desktop/tablet MVP only)
- Dark theme (keep existing light theme)
- Separate HTML pages for Upload/Reports/Admin (keep as sections within single page)
- Changes to backend API or chat functionality

## Success Metrics

- User can immediately identify how to interact with the app (centered input)
- Conversation history visible while viewing results (split view)
- Navigation accessible without leaving chat context (sidebar always visible)
- Transitions feel smooth and professional (no jarring layout shifts)

## User Stories

### Story 1: Fresh Start Experience
**As a** new user opening HealthUp
**I want** to see a clear, centered input field with suggested questions
**So that** I immediately know how to interact with the app

**Acceptance Criteria:**
- Input field centered horizontally and vertically in main content area
- 3-4 suggested questions displayed below input
- Clicking a suggestion populates and submits the question automatically
- Minimal visual clutter (no results area, no chat history)

### Story 2: Active Conversation
**As a** user chatting with the assistant
**I want** the conversation to take up the full content area
**So that** I can focus on the dialogue without distractions

**Acceptance Criteria:**
- Chat messages fill the available vertical space
- User and assistant messages clearly differentiated
- Tool call indicators visible during processing
- Input field pinned at bottom

### Story 3: Viewing Results with Context
**As a** user who received a plot or table result
**I want** to see the visualization while keeping chat visible
**So that** I can ask follow-up questions without losing context

**Acceptance Criteria:**
- Results appear as clickable thumbnail in chat stream
- Clicking thumbnail animates to 70/30 split (data left, chat right)
- Chat scrolls to show the active thumbnail
- Close button on data panel returns to full chat view
- Animation is smooth (400ms)

### Story 4: Persistent Navigation
**As a** user who needs to upload reports or check history
**I want** navigation always visible via icon sidebar
**So that** I can access other features without disrupting my chat

**Acceptance Criteria:**
- Icon sidebar (~50-60px) always visible on left
- Icons for: Home/Chat, Reports, Upload, Admin
- Clicking navigates to respective page/screen
- Current location highlighted

## Technical Architecture

### UI States

```
┌──────────────────────────────────────────────────────────────────┐
│                        STATE 1: FRESH START                      │
├──┬───────────────────────────────────────────────────────────────┤
│🏠│                                                               │
│📄│                                                               │
│📤│              [ Ask about your health... ]                     │
│⚙️│                                                               │
│  │         💡 Покажи мои последние анализы                       │
│  │         💡 Как менялся холестерин?                            │
│  │         💡 Vitamin D trends                                   │
│  │                                                               │
└──┴───────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     STATE 2: ACTIVE CONVERSATION                 │
├──┬───────────────────────────────────────────────────────────────┤
│🏠│  👤 покажи мой холестерин                                     │
│📄│                                                               │
│📤│  🤖 Нашел 3 пациента в базе:                                  │
│⚙️│     1. Иван Петров (М, 1985-03-15)                            │
│  │     2. Мария Иванова (Ж, 1990-06-20)                          │
│  │     3. Алексей Сидоров (М, 1978-11-10)                        │
│  │                                                               │
│  │     Для какого пациента показать результаты?                  │
│  │                                                               │
│  │  👤 первый                                                    │
│  │                                                               │
│  │  🤖 [🔄 Searching analytes...]                                │
│  │                                                               │
│  ├───────────────────────────────────────────────────────────────│
│  │  [ Type your message... ]                              [Send] │
└──┴───────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                  STATE 2.5: RESULT THUMBNAIL IN CHAT             │
├──┬───────────────────────────────────────────────────────────────┤
│🏠│  👤 первый                                                    │
│📄│                                                               │
│📤│  🤖 Вот результаты холестерина для Ивана:                     │
│⚙️│                                                               │
│  │     ┌─────────────────────────┐                               │
│  │     │  📈  Холестерин         │  ← clickable thumbnail        │
│  │     │      12 data points     │                               │
│  │     └─────────────────────────┘                               │
│  │                                                               │
│  ├───────────────────────────────────────────────────────────────│
│  │  [ Type your message... ]                              [Send] │
└──┴───────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     STATE 3: SPLIT VIEW (70/30)                  │
├──┬─────────────────────────────────────┬─────────────────────────┤
│🏠│                                [X]  │ 👤 первый               │
│📄│                                     │                         │
│📤│         📈 Full Plot                │ 🤖 Вот результаты:      │
│⚙️│                                     │ ┌───────────────┐       │
│  │      (Chart.js visualization)       │ │ 📈 Холестерин │ ←active│
│  │                                     │ └───────────────┘       │
│  │              70%                    │                         │
│  │                                     ├─────────────────────────│
│  │                                     │ [ Message... ]   [Send] │
└──┴─────────────────────────────────────┴─────────────────────────┘
```

### Component Structure

```
index.html
├── sidebar.js (new)
│   └── Icon navigation component
├── chatStates.js (new)
│   ├── FreshState - centered input + suggestions
│   ├── ConversationState - full chat view
│   └── SplitState - 70/30 data + chat
├── resultThumbnail.js (new)
│   ├── PlotThumbnail component
│   └── TableThumbnail component
├── chat.js (modified)
│   └── Integrate with state management
└── app.js (modified)
    └── State orchestration, animations
```

### State Transitions

```
                    ┌─────────────┐
                    │ FRESH_START │
                    └──────┬──────┘
                           │ user sends message
                           │ OR clicks suggestion
                           ▼
                    ┌─────────────┐
           ┌───────▶│CONVERSATION │◀───────┐
           │        └──────┬──────┘        │
           │               │ LLM returns   │
           │               │ result with   │
           │               │ thumbnail     │
           │               ▼               │
           │        ┌─────────────┐        │
           │        │  THUMBNAIL  │        │
           │        │  (in chat)  │        │
           │        └──────┬──────┘        │
           │               │ user clicks   │
           │               │ thumbnail     │
           │               ▼               │
           │        ┌─────────────┐        │
           └────────│ SPLIT_VIEW  │────────┘
        close btn   └─────────────┘   close btn
        OR new msg                    (animate back)
```

### Animation Specifications

**Transition: Conversation → Split View (thumbnail click)**
- Duration: 400ms
- Easing: `ease-out`
- Sequence:
  1. Chat container width animates from 100% to 30%
  2. Chat scrolls to center the clicked thumbnail
  3. Data panel fades in + slides from left (0% → 70% width)
  4. **Chart.js render hook**: Listen for `transitionend` event on data panel, then render chart
     ```javascript
     dataPanel.addEventListener('transitionend', (e) => {
       if (e.propertyName === 'width') {
         // Panel has reached full size, safe to render Chart.js
         renderVisualization(resultData);
       }
     }, { once: true });
     ```

**Transition: Split View → Conversation (close button)**
- Duration: 400ms
- Easing: `ease-in`
- Sequence:
  1. Data panel fades out + slides left
  2. Chat container width animates from 30% to 100%
  3. Chat scroll position preserved

**CSS Variables:**
```css
:root {
  --transition-duration: 400ms;
  --sidebar-width-icon: 56px;  /* New icon-only sidebar */
  --sidebar-width-legacy: 260px; /* Existing full sidebar (to be replaced) */
  --split-data-width: 70%;
  --split-chat-width: 30%;
}
```

### Sidebar Component

**File:** `public/js/sidebar.js`

**Structure:**
```html
<!-- Note: Uses .sidebar-icon class to avoid conflict with existing .sidebar -->
<nav class="sidebar-icon" id="sidebar">
  <div class="sidebar-icon-logo">
    <span class="logo-letter">H</span>
  </div>
  <ul class="sidebar-icon-nav">
    <li class="sidebar-icon-item active" data-section="assistant" title="Chat">
      <span class="icon">🏠</span>
    </li>
    <li class="sidebar-icon-item" data-section="reports" title="Reports">
      <span class="icon">📄</span>
    </li>
    <li class="sidebar-icon-item" data-section="upload" title="Upload">
      <span class="icon">📤</span>
    </li>
    <li class="sidebar-icon-item" data-section="admin" title="Admin">
      <span class="icon">⚙️</span>
    </li>
  </ul>
</nav>
```

**Behavior:**
- Click triggers existing `switchSection()` function (keeps sections in single page)
- Home/Chat activates `section-assistant` which now has 3-state chat
- Active state indicated by highlight/border
- Tooltips on hover show full label
- `data-section` matches existing section IDs for compatibility

**Styling:**
```css
/* Note: .sidebar-icon avoids collision with existing .sidebar (260px) */
.sidebar-icon {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: var(--sidebar-width-icon); /* 56px */
  background: #f8f9fa;
  border-right: 1px solid #e9ecef;
  display: flex;
  flex-direction: column;
  z-index: 100;
}

.sidebar-icon-logo {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid #e9ecef;
}

.logo-letter {
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 700;
  font-size: 16px;
}

.sidebar-icon-nav {
  list-style: none;
  margin: 0;
  padding: 8px 0;
}

.sidebar-icon-item {
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 150ms;
}

.sidebar-icon-item:hover {
  background: #e9ecef;
}

.sidebar-icon-item.active {
  background: #e7f1ff;
  border-left: 3px solid #007bff;
}

.sidebar-icon-item .icon {
  font-size: 20px;
}
```

### Result Thumbnail Component

**File:** `public/js/resultThumbnail.js`

**Plot Thumbnail:**
```html
<div class="result-thumbnail result-thumbnail--plot" data-result-id="uuid">
  <div class="thumbnail-icon">📈</div>
  <div class="thumbnail-content">
    <div class="thumbnail-title">Холестерин</div>
    <div class="thumbnail-meta">12 data points</div>
  </div>
</div>
```

**Table Thumbnail:**
```html
<div class="result-thumbnail result-thumbnail--table" data-result-id="uuid">
  <div class="thumbnail-icon">📋</div>
  <div class="thumbnail-content">
    <div class="thumbnail-title">Результаты анализа</div>
    <div class="thumbnail-meta">8 parameters</div>
  </div>
</div>
```

**Styling:**
```css
.result-thumbnail {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  cursor: pointer;
  transition: all 200ms;
  max-width: 280px;
}

.result-thumbnail:hover {
  background: #e9ecef;
  border-color: #dee2e6;
}

.result-thumbnail--plot .thumbnail-icon {
  color: #007bff;
}

.result-thumbnail--table .thumbnail-icon {
  color: #28a745;
}

.thumbnail-icon {
  font-size: 24px;
}

.thumbnail-title {
  font-weight: 500;
  color: #212529;
}

.thumbnail-meta {
  font-size: 12px;
  color: #6c757d;
}
```

### Fresh State with Suggestions

**File:** `public/js/chatStates.js`

**Structure:**
```html
<div class="fresh-state">
  <div class="fresh-input-container">
    <input
      type="text"
      class="fresh-input"
      placeholder="Ask about your health..."
    />
    <button class="fresh-send-btn">→</button>
  </div>
  <div class="fresh-suggestions">
    <button class="suggestion-btn" data-question="Покажи мои последние анализы">
      💡 Покажи мои последние анализы
    </button>
    <button class="suggestion-btn" data-question="Как менялся холестерин?">
      💡 Как менялся холестерин?
    </button>
    <button class="suggestion-btn" data-question="Show vitamin D trends">
      💡 Show vitamin D trends
    </button>
    <button class="suggestion-btn" data-question="Сравни мои анализы за год">
      💡 Сравни мои анализы за год
    </button>
  </div>
</div>
```

**Behavior:**

**Session Initialization Gate (CRITICAL):**
- Fresh state input and suggestion buttons start **disabled**
- On SSE `session_start` event → enable input and suggestions
- This prevents "Session not initialized" errors on immediate clicks
- Implementation:
  ```javascript
  // On page load
  freshInput.disabled = true;
  suggestionBtns.forEach(btn => btn.disabled = true);

  // On session_start SSE event
  eventSource.addEventListener('message', (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'session_start') {
      sessionId = data.sessionId;
      freshInput.disabled = false;
      suggestionBtns.forEach(btn => btn.disabled = false);
    }
  });
  ```

**Clicking suggestion button:**
1. Populates input with question text
2. Immediately submits to chat (sessionId guaranteed valid)
3. Transitions to CONVERSATION state

**Styling:**
```css
.fresh-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 20px;
}

.fresh-input-container {
  display: flex;
  width: 100%;
  max-width: 600px;
  background: #fff;
  border: 2px solid #e9ecef;
  border-radius: 24px;
  padding: 4px;
  transition: border-color 200ms;
}

.fresh-input-container:focus-within {
  border-color: #007bff;
}

.fresh-input {
  flex: 1;
  border: none;
  outline: none;
  padding: 12px 16px;
  font-size: 16px;
  background: transparent;
}

.fresh-send-btn {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: #007bff;
  color: white;
  font-size: 18px;
  cursor: pointer;
}

.fresh-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 24px;
  max-width: 600px;
  justify-content: center;
}

.suggestion-btn {
  padding: 8px 16px;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 20px;
  font-size: 14px;
  cursor: pointer;
  transition: all 200ms;
}

.suggestion-btn:hover {
  background: #e9ecef;
  border-color: #dee2e6;
}
```

### Split View Container

**File:** `public/js/chatStates.js`

**Structure:**
```html
<div class="split-view">
  <div class="split-data-panel">
    <button class="split-close-btn" title="Close">×</button>
    <div class="split-data-content">
      <!-- Plot or Table rendered here -->
    </div>
  </div>
  <div class="split-chat-panel">
    <!-- Chat component rendered here -->
  </div>
</div>
```

**Styling:**
```css
.split-view {
  display: flex;
  height: 100%;
}

.split-data-panel {
  width: var(--split-data-width);
  position: relative;
  padding: 16px;
  border-right: 1px solid #e9ecef;
  overflow: auto;
}

.split-close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: #f8f9fa;
  font-size: 20px;
  cursor: pointer;
  z-index: 10;
}

.split-close-btn:hover {
  background: #e9ecef;
}

.split-chat-panel {
  width: var(--split-chat-width);
  display: flex;
  flex-direction: column;
}
```

### Main Layout Structure

**File:** `public/index.html` (modified)

```html
<body>
  <!-- Icon Sidebar (always visible, replaces existing 260px sidebar) -->
  <nav class="sidebar-icon" id="sidebar">
    <!-- sidebar content -->
  </nav>

  <!-- Main content area (right of sidebar) -->
  <main class="main-content" id="main-content">
    <!-- State-dependent content rendered here -->

    <!-- Medical Disclaimer Footer -->
    <footer class="main-footer">
      <p class="disclaimer-text">
        This analysis is based on your lab data and general medical knowledge.
        Always consult your healthcare provider to interpret results in the context of your complete health history.
      </p>
    </footer>
  </main>

  <!-- Scripts: Keep existing IIFE pattern, no ES modules -->
  <script src="js/plotRenderer.js"></script>
  <script src="js/sidebar.js"></script>
  <script src="js/chatStates.js"></script>
  <script src="js/resultThumbnail.js"></script>
  <script src="js/chat.js"></script>
  <script src="js/app.js"></script>
</body>
```

**Module System: No Changes**
- Keep existing IIFE pattern with `window.*` exports
- New files follow same pattern: `window.Sidebar`, `window.ChatStates`, etc.
- No ES modules migration (avoids complexity)

**Base Layout CSS:**
```css
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #fff;
}

.main-content {
  margin-left: var(--sidebar-width-icon);
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Medical Disclaimer Footer */
.main-footer {
  padding: 8px 16px;
  background: #f8f9fa;
  border-top: 1px solid #e9ecef;
}

.disclaimer-text {
  margin: 0;
  font-size: 11px;
  color: #6c757d;
  text-align: center;
}
```

## Migration from Existing Layout

### Current State (index.html)

The existing implementation has:
- **260px sidebar** with logo, full text labels, nav sections, footer
- **CSS classes**: `.sidebar`, `.sidebar-nav`, `.nav-item`, `.sidebar-header`, etc. (style.css lines 202-340)
- **CSS variable**: `--sidebar-width: 260px`
- **Sections**: Upload, Assistant, Reports as `display: none/block` sections within single page

### Migration Strategy

**Approach: Refactor in-place (not separate pages)**

1. **Rename existing sidebar classes** to avoid conflicts:
   - `.sidebar` → `.sidebar-legacy` (temporary, then delete)
   - Create new `.sidebar-icon` class for 56px icon sidebar
   - Or: Override existing `.sidebar` styles in `redesign.css` with higher specificity

2. **CSS Variable Update**:
   ```css
   /* In redesign.css - override existing */
   :root {
     --sidebar-width: 56px; /* Override from 260px */
   }
   ```

3. **Keep section switching logic**:
   - Existing JS in index.html handles `data-section` navigation
   - Icon sidebar clicks trigger same `switchSection()` function
   - Upload, Reports, Admin sections remain as hidden/shown divs

4. **Chat section becomes stateful**:
   - `section-assistant` div now managed by ChatStates
   - Fresh/Conversation/Split states render within this section
   - Other sections (upload, reports) unchanged

### CSS Class Mapping

| Existing Class | Action | New Class |
|----------------|--------|-----------|
| `.sidebar` | Replace | `.sidebar-icon` |
| `.sidebar-header` | Remove | (icon sidebar has no header) |
| `.sidebar-nav` | Replace | `.sidebar-icon-nav` |
| `.nav-item` | Replace | `.sidebar-icon-item` |
| `.sidebar-footer` | Remove | (icon sidebar has no footer) |
| `.main-content` | Keep | (adjust margin-left) |

### File-Level Changes

| File | Change |
|------|--------|
| `index.html` | Replace sidebar HTML, add footer disclaimer |
| `style.css` | Keep as-is (legacy styles won't apply to new classes) |
| `redesign.css` | New file with all v4.1 styles |
| `app.js` | Add state management, keep section switching |

## Data Flow

### Result Generation → Thumbnail Display

**SSE Event Types (existing backend events):**
- `plot_result` - Contains: `{ plot_title, rows, replace_previous }`
- `table_result` - Contains: `{ table_title, rows, replace_previous }`

**Flow:**
1. Chat receives `plot_result` or `table_result` SSE event (existing events, no backend changes)
2. `chat.js` intercepts and creates result object instead of rendering immediately:
   ```javascript
   // In handlePlotResult() / handleTableResult()
   const resultObj = {
     id: crypto.randomUUID(),
     type: data.type === 'plot_result' ? 'plot' : 'table',
     title: data.plot_title || data.table_title,
     meta: `${data.rows.length} ${data.type === 'plot_result' ? 'data points' : 'parameters'}`,
     data: { rows: data.rows, replace_previous: data.replace_previous }
   };
   ```
3. Render thumbnail in chat stream (not full result)
4. Store result in `resultStore` Map for later retrieval when thumbnail clicked

### Thumbnail Click → Split View

1. User clicks thumbnail
2. Retrieve full result from `resultStore` by ID
3. Animate transition to split view
4. Render full visualization in data panel:
   - Plot: Use existing `plotRenderer.js`
   - Table: Use existing table renderer with out-of-range highlighting
5. Scroll chat to center the clicked thumbnail
6. Highlight active thumbnail in chat

### Split View Close → Conversation

1. User clicks close button (×)
2. Animate transition back to full chat
3. Data panel removed from DOM
4. Chat scroll position preserved
5. Focus input field

## Features to Preserve

From existing implementation:
- ✅ Tool call indicators ("🔄 Searching analytes...")
- ✅ Parameter table with out-of-range highlighting (red outline)
- ✅ Plot rendering with Chart.js, zoom, reference bands
- ✅ SSE streaming for chat messages
- ✅ Session management and conversation flow

## Features to Remove

- ❌ Copy SQL button (remove entirely)

## File Changes Summary

### New Files
- `public/js/sidebar.js` - Icon navigation component (IIFE, exports `window.Sidebar`)
- `public/js/chatStates.js` - State management (IIFE, exports `window.ChatStates`)
- `public/js/resultThumbnail.js` - Thumbnail components (IIFE, exports `window.ResultThumbnail`)
- `public/css/redesign.css` - All new styles (uses `.sidebar-icon` to avoid conflicts)

### Modified Files
- `public/index.html` - Replace 260px sidebar with 56px icon sidebar, add footer disclaimer
- `public/js/app.js` - State orchestration, animation triggers (keep existing section switching)
- `public/js/chat.js` - Intercept `plot_result`/`table_result` → render thumbnails, integrate with states

### Unchanged Files
- `public/css/style.css` - Keep as-is (legacy `.sidebar` classes won't conflict with `.sidebar-icon`)
- `public/js/plotRenderer.js` - Reuse as-is for split view
- `public/js/unified-upload.js` - Upload section unchanged
- `public/js/reports-browser.js` - Reports section unchanged
- `public/admin.html` - Admin page unchanged
- All backend files - No changes needed

## Testing Strategy

### Manual Testing Checklist

**Fresh State:**
- [ ] Input field centered on page load
- [ ] Input and suggestions **disabled** until session_start SSE received
- [ ] After session_start, input and suggestions become enabled
- [ ] Suggestions visible below input
- [ ] Clicking suggestion submits question
- [ ] Typing + Enter submits question
- [ ] Sidebar visible and clickable

**Conversation State:**
- [ ] Messages render correctly (user right, assistant left)
- [ ] Tool indicators show during processing
- [ ] Streaming text appears smoothly
- [ ] Input stays at bottom

**Thumbnail:**
- [ ] Plot results show 📈 thumbnail
- [ ] Table results show 📋 thumbnail
- [ ] Thumbnail shows title and meta info
- [ ] Thumbnail is clickable
- [ ] Multiple thumbnails in chat history work

**Split View:**
- [ ] Animation smooth (400ms, no jank)
- [ ] Data panel shows at 70% width
- [ ] Chat shows at 30% width
- [ ] Chat scrolls to active thumbnail
- [ ] Close button visible and works
- [ ] Closing animates smoothly back

**Sidebar Navigation:**
- [ ] All icons visible
- [ ] Tooltips on hover
- [ ] Click navigates to correct page
- [ ] Active state shows on current page
- [ ] Chat icon returns to chat

**Integration:**
- [ ] Full flow: Fresh → Question → Clarification → Result → Thumbnail → Split → Close
- [ ] Multiple results in one session work
- [ ] Page refresh returns to Fresh state

## Implementation Order

1. **Phase 1: Layout Foundation**
   - Add sidebar HTML/CSS
   - Restructure index.html with new layout
   - Basic CSS variables for sizing

2. **Phase 2: Fresh State**
   - Implement centered input
   - Add suggestion buttons
   - Wire up suggestion click → submit

3. **Phase 3: Thumbnail System**
   - Create thumbnail components
   - Modify chat.js to render thumbnails
   - Implement resultStore for data retention

4. **Phase 4: Split View**
   - Implement split layout CSS
   - Add close button
   - Wire up thumbnail click → split view

5. **Phase 5: Animations**
   - Add CSS transitions
   - Implement JS animation orchestration
   - Handle scroll position during transitions

6. **Phase 6: Polish**
   - Remove copy SQL button
   - Test all flows
   - Fix edge cases

## Out of Scope

- Mobile responsive design (tablet minimum width assumed)
- Dark theme
- Changes to Upload, Reports, Admin pages
- Backend API changes
- Conversation history persistence
- Multiple simultaneous split views

## Peer Review Resolutions

Issues raised in peer review and their resolutions:

| Issue | Resolution |
|-------|------------|
| SSE event types unclear | Clarified: Use existing `plot_result`/`table_result` events, no backend changes |
| Sidebar CSS conflicts | Added Migration section with class renaming strategy (`.sidebar-icon`) |
| Module system unspecified | Clarified: Keep IIFE pattern, no ES modules |
| Session gate for fresh state | Added explicit disabled-until-ready spec with code example |
| Chart.js render hook vague | Added `transitionend` event listener spec |
| Medical disclaimer missing | Added footer with small disclaimer text |

---

**End of PRD v4.1**
