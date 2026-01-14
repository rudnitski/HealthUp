// server/routes/onboarding.js
// PRD v5.0: First-Time User Onboarding API

import fs from 'fs';
import path from 'path';
import express from 'express';
import OpenAI from 'openai';
import { queryWithUser } from '../db/index.js';
import { getReportDetail } from '../services/reportRetrieval.js';
import { requireAuth } from '../middleware/auth.js';
import { getDirname } from '../utils/path-helpers.js';

const __dirname = getDirname(import.meta.url);
const router = express.Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const INSIGHT_MODEL = process.env.CHAT_MODEL || process.env.SQL_GENERATOR_MODEL || 'gpt-4o-mini';
const INSIGHT_TIMEOUT_MS = 30000;
const MAX_REPORT_IDS = 20;

// Load prompt template (ESM-safe file loading)
const FIRST_INSIGHT_TEMPLATE = fs.readFileSync(
  path.join(__dirname, '../../prompts/first_insight.md'),
  'utf-8'
);

function buildFirstInsightPrompt(labDataJson) {
  return FIRST_INSIGHT_TEMPLATE.replace('{{labResultsJson}}', labDataJson);
}

/**
 * GET /api/onboarding/status
 * Check if user is a new user (no patients AND no reports)
 * Uses efficient COUNT queries (not full list fetch)
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const patientResult = await queryWithUser(
      'SELECT COUNT(*)::INT as count FROM patients',
      [],
      req.user.id
    );
    const reportResult = await queryWithUser(
      'SELECT COUNT(*)::INT as count FROM patient_reports WHERE status = $1',
      ['completed'],
      req.user.id
    );

    const patient_count = patientResult.rows[0]?.count ?? 0;
    const report_count = reportResult.rows[0]?.count ?? 0;

    res.json({
      is_new_user: patient_count === 0 && report_count === 0,
      patient_count,
      report_count
    });
  } catch (error) {
    console.error('[onboarding] Status check failed:', error.message);
    res.status(500).json({ error: 'Failed to check onboarding status' });
  }
});

/**
 * POST /api/onboarding/insight
 * Generate personalized insight for newly uploaded reports
 */
