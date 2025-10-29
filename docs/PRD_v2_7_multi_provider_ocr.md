# PRD v2.7 — Multi-Provider OCR Support (OpenAI + Anthropic)

## 🎯 Goal
Enable configurable switching between **OpenAI Vision** and **Anthropic Claude 4.5** for lab report OCR processing, allowing the system to leverage the best-performing model for medical document extraction.

**User Story:**
> As a system administrator, I want to switch between OpenAI and Anthropic OCR providers via environment configuration so that I can test and compare accuracy, cost, and performance for lab report extraction without code changes.

> As a developer, I want the OCR processing logic to be provider-agnostic so that adding new vision models in the future requires minimal refactoring.

---

## 📋 Prerequisites

### Current State ✅
- **OpenAI Vision API** (`gpt-5-mini`) for OCR
- **Structured JSON output** with strict schema validation
- **Multi-page PDF support** (max 10 pages, converted via `pdftoppm`)
- **Image formats**: PDF, JPEG, PNG, WebP, GIF, HEIC
- **Processing pipeline**: Upload → PDF-to-image → Vision API → JSON parsing → DB persistence
- **Async job processing** with progress tracking

### Technical Context
- Current implementation: [server/services/labReportProcessor.js](../server/services/labReportProcessor.js)
- OpenAI SDK: `openai@^4.58.1`
- Structured output via `client.responses.parse()` with JSON schema
- Base64 image encoding for API requests

### Dependencies
- PRD v0.8 (Schema Refactor)
- PRD v2.4 (Analyte Mapping Write Mode)
- Existing lab report upload pipeline

---

## 🧩 Scope

### In-Scope
1. **Provider Abstraction Layer**
   - Abstract interface for vision providers
   - OpenAI adapter (refactor existing code)
   - Anthropic adapter (new implementation)
   - Provider factory pattern

