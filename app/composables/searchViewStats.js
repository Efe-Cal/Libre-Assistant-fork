/**
 * @file searchViewStats.js
 * @description Composable to calculate web page read statistics from executed tools only
 */

// Function to get formatted statistics string for display from executed tools only
function getFormattedStatsFromExecutedTools(executedTools) {
  let pageCount = 0;

  // Count from tool_calls (both new parts based and old structure use this)
  if (executedTools && Array.isArray(executedTools)) {
    executedTools.forEach(tool => {
      // Count web page operations (type: "browser.open")
      if (tool.type === 'browser.open') {
        pageCount++;
      }
      // Count new search tool operations
      if (tool.type === 'function' && tool.function?.name === 'search') {
        pageCount++;
      }
    });
  }

  // Display only if there are pages read
  if (pageCount > 0) {
    return `Performed ${pageCount} search${pageCount !== 1 ? 'es' : ''}`;
  }

  return '';
}

export {
  getFormattedStatsFromExecutedTools
};