router.post('/insight', requireAuth, async (req, res) => {
  const { report_ids } = req.body;

  if (!report_ids || !Array.isArray(report_ids) || report_ids.length === 0) {
    return res.status(400).json({ error: 'report_ids array required', retryable: false });
  }

  // Defense-in-depth: Cap report_ids to prevent oversized prompts
  if (report_ids.length > MAX_REPORT_IDS) {
    return res.status(400).json({
      error: `Maximum ${MAX_REPORT_IDS} reports allowed`,
      retryable: false
    });
  }

  // UUID validation to prevent PostgreSQL 500 errors
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalidIds = report_ids.filter(id => typeof id !== 'string' || !uuidPattern.test(id));
  if (invalidIds.length > 0) {
    return res.status(400).json({
      error: 'Invalid report_id format - expected UUID',
      retryable: false
    });
  }

  try {
    console.log('[onboarding] Insight requested:', {
      userId: req.user.id,
      report_count: report_ids.length
    });

    // 1. Fetch lab results using existing getReportDetail() function
    const rawReportsData = await Promise.all(
      report_ids.map(id => getReportDetail(id, { mode: 'user', userId: req.user.id }))
    );

    // Filter out null responses (invalid/unauthorized report_ids)
    const reportsData = rawReportsData.filter(Boolean);

    if (reportsData.length === 0) {
      return res.status(404).json({ error: 'No valid reports found', retryable: false });
    }

    // Extract unique patient_ids from all fetched reports
    const patientIds = [...new Set(reportsData.map(r => r.patient_id).filter(Boolean))];

    if (patientIds.length === 0) {
      return res.status(400).json({ error: 'No patient_id found in reports', retryable: false });
    }

    // Use first patient as primary (consistent with client-side behavior)
    const primaryPatientId = patientIds[0];

    // Filter reports to ONLY the primary patient (reject mixed-patient requests)
    const singlePatientReports = reportsData.filter(r => r.patient_id === primaryPatientId);

    if (patientIds.length > 1) {
      console.warn('[onboarding/insight] Multiple patients in request, filtering to primary:', {
        requested_count: reportsData.length,
        filtered_count: singlePatientReports.length,
        primary_patient_id: primaryPatientId,
        all_patient_ids: patientIds
      });
    }

    // 2. Aggregate parameters from SINGLE-PATIENT reports only
    let allParameters = singlePatientReports.flatMap(r => r?.parameters || []);

    // Parameter count limit to prevent oversized prompts
    const MAX_PARAMETERS = 200;

    if (allParameters.length > MAX_PARAMETERS) {
      console.warn('[onboarding/insight] Truncating parameters:', {
        original_count: allParameters.length,
        truncated_to: MAX_PARAMETERS
      });

      // Prioritize out-of-range values (most clinically relevant)
      const outOfRange = allParameters.filter(p => p.is_value_out_of_range);
      const normal = allParameters.filter(p => !p.is_value_out_of_range);

      if (outOfRange.length >= MAX_PARAMETERS) {
        allParameters = outOfRange.slice(-MAX_PARAMETERS);
      } else {
        const remainingSlots = MAX_PARAMETERS - outOfRange.length;
        allParameters = [...outOfRange, ...normal.slice(-remainingSlots)];
      }
    }

    const firstReport = singlePatientReports[0];
    const patient_id = primaryPatientId;

    // 3. Build prompt with lab data
    const labDataJson = JSON.stringify({
      patient: {
        name: firstReport?.patient_name,
        gender: firstReport?.patient_gender
      },
      reports_count: singlePatientReports.length,
      parameters: allParameters.map(p => ({
        name: p.parameter_name,
        value: p.result,
        unit: p.unit,
        out_of_range: p.is_value_out_of_range,
        reference: p.reference_interval?.text
      }))
    }, null, 2);

    const systemPrompt = buildFirstInsightPrompt(labDataJson);

    // 4. Call LLM with structured output (Responses API - per CLAUDE.md gotcha #11)
    const response = await openai.responses.parse({
      model: INSIGHT_MODEL,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `${systemPrompt}\n\nGenerate the insight and suggestions based on the lab data provided.`
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'insight_response',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              sections: {
                type: 'array',
                description: 'Exactly 3 sections: finding, action, tracking',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['finding', 'action', 'tracking'],
                      description: 'Section type for visual styling'
                    },
                    title: {
                      type: 'string',
                      description: 'Section heading in the same language as lab data'
                    },
                    text: {
                      type: 'string',
                      description: '1-2 sentences for this section'
                    }
                  },
                  required: ['type', 'title', 'text'],
                  additionalProperties: false
                },
                minItems: 3,
                maxItems: 3
              },
              suggestions_intro: {
                type: 'string',
                description: 'Conversational intro phrase in same language as lab data, e.g. "I can tell you more about:"'
              },
              suggestions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'Topic phrase that flows after intro' },
                    query: { type: 'string', description: 'Full question to send to chat' }
                  },
                  required: ['label', 'query'],
                  additionalProperties: false
                },
                minItems: 2,
                maxItems: 4
              }
            },
            required: ['sections', 'suggestions_intro', 'suggestions'],
            additionalProperties: false
          }
        }
      },
      temperature: 0.7
    }, {
      timeout: INSIGHT_TIMEOUT_MS
    });

    // 5. Access parsed response with defensive null check
    const parsed = response.output_parsed;
    if (!parsed || !Array.isArray(parsed.sections) || parsed.sections.length !== 3 || !Array.isArray(parsed.suggestions)) {
      console.error('[onboarding] LLM returned malformed response:', {
        userId: req.user.id,
        has_parsed: !!parsed,
        has_sections: Array.isArray(parsed?.sections),
        sections_count: parsed?.sections?.length,
        has_suggestions: Array.isArray(parsed?.suggestions)
      });
      return res.status(500).json({ error: 'Failed to parse LLM response', retryable: true });
    }

    console.log('[onboarding] Insight generated:', {
      userId: req.user.id,
      suggestion_count: parsed.suggestions.length,
      patient_name: firstReport?.patient_name,
      patient_id
    });

    // Return insight sections with patient info and lab data for client display
    // PRD v5.0: Include lab_data for system prompt injection (avoids LLM needing SQL for basic questions)
    res.json({
      sections: parsed.sections,
      suggestions_intro: parsed.suggestions_intro,
      suggestions: parsed.suggestions,
      analytes_extracted: allParameters.length,
      reports_processed: singlePatientReports.length,
      patient_id,
      patient_name: firstReport?.patient_name || null,
      lab_data: allParameters.map(p => ({
        parameter_name: p.parameter_name,
        result: p.result,
        unit: p.unit,
        reference_interval: p.reference_interval?.text || null,
        is_value_out_of_range: p.is_value_out_of_range || false
      }))
    });

  } catch (error) {
    // OpenAI SDK throws various timeout errors: APIConnectionTimeoutError, ETIMEDOUT, AbortError
    const isTimeout = error.name === 'AbortError' ||
                      error.code === 'ETIMEDOUT' ||
                      error.name === 'APIConnectionTimeoutError' ||
                      (error.message && error.message.includes('timeout'));
    if (isTimeout) {
      console.error('[onboarding] Insight generation timed out:', { userId: req.user.id });
      return res.status(504).json({ error: 'Insight generation timed out', retryable: true });
    }
    console.error('[onboarding] Insight generation failed:', error.message);
    res.status(500).json({ error: 'Failed to generate insight', retryable: true });
  }
});

export default router;