2. **Anthropic Claude Integration**
   - Install `@anthropic-ai/sdk` package
   - Implement tool-based structured output (Anthropic's approach)
   - Handle API differences (request/response format, image encoding)
   - Support Claude Sonnet 4.5 model (`claude-sonnet-4-5-20250929`)

3. **Configuration Management**
   - Add `OCR_PROVIDER` env variable (values: `openai`, `anthropic`)
   - Add `ANTHROPIC_API_KEY` env variable
   - Add `ANTHROPIC_VISION_MODEL` env variable
   - Maintain backward compatibility (default to OpenAI if not configured)

4. **Testing & Validation**
   - Test with existing lab report samples
   - Compare accuracy between providers
   - Validate structured output consistency
   - Performance benchmarking (latency, cost)

### Out-of-Scope
- Multi-provider fallback logic (if one fails, try another)
- Per-request provider selection (API level)
- Migration of existing lab reports to re-process with new provider
- Support for additional providers (Azure, Google Vision, etc.)
- Dynamic model selection (multiple models per provider)

---

## 🏗️ Technical Design

### 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    labReportProcessor.js                         │
├─────────────────────────────────────────────────────────────────┤
│  processLabReport()                                              │
│    ├─ File validation & PDF processing                           │
│    ├─ Image preparation (PDF → PNG conversion)                   │
│    ├─ Provider selection (via env var)                           │
│    │   ├─ VisionProviderFactory.create(providerName)             │
│    │   └─ Returns: OpenAIProvider | AnthropicProvider            │
│    ├─ Call provider.analyze(images, prompts, schema)             │
│    ├─ Parse structured response                                  │
│    └─ Persist to database                                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              VisionProvider Interface (Abstract)                 │
├─────────────────────────────────────────────────────────────────┤
│  + analyze(images, systemPrompt, userPrompt, schema)             │
│  + parseResponse(rawResponse)                                    │
│  + validateConfig()                                              │
└─────────────────────────────────────────────────────────────────┘
           ▲                                   ▲
           │                                   │
    ┌──────┴──────┐                   ┌───────┴────────┐
    │ OpenAIProvider│                  │AnthropicProvider│
    └─────────────┘                   └────────────────┘
```

### 2. Provider Interface

**File**: `server/services/vision/VisionProvider.js` (new)

```javascript
/**
 * Abstract interface for vision OCR providers
 */
class VisionProvider {
  /**
   * Analyze images and extract structured data
   * @param {Array<string>} imageDataUrls - Base64 data URLs
   * @param {string} systemPrompt - System instructions
   * @param {string} userPrompt - User query
   * @param {object} schema - JSON schema for structured output
   * @returns {Promise<object>} Structured extraction result
   */
  async analyze(imageDataUrls, systemPrompt, userPrompt, schema) {
    throw new Error('analyze() must be implemented by subclass');
  }

  /**
   * Validate provider configuration (API keys, model names)
   * @throws {Error} If configuration is invalid
   */
  validateConfig() {
    throw new Error('validateConfig() must be implemented by subclass');
  }

  /**
   * Retry a function with exponential backoff
   * @param {Function} fn - Async function to retry
   * @param {object} options - Retry options
   * @param {number} options.attempts - Max retry attempts (default: 3)
   * @param {number} options.baseDelay - Base delay in ms (default: 500)
   * @returns {Promise<any>} Result from fn
   */
  async withRetry(fn, { attempts = 3, baseDelay = 500 } = {}) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt === attempts || !this.shouldRetry(error)) {
          break;
        }

        const backoff = baseDelay * (2 ** (attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    throw lastError;
  }

  /**
   * Determine if an error should trigger a retry
   * @param {Error} error - Error from API call
   * @returns {boolean} True if should retry
   */
  shouldRetry(error) {
    if (!error) {
      return false;
    }

    // OpenAI SDK: error.response.status
    // Anthropic SDK: error.status (APIError)
    // Network errors: error.code
    const status = error.response?.status || error.status;

    if (status) {
      return status === 429 || status >= 500;
    }

    // Retry on network timeouts and connection errors
    const retryableCodes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND'];
    if (error.code && retryableCodes.includes(error.code)) {
      return true;
    }

    return false;
  }
}
```

### 3. OpenAI Provider (Refactored)

**File**: `server/services/vision/OpenAIProvider.js` (new)

**Key changes from current implementation:**
- Extract OpenAI-specific logic from `labReportProcessor.js`
- Keep existing `client.responses.parse()` with structured output
- Maintain retry logic with exponential backoff
- Image format: `{type: 'input_image', image_url: 'data:image/png;base64,...'}`

**Configuration:**
- `OPENAI_API_KEY` (required)
- `OPENAI_VISION_MODEL` (default: `gpt-5-mini`)

**Request structure (unchanged):**
```javascript
{
  model: 'gpt-5-mini',
  input: [
    { role: 'system', content: [{type: 'input_text', text: systemPrompt}] },
    { role: 'user', content: [
      {type: 'input_text', text: userPrompt},
      {type: 'input_image', image_url: 'data:image/png;base64,...'},
      // ... more images
    ]}
  ],
  text: { format: structuredOutputFormat }
}
```

**Response parsing:**
- Extract from `response.output_parsed` (primary)
- Fallback to `response.output_text` if parsing fails

### 4. Anthropic Provider (New Implementation)

**File**: `server/services/vision/AnthropicProvider.js` (new)

**Configuration:**
- `ANTHROPIC_API_KEY` (required)
- `ANTHROPIC_VISION_MODEL` (default: `claude-sonnet-4-5-20250929`)

**Structured Output Strategy:**
Anthropic doesn't have native structured output like OpenAI. We use the **tool-calling approach**:

1. Convert JSON schema → Tool definition (with compatibility adapter)
2. Force Claude to call the tool via `tool_choice`
3. Extract structured data from tool call input

**⚠️ JSON Schema Compatibility Issue:**
Our current schema uses `anyOf: [{type: 'string'}, {type: 'null'}]` for nullable fields and `additionalProperties: false` for strict validation. Anthropic's tool input schemas **do not fully support `anyOf` patterns** and have different nullable handling.

**Adapter Strategy:**
```javascript
/**
 * Convert OpenAI-style JSON schema to Anthropic-compatible tool input schema
 * - Transform anyOf: [{type: 'string'}, {type: 'null'}] → type: ['string', 'null']
 * - Transform anyOf: [{type: 'string'}, {type: 'number'}, {type: 'null'}] → type: ['string', 'number', 'null']
 * - Keep additionalProperties: false (Anthropic supports this)
 * - Preserve nested required arrays
 */
function convertSchemaForAnthropic(openAiSchema) {
  const convert = (obj) => {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (obj.anyOf && Array.isArray(obj.anyOf)) {
      // Extract all types from anyOf array (including null)
      const types = obj.anyOf
        .map(item => item?.type)
        .filter(t => t !== undefined);

      if (types.length > 0) {
        // Convert to Anthropic's type array format
        // For single type: use string directly, for multiple: use array
        const typeValue = types.length === 1 ? types[0] : types;

        return {
          ...obj,
          type: typeValue,
          anyOf: undefined  // Remove anyOf as it's not needed
        };
      }
    }

    // Recursively process nested objects and arrays
    const result = { ...obj };

    if (result.properties) {
      result.properties = Object.fromEntries(
        Object.entries(result.properties).map(([key, val]) => [key, convert(val)])
      );
    }

    if (result.items) {
      result.items = convert(result.items);
    }

    return result;
  };

  return convert(JSON.parse(JSON.stringify(openAiSchema)));
}
```

**Example transformations:**
```javascript
// Single type + null
{ anyOf: [{ type: 'string' }, { type: 'null' }] }
→ { type: ['string', 'null'] }

// Multiple types + null (patient_age case)
{ anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] }
→ { type: ['string', 'number', 'null'] }

