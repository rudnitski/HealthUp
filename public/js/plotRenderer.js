/**
 * Plot Renderer for Lab Results Time-Series Visualization
 * Uses Chart.js with date-fns adapter for time-series plotting
 * PRD: docs/PRD_v2_1_plot_generation.md
 */

(() => {
  // Import Chart.js (expects Chart.js to be loaded via CDN or bundler)
  // Chart.js and chartjs-adapter-date-fns must be available globally

  const registerZoomPlugin = () => {
    if (typeof window === 'undefined' || !window.Chart || typeof window.Chart.register !== 'function') {
      return false;
    }

    const zoomPlugin =
      window.chartjsPluginZoom ||
      window.ChartZoom ||
      (typeof window['chartjs-plugin-zoom'] !== 'undefined' ? window['chartjs-plugin-zoom'] : null);

    if (!zoomPlugin) {
      console.warn('[plotRenderer] chartjs-plugin-zoom not found. Zoom/pan disabled.');
      return false;
    }

    try {
      window.Chart.register(zoomPlugin);
      console.log('[plotRenderer] chartjs-plugin-zoom registered');
      return true;
    } catch (error) {
      console.warn('[plotRenderer] Failed to register chartjs-plugin-zoom:', error);
      return false;
    }
  };

  const registerDatalabelsPlugin = () => {
    if (typeof window === 'undefined' || !window.Chart || typeof window.Chart.register !== 'function') {
      return false;
    }

    const datalabelsPlugin =
      window.ChartDataLabels ||
      (typeof window['chartjs-plugin-datalabels'] !== 'undefined' ? window['chartjs-plugin-datalabels'] : null);

    if (!datalabelsPlugin) {
      console.warn('[plotRenderer] chartjs-plugin-datalabels not found. Value labels disabled.');
      return false;
    }

    try {
      window.Chart.register(datalabelsPlugin);
      console.log('[plotRenderer] chartjs-plugin-datalabels registered');
      return true;
    } catch (error) {
      console.warn('[plotRenderer] Failed to register chartjs-plugin-datalabels:', error);
      return false;
    }
  };

  const zoomPluginRegistered = registerZoomPlugin();
  const datalabelsPluginRegistered = registerDatalabelsPlugin();

  /**
   * Group data points by unit for multi-series plotting with reference bands
   * @param {Array} rows - Array of {t, y, unit, reference_lower, reference_upper, reference_*_operator, is_value_out_of_range}
   * @returns {Array} Array of {unit: string, measurements: Array, referenceBand: Array, outOfRangePoints: Array}
   */
  const groupByUnit = (rows) => {
    console.log('[plotRenderer] groupByUnit input:', {
      rowCount: rows.length,
      firstRow: rows[0]
    });

    const groups = {};

    rows.forEach((row, index) => {
      const unit = row.unit || 'unknown';
      // Convert timestamp to number if it's a string
      const xValue = typeof row.t === 'string' ? parseInt(row.t, 10) : row.t;
      const yValue = parseFloat(row.y);

      if (index < 3) {
        console.log(`[plotRenderer] Processing row ${index}:`, {
          raw: row,
          unit,
          x: xValue,
          y: yValue,
          hasReferenceBands: row.reference_lower !== null || row.reference_upper !== null,
          isOutOfRange: row.is_value_out_of_range || row.is_out_of_range
        });
      }

      if (!groups[unit]) {
        groups[unit] = {
          measurements: [],
          referenceBand: [],
          outOfRangePoints: []
        };
      }

      // Parse reference bounds
      const refLower = row.reference_lower !== null && row.reference_lower !== undefined
        ? parseFloat(row.reference_lower)
        : null;
      const refUpper = row.reference_upper !== null && row.reference_upper !== undefined
        ? parseFloat(row.reference_upper)
        : null;

      // Validate range: ignore reversed ranges (lower > upper)
      const hasValidRange = refLower !== null && refUpper !== null && refLower <= refUpper;
      const hasOneLimitOnly = (refLower !== null && refUpper === null) || (refLower === null && refUpper !== null);

      // Add measurement point
      const measurementPoint = {
        x: xValue,
        y: yValue,
        reference_lower: refLower,
        reference_upper: refUpper,
        reference_lower_operator: row.reference_lower_operator,
        reference_upper_operator: row.reference_upper_operator
      };
      groups[unit].measurements.push(measurementPoint);

      // Add reference band point (if valid)
      if (hasValidRange || hasOneLimitOnly) {
        groups[unit].referenceBand.push({
          x: xValue,
          lower: refLower,
          upper: refUpper,
          lower_operator: row.reference_lower_operator,
          upper_operator: row.reference_upper_operator
        });
      }

      // Track out-of-range points separately
      const isOutOfRange = row.is_value_out_of_range === true || row.is_out_of_range === true;
      if (isOutOfRange) {
        groups[unit].outOfRangePoints.push({
          x: xValue,
          y: yValue
        });
      }
    });

    // Convert to array and sort chronologically
    const result = Object.entries(groups).map(([unit, data]) => ({
      unit,
      measurements: data.measurements.sort((a, b) => a.x - b.x),
      referenceBand: data.referenceBand.sort((a, b) => a.x - b.x),
      outOfRangePoints: data.outOfRangePoints.sort((a, b) => a.x - b.x)
    }));

    console.log('[plotRenderer] groupByUnit output:', {
      seriesCount: result.length,
      series: result.map(s => ({
        unit: s.unit,
        measurementCount: s.measurements.length,
        referenceBandCount: s.referenceBand.length,
        outOfRangeCount: s.outOfRangePoints.length
      }))
    });

    return result;
  };

  /**
   * Render a time-series plot using Chart.js
   * @param {string} canvasId - ID of canvas element
   * @param {Array} rows - Array of {t: timestamp_ms, y: numeric, unit: string}
   * @param {Object} options - Additional configuration options
   * @returns {Chart|null} Chart.js instance or null if failed
   */
  const renderPlot = (canvasId, rows, options = {}) => {
    console.log('[plotRenderer] renderPlot called', {
      canvasId,
      rowCount: rows?.length,
      hasChart: !!window.Chart,
      options
    });

    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      console.error(`[plotRenderer] Canvas element "${canvasId}" not found`);
      return null;
    }

    console.log('[plotRenderer] Canvas element found:', {
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      offsetWidth: canvas.offsetWidth,
      offsetHeight: canvas.offsetHeight,
      parentHidden: canvas.parentElement?.hidden
    });

    if (!window.Chart) {
      console.error('[plotRenderer] Chart.js not loaded. Include Chart.js library.');
      return null;
    }

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      console.warn('[plotRenderer] No data to plot');
      return null;
    }

    console.log('[plotRenderer] Sample data:', rows.slice(0, 2));

    const ctx = canvas.getContext('2d');

    // Color palette for multiple series
    const COLORS = [
      '#4BC0C0', // Teal
      '#FF6384', // Pink
      '#36A2EB', // Blue
      '#FFCE56', // Yellow
      '#9966FF', // Purple
      '#FF9F40', // Orange
    ];

    // Reference band color (light green with low opacity)
    const BAND_COLOR = 'rgba(144, 238, 144, 0.25)'; // Light green, 25% opacity
    const BAND_BORDER_COLOR = 'rgba(144, 238, 144, 0.5)'; // Light green border

    // Out-of-range color (pink/red)
    const OUT_OF_RANGE_COLOR = 'rgba(255, 99, 132, 0.8)'; // Pink/red

    // Group data by unit
    const seriesData = groupByUnit(rows);

    // Create datasets for Chart.js (multiple datasets per unit for bands)
    const datasets = [];

    seriesData.forEach((series, seriesIndex) => {
      const color = COLORS[seriesIndex % COLORS.length];

      console.log(`[plotRenderer] Creating datasets for ${series.unit}:`, {
        measurementCount: series.measurements.length,
        referenceBandCount: series.referenceBand.length,
        outOfRangeCount: series.outOfRangePoints.length
      });

      // Dataset 1 & 2: Reference band (if exists)
      // Strategy: Create horizontal band spanning entire time range
      if (series.referenceBand.length > 0) {
        console.log(`[plotRenderer] Processing reference band for ${series.unit}:`, {
          bandPointCount: series.referenceBand.length,
          sampleBandPoint: series.referenceBand[0]
        });

        // Find the most common reference range (mode)
        // Group by lower/upper pair to handle adaptive ranges
        const rangeCounts = new Map();
        series.referenceBand.forEach(point => {
          const key = `${point.lower}|${point.upper}`;
          rangeCounts.set(key, (rangeCounts.get(key) || 0) + 1);
        });

        console.log('[plotRenderer] Range counts:', Array.from(rangeCounts.entries()));

        // Find most frequent range - PREFER complete ranges (both lower AND upper)
        let mostFrequentRange = null;
        let maxCount = 0;
        let hasCompleteRange = false;

        // First pass: look for complete ranges (both lower and upper)
        rangeCounts.forEach((count, key) => {
          const [lower, upper] = key.split('|');
          const lowerVal = lower !== 'null' ? parseFloat(lower) : null;
          const upperVal = upper !== 'null' ? parseFloat(upper) : null;

          // Complete range (both bounds present)
          if (lowerVal !== null && upperVal !== null) {
            if (count > maxCount || !hasCompleteRange) {
              maxCount = count;
              mostFrequentRange = { lower: lowerVal, upper: upperVal };
              hasCompleteRange = true;
            }
          }
        });

        // Second pass: if no complete ranges, accept partial ranges
        if (!hasCompleteRange) {
          rangeCounts.forEach((count, key) => {
            const [lower, upper] = key.split('|');
            if (count > maxCount) {
              maxCount = count;
              mostFrequentRange = {
                lower: lower !== 'null' ? parseFloat(lower) : null,
                upper: upper !== 'null' ? parseFloat(upper) : null
              };
            }
          });
        }

        console.log('[plotRenderer] Most frequent range:', mostFrequentRange,
          `(complete: ${hasCompleteRange}, count: ${maxCount})`);

        if (mostFrequentRange && (mostFrequentRange.lower !== null || mostFrequentRange.upper !== null)) {
          // Get time range from measurements
          const timeMin = Math.min(...series.measurements.map(m => m.x));
          const timeMax = Math.max(...series.measurements.map(m => m.x));

          // Create horizontal band data (2 points: start and end of time range)
          const lowerBandData = [];
          const upperBandData = [];

          if (mostFrequentRange.lower !== null) {
            lowerBandData.push(
              { x: timeMin, y: mostFrequentRange.lower },
              { x: timeMax, y: mostFrequentRange.lower }
            );
          }

          if (mostFrequentRange.upper !== null) {
            upperBandData.push(
              { x: timeMin, y: mostFrequentRange.upper },
              { x: timeMax, y: mostFrequentRange.upper }
            );
          }

          if (lowerBandData.length > 0 && upperBandData.length > 0) {
            // Case 1: Two-sided band (fill between lower and upper)
            console.log('[plotRenderer] Adding two-sided reference band');
            datasets.push({
              label: `_${series.unit}_lower_band`,
              data: lowerBandData,
              borderColor: BAND_BORDER_COLOR,
              backgroundColor: 'transparent',
              borderWidth: 1,
              borderDash: [5, 5],
              pointRadius: 0,
              pointHoverRadius: 0,
              fill: false,
              showLine: true,
              tension: 0,
              order: 3,
              datalabels: { display: false }
            });
            datasets.push({
              label: `Healthy range (${series.unit})`,
              data: upperBandData,
              borderColor: BAND_BORDER_COLOR,
              backgroundColor: BAND_COLOR,
              borderWidth: 1,
              borderDash: [5, 5],
              pointRadius: 0,
              pointHoverRadius: 0,
              fill: '-1',
              showLine: true,
              tension: 0,
              order: 3,
              datalabels: { display: false }
            });
          } else if (upperBandData.length > 0) {
            // Case 2: Upper-bound only (fill to origin)
            console.log('[plotRenderer] Adding upper-only reference band');
            datasets.push({
              label: `Healthy range (${series.unit})`,
              data: upperBandData,
              borderColor: BAND_BORDER_COLOR,
              backgroundColor: BAND_COLOR,
              borderWidth: 1,
              borderDash: [5, 5],
              pointRadius: 0,
              pointHoverRadius: 0,
              fill: 'start',
              showLine: true,
              tension: 0,
              order: 3,
              datalabels: { display: false }
            });
          } else if (lowerBandData.length > 0) {
            // Case 3: Lower-bound only (fill to end/top)
            console.log('[plotRenderer] Adding lower-only reference band');
            datasets.push({
              label: `Healthy range (${series.unit})`,
              data: lowerBandData,
              borderColor: BAND_BORDER_COLOR,
              backgroundColor: BAND_COLOR,
              borderWidth: 1,
              borderDash: [5, 5],
              pointRadius: 0,
              pointHoverRadius: 0,
              fill: 'end',
              showLine: true,
              tension: 0,
              order: 3,
              datalabels: { display: false }
            });
          }
        } else {
          console.warn('[plotRenderer] No valid reference range found for', series.unit);
        }
      } else {
        console.log('[plotRenderer] No reference band data for', series.unit);
      }

      // Dataset 3: Measurement line
      const measurementData = series.measurements.map(point => ({
        x: point.x,
        y: point.y,
        // Store reference info for tooltips
        _reference_lower: point.reference_lower,
        _reference_upper: point.reference_upper,
        _reference_lower_operator: point.reference_lower_operator,
        _reference_upper_operator: point.reference_upper_operator
      }));

      datasets.push({
        label: `Results (${series.unit})`,
        data: measurementData,
        borderColor: color,
        backgroundColor: color + '33',
        tension: 0.1,
        pointRadius: 5,
        pointHoverRadius: 8,
        borderWidth: 2,
        fill: false,
        showLine: true,
        order: 2, // Render on top of bands
        datalabels: {
          display: datalabelsPluginRegistered,
          align: 'top',
          anchor: 'end',
          offset: 4,
          color: '#1c1c1e',
          font: {
            size: 11,
            weight: 'bold'
          },
          formatter: (value) => {
            // Format to 1-2 decimal places, remove trailing zeros
            const num = parseFloat(value.y);
            return num % 1 === 0 ? num.toFixed(0) : num.toFixed(2).replace(/\.?0+$/, '');
          }
        }
      });

      // Dataset 4: Out-of-range points (if any)
      if (series.outOfRangePoints.length > 0) {
        datasets.push({
          label: `Out of range (${series.unit})`,
          data: series.outOfRangePoints,
          borderColor: OUT_OF_RANGE_COLOR,
          backgroundColor: OUT_OF_RANGE_COLOR,
          pointRadius: 7,
          pointHoverRadius: 10,
          pointStyle: 'triangle',
          borderWidth: 2,
          showLine: false,
          order: 1, // Render on top
          datalabels: {
            display: false // No labels on out-of-range markers (triangle already indicates issue)
          }
        });
      }
    });

    // Calculate Y-axis range with padding for better aesthetics
    // Collect all Y values (measurements, reference bands)
    const allYValues = [];
    datasets.forEach(dataset => {
      dataset.data.forEach(point => {
        if (point.y !== null && point.y !== undefined && !isNaN(point.y)) {
          allYValues.push(point.y);
        }
      });
    });

    let suggestedMin = undefined;
    let suggestedMax = undefined;

    if (allYValues.length > 0) {
      const minY = Math.min(...allYValues);
      const maxY = Math.max(...allYValues);
      const range = maxY - minY;

      // Add 20% padding above and below for visual breathing room
      const padding = range * 0.2;
      suggestedMin = Math.max(0, minY - padding); // Don't go below 0 for lab values
      suggestedMax = maxY + padding;

      console.log('[plotRenderer] Y-axis range:', {
        dataMin: minY,
        dataMax: maxY,
        suggestedMin,
        suggestedMax,
        paddingPercent: '20%'
      });
    }

    // Chart configuration
    const config = {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: {
              unit: options.timeUnit || 'day',
              displayFormats: {
                day: 'MMM dd',
                week: 'MMM dd',
                month: 'MMM yyyy',
                year: 'yyyy'
              },
              tooltipFormat: 'PPP' // Full date format in tooltips
            },
            title: {
              display: true,
              text: options.xAxisLabel || 'Date',
              font: {
                size: 14,
                weight: 'bold'
              }
            },
            grid: {
              display: true,
              color: 'rgba(0, 0, 0, 0.1)'
            },
            ticks: {
              maxRotation: 45,
              minRotation: 0,
              autoSkip: true,
              maxTicksLimit: 10
            }
          },
          y: {
            beginAtZero: false,
            suggestedMin: suggestedMin,
            suggestedMax: suggestedMax,
            title: {
              display: true,
              text: options.yAxisLabel || 'Value',
              font: {
                size: 14,
                weight: 'bold'
              }
            },
            grid: {
              display: true,
              color: 'rgba(0, 0, 0, 0.1)'
            }
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed.y;
                const datasetLabel = context.dataset.label;

                // Skip tooltip for hidden band datasets
                if (datasetLabel && datasetLabel.startsWith('_')) {
                  return null;
                }

                // For measurement datasets, show value with reference range
                if (datasetLabel && datasetLabel.startsWith('Results')) {
                  const dataPoint = context.dataset.data[context.dataIndex];
                  const refLower = dataPoint?._reference_lower;
                  const refUpper = dataPoint?._reference_upper;
                  const refLowerOp = dataPoint?._reference_lower_operator;
                  const refUpperOp = dataPoint?._reference_upper_operator;

                  // Format value
                  let label = `${value}`;

                  // Add reference range if available
                  if (refLower !== null && refUpper !== null) {
                    // Two-sided range
                    const lowerSymbol = refLowerOp === '>' ? '>' : '≥';
                    const upperSymbol = refUpperOp === '<' ? '<' : '≤';
                    label += ` (Healthy: ${lowerSymbol} ${refLower}, ${upperSymbol} ${refUpper})`;
                  } else if (refLower !== null) {
                    // Only lower bound
                    const symbol = refLowerOp === '>' ? '>' : '≥';
                    label += ` (Healthy: ${symbol} ${refLower})`;
                  } else if (refUpper !== null) {
                    // Only upper bound
                    const symbol = refUpperOp === '<' ? '<' : '≤';
                    label += ` (Healthy: ${symbol} ${refUpper})`;
                  }

                  return label;
                }

                // For other datasets (out-of-range, bands), show simple label
                return `${value}`;
              },
              title: (tooltipItems) => {
                // Format date for tooltip title
                if (tooltipItems.length > 0) {
                  const timestamp = tooltipItems[0].parsed.x;
                  const date = new Date(timestamp);
                  return date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  });
                }
                return '';
              }
            },
            filter: (tooltipItem) => {
              // Hide tooltips for hidden band datasets
              return !tooltipItem.dataset.label?.startsWith('_');
            }
          },
          legend: {
            display: true,
            position: 'top',
            labels: {
              usePointStyle: true,
              padding: 15,
              font: {
                size: 12
              },
              // Filter out hidden datasets from legend
              filter: (legendItem, chartData) => {
                return !legendItem.text?.startsWith('_');
              }
            }
          },
          title: {
            display: !!options.title,
            text: options.title || '',
            font: {
              size: 14,
              weight: 'bold'
            },
            padding: {
              top: 5,
              bottom: 15
            },
            color: '#1c1c1e'
          }
        },
        interaction: {
          mode: 'nearest',
          axis: 'x',
          intersect: false
        }
      }
    };

    console.log('[plotRenderer] Creating chart with config:', {
      datasetCount: datasets.length,
      totalPoints: datasets.reduce((sum, ds) => sum + ds.data.length, 0)
    });

    try {
      const chart = new Chart(ctx, config);
      console.log('[plotRenderer] Chart created successfully:', {
        chartId: chart.id,
        datasetCount: chart.data.datasets.length
      });
      return chart;
    } catch (error) {
      console.error('[plotRenderer] Failed to create chart:', error);
      return null;
    }
  };

  /**
   * Destroy existing chart instance
   * @param {Chart} chart - Chart.js instance to destroy
   */
  const destroyChart = (chart) => {
    if (chart && typeof chart.destroy === 'function') {
      chart.destroy();
    }
  };

  /**
   * Execute SQL query and render plot
   * @param {string} sql - SQL query to execute
   * @param {string} canvasId - ID of canvas element
   * @param {Object} options - Additional options
   * @returns {Promise<Chart|null>} Chart.js instance or null
   */
  const executeSqlAndRenderPlot = async (sql, canvasId, options = {}) => {
    if (!sql || typeof sql !== 'string') {
      console.error('[plotRenderer] Invalid SQL query');
      return null;
    }

    try {
      // Execute SQL query via backend endpoint
      // Assuming the backend has an endpoint to execute SQL directly
      // This should be implemented in the backend (not covered in this PRD)
      const response = await fetch('/api/execute-sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || 'SQL execution failed';
        console.error('[plotRenderer] SQL execution failed:', errorMessage);
        return null;
      }

      const result = await response.json();
      const rows = result.rows || [];

      if (!rows.length) {
        console.warn('[plotRenderer] No data returned from SQL query');
        return null;
      }

      return renderPlot(canvasId, rows, options);
    } catch (error) {
      console.error('[plotRenderer] Error executing SQL and rendering plot:', error);
      return null;
    }
  };

  // Export to global scope
  window.plotRenderer = {
    renderPlot,
    destroyChart,
    executeSqlAndRenderPlot,
    groupByUnit
  };

  console.log('[plotRenderer] Module initialized', {
    hasChart: !!window.Chart,
    functions: Object.keys(window.plotRenderer)
  });
})();
