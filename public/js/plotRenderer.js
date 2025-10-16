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

  const zoomPluginRegistered = registerZoomPlugin();

  /**
   * Group data points by unit for multi-series plotting
   * @param {Array} rows - Array of {t: timestamp_ms, y: numeric, unit: string}
   * @returns {Array} Array of {unit: string, points: Array<{x: number, y: number}>}
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
          xType: typeof xValue,
          yValid: !isNaN(yValue),
          xValid: !isNaN(xValue)
        });
      }

      if (!groups[unit]) {
        groups[unit] = [];
      }
      groups[unit].push({
        x: xValue, // Unix timestamp in milliseconds (converted to number)
        y: yValue
      });
    });

    const result = Object.entries(groups).map(([unit, points]) => ({
      unit,
      points: points.sort((a, b) => a.x - b.x) // Ensure chronological order
    }));

    console.log('[plotRenderer] groupByUnit output:', {
      seriesCount: result.length,
      series: result.map(s => ({ unit: s.unit, pointCount: s.points.length, firstPoint: s.points[0] }))
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
      '#4BC0C0', // Repeat colors if more than 6 series
    ];

    // Group data by unit
    const seriesData = groupByUnit(rows);

    // Create datasets for Chart.js
    const datasets = seriesData.map((series, index) => {
      console.log(`[plotRenderer] Creating dataset for ${series.unit}:`, {
        pointCount: series.points.length,
        firstPoint: series.points[0],
        lastPoint: series.points[series.points.length - 1],
        xRange: {
          min: Math.min(...series.points.map(p => p.x)),
          max: Math.max(...series.points.map(p => p.x))
        },
        yRange: {
          min: Math.min(...series.points.map(p => p.y)),
          max: Math.max(...series.points.map(p => p.y))
        }
      });

      return {
        label: series.unit,
        data: series.points,
        borderColor: COLORS[index % COLORS.length],
        backgroundColor: COLORS[index % COLORS.length] + '33', // 20% opacity
        tension: 0.1, // Slight curve for smoother lines
        pointRadius: 5, // Larger points for visibility
        pointHoverRadius: 8,
        borderWidth: 2, // Thicker lines
        fill: false,
        showLine: true // Explicitly show lines between points
      };
    });

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
                const unit = context.dataset.label;
                return `${value} ${unit}`;
              }
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
          },
          ...(zoomPluginRegistered ? {
            zoom: {
              limits: {
                x: { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY },
                y: { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY }
              },
              pan: {
                enabled: true,
                mode: 'x',
                modifierKey: 'shift'
              },
              zoom: {
                wheel: {
                  enabled: true,
                  modifierKey: null
                },
                pinch: {
                  enabled: true
                },
                drag: {
                  enabled: true,
                  modifierKey: null
                },
                mode: 'x'
              }
            }
          } : {})
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