// Single type only
{ anyOf: [{ type: 'boolean' }] }
→ { type: 'boolean' }
```

**Testing:** Validate that converted schema produces identical field extraction compared to OpenAI's native structured output.

**Request structure:**
```javascript
{
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 4096,
  tools: [
    {
      name: 'full_lab_extraction',
      description: 'Extract structured lab report data',
      input_schema: {
        type: 'object',
        properties: { /* our JSON schema */ },
        required: [...]
      }
    }
  ],
  tool_choice: { type: 'tool', name: 'full_lab_extraction' },
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: systemPrompt + '\n\n' + userPrompt },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: '...' // without data URL prefix
          }
        },
        // ... more images
      ]
    }
  ]
}
```

**⚠️ Image Size Limit & Validation:**
Anthropic enforces a **5MB per-image limit** (vs OpenAI's 20MB).

**Validation Strategy:**
Based on production data analysis, typical lab PDFs are <1MB and convert to PNG images <1MB per page, well under Anthropic's limit. Instead of adding compression logic, we validate and provide clear error messages.

```javascript
/**
 * Validate image size for provider limits
 * @param {Buffer} imageBuffer - Image data
 * @param {string} providerName - 'openai' or 'anthropic'
 * @throws {Error} If image exceeds provider limit
 */
function validateImageSize(imageBuffer, providerName) {
  const sizeMB = imageBuffer.length / (1024 * 1024);
  const limits = {
    openai: 20,
    anthropic: 5
  };

  const limit = limits[providerName] || 20;

  if (sizeMB > limit) {
    const error = new Error(
      `Image size ${sizeMB.toFixed(2)}MB exceeds ${providerName} limit of ${limit}MB. ` +
      `Please upload a smaller file or reduce PDF quality.`
    );
    error.statusCode = 413; // Payload Too Large
    throw error;
  }

  console.log(`[${providerName}] Image size: ${sizeMB.toFixed(2)}MB (limit: ${limit}MB)`);
}
```

**User-facing error message:**
```
❌ File too large for Anthropic OCR
Your PDF contains pages that exceed Anthropic's 5MB per-page limit.
Current page size: 6.2MB

Please try:
• Reducing PDF quality/DPI
• Splitting large documents
• Or switch to OpenAI provider (supports up to 20MB)
```

**Implementation Note:**
- Validate each converted PNG page before sending to API
- Log warning at 80% of limit (4MB for Anthropic)
- Track occurrences to inform future compression strategy if needed

**Image format transformation:**
- OpenAI: `data:image/png;base64,ABC123`
- Anthropic: Extract media type and base64 data separately
  ```javascript
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  const mediaType = match[1]; // 'image/png' or 'image/jpeg'
  const data = match[2];      // 'ABC123'
  ```

**Response parsing:**
```javascript
// Anthropic returns tool use in content blocks
const toolUse = response.content.find(block => block.type === 'tool_use');
const structuredData = toolUse.input; // This is our JSON schema data
```

**Key differences:**
| Feature | OpenAI | Anthropic |
|---------|--------|-----------|
| Structured output | Native (`responses.parse`) | Tool-based workaround |
| Image format | `input_image` + `image_url` | `image` + `source` object |
| System prompt | Separate role | Combined with user message |
| Max images/request | ~20 | 100 |
| Max image size | 20MB | 5MB (API), 10MB (claude.ai) |
| Response parsing | `output_parsed` | `content[].input` (tool call) |

### 5. Provider Factory

**File**: `server/services/vision/VisionProviderFactory.js` (new)

```javascript
const OpenAIProvider = require('./OpenAIProvider');
const AnthropicProvider = require('./AnthropicProvider');

class VisionProviderFactory {
  static create(providerName) {
    switch (providerName?.toLowerCase()) {
      case 'openai':
        return new OpenAIProvider();
      case 'anthropic':
        return new AnthropicProvider();
      default:
        throw new Error(`Unknown OCR provider: ${providerName}. Supported: openai, anthropic`);
    }
  }
}

module.exports = VisionProviderFactory;
```

### 6. Integration with labReportProcessor

**File**: `server/services/labReportProcessor.js` (modified)

**Changes:**
```javascript
// Line ~8: Add import
const VisionProviderFactory = require('./vision/VisionProviderFactory');

// Line ~29: Replace DEFAULT_MODEL
const OCR_PROVIDER = process.env.OCR_PROVIDER || 'openai';

// Line ~630-715: Replace OpenAI-specific code
const provider = VisionProviderFactory.create(OCR_PROVIDER);
provider.validateConfig();

updateProgress(jobId, 40, `Analyzing with ${OCR_PROVIDER.toUpperCase()}`);

const analysisResult = await provider.analyze(
  imageDataUrls,
  systemPrompt,
  userPrompt,
  structuredOutputFormat.schema
);

updateProgress(jobId, 70, 'AI analysis completed');

// analysisResult already contains parsed JSON matching schema
const coreResult = parseVisionResponse(
  analysisResult,
  JSON.stringify(analysisResult)
);
```

**Remove OpenAI-specific code:**
- Client initialization (~line 637)
- Request payload building (~line 669-689)
- `callVision()` function (~line 691-701)
- `withRetry()` wrapper (~line 706) - move to base provider

**Keep generic code:**
- File validation
- PDF-to-image conversion
- Sanitization functions
- Database persistence
- Job progress tracking

---

## 📊 Data Model Changes

### Environment Variables

**New variables** (`.env.example`):
```bash
# OCR Provider Configuration (v2.7)
OCR_PROVIDER=openai                        # Options: openai, anthropic
OPENAI_API_KEY=sk-...                      # OpenAI API key
OPENAI_VISION_MODEL=gpt-5-mini             # OpenAI model name
ANTHROPIC_API_KEY=sk-ant-...               # Anthropic API key
ANTHROPIC_VISION_MODEL=claude-sonnet-4-5-20250929  # Anthropic model name
```

**Deprecation:**
- `OPENAI_VISION_MODEL` still supported (for backward compatibility)
- New deploys should use provider-specific model names

### No Database Schema Changes
This feature is purely at the service layer. Database schema remains unchanged.

---

## 🔧 Implementation Plan

### Phase 1: Provider Abstraction (Days 1-2)
1. Create `server/services/vision/` directory
2. Implement `VisionProvider.js` base class
3. Refactor OpenAI logic → `OpenAIProvider.js`
4. Test existing functionality (no regressions)

### Phase 2: Anthropic Integration (Days 3-5)
1. Install `@anthropic-ai/sdk` package
2. Implement `AnthropicProvider.js`
   - Schema → Tool definition converter
   - Image format transformer
   - Request builder with tool_choice
   - Response parser (extract from tool_use)
3. Implement retry logic with exponential backoff
4. Handle Anthropic-specific errors (rate limits, token limits)

### Phase 3: Factory & Configuration (Day 6)
1. Implement `VisionProviderFactory.js`
2. Update `labReportProcessor.js` to use factory
3. Add environment variable validation
4. Update `.env.example` with documentation

### Phase 4: Testing & Validation (Days 7-8)
1. **Unit tests:**
   - OpenAIProvider request/response handling
   - AnthropicProvider request/response handling
   - **Schema → Tool definition conversion (critical):**
     - Test single-type + null: `{anyOf: [{type: 'string'}, {type: 'null'}]}` → `{type: ['string', 'null']}`
     - Test multi-type + null: `{anyOf: [{type: 'string'}, {type: 'number'}, {type: 'null'}]}` → `{type: ['string', 'number', 'null']}`
     - Test nested objects with anyOf fields
     - Test array items with anyOf fields
   - **Retry logic (critical):**
     - Test OpenAI SDK errors: `error.response.status = 429` → should retry
     - Test Anthropic SDK errors: `error.status = 429` → should retry
     - Test network errors: `error.code = 'ETIMEDOUT'` → should retry
     - Test non-retryable errors: `error.status = 400` → should NOT retry
   - **Image size validation:**
     - Test within limit: 3MB image with Anthropic → passes
     - Test exceeds limit: 6MB image with Anthropic → throws error with statusCode 413
     - Test warning threshold: 4.5MB image → logs warning
   - Image format transformations (data URL → base64 source)

2. **Integration tests:**
   - Process sample lab reports with OpenAI
   - Process same reports with Anthropic
   - Compare extracted data (accuracy)
   - Validate structured output consistency
   - **Field-by-field validation:** Ensure `patient_age` extracts correctly as string/number with both providers

3. **Performance testing:**
   - Latency comparison
   - Cost comparison (tokens used)
   - Retry behavior under rate limits

### Phase 5: Documentation & Rollout (Day 9)
1. Update README with new env vars
2. Add provider selection guide
3. Document cost/performance trade-offs
4. Create migration guide for existing deployments

---

## 🧪 Testing Strategy

### Test Cases

**1. Provider Selection**
- ✅ Default to OpenAI if `OCR_PROVIDER` not set
- ✅ Use OpenAI when `OCR_PROVIDER=openai`
- ✅ Use Anthropic when `OCR_PROVIDER=anthropic`
- ✅ Throw error for invalid provider name
- ✅ Validate API keys before processing

**2. OpenAI Provider (Regression Testing)**
- ✅ Single-page PDF extraction
- ✅ Multi-page PDF extraction (10 pages)
- ✅ Image file extraction (JPEG, PNG)
- ✅ Structured output validation
- ✅ Retry on rate limits
- ✅ Error handling (invalid API key, model not found)

**3. Anthropic Provider (New Functionality)**
- ✅ Single-page PDF extraction
- ✅ Multi-page PDF extraction (10 pages)
- ✅ Image file extraction (JPEG, PNG)
- ✅ Tool-based structured output
- ✅ Schema → Tool definition conversion
- ✅ Image data URL → base64 source transformation
- ✅ Retry on rate limits
- ✅ Error handling (invalid API key, model not found)

**4. Data Consistency**
- ✅ Same PDF processed by both providers yields similar results
- ✅ Extracted patient names match
- ✅ Test dates match
- ✅ Parameter counts match (±2 tolerance)
- ✅ Numeric values match (±5% tolerance for OCR errors)

**5. Edge Cases**
- ✅ Missing API key (throw error early)
- ✅ Empty PDF (no pages detected)
- ✅ Oversized image (>5MB for Anthropic)
- ✅ Non-English lab report (Russian, Hebrew)
- ✅ Malformed JSON in response (fallback parsing)
- ✅ API timeout (retry logic)

### Sample Lab Reports for Testing
- `test/fixtures/lab_report_cholesterol_en.pdf` (English, 1 page)
- `test/fixtures/lab_report_vitamin_d_ru.pdf` (Russian, 1 page)
- `test/fixtures/lab_report_comprehensive_he.pdf` (Hebrew, 3 pages)
- `test/fixtures/lab_report_multipage_10.pdf` (10 pages, edge case)

### Critical Unit Test Examples

**Test 1: Schema Converter - Multi-type anyOf**
```javascript
describe('convertSchemaForAnthropic', () => {
  it('should convert multi-type anyOf to type array', () => {
    const input = {
      patient_age: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] }
    };

    const result = convertSchemaForAnthropic(input);

    expect(result.patient_age.type).toEqual(['string', 'number', 'null']);
    expect(result.patient_age.anyOf).toBeUndefined();
  });

  it('should convert single-type anyOf to type array', () => {
    const input = {
      patient_name: { anyOf: [{ type: 'string' }, { type: 'null' }] }
    };

    const result = convertSchemaForAnthropic(input);

    expect(result.patient_name.type).toEqual(['string', 'null']);
  });

  it('should handle nested objects recursively', () => {
    const input = {
      parameters: {
        type: 'array',
        items: {
          properties: {
            result: { anyOf: [{ type: 'string' }, { type: 'null' }] }
          }
        }
      }
    };

    const result = convertSchemaForAnthropic(input);

    expect(result.parameters.items.properties.result.type).toEqual(['string', 'null']);
  });
});
```

**Test 2: Retry Logic - Multi-SDK Error Handling**
```javascript
describe('VisionProvider.shouldRetry', () => {
  let provider;

  beforeEach(() => {
    provider = new VisionProvider();
  });

  it('should retry on OpenAI SDK 429 error', () => {
    const error = { response: { status: 429 } };
    expect(provider.shouldRetry(error)).toBe(true);
  });

  it('should retry on Anthropic SDK 429 error', () => {
    const error = { status: 429 }; // No response object
    expect(provider.shouldRetry(error)).toBe(true);
  });

  it('should retry on network timeout', () => {
    const error = { code: 'ETIMEDOUT' };
    expect(provider.shouldRetry(error)).toBe(true);
  });

  it('should NOT retry on 400 client error', () => {
    const error = { status: 400 };
    expect(provider.shouldRetry(error)).toBe(false);
  });

  it('should retry on 500 server error', () => {
    const error = { response: { status: 503 } };
    expect(provider.shouldRetry(error)).toBe(true);
  });
});
```

---

## 📈 Success Metrics

### Functional Metrics
- ✅ Provider switching works via env var (manual test)
- ✅ OpenAI provider maintains 100% feature parity with current implementation
- ✅ Anthropic provider achieves >95% extraction accuracy vs OpenAI baseline
- ✅ Zero regressions in existing lab report processing

### Performance Metrics
- **Latency:** Compare avg processing time per page
  - OpenAI baseline: ~2-3s per page
  - Anthropic target: <5s per page (acceptable)
- **Cost:** Compare per-request cost
  - OpenAI `gpt-5-mini`: ~$0.01-0.03 per report
  - Anthropic `claude-sonnet-4.5`: TBD (track in production)
- **Accuracy:** Compare extraction quality
  - Patient name extraction: >98% match
  - Test date extraction: >95% match
  - Numeric value extraction: >90% match (±5% tolerance)

### Reliability Metrics
- ✅ Retry logic handles rate limits (429 errors)
- ✅ Error messages are actionable (missing API key, invalid model)
- ✅ Job progress tracking works for both providers

---

## 🚀 Rollout Plan

### Stage 1: Development & Internal Testing (Week 1)
- Implement provider abstraction
- Add Anthropic integration
- Run unit and integration tests
- **Criteria:** All tests pass, no regressions

### Stage 2: Staging Environment Testing (Week 2)
- Deploy to staging with `OCR_PROVIDER=openai` (baseline)
- Process 50 historical lab reports
- Switch to `OCR_PROVIDER=anthropic`
- Process same 50 reports, compare results
- **Criteria:** >95% accuracy match, acceptable latency

### Stage 3: Production Rollout (Week 3)
- Deploy to production with `OCR_PROVIDER=openai` (default)
- Monitor for 3 days (no changes)
- Switch to `OCR_PROVIDER=anthropic` for 10% of traffic (A/B test)
- Compare extraction quality via manual review
- **Criteria:** No increase in error rates, user satisfaction maintained

### Stage 4: Full Migration (Week 4+)
- Based on A/B test results, decide:
  - **Option A:** Keep OpenAI as default (if Anthropic not better)
  - **Option B:** Switch to Anthropic as default (if accuracy/cost improved)
  - **Option C:** Allow per-user provider selection (future enhancement)

---

## 🔐 Security & Compliance

### API Key Management
- ✅ Store keys in `.env` (never commit to git)
- ✅ **Validate keys on application startup** (fail fast if missing/invalid)
- ✅ Use separate keys for dev/staging/prod environments
- ✅ Rotate keys quarterly (security best practice)

**Startup Validation Implementation:**
```javascript
// server/app.js - Add after dotenv.config()
const VisionProviderFactory = require('./services/vision/VisionProviderFactory');

// Validate OCR provider configuration on startup
try {
  const ocrProvider = process.env.OCR_PROVIDER || 'openai';
  console.log(`[Startup] Validating OCR provider: ${ocrProvider}`);

  const provider = VisionProviderFactory.create(ocrProvider);
  provider.validateConfig();

  console.log(`[Startup] ✅ OCR provider validated: ${ocrProvider}`);
} catch (error) {
  console.error(`[Startup] ❌ OCR provider validation failed: ${error.message}`);
  console.error('[Startup] Please check your .env configuration:');
  console.error(`  - OCR_PROVIDER=${process.env.OCR_PROVIDER || 'openai'}`);
  console.error(`  - OPENAI_API_KEY=${process.env.OPENAI_API_KEY ? '✅ set' : '❌ missing'}`);
  console.error(`  - ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ? '✅ set' : '❌ missing'}`);
  process.exit(1); // Fail fast - don't start server with invalid config
}
```

**Provider.validateConfig() Implementation:**
```javascript
// OpenAIProvider.js
validateConfig() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required but not set');
  }
  if (!process.env.OPENAI_VISION_MODEL) {
    console.warn('[OpenAI] OPENAI_VISION_MODEL not set, using default: gpt-5-mini');
  }
}

// AnthropicProvider.js
validateConfig() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required but not set');
  }
  if (!process.env.ANTHROPIC_VISION_MODEL) {
    console.warn('[Anthropic] ANTHROPIC_VISION_MODEL not set, using default: claude-sonnet-4-5-20250929');
  }
}
```

This ensures the application never starts with invalid credentials, preventing runtime failures during lab report processing.

### Data Privacy
- ✅ Lab reports processed via HTTPS (both providers)
- ✅ Image data sent as base64 (no external hosting)
- ✅ No data retention by providers (verify TOC)
- ✅ GDPR/HIPAA compliance review (if applicable)

### Rate Limiting
- ✅ Respect provider rate limits
- ✅ Implement exponential backoff
- ✅ Track rate limit errors in logs
- ✅ Alert on repeated 429 errors

---

## 🛠️ Maintenance & Monitoring

### Logging
- Log provider selection at job start
- Log API request/response times
- Log extraction accuracy metrics (if reference data available)
- Log errors with provider context

**Example log entry:**
```
[labReportProcessor:job123] Starting processing
[labReportProcessor:job123] Using provider: anthropic (model: claude-sonnet-4-5-20250929)
[labReportProcessor:job123] API request completed in 3241ms
[labReportProcessor:job123] Extracted 12 parameters from 2 pages
```

### Monitoring Dashboard
- Track provider usage distribution (OpenAI vs Anthropic)
- Track avg latency per provider
- Track error rates per provider
- Track cost per report (estimate based on tokens)

### Alerting
- Alert if API key invalid (both providers)
- Alert if error rate >5% for either provider
- Alert if latency >10s per page (degraded performance)
- Alert if cost per report spikes >2x baseline

---

## 📚 Dependencies

### New NPM Packages
```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.0"
  }
}
```

**Package purpose:**
- `@anthropic-ai/sdk`: Anthropic Claude API client

### System Dependencies (Unchanged)
- `pdftoppm` (Poppler utils) for PDF → image conversion
- PostgreSQL database
- Node.js 18+

---

## 🔮 Future Enhancements (Out of Scope)

### v2.8: Multi-Provider Fallback
- If primary provider fails, automatically retry with secondary
- Configuration: `OCR_PROVIDER_PRIMARY=anthropic`, `OCR_PROVIDER_FALLBACK=openai`

### v2.9: Per-Request Provider Selection
- Allow API clients to specify provider via request header
- Useful for A/B testing at application level

### v3.0: Multi-Model Support
- Support multiple models per provider
- Example: `ANTHROPIC_VISION_MODELS=claude-opus-4,claude-sonnet-4.5`
- Route complex reports to Opus, simple reports to Sonnet

### v3.1: Provider Performance Analytics
- Track accuracy per provider over time
- Automatic provider selection based on historical performance
- ML-based routing (complex reports → Provider A, simple → Provider B)

---

## 📝 Open Questions

1. **Cost Comparison:** What is the actual cost per report for Anthropic vs OpenAI?
   - **Action:** Track token usage for 100 sample reports with both providers
   - **Owner:** Backend team
   - **Deadline:** Before Stage 3 (production rollout)

2. **Accuracy Benchmark:** Which provider performs better for non-English reports?
   - **Action:** Process 20 Russian + 20 Hebrew reports with both providers
   - **Owner:** QA team
   - **Deadline:** During Stage 2 (staging testing)

3. **Rate Limits:** What are the actual rate limits for both providers?
   - **OpenAI:** 10,000 RPM (enterprise tier)
   - **Anthropic:** TBD (check documentation)
   - **Action:** Test with burst traffic (50 concurrent uploads)
   - **Owner:** DevOps team

4. **Fallback Strategy:** Should we implement automatic fallback in v2.7 or defer to v2.8?
   - **Decision:** Defer to v2.8 (keep v2.7 scope tight)
   - **Rationale:** Need production data to inform fallback logic

5. **Image Size Edge Cases:** How often do real PDFs exceed 5MB per page?
   - **Action:** Monitor production logs for size warnings (>4MB)
   - **Acceptance Criteria:** <1% of uploads trigger size warnings
   - **Owner:** Backend team
   - **Deadline:** First month of production (Stage 3)
   - **Note:** If occurrences are frequent, implement compression strategy in v2.8

6. **JSON Schema Adapter Testing:** Does the `anyOf` → `type: [...]` conversion preserve all fields?
   - **Action:** Unit test schema converter with actual lab report schema
   - **Validation:** Compare OpenAI vs Anthropic extraction field-by-field
   - **Owner:** Backend team
   - **Deadline:** Phase 2 (Anthropic Integration)

---

## ✅ Definition of Done

**Core Implementation:**
- [ ] Provider abstraction implemented (`VisionProvider.js` with `withRetry()` and `shouldRetry()`)
- [ ] OpenAI provider refactored (no regressions)
- [ ] Anthropic provider implemented (tool-based structured output)
- [ ] Provider factory pattern implemented
- [ ] Configuration via env vars working
- [ ] Startup credential validation implemented (fail fast)

**Critical Features:**
- [ ] JSON schema adapter implemented (`convertSchemaForAnthropic()`)
- [ ] Image size validation implemented (`validateImageSize()`)
- [ ] Anthropic-specific image format transformer working

**Testing:**
- [ ] Unit tests for schema converter (anyOf → type: [...])
- [ ] Unit tests for image size validation (5MB limit)
- [ ] Unit tests for retry logic (both providers)
- [ ] Integration tests with sample lab reports (OpenAI)
- [ ] Integration tests with sample lab reports (Anthropic)
- [ ] Field-by-field extraction comparison (OpenAI vs Anthropic)
- [ ] Edge case: >5MB image with Anthropic (should fail gracefully)
- [ ] All tests passing (>90% coverage)

**Documentation & Deployment:**
- [ ] README updated with provider selection guide
- [ ] `.env.example` updated with all new variables
- [ ] Image size validation documented
- [ ] JSON schema compatibility documented
- [ ] Staging deployment successful
- [ ] Manual testing completed (10 diverse lab reports per provider)
- [ ] Performance benchmarks recorded (latency, cost, accuracy)
- [ ] Code review approved
- [ ] Production deployment plan documented

---

## 📞 Stakeholders

- **Product Owner:** @yuryrudnitski
- **Backend Lead:** @yuryrudnitski
- **QA Lead:** TBD
- **DevOps:** TBD

---

## 📅 Timeline

- **PRD Review:** 2025-10-29 (today)
- **Implementation Start:** 2025-10-30
- **Internal Testing Complete:** 2025-11-06 (1 week)
- **Staging Deployment:** 2025-11-07
- **Production Rollout:** 2025-11-14 (2 weeks total)

---

## 🔗 References

- [Anthropic Vision API Documentation](https://docs.claude.com/en/docs/build-with-claude/vision)
- [Anthropic Messages API](https://docs.claude.com/en/api/messages)
- [OpenAI Vision API](https://platform.openai.com/docs/guides/vision)
- [Current Implementation: labReportProcessor.js](../server/services/labReportProcessor.js)
- [Anthropic Structured Output Guide](https://www.tribe.ai/applied-ai/a-gentle-introduction-to-structured-generation-with-anthropic-api)

---

## 📋 Implementation Risk Mitigation Summary

This section addresses critical issues identified during PRD review:

### 1. ✅ Anthropic 5MB Image Limit
**Problem:** `pdftoppm` produces PNG files >5MB for color-rich PDFs, violating Anthropic's limit.

**Solution (Simplified):**
- **Production data analysis:** Real lab PDFs are <1MB, converting to ~1MB PNG per page (well under 5MB limit)
- **Validation-only approach:** Check image size before API call, fail with clear error if >5MB
- **No compression needed:** Avoids adding `sharp` dependency and complexity
- **User feedback:** Actionable error message suggesting file quality reduction or provider switch
- **Monitoring:** Log warnings at 80% of limit (4MB) to track edge cases

**Location in PRD:** Lines 353-403

### 2. ✅ Retry Logic Ownership
**Problem:** Original design said "move withRetry() to base provider" but interface didn't show it. Additionally, Anthropic SDK throws `APIError` with `error.status` (no `response` object), so OpenAI-style retry logic wouldn't work.

**Solution:**
- Added `withRetry()` and `shouldRetry()` methods to `VisionProvider` base class
- Both OpenAI and Anthropic providers inherit retry logic (DRY principle)
- **Multi-SDK error handling:** Checks `error.response?.status || error.status` to support both SDKs
- **Network error support:** Retries on `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`
- Exponential backoff for 429 (rate limit) and 5xx (server) errors
- Configurable attempts and delay parameters

**Location in PRD:** Lines 134-189

### 3. ✅ JSON Schema Compatibility
**Problem:** Anthropic tools don't support `anyOf` patterns used in current schema. Specifically, `patient_age: { anyOf: [{type: 'string'}, {type: 'number'}, {type: 'null'}] }` (multi-type union) would fail with the initial adapter that only handled single-type cases.

**Solution:**
- Implemented `convertSchemaForAnthropic()` adapter function
- **Handles all anyOf patterns:**
  - Single type + null: `anyOf: [{type: 'string'}, {type: 'null'}]` → `type: ['string', 'null']`
  - **Multi-type + null:** `anyOf: [{type: 'string'}, {type: 'number'}, {type: 'null'}]` → `type: ['string', 'number', 'null']`
  - Single type only: `anyOf: [{type: 'boolean'}]` → `type: 'boolean'`
- Preserves `additionalProperties: false` and nested `required` arrays
- Recursive transformation for nested objects and arrays
- Testing: Field-by-field comparison of OpenAI vs Anthropic extraction

**Location in PRD:** Lines 231-300

### 4. ✅ Startup Credential Validation
**Problem:** Per-job validation risks runtime failures during processing.

**Solution:**
- Added provider validation in `server/app.js` startup sequence
- Fails fast with clear error message if credentials missing
- Logs validated provider name and model on successful startup
- Never starts server with invalid configuration
- Implementation in both OpenAI and Anthropic provider classes

**Location in PRD:** Lines 672-719

---

**Version:** 2.7.2
**Status:** Updated → Ready for Review
**Last Updated:** 2025-10-29 (Third Revision)

**Changelog:**
- **v2.7.2:** Simplified image size handling - removed `sharp` dependency (production PDFs are <1MB)
- **v2.7.2:** Replaced compression with validation-only approach (fail gracefully with user feedback)
- **v2.7.2:** Added monitoring for 4MB+ images to track edge cases
- **v2.7.1:** Fixed critical schema converter to handle multi-type `anyOf` unions (e.g., `patient_age`)
- **v2.7.1:** Fixed retry logic to support both OpenAI (`error.response.status`) and Anthropic (`error.status`) SDK error formats
- **v2.7.1:** Added network error retry support (`ETIMEDOUT`, `ECONNRESET`, etc.)
- **v2.7.1:** Added comprehensive unit test examples for critical features